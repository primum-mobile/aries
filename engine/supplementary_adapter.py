# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

import copy
import datetime

from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Any, Dict, Optional, Tuple

import astrology
import chart
import geonames
from engine import chart_factory
from engine import converse_transits
from engine import moment
import planets
import posfordate
import revolutions
from engine import solilunar
from engine import synodic_cycle
import symbolic_time


DisplayDateTime = Tuple[int, int, int, int, int, int]


def progression_method_for_feature_kind(feature_kind):
	if feature_kind == 'solar_arc':
		return posfordate.SOLAR_ARC
	if feature_kind == 'minor':
		return posfordate.MINOR
	if feature_kind == 'tertiary':
		return posfordate.TERTIARY
	return posfordate.SECONDARY


def progression_feature_kind_for_method(method):
	method = posfordate.progression_method(method)
	if method == posfordate.SOLAR_ARC:
		return 'solar_arc'
	if method == posfordate.MINOR:
		return 'minor'
	if method == posfordate.TERTIARY:
		return 'tertiary'
	return 'secondary'


# --- Per-chart options narrowing (policy-chart-lifecycle "Decided": the
# options singleton is the accepted global model; per-chart toggles scope by
# READ-time narrowed copies, never by mutating the global). The Marr sidereal
# flag is the first binding-scoped option: each return document carries
# retained_state['marr_sidereal'], stamped from the global default on first
# build; the document-row toggle flips the binding, Settings > Revolutions
# keeps owning the default for newly opened returns.

MARR_ATTR_BY_FEATURE_KIND = {
	'solar_return': 'revsidereal_marr_solar',
	'solar_average': 'revsidereal_marr_solar',
	'lunar_average': 'revsidereal_marr_lunar',
	'lunar_return': 'revsidereal_marr_lunar',
	'planetary_return': 'revsidereal_marr_planet',
}


class _OptionsOverlay(object):
	"""Read-only options view with a few attributes overridden.

	revolutions._marr_sidereal_enabled reads ``chrt.options``; handing the
	compute a shallow chart copy holding this overlay scopes the flag to one
	build without touching the process-wide options object."""

	def __init__(self, base, overrides):
		object.__setattr__(self, '_base', base)
		object.__setattr__(self, '_overrides', dict(overrides))

	def __getattr__(self, name):
		overrides = object.__getattribute__(self, '_overrides')
		if name in overrides:
			return overrides[name]
		return getattr(object.__getattribute__(self, '_base'), name)


def resolve_marr_retained(options, retained, feature_kind):
	"""The per-document Marr flag: binding value if stamped, else the global
	default (which is then stamped by the caller via retained update)."""
	attr = MARR_ATTR_BY_FEATURE_KIND.get(feature_kind)
	if attr is None:
		return None
	value = retained.get('marr_sidereal')
	if value is None:
		value = getattr(options, attr, False)
	return bool(value)


def chart_with_marr_override(chrt, feature_kind, marr_value):
	"""A shallow chart copy whose options report the per-document Marr flag."""
	attr = MARR_ATTR_BY_FEATURE_KIND.get(feature_kind)
	if chrt is None or attr is None or marr_value is None:
		return chrt
	options = getattr(chrt, 'options', None)
	if options is None:
		return chrt
	if bool(getattr(options, attr, False)) == bool(marr_value):
		return chrt
	clone = copy.copy(chrt)
	clone.options = _OptionsOverlay(options, {attr: bool(marr_value)})
	return clone


def place_to_payload(place_obj):
	if place_obj is None:
		return None
	return {
		'place': getattr(place_obj, 'place', ''),
		'deglon': int(getattr(place_obj, 'deglon', 0)),
		'minlon': int(getattr(place_obj, 'minlon', 0)),
		'seclon': int(getattr(place_obj, 'seclon', 0)),
		'east': bool(getattr(place_obj, 'east', True)),
		'deglat': int(getattr(place_obj, 'deglat', 0)),
		'minlat': int(getattr(place_obj, 'minlat', 0)),
		'seclat': int(getattr(place_obj, 'seclat', 0)),
		'north': bool(getattr(place_obj, 'north', True)),
		'altitude': int(getattr(place_obj, 'altitude', 0)),
		# Full-precision signed decimals alongside the (floored) integer DMS, so a
		# round-trip keeps a clicked coordinate exact — the DMS fields alone floor
		# to the whole arcsecond (~30 m). payload_to_place prefers these.
		'lon': float(getattr(place_obj, 'lon', 0.0)),
		'lat': float(getattr(place_obj, 'lat', 0.0)),
	}


def payload_to_place(payload, fallback=None):
	if payload is None:
		fallback_payload = place_to_payload(fallback)
		if fallback_payload is None:
			return None
		payload = fallback_payload
	place = chart.Place(
		payload.get('place', ''),
		int(payload.get('deglon', 0)),
		int(payload.get('minlon', 0)),
		int(payload.get('seclon', 0)),
		bool(payload.get('east', True)),
		int(payload.get('deglat', 0)),
		int(payload.get('minlat', 0)),
		int(payload.get('seclat', 0)),
		bool(payload.get('north', True)),
		int(payload.get('altitude', 0)),
	)
	# Place.__init__ recomputes lon/lat from the integer DMS above (floored to the
	# arcsecond); when the payload carries the exact signed decimals, restore them
	# so a relocated solar/transit "here" chart lands on the clicked point.
	if payload.get('lon') is not None and payload.get('lat') is not None:
		place.lon = float(payload['lon'])
		place.lat = float(payload['lat'])
	return place


def _display_datetime_to_datetime(display_dt):
	if display_dt is None:
		return None
	try:
		parts = tuple(int(value) for value in tuple(display_dt)[:6])
		if len(parts) < 6:
			return None
		return datetime.datetime(*parts)
	except Exception:
		return None


def _chart_time_to_datetime(chrt):
	time_obj = getattr(chrt, 'time', None)
	if time_obj is None:
		return None
	try:
		return datetime.datetime(
			int(getattr(time_obj, 'year')),
			int(getattr(time_obj, 'month')),
			int(getattr(time_obj, 'day')),
			int(getattr(time_obj, 'hour')),
			int(getattr(time_obj, 'minute')),
			int(getattr(time_obj, 'second')),
		)
	except Exception:
		return None


def _chart_time_context_payload(time_obj):
	if time_obj is None:
		return {}
	return {
		'cal': int(getattr(time_obj, 'cal', chart.Time.GREGORIAN)),
		'zt': int(getattr(time_obj, 'zt', chart.Time.ZONE)),
		'plus': bool(getattr(time_obj, 'plus', True)),
		'zh': int(getattr(time_obj, 'zh', 0) or 0),
		'zm': int(getattr(time_obj, 'zm', 0) or 0),
		'daylight': bool(getattr(time_obj, 'daylightsaving', False)),
		'tzid': str(getattr(time_obj, 'tzid', '') or ''),
		'tzauto': bool(getattr(time_obj, 'tzauto', False)),
	}


_RETAINED_CLOCK_KEYS = {
	'symbolic': {
		'place_payload': 'symbolic_place_payload',
		'cal': 'symbolic_cal',
		'zt': 'symbolic_zt',
		'plus': 'symbolic_plus',
		'zh': 'symbolic_zh',
		'zm': 'symbolic_zm',
		'daylight': 'symbolic_daylight',
		'tzid': 'symbolic_tzid',
		'tzauto': 'symbolic_tzauto',
	},
	'physical': {
		'place_payload': 'physical_place_payload',
		'cal': 'physical_cal',
		'zt': 'physical_zt',
		'plus': 'physical_plus',
		'zh': 'physical_zh',
		'zm': 'physical_zm',
		'daylight': 'physical_daylight',
		'tzid': 'physical_tzid',
		'tzauto': 'physical_tzauto',
	},
}


def _retained_clock_keys(prefix):
	try:
		return _RETAINED_CLOCK_KEYS[prefix]
	except KeyError as exc:
		raise ValueError("unsupported retained clock") from exc


def retained_clock_time(retained, prefix, values, *, fallback_place=None, fallback_time=None):
	"""Build a ``chart.Time`` from one retained converse-transit clock.

	Converse sessions retain two independent civil clocks: ``symbolic_*`` for
	the list/header cursor and ``physical_*`` for the actual transit epoch shown
	in the footer.  This helper is shared by the adapter and its phase stepper so
	both resolve IANA/static offsets through ``chart.Time`` identically.
	"""
	parts = tuple(int(value) for value in tuple(values)[:6])
	if len(parts) < 6:
		return None
	keys = _retained_clock_keys(prefix)
	place = payload_to_place(
		(retained or {}).get(keys['place_payload']),
		fallback=fallback_place,
	)
	if place is None:
		return None
	source_time = fallback_time
	cal = int((retained or {}).get(
		keys['cal'],
		getattr(source_time, 'cal', chart.Time.GREGORIAN),
	))
	zt = int((retained or {}).get(
		keys['zt'],
		getattr(source_time, 'zt', chart.Time.ZONE),
	))
	plus = bool((retained or {}).get(
		keys['plus'],
		getattr(source_time, 'plus', True),
	))
	zh = int((retained or {}).get(
		keys['zh'],
		getattr(source_time, 'zh', 0) or 0,
	) or 0)
	zm = int((retained or {}).get(
		keys['zm'],
		getattr(source_time, 'zm', 0) or 0,
	) or 0)
	daylight = bool((retained or {}).get(
		keys['daylight'],
		getattr(source_time, 'daylightsaving', False),
	))
	tzid = str((retained or {}).get(
		keys['tzid'],
		getattr(source_time, 'tzid', '') or '',
	) or '')
	tzauto = bool((retained or {}).get(
		keys['tzauto'],
		getattr(source_time, 'tzauto', False),
	))
	# ``moment.utc_to_chart_local`` prefers a retained IANA zone whenever one is
	# available, including older records whose ``tzauto`` flag predates tzid
	# persistence. Resolve the matching local offset before constructing Time so
	# the physical chart JD remains the exact mirrored instant instead of
	# drifting by a historical-zone offset.
	if tzid and cal == chart.Time.GREGORIAN and zt == chart.Time.ZONE:
		try:
			resolved = geonames.Geonames.resolve_zone_fields(
				parts[0], parts[1], parts[2], parts[3], parts[4], parts[5],
				place, tzid,
			)
		except Exception:
			resolved = None
		if resolved is not None:
			plus = bool(resolved['plus'])
			zh = int(resolved['zh'])
			zm = int(resolved['zm'])
			daylight = bool(resolved['daylightsaving'])
	return chart.Time(
		parts[0], parts[1], parts[2], parts[3], parts[4], parts[5],
		False, cal, zt, plus, zh, zm, daylight, place, False,
		tzid=tzid,
		tzauto=tzauto,
	)


def retained_clock_local_tuple_for_jd(
	retained,
	prefix,
	jd_value,
	*,
	fallback_place=None,
	fallback_time=None,
):
	"""Express one exact UT JD in a retained converse-transit civil clock."""
	source_time = fallback_time
	keys = _retained_clock_keys(prefix)
	cal = int((retained or {}).get(
		keys['cal'],
		getattr(source_time, 'cal', chart.Time.GREGORIAN),
	))
	utc_tuple = converse_transits.jd_to_utc_tuple(jd_value, cal)
	place = payload_to_place(
		(retained or {}).get(keys['place_payload']),
		fallback=fallback_place,
	)
	time_shape = SimpleNamespace(
		zt=int((retained or {}).get(
			keys['zt'],
			getattr(source_time, 'zt', chart.Time.ZONE),
		)),
		plus=bool((retained or {}).get(
			keys['plus'],
			getattr(source_time, 'plus', True),
		)),
		zh=int((retained or {}).get(
			keys['zh'],
			getattr(source_time, 'zh', 0) or 0,
		) or 0),
		zm=int((retained or {}).get(
			keys['zm'],
			getattr(source_time, 'zm', 0) or 0,
		) or 0),
		daylightsaving=bool((retained or {}).get(
			keys['daylight'],
			getattr(source_time, 'daylightsaving', False),
		)),
		tzid=str((retained or {}).get(
			keys['tzid'],
			getattr(source_time, 'tzid', '') or '',
		) or ''),
		tzauto=bool((retained or {}).get(
			keys['tzauto'],
			getattr(source_time, 'tzauto', False),
		)),
	)
	local_tuple = moment.utc_to_chart_local(time_shape, utc_tuple, place=place)
	return tuple(int(value) for value in (local_tuple or utc_tuple)[:6])


def _return_identity_anchor(retained, current_chart, fallback_dt):
	"""Selected return instant for mode-only rebuilds.

	``lunar_cycle_offset`` / ``cycle_offset`` is a navigation delta from the
	launch anchor. During a Marr on/off rebuild the chosen return itself is the
	identity, so prefer the raw return stamp and only fall back to chart Time.
	"""
	return (
		_display_datetime_to_datetime((retained or {}).get('raw_return_datetime'))
		or _chart_time_to_datetime(current_chart)
		or fallback_dt
	)


@dataclass
class SupplementaryBinding:
	feature_kind: str
	parent_source_datetime: Optional[DisplayDateTime] = None
	retained_state: Dict[str, Any] = field(default_factory=dict)

	@classmethod
	def from_payload(cls, payload, feature_kind=None):
		data = dict(payload or {})
		binding_feature_kind = data.get('feature_kind') or feature_kind
		if binding_feature_kind is None:
			return None
		return cls(
			feature_kind=binding_feature_kind,
			parent_source_datetime=data.get('parent_source_datetime'),
			retained_state=dict(data.get('retained_state') or {}),
		)

	def to_payload(self):
		return {
			'feature_kind': self.feature_kind,
			'parent_source_datetime': self.parent_source_datetime,
			'retained_state': dict(self.retained_state or {}),
		}


@dataclass
class SupplementaryDriverState:
	base_chart: Any
	source_datetime: Any
	chart_session: Any = None
	runtime_radix: Any = None
	source_display_datetime: Optional[DisplayDateTime] = None
	# In-place rebuilds (e.g. the per-document Marr toggle) flip HOW a return
	# is computed, not WHICH cycle it shows: solar reuses stamped base_year;
	# lunar/planetary choose the closest return to stamped raw_return_datetime
	# and do not reapply the retained navigation offset for this rebuild.
	preserve_return_cycle: bool = False


@dataclass
class SupplementaryBuildResult:
	chart: Any
	display_datetime: Optional[DisplayDateTime]
	binding: SupplementaryBinding


class BaseSupplementaryAdapter(object):
	"""Base class for supplementary chart builders (transits, progressions, returns, etc).

	Supplementary adapters implement the Antikythera Deriver pattern: they take a
	Context (radix chart + time) plus a Binding (user configuration) and produce a
	derived chart (e.g., transit, progression, solar return).

	Each adapter subclass (TransitSupplementaryAdapter, SolarReturnSupplementaryAdapter,
	etc) handles one feature kind and encapsulates the logic for:
	- Extracting configuration from the Binding
	- Building the derived chart
	- Managing time cursors and parent refresh logic
	- Persisting intent across navigation

	Antikythera invariants:
	- The adapter is stateless; all intent is in the Binding
	- The built chart is deterministic from Binding + Context
	- Controllers and sessions are disposable and rehydratable from Binding

	Attributes:
		feature_kinds (tuple): Which supplementary kinds this adapter handles
			(e.g., ('transits',) for TransitSupplementaryAdapter)
	"""
	feature_kinds = ()

	def matches(self, feature_kind):
		return feature_kind in self.feature_kinds

	def capture_binding(self, frame, session=None, current_chart=None, feature_kind=None):
		resolved_feature_kind = feature_kind
		if resolved_feature_kind is None and session is not None:
			resolved_feature_kind = session.get('supplementary_feature_kind')
		binding = SupplementaryBinding.from_payload(
			session.get('supplementary_binding') if session is not None else None,
			feature_kind=resolved_feature_kind,
		)
		if binding is None:
			binding = SupplementaryBinding(resolved_feature_kind)
		if binding.parent_source_datetime is None and session is not None:
			binding.parent_source_datetime = session.get('parent_source_datetime')
		return binding

	def uses_parent_cursor(self, frame, parent_chart_session, binding):
		return frame._supplementary_uses_session_cursor(binding.feature_kind, chart_session=parent_chart_session)

	def refresh_source_datetime(self, frame, session, source_dt, binding):
		target_display_dt = frame._session_target_datetime_from_parent_refresh(session, source_dt)
		target_source_dt = frame._display_datetime_to_datetime(target_display_dt)
		if target_source_dt is None:
			return source_dt
		return target_source_dt

	def parent_source_datetime_for_options_rebuild(self, frame, session, source_dt, target_source_dt, binding, result):
		return source_dt

	def build(self, frame, driver_state, binding, current_chart=None, session=None):
		raise NotImplementedError()


class LegacySupplementaryAdapter(BaseSupplementaryAdapter):
	def __init__(self, feature_kind, rebuilder):
		self.feature_kinds = (feature_kind,)
		self._rebuilder = rebuilder

	def build(self, frame, driver_state, binding, current_chart=None, session=None):
		chart_obj, display_dt = self._rebuilder(
			frame,
			session,
			current_chart,
			driver_state.base_chart,
			driver_state.source_datetime,
		)
		return SupplementaryBuildResult(chart_obj, display_dt, binding)


class SecondarySupplementaryAdapter(BaseSupplementaryAdapter):
	feature_kinds = ('secondary', 'minor', 'tertiary')

	def _method_for_feature_kind(self, feature_kind):
		return progression_method_for_feature_kind(feature_kind)

	def _default_angle_method(self, frame):
		return posfordate.progression_angle_method(
			getattr(frame.options, 'progressed_angle_method', posfordate.TRUE_SOLAR_ARC_LON)
		)

	def _default_day_type(self, frame):
		return posfordate.progression_day_type(
			getattr(frame.options, 'progression_day_type', posfordate.PROGRESSION_DAY_TYPE_Q2)
		)

	def normalize_retained_state(self, frame, retained, current_chart=None, feature_kind=None):
		state = dict(retained or {})
		# The progression METHOD is owned by the binding's feature_kind, NOT by the
		# retained state. A fresh binding has an empty retained dict, so falling
		# back to SECONDARY here silently rewrites a solar_arc/minor/tertiary
		# binding into a secondary one (the shared-adapter cross-wire). Seed the
		# default from the authoritative feature_kind the caller passes; only fall
		# back to SECONDARY when neither the retained state nor the caller knows.
		default_method = (
			self._method_for_feature_kind(feature_kind)
			if feature_kind is not None
			else posfordate.SECONDARY
		)
		resolved = progression_feature_kind_for_method(
			state.get('progression_method', state.get('method', default_method))
		)
		if resolved not in self.feature_kinds:
			resolved = progression_feature_kind_for_method(default_method)
		state['progression_method'] = self._method_for_feature_kind(resolved)
		state['feature_kind'] = resolved
		if state.get('angle_method') is None:
			if current_chart is not None:
				state['angle_method'] = frame._progression_angle_method_for_chart(current_chart)
			else:
				state['angle_method'] = self._default_angle_method(frame)
		if state.get('day_type') is None:
			if current_chart is not None:
				state['day_type'] = frame._progression_day_type_for_chart(current_chart)
			else:
				state['day_type'] = self._default_day_type(frame)
		return state

	def symbolic_age_for_display_datetime(self, frame, base_chart, display_datetime, retained=None, feature_kind=None):
		if base_chart is None or display_datetime is None:
			return None
		resolved_feature_kind = feature_kind or self.feature_kinds[0]
		state = self.normalize_retained_state(frame, retained, feature_kind=resolved_feature_kind)
		return symbolic_time.symbolic_age_for_real_datetime(
			base_chart,
			display_datetime,
			method=self._method_for_feature_kind(resolved_feature_kind),
			day_type=state.get('day_type', self._default_day_type(frame)),
		)

	def capture_binding(self, frame, session=None, current_chart=None, feature_kind=None):
		binding = BaseSupplementaryAdapter.capture_binding(self, frame, session=session, current_chart=current_chart, feature_kind=feature_kind)
		binding.feature_kind = progression_feature_kind_for_method(self._method_for_feature_kind(binding.feature_kind))
		retained = self.normalize_retained_state(frame, binding.retained_state, current_chart=current_chart, feature_kind=binding.feature_kind)
		binding.retained_state = retained
		return binding

	def build(self, frame, driver_state, binding, current_chart=None, session=None):
		binding.feature_kind = progression_feature_kind_for_method(self._method_for_feature_kind(binding.feature_kind))
		method = self._method_for_feature_kind(binding.feature_kind)
		retained = self.normalize_retained_state(frame, binding.retained_state, current_chart=current_chart, feature_kind=binding.feature_kind)
		angle_method = retained.get('angle_method', self._default_angle_method(frame))
		day_type = retained.get('day_type', self._default_day_type(frame))
		target_source_dt = driver_state.source_datetime
		target_dt = (
			target_source_dt.year,
			target_source_dt.month,
			target_source_dt.day,
			target_source_dt.hour,
			target_source_dt.minute,
			target_source_dt.second,
		)
		age = symbolic_time.symbolic_age_for_real_datetime(
			driver_state.base_chart,
			target_dt,
			method=method,
			day_type=day_type,
		)
		_age_int, _age_years, _progressed_tuple, progression_chart = posfordate.make_progressed_chart_by_symbolic_age(
			driver_state.base_chart,
			frame.options,
			age,
			method=method,
			angle_method=angle_method,
		)
		retained['angle_method'] = angle_method
		retained['day_type'] = day_type
		retained['progression_method'] = method
		retained['feature_kind'] = binding.feature_kind
		retained['age'] = age
		binding.retained_state = retained
		return SupplementaryBuildResult(progression_chart, target_dt, binding)


class SolarArcSupplementaryAdapter(BaseSupplementaryAdapter):
	feature_kinds = ('solar_arc',)

	def _default_angle_method(self, frame):
		return posfordate.progression_angle_method(
			getattr(frame.options, 'progressed_angle_method', posfordate.TRUE_SOLAR_ARC_LON)
		)

	def normalize_retained_state(self, frame, retained, current_chart=None):
		state = dict(retained or {})
		state['feature_kind'] = 'solar_arc'
		state['progression_method'] = posfordate.SOLAR_ARC
		if state.get('angle_method') is None:
			if current_chart is not None:
				state['angle_method'] = frame._progression_angle_method_for_chart(current_chart)
			else:
				state['angle_method'] = self._default_angle_method(frame)
		else:
			state['angle_method'] = posfordate.progression_angle_method(state.get('angle_method'))
		state.pop('day_type', None)
		return state

	def symbolic_age_for_display_datetime(self, frame, base_chart, display_datetime, retained=None, feature_kind=None):
		if base_chart is None or display_datetime is None:
			return None
		return symbolic_time.solar_arc_age_for_real_datetime(base_chart, display_datetime)

	def capture_binding(self, frame, session=None, current_chart=None, feature_kind=None):
		binding = BaseSupplementaryAdapter.capture_binding(
			self, frame, session=session, current_chart=current_chart, feature_kind='solar_arc'
		)
		binding.feature_kind = 'solar_arc'
		binding.retained_state = self.normalize_retained_state(
			frame, binding.retained_state, current_chart=current_chart
		)
		return binding

	def build(self, frame, driver_state, binding, current_chart=None, session=None):
		binding.feature_kind = 'solar_arc'
		retained = self.normalize_retained_state(frame, binding.retained_state, current_chart=current_chart)
		angle_method = retained.get('angle_method', self._default_angle_method(frame))
		target_source_dt = driver_state.source_datetime
		target_dt = (
			target_source_dt.year,
			target_source_dt.month,
			target_source_dt.day,
			target_source_dt.hour,
			target_source_dt.minute,
			target_source_dt.second,
		)
		age = symbolic_time.solar_arc_age_for_real_datetime(driver_state.base_chart, target_dt)
		_age_int, _age_years, _progressed_tuple, solar_arc_chart = posfordate.make_progressed_chart_by_symbolic_age(
			driver_state.base_chart,
			frame.options,
			age,
			method=posfordate.SOLAR_ARC,
			angle_method=angle_method,
		)
		retained['angle_method'] = angle_method
		retained['age'] = age
		binding.retained_state = retained
		return SupplementaryBuildResult(solar_arc_chart, target_dt, binding)


class SolarReturnSupplementaryAdapter(BaseSupplementaryAdapter):
	feature_kinds = ('solar_return',)

	def _containing_solar_return_year(self, frame, base_chart, target_source_dt):
		if base_chart is None or target_source_dt is None:
			return None
		candidate_year = int(target_source_dt.year)
		revolution, _label, display_dt, _stepper_ctx = frame._build_solar_revolution_chart_for_year(base_chart, candidate_year)
		if revolution is None or display_dt is None:
			return None
		candidate_dt = frame._display_datetime_to_datetime(display_dt)
		if candidate_dt is None:
			return candidate_year
		if target_source_dt >= candidate_dt:
			return candidate_year
		return candidate_year - 1

	def capture_binding(self, frame, session=None, current_chart=None, feature_kind=None):
		binding = BaseSupplementaryAdapter.capture_binding(self, frame, session=session, current_chart=current_chart, feature_kind=feature_kind)
		retained = dict(binding.retained_state or {})
		place_payload = retained.get('place_payload')
		if place_payload is None and 'place' in retained:
			place_payload = place_to_payload(retained.get('place'))
		if place_payload is None and current_chart is not None:
			place_payload = place_to_payload(getattr(current_chart, 'place', None))
		if place_payload is not None:
			retained['place_payload'] = place_payload
		if retained.get('solar_return_mode') is None:
			default_mode = str(getattr(frame.options, 'revolutions_solarreturnmode', 'standard') or 'standard')
			retained['solar_return_mode'] = (
				solilunar.RETURN_MODE_TITHI_PRAVESHA
				if default_mode == solilunar.RETURN_MODE_TITHI_PRAVESHA
				else 'standard'
			)
		retained.pop('place', None)
		binding.retained_state = retained
		return binding

	def refresh_source_datetime(self, frame, session, source_dt, binding):
		# Solar returns already preserve relative intent in retained year/degree offsets.
		# On parent cursor changes they must re-seed from the new parent cursor directly,
		# not from the previous child-to-parent delta.
		if isinstance(source_dt, datetime.datetime):
			return source_dt
		target_source_dt = frame._display_datetime_to_datetime(source_dt)
		if target_source_dt is None:
			return source_dt
		return target_source_dt

	def build(self, frame, driver_state, binding, current_chart=None, session=None):
		base_chart = driver_state.base_chart
		target_source_dt = driver_state.source_datetime
		retained = dict(binding.retained_state or {})
		place = payload_to_place(retained.get('place_payload'), fallback=(getattr(current_chart, 'place', None) if current_chart is not None else base_chart.place))
		plus = bool(retained.get('plus', True))
		zh = int(retained.get('zh', getattr(base_chart.time, 'zh', 0) or 0))
		zm = int(retained.get('zm', getattr(base_chart.time, 'zm', 0) or 0))
		daylight = bool(retained.get('daylight', getattr(base_chart.time, 'daylightsaving', False)))
		year_offset = int(retained.get('solar_year_offset', 0) or 0)
		degree_offset = int(retained.get('solar_degree_offset', 0) or 0)
		year_mode = retained.get('solar_year_mode') or retained.get('year_mode') or 'configured'
		if year_mode != 'containing':
			year_mode = 'configured'
		# Per-document Marr sidereal flag: binding-scoped read-time narrowing,
		# never a global option write (policy-chart-lifecycle Decided).
		marr = resolve_marr_retained(frame.options, retained, 'solar_return')
		return_mode = str(retained.get('solar_return_mode') or 'standard')
		if return_mode != solilunar.RETURN_MODE_TITHI_PRAVESHA:
			return_mode = 'standard'
		if return_mode == solilunar.RETURN_MODE_TITHI_PRAVESHA:
			marr = False
		calc_base = chart_with_marr_override(base_chart, 'solar_return', marr)
		preserved_year = None
		anchor_year = None
		if getattr(driver_state, 'preserve_return_cycle', False):
			preserved_year = retained.get('base_year')
		if preserved_year is not None:
			target_year = int(preserved_year)
		else:
			if year_mode == 'containing':
				anchor_year = self._containing_solar_return_year(frame, calc_base, target_source_dt)
			if anchor_year is None:
				anchor_year = frame._get_configured_solar_return_year(reference_dt=target_source_dt, radix=calc_base)
			target_year = int(anchor_year) + year_offset
		if hasattr(frame, '_debug_solar_child'):
			frame._debug_solar_child(
				'adapter_build_before',
				target_source_datetime=(
					target_source_dt.year,
					target_source_dt.month,
					target_source_dt.day,
					target_source_dt.hour,
					target_source_dt.minute,
					target_source_dt.second,
				),
				anchor_year=anchor_year,
				year_mode=year_mode,
				target_year=target_year,
				year_offset=year_offset,
				degree_offset=degree_offset,
				retained_state=dict(retained),
			)
		revolution, display_dt = frame._build_solar_revolution_step_chart(
			calc_base,
			target_year,
			place,
			plus,
			zh=zh,
			zm=zm,
			daylight=daylight,
			degree_offset=degree_offset,
		)
		if revolution is None or display_dt is None:
			return SupplementaryBuildResult(None, None, binding)
		if return_mode == solilunar.RETURN_MODE_TITHI_PRAVESHA:
			solar_dt = _chart_time_to_datetime(revolution)
			if solar_dt is None:
				return SupplementaryBuildResult(None, None, binding)
			event = solilunar.closest_phase_return(
				calc_base,
				solar_dt,
				window_days=16.0,
				mode=solilunar.RETURN_MODE_SOLILUNAR,
			)
			if event is None:
				return SupplementaryBuildResult(None, None, binding)
			t1, t2, t3, t4, t5, t6 = event.datetime
			time_obj = chart.Time(
				t1, t2, t3, t4, t5, t6,
				False, base_chart.time.cal, chart.Time.GREENWICH,
				plus, 0, 0, False, place, False,
			)
			revolution = chart_factory.build_chart(
				base_chart.name, base_chart.male, time_obj, place,
				chart.Chart.SOLAR, '', frame.options, False,
			)
			display_dt = frame._revolution_display_datetime(
				base_chart, t1, t2, t3, t4, t5, t6,
				plus=plus, zh=zh, zm=zm, daylight=daylight,
			)
			retained['tithi_pravesha_solar_datetime'] = (
				int(solar_dt.year), int(solar_dt.month), int(solar_dt.day),
				int(solar_dt.hour), int(solar_dt.minute), int(solar_dt.second),
			)
			retained['raw_return_datetime'] = tuple(int(v) for v in event.datetime)
		else:
			retained.pop('tithi_pravesha_solar_datetime', None)
			retained.pop('raw_return_datetime', None)
		retained.update({
			'place_payload': place_to_payload(place),
			'plus': plus,
			'zh': zh,
			'zm': zm,
			'daylight': daylight,
			'solar_year_offset': year_offset,
			'solar_degree_offset': degree_offset,
			'solar_year_mode': year_mode,
			'solar_return_mode': return_mode,
			'marr_sidereal': bool(marr),
			'base_year': int(target_year),
		})
		if hasattr(frame, '_debug_solar_child'):
			frame._debug_solar_child(
				'adapter_build_after',
				target_year=target_year,
				display_datetime=display_dt,
				retained_state=dict(retained),
			)
		retained.pop('place', None)
		binding.retained_state = retained
		return SupplementaryBuildResult(revolution, display_dt, binding)


class LunarReturnSupplementaryAdapter(BaseSupplementaryAdapter):
	feature_kinds = ('lunar_return',)

	def capture_binding(self, frame, session=None, current_chart=None, feature_kind=None):
		binding = BaseSupplementaryAdapter.capture_binding(self, frame, session=session, current_chart=current_chart, feature_kind=feature_kind)
		retained = dict(binding.retained_state or {})
		seed_chart = None
		if current_chart is not None:
			seed_chart = current_chart
		elif hasattr(frame, '_active_chart_session'):
			try:
				active_cs = frame._active_chart_session()
			except Exception:
				active_cs = None
			if active_cs is not None:
				seed_chart = getattr(active_cs, 'radix', None) or getattr(active_cs, 'chart', None)
		if seed_chart is None:
			seed_chart = getattr(frame, 'horoscope', None)
		place_payload = retained.get('place_payload')
		if place_payload is None and seed_chart is not None:
			place_payload = place_to_payload(getattr(seed_chart, 'place', None))
		if place_payload is not None:
			retained['place_payload'] = place_payload
		if 'plus' not in retained:
			retained['plus'] = bool(getattr(getattr(seed_chart, 'time', None), 'plus', True))
		if 'zh' not in retained:
			retained['zh'] = int(getattr(getattr(seed_chart, 'time', None), 'zh', 0) or 0)
		if 'zm' not in retained:
			retained['zm'] = int(getattr(getattr(seed_chart, 'time', None), 'zm', 0) or 0)
		if 'daylight' not in retained:
			retained['daylight'] = bool(getattr(getattr(seed_chart, 'time', None), 'daylightsaving', False))
		default_mode = getattr(frame.options, 'revolutions_lunarreturnmode', solilunar.RETURN_MODE_LUNAR)
		retained['lunar_return_mode'] = solilunar.normalize_return_mode(
			retained.get('lunar_return_mode', default_mode)
		)
		binding.retained_state = retained
		return binding

	def refresh_source_datetime(self, frame, session, source_dt, binding):
		if isinstance(source_dt, datetime.datetime):
			return source_dt
		target_source_dt = frame._display_datetime_to_datetime(source_dt)
		if target_source_dt is None:
			return source_dt
		return target_source_dt

	def build(self, frame, driver_state, binding, current_chart=None, session=None):
		base_chart = driver_state.base_chart
		runtime_radix = driver_state.runtime_radix
		target_source_dt = driver_state.source_datetime
		calc_chart = frame._lunar_return_calc_chart(base_chart, runtime_radix)
		radix_chart = runtime_radix if runtime_radix is not None else calc_chart
		retained = dict(binding.retained_state or {})
		place = payload_to_place(retained.get('place_payload'), fallback=base_chart.place)
		plus = bool(retained.get('plus', getattr(base_chart.time, 'plus', True)))
		zh = int(retained.get('zh', getattr(base_chart.time, 'zh', 0) or 0))
		zm = int(retained.get('zm', getattr(base_chart.time, 'zm', 0) or 0))
		daylight = bool(retained.get('daylight', getattr(base_chart.time, 'daylightsaving', False)))
		cycle_offset = int(retained.get('lunar_cycle_offset', 0) or 0)
		# Per-document Marr sidereal flag (binding-scoped, no global write).
		marr = resolve_marr_retained(frame.options, retained, 'lunar_return')
		calc_chart = chart_with_marr_override(calc_chart, 'lunar_return', marr)
		return_mode = solilunar.normalize_return_mode(retained.get('lunar_return_mode'))
		revs = revolutions.Revolutions()
		preserve_cycle = bool(getattr(driver_state, 'preserve_return_cycle', False))
		event = None
		if return_mode == solilunar.RETURN_MODE_LUNAR:
			if preserve_cycle:
				identity_anchor = _return_identity_anchor(retained, current_chart, target_source_dt)
				pair = revolutions.Revolutions.closest_lunar_return(calc_chart, identity_anchor, window_days=2)
				if pair is None:
					return SupplementaryBuildResult(None, None, binding)
				revs._set_hit_values(pair[1])
			else:
				if not revs.compute_lunar_before_datetime(target_source_dt, calc_chart, inclusive=True):
					return SupplementaryBuildResult(None, None, binding)
			anchor_dt = datetime.datetime(*tuple(int(v) for v in revs.t[:6]))
			if not preserve_cycle and cycle_offset > 0:
				for _ in range(cycle_offset):
					revs2 = revolutions.Revolutions()
					if not revs2.compute_lunar_after_datetime(anchor_dt, calc_chart):
						return SupplementaryBuildResult(None, None, binding)
					revs = revs2
					anchor_dt = datetime.datetime(*tuple(int(v) for v in revs.t[:6]))
			elif not preserve_cycle and cycle_offset < 0:
				for _ in range(abs(cycle_offset)):
					revs2 = revolutions.Revolutions()
					if not revs2.compute_lunar_before_datetime(anchor_dt, calc_chart):
						return SupplementaryBuildResult(None, None, binding)
					revs = revs2
					anchor_dt = datetime.datetime(*tuple(int(v) for v in revs.t[:6]))
			t1, t2, t3, t4, t5, t6 = revs.t[0], revs.t[1], revs.t[2], revs.t[3], revs.t[4], revs.t[5]
			target_lon = None
			try:
				target_lon = float(calc_chart.planets.planets[astrology.SE_MOON].data[planets.Planet.LONG])
			except Exception:
				pass
			if frame.options.ayanamsha != 0:
				try:
					t1, t2, t3, t4, t5, t6 = frame.calcPrecNutCorrectedRevolution(
						revs,
						astrology.SE_MOON,
						topo_place=place,
						seed=(t1, t2, t3, t4, t5, t6),
						target_lon_trop=target_lon,
						reference_chart=calc_chart,
					)
				except Exception:
					pass
		else:
			branch_hint = solilunar.RETURN_BRANCH_ANY
			if return_mode == solilunar.RETURN_MODE_JONAS_ARC:
				branch_hint = solilunar.normalize_return_branch(retained.get('jonas_arc_anchor_branch'))
			if preserve_cycle:
				identity_anchor = _return_identity_anchor(retained, current_chart, target_source_dt)
				event = solilunar.closest_phase_return(
					calc_chart,
					identity_anchor,
					window_days=16.0,
					mode=return_mode,
					branch=branch_hint,
				)
				if event is None and branch_hint != solilunar.RETURN_BRANCH_ANY:
					event = solilunar.closest_phase_return(
						calc_chart,
						identity_anchor,
						window_days=16.0,
						mode=return_mode,
					)
			else:
				if branch_hint != solilunar.RETURN_BRANCH_ANY:
					event = solilunar.closest_phase_return(
						calc_chart,
						target_source_dt,
						window_days=16.0,
						mode=return_mode,
						branch=branch_hint,
					)
					if event is None:
						event = solilunar.closest_phase_return(
							calc_chart,
							target_source_dt,
							window_days=16.0,
							mode=return_mode,
						)
				else:
					event = solilunar.phase_return_before_datetime(
						calc_chart,
						target_source_dt,
						inclusive=True,
						mode=return_mode,
					)
			if event is None:
				return SupplementaryBuildResult(None, None, binding)
			anchor_dt = datetime.datetime(*tuple(int(v) for v in event.datetime[:6]))
			if not preserve_cycle and cycle_offset > 0:
				for _ in range(cycle_offset):
					event = solilunar.phase_return_after_datetime(calc_chart, anchor_dt, inclusive=False, mode=return_mode)
					if event is None:
						return SupplementaryBuildResult(None, None, binding)
					anchor_dt = datetime.datetime(*tuple(int(v) for v in event.datetime[:6]))
			elif not preserve_cycle and cycle_offset < 0:
				for _ in range(abs(cycle_offset)):
					event = solilunar.phase_return_before_datetime(calc_chart, anchor_dt, inclusive=False, mode=return_mode)
					if event is None:
						return SupplementaryBuildResult(None, None, binding)
					anchor_dt = datetime.datetime(*tuple(int(v) for v in event.datetime[:6]))
			t1, t2, t3, t4, t5, t6 = event.datetime
		raw_dt = tuple(int(v) for v in (t1, t2, t3, t4, t5, t6))
		time_obj = chart.Time(t1, t2, t3, t4, t5, t6, False, base_chart.time.cal, chart.Time.GREENWICH, plus, 0, 0, False, place, False)
		revolution = chart_factory.build_chart(radix_chart.name, radix_chart.male, time_obj, place, chart.Chart.LUNAR, '', frame.options, False)
		display_dt = frame._revolution_display_datetime(base_chart, t1, t2, t3, t4, t5, t6, plus=plus, zh=zh, zm=zm, daylight=daylight)
		retained.pop('jonas_arc_anchor_branch', None)
		if return_mode == solilunar.RETURN_MODE_JONAS_ARC and event is not None:
			retained['jonas_arc_branch'] = getattr(event, 'branch', solilunar.RETURN_BRANCH_ANY)
			retained['jonas_arc_target_phase'] = getattr(event, 'target_phase', None)
		else:
			retained.pop('jonas_arc_branch', None)
			retained.pop('jonas_arc_target_phase', None)
		retained.update({
			'place_payload': place_to_payload(place),
			'plus': plus,
			'zh': zh,
			'zm': zm,
			'daylight': daylight,
			'lunar_cycle_offset': cycle_offset,
			'lunar_return_mode': return_mode,
			'marr_sidereal': bool(marr),
			'raw_return_datetime': raw_dt,
		})
		binding.retained_state = retained
		return SupplementaryBuildResult(revolution, display_dt, binding)


class PlanetaryReturnSupplementaryAdapter(BaseSupplementaryAdapter):
	feature_kinds = ('planetary_return',)

	def normalize_retained_state(self, frame, current_chart=None, retained=None, planet_type=None):
		state = dict(retained or {})
		if planet_type is not None:
			state['planet_type'] = int(planet_type)
		place_payload = state.get('place_payload')
		if place_payload is None and current_chart is not None:
			place_payload = place_to_payload(getattr(current_chart, 'place', None))
		if place_payload is not None:
			state['place_payload'] = place_payload
		if 'plus' not in state:
			state['plus'] = bool(getattr(getattr(current_chart, 'time', None), 'plus', True))
		if 'zh' not in state:
			state['zh'] = int(getattr(getattr(current_chart, 'time', None), 'zh', 0) or 0)
		if 'zm' not in state:
			state['zm'] = int(getattr(getattr(current_chart, 'time', None), 'zm', 0) or 0)
		if 'daylight' not in state:
			state['daylight'] = bool(getattr(getattr(current_chart, 'time', None), 'daylightsaving', False))
		state['cycle_offset'] = int(state.get('cycle_offset', 0) or 0)
		return state

	def capture_binding(self, frame, session=None, current_chart=None, feature_kind=None):
		binding = BaseSupplementaryAdapter.capture_binding(self, frame, session=session, current_chart=current_chart, feature_kind=feature_kind)
		planet_type = None
		if session is not None:
			planet_type = session.get('planetary_return_type')
		binding.retained_state = self.normalize_retained_state(
			frame,
			current_chart=current_chart,
			retained=binding.retained_state,
			planet_type=planet_type,
		)
		return binding

	def refresh_source_datetime(self, frame, session, source_dt, binding):
		if isinstance(source_dt, datetime.datetime):
			return source_dt
		target_source_dt = frame._display_datetime_to_datetime(source_dt)
		if target_source_dt is None:
			return source_dt
		return target_source_dt

	def build(self, frame, driver_state, binding, current_chart=None, session=None):
		retained = self.normalize_retained_state(frame, current_chart=current_chart, retained=binding.retained_state)
		planet_type = retained.get('planet_type')
		if planet_type is None:
			return SupplementaryBuildResult(None, None, binding)
		planet_type = int(planet_type)
		pid = revolutions.Revolutions.planetary_pid(planet_type)
		if pid is None:
			return SupplementaryBuildResult(None, None, binding)

		base_chart = driver_state.base_chart
		target_source_dt = driver_state.source_datetime
		# Per-document Marr sidereal flag (binding-scoped, no global write).
		marr = resolve_marr_retained(frame.options, retained, 'planetary_return')
		calc_base = chart_with_marr_override(base_chart, 'planetary_return', marr)
		synodic_dt = (
			_display_datetime_to_datetime(retained.get('synodic_event_datetime'))
			or _display_datetime_to_datetime(retained.get('raw_synodic_datetime'))
		)
		if synodic_dt is not None:
			t1, t2, t3, t4, t5, t6 = (
				int(synodic_dt.year), int(synodic_dt.month), int(synodic_dt.day),
				int(synodic_dt.hour), int(synodic_dt.minute), int(synodic_dt.second),
			)
			raw_dt = tuple(int(v) for v in (t1, t2, t3, t4, t5, t6))
			cycle_offset = 0
		else:
			revs = revolutions.Revolutions()
			preserve_cycle = bool(getattr(driver_state, 'preserve_return_cycle', False))
			step_anchor = _display_datetime_to_datetime(retained.get('planetary_step_anchor_datetime'))
			step_delta = int(retained.get('planetary_step_delta', 0) or 0)
			used_step_anchor = step_anchor is not None and step_delta != 0 and not preserve_cycle
			if used_step_anchor:
				anchor_dt = step_anchor
				revs._set_hit_values((
					anchor_dt.year, anchor_dt.month, anchor_dt.day,
					anchor_dt.hour, anchor_dt.minute, anchor_dt.second,
				))
				for _ in range(abs(step_delta)):
					revs2 = revolutions.Revolutions()
					if step_delta > 0:
						found = revs2.compute_planetary_after_datetime(
							planet_type, anchor_dt, calc_base, inclusive=False,
						)
					else:
						found = revs2.compute_planetary_before_datetime(
							planet_type, anchor_dt, calc_base, inclusive=False,
						)
					if not found:
						return SupplementaryBuildResult(None, None, binding)
					revs = revs2
					anchor_dt = datetime.datetime(*tuple(int(v) for v in revs.t[:6]))
			elif preserve_cycle:
				identity_anchor = _return_identity_anchor(retained, current_chart, target_source_dt)
				pair = revolutions.Revolutions.closest_planetary_return(
					planet_type, calc_base, identity_anchor, window_days=30,
				)
				if pair is None:
					return SupplementaryBuildResult(None, None, binding)
				revs._set_hit_values(pair[1])
			else:
				if not revs.compute_planetary_cycle_start_datetime(planet_type, target_source_dt, calc_base):
					return SupplementaryBuildResult(None, None, binding)

			anchor_dt = datetime.datetime(*tuple(int(v) for v in revs.t[:6]))
			cycle_offset = int(retained.get('cycle_offset', 0) or 0)
			if not used_step_anchor and not preserve_cycle and cycle_offset > 0:
				for _ in range(cycle_offset):
					revs2 = revolutions.Revolutions()
					if not revs2.compute_planetary_after_datetime(planet_type, anchor_dt, calc_base):
						return SupplementaryBuildResult(None, None, binding)
					revs = revs2
					anchor_dt = datetime.datetime(*tuple(int(v) for v in revs.t[:6]))
			elif not used_step_anchor and not preserve_cycle and cycle_offset < 0:
				for _ in range(abs(cycle_offset)):
					revs2 = revolutions.Revolutions()
					if not revs2.compute_planetary_before_datetime(planet_type, anchor_dt, calc_base):
						return SupplementaryBuildResult(None, None, binding)
					revs = revs2
					anchor_dt = datetime.datetime(*tuple(int(v) for v in revs.t[:6]))

			t1, t2, t3, t4, t5, t6 = revs.t[0], revs.t[1], revs.t[2], revs.t[3], revs.t[4], revs.t[5]
			raw_dt = tuple(int(v) for v in (t1, t2, t3, t4, t5, t6))
		place = payload_to_place(retained.get('place_payload'), fallback=(getattr(current_chart, 'place', None) if current_chart is not None else getattr(base_chart, 'place', None)))
		plus = bool(retained.get('plus', True))
		zh = int(retained.get('zh', getattr(base_chart.time, 'zh', 0) or 0))
		zm = int(retained.get('zm', getattr(base_chart.time, 'zm', 0) or 0))
		daylight = bool(retained.get('daylight', getattr(base_chart.time, 'daylightsaving', False)))
		if synodic_dt is None and getattr(frame.options, 'ayanamsha', 0) != 0:
			try:
				t1, t2, t3, t4, t5, t6 = frame.calcPrecNutCorrectedRevolution(revs, pid, topo_place=place, seed=(t1, t2, t3, t4, t5, t6))
			except Exception:
				pass
		time_obj = chart.Time(t1, t2, t3, t4, t5, t6, False, base_chart.time.cal, chart.Time.GREENWICH, plus, 0, 0, False, place, False)
		revolution = chart_factory.build_chart(base_chart.name, base_chart.male, time_obj, place, chart.Chart.REVOLUTION, '', frame.options, False)
		display_dt = frame._revolution_display_datetime(base_chart, t1, t2, t3, t4, t5, t6, plus=plus, zh=zh, zm=zm, daylight=daylight)
		retained.update({
			'planet_type': planet_type,
			'place_payload': place_to_payload(place),
			'plus': plus,
			'zh': zh,
			'zm': zm,
			'daylight': daylight,
			'cycle_offset': cycle_offset,
			'marr_sidereal': bool(marr),
			'raw_return_datetime': raw_dt,
		})
		retained.pop('planetary_step_anchor_datetime', None)
		retained.pop('planetary_step_delta', None)
		if synodic_dt is not None:
			retained['synodic_event_datetime'] = raw_dt
			retained['raw_synodic_datetime'] = raw_dt
			event_payload = retained.get('synodic_event')
			if isinstance(event_payload, dict):
				payload = dict(event_payload)
				payload['datetime'] = raw_dt
				payload['jd_ut'] = float(synodic_cycle.datetime_to_jd(calc_base, synodic_dt))
				retained['synodic_event'] = payload
		binding.retained_state = retained
		return SupplementaryBuildResult(revolution, display_dt, binding)


class ProfectionsSupplementaryAdapter(BaseSupplementaryAdapter):
	feature_kinds = ('profections',)

	def normalize_retained_state(self, current_chart=None, retained=None):
		state = dict(retained or {})
		if 'proftype' not in state:
			state['proftype'] = int(getattr(current_chart, 'proftype', chart.Chart.YEAR) if current_chart is not None else chart.Chart.YEAR)
		return state

	def capture_binding(self, frame, session=None, current_chart=None, feature_kind=None):
		binding = BaseSupplementaryAdapter.capture_binding(self, frame, session=session, current_chart=current_chart, feature_kind=feature_kind)
		retained = self.normalize_retained_state(current_chart=current_chart, retained=binding.retained_state)
		binding.retained_state = retained
		return binding

	def build(self, frame, driver_state, binding, current_chart=None, session=None):
		retained = self.normalize_retained_state(current_chart=current_chart, retained=binding.retained_state)
		snap_override = retained.pop('_profections_snap_override', None)
		if snap_override is not None:
			snap_override = bool(snap_override)
		parent_cs = driver_state.chart_session
		parent_chart = getattr(parent_cs, 'chart', None) if parent_cs is not None else None
		parent_htype = getattr(parent_chart, 'htype', None)
		if snap_override is None and parent_htype in (
			chart.Chart.SOLAR,
			chart.Chart.LUNAR,
		):
			# When profections are derived from a stepped return chart, they must
			# follow the parent's real cursor exactly instead of snapping back to
			# the completed solar-return boundary.
			snap_override = False
		pchart, display_dt, t = frame._build_profections_chart(
			driver_state.base_chart,
			driver_state.source_datetime,
			current_chart=current_chart,
			proftype=retained.get('proftype', chart.Chart.YEAR),
			snap_override=snap_override,
		)
		retained.update({
			'proftype': int(getattr(pchart, 'proftype', retained.get('proftype', chart.Chart.YEAR)) if pchart is not None else retained.get('proftype', chart.Chart.YEAR)),
			'time_float': float(t),
			'display_datetime': tuple(int(v) for v in display_dt) if display_dt is not None else None,
		})
		binding.retained_state = retained
		return SupplementaryBuildResult(pchart, display_dt, binding)


class TransitSupplementaryAdapter(BaseSupplementaryAdapter):
	"""Builds transit charts from arbitrary datetimes.

	A transit is the planetary positions at a specified moment, calculated for
	a given location (usually the radix's location). Transits are the primary
	tool for real-time astrological forecasting.

	This adapter:
	- Takes a Context (radix chart defining location) and a time
	- Produces a Transit chart (chart.Chart with type=TRANSIT)
	- Handles location persistence (place_payload in Binding)
	- Supports arbitrary datetime navigation (past, present, future)

	Usage:
	1. Construct with radix and target datetime
	2. Call build() to create the transit chart
	3. Pass to workspace to open as a session tab

	Antikythera mapping:
	- Context: radix location, calendar type, timezone
	- Binding: place override (if user changed location), display time
	- DerivedNode: the computed transit chart
	"""
	feature_kinds = ('transits',)

	def normalize_retained_state(self, current_chart=None, retained=None):
		state = dict(retained or {})
		time_obj = getattr(current_chart, 'time', None) if current_chart is not None else None
		place_payload = state.get('place_payload')
		if place_payload is None and current_chart is not None:
			place_payload = place_to_payload(getattr(current_chart, 'place', None))
		if place_payload is not None:
			state['place_payload'] = place_payload
		if state.get('display_datetime') is None and time_obj is not None:
			state['display_datetime'] = (
				int(getattr(time_obj, 'origyear', time_obj.year)),
				int(getattr(time_obj, 'origmonth', time_obj.month)),
				int(getattr(time_obj, 'origday', time_obj.day)),
				int(time_obj.hour),
				int(time_obj.minute),
				int(time_obj.second),
			)
		if time_obj is not None:
			state.update(_chart_time_context_payload(time_obj))
		return state

	def capture_binding(self, frame, session=None, current_chart=None, feature_kind=None):
		binding = BaseSupplementaryAdapter.capture_binding(self, frame, session=session, current_chart=current_chart, feature_kind=feature_kind)
		retained = self.normalize_retained_state(current_chart=current_chart, retained=binding.retained_state)
		binding.retained_state = retained
		return binding

	def refresh_source_datetime(self, frame, session, source_dt, binding):
		current_chart = None
		cs = session.get('chart_session') if isinstance(session, dict) else None
		if cs is not None:
			current_chart = getattr(cs, 'chart', None)
		retained = self.normalize_retained_state(current_chart=current_chart, retained=binding.retained_state)
		binding.retained_state = retained
		target_source_dt = _display_datetime_to_datetime(retained.get('display_datetime'))
		if target_source_dt is not None:
			return target_source_dt
		display_dt = getattr(cs, 'display_datetime', None) if cs is not None else None
		target_source_dt = _display_datetime_to_datetime(display_dt)
		if target_source_dt is not None:
			return target_source_dt
		return source_dt

	def parent_source_datetime_for_options_rebuild(self, frame, session, source_dt, target_source_dt, binding, result):
		return target_source_dt if isinstance(target_source_dt, datetime.datetime) else source_dt

	def build(self, frame, driver_state, binding, current_chart=None, session=None):
		base_chart = driver_state.base_chart
		target_source_dt = driver_state.source_datetime
		retained = self.normalize_retained_state(current_chart=current_chart, retained=binding.retained_state)
		place = payload_to_place(retained.get('place_payload'), fallback=(getattr(current_chart, 'place', None) if current_chart is not None else getattr(base_chart, 'place', None)))
		base_time = getattr(base_chart, 'time', None)
		cal = int(retained.get('cal', getattr(base_time, 'cal', chart.Time.GREGORIAN)))
		zt = int(retained.get('zt', getattr(base_time, 'zt', chart.Time.ZONE)))
		plus = bool(retained.get('plus', getattr(base_time, 'plus', True)))
		zh = int(retained.get('zh', getattr(base_time, 'zh', 0) or 0))
		zm = int(retained.get('zm', getattr(base_time, 'zm', 0) or 0))
		daylight = bool(retained.get('daylight', getattr(base_time, 'daylightsaving', False)))
		tzid = str(retained.get('tzid', getattr(base_time, 'tzid', '') or '') or '')
		tzauto = bool(retained.get('tzauto', getattr(base_time, 'tzauto', False)))
		time = chart.Time(
			target_source_dt.year,
			target_source_dt.month,
			target_source_dt.day,
			target_source_dt.hour,
			target_source_dt.minute,
			target_source_dt.second,
			False,
			cal,
			zt,
			plus,
			zh,
			zm,
			daylight,
			place,
			False,
			tzid=tzid,
			tzauto=tzauto,
		)
		retained['place_payload'] = place_to_payload(place)
		retained.update(_chart_time_context_payload(time))
		display_dt = (
			target_source_dt.year,
			target_source_dt.month,
			target_source_dt.day,
			target_source_dt.hour,
			target_source_dt.minute,
			target_source_dt.second,
		)
		retained['display_datetime'] = tuple(int(v) for v in display_dt)
		binding.retained_state = retained
		return SupplementaryBuildResult(
			chart_factory.build_chart(base_chart.name, base_chart.male, time, place, chart.Chart.TRANSIT, '', frame.options, False),
			display_dt,
			binding,
		)


class ConverseTransitSupplementaryAdapter(BaseSupplementaryAdapter):
	"""Derive a direct or prenatal transit from one symbolic cursor.

	The source datetime is always the symbolic/list clock shown in the chart
	header.  Converse mode builds at ``2 * radix_jd - symbolic_jd``; direct mode
	builds at the symbolic JD itself.  In both modes the real physical epoch
	remains in ``chart.time`` for the footer.
	"""
	feature_kinds = ('converse_transits',)

	def normalize_retained_state(self, current_chart=None, retained=None):
		state = dict(retained or {})
		state.setdefault('converse_enabled', True)
		time_obj = getattr(current_chart, 'time', None) if current_chart is not None else None
		if state.get('physical_place_payload') is None and current_chart is not None:
			state['physical_place_payload'] = place_to_payload(
				getattr(current_chart, 'place', None)
			)
		if time_obj is not None:
			context = _chart_time_context_payload(time_obj)
			for key, value in context.items():
				target = 'physical_daylight' if key == 'daylight' else f'physical_{key}'
				state.setdefault(target, value)
		return state

	def capture_binding(self, frame, session=None, current_chart=None, feature_kind=None):
		binding = BaseSupplementaryAdapter.capture_binding(
			self,
			frame,
			session=session,
			current_chart=current_chart,
			feature_kind=feature_kind,
		)
		binding.retained_state = self.normalize_retained_state(
			current_chart=current_chart,
			retained=binding.retained_state,
		)
		return binding

	def refresh_source_datetime(self, frame, session, source_dt, binding):
		retained = self.normalize_retained_state(
			current_chart=getattr(
				session.get('chart_session') if isinstance(session, dict) else None,
				'chart',
				None,
			),
			retained=binding.retained_state,
		)
		binding.retained_state = retained
		target = _display_datetime_to_datetime(retained.get('display_datetime'))
		if target is not None:
			return target
		cs = session.get('chart_session') if isinstance(session, dict) else None
		target = _display_datetime_to_datetime(
			getattr(cs, 'display_datetime', None) if cs is not None else None
		)
		return target if target is not None else source_dt

	def parent_source_datetime_for_options_rebuild(
		self,
		frame,
		session,
		source_dt,
		target_source_dt,
		binding,
		result,
	):
		return target_source_dt if isinstance(target_source_dt, datetime.datetime) else source_dt

	def build(self, frame, driver_state, binding, current_chart=None, session=None):
		base_chart = driver_state.base_chart
		source_dt = driver_state.source_datetime
		retained = self.normalize_retained_state(
			current_chart=current_chart,
			retained=binding.retained_state,
		)
		display_dt = (
			int(source_dt.year),
			int(source_dt.month),
			int(source_dt.day),
			int(source_dt.hour),
			int(source_dt.minute),
			int(source_dt.second),
		)
		stamped_dt = tuple(retained.get('symbolic_cursor_datetime') or ())
		stamped_jd = retained.get('symbolic_cursor_jd')
		if len(stamped_dt) >= 6 and tuple(int(v) for v in stamped_dt[:6]) == display_dt:
			try:
				symbolic_jd = float(stamped_jd)
			except (TypeError, ValueError):
				symbolic_jd = None
		else:
			symbolic_jd = None
		if symbolic_jd is None:
			symbolic_time_obj = retained_clock_time(
				retained,
				'symbolic',
				display_dt,
				fallback_place=getattr(base_chart, 'place', None),
				fallback_time=getattr(base_chart, 'time', None),
			)
			if symbolic_time_obj is None:
				return SupplementaryBuildResult(None, display_dt, binding)
			symbolic_jd = float(symbolic_time_obj.jd)

		converse_enabled = bool(retained.get('converse_enabled', True))
		physical_jd = (
			converse_transits.mirrored_jd(
				getattr(getattr(base_chart, 'time', None), 'jd'),
				symbolic_jd,
			)
			if converse_enabled
			else symbolic_jd
		)
		physical_display_dt = retained_clock_local_tuple_for_jd(
			retained,
			'physical',
			physical_jd,
			fallback_place=getattr(base_chart, 'place', None),
			fallback_time=getattr(base_chart, 'time', None),
		)
		physical_time = retained_clock_time(
			retained,
			'physical',
			physical_display_dt,
			fallback_place=getattr(base_chart, 'place', None),
			fallback_time=getattr(base_chart, 'time', None),
		)
		if physical_time is None:
			return SupplementaryBuildResult(None, display_dt, binding)
		physical_place = payload_to_place(
			retained.get('physical_place_payload'),
			fallback=getattr(base_chart, 'place', None),
		)
		retained.update({
			'display_datetime': display_dt,
			'symbolic_cursor_datetime': display_dt,
			'symbolic_cursor_jd': float(symbolic_jd),
			'physical_cursor_datetime': tuple(int(value) for value in physical_display_dt),
			'physical_cursor_jd': float(physical_time.jd),
			'physical_place_payload': place_to_payload(physical_place),
		})
		binding.retained_state = retained
		return SupplementaryBuildResult(
			chart_factory.build_chart(
				base_chart.name,
				base_chart.male,
				physical_time,
				physical_place,
				chart.Chart.TRANSIT,
				'',
				frame.options,
				False,
			),
			display_dt,
			binding,
		)


class SupplementaryAdapterRegistry(object):
	def __init__(self):
		secondary = SecondarySupplementaryAdapter()
		solar_arc = SolarArcSupplementaryAdapter()
		solar_return = SolarReturnSupplementaryAdapter()
		lunar_return = LunarReturnSupplementaryAdapter()
		profections = ProfectionsSupplementaryAdapter()
		transits = TransitSupplementaryAdapter()
		converse_transits = ConverseTransitSupplementaryAdapter()
		planetary_return = PlanetaryReturnSupplementaryAdapter()
		self._adapters = {
			'secondary': secondary,
			'solar_arc': solar_arc,
			'minor': secondary,
			'tertiary': secondary,
			'solar_return': solar_return,
			'lunar_return': lunar_return,
			'solar_average': LegacySupplementaryAdapter(
				'solar_average',
				lambda frame, session, current_chart, base_chart, target_source_dt: frame._rebuild_workspace_solar_average_child(session, current_chart, base_chart, target_source_dt),
			),
			'planetary_return': planetary_return,
			'profections': profections,
			'transits': transits,
			'converse_transits': converse_transits,
		}

	def adapter_for_feature_kind(self, feature_kind):
		return self._adapters.get(feature_kind)
