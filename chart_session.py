# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

import wx
import astrology
import chart
import chartalerts
import moonphasejump
import options
import soundfx
import util


class ChartSession(object):
	"""Interactive session for a single chart in a workspace tab.

	ChartSession owns the time cursor (display_datetime), chart state, and
	navigation behavior for a chart. It is the primary "driver" in Antikythera
	terms: the interactive controller that owns the mutable semantic state.

	Key responsibilities:
	- Maintain the current chart (self.chart) and its time cursor
	- Handle time navigation (stepping, jumping, searching by date/aspect)
	- Manage view modes (single chart, compound synastry, positions table, etc)
	- Propagate changes back to the workspace (on_change callback)
	- Serve as the interaction hub for exact-hit searches, stepping, etc

	Antikythera role:
	ChartSession is the "driver" that owns the time cursor. The canonical time
	state lives here, not in the chart itself (which is immutable). For derived
	charts (transits, progressions), there's one ChartSession per derived chart,
	all sharing the same radix but each with its own cursor/navigation state.

	View modes:
	- CHART (0): Single chart display
	- COMPOUND (1): Two charts side-by-side (synastry, comparison)
	- POSITIONS (2): Positions table view
	- SQUARE (3): Square/symmetric view

	Attributes:
		chart (chart.Chart): Current chart being displayed (mutable via change_chart).
		radix (chart.Chart): The natal/birth chart (immutable context).
		cursor_jd (float): Authoritative absolute session cursor (Julian day).
		display_datetime (tuple): (year, month, day, hour, minute, second) - the
			display/local view of the cursor for supplementary charts. Updated via navigation/stepping.
		display_anchor_chart (chart.Chart): Secondary reference chart for some views.
		view_mode (int): Current view mode (CHART, COMPOUND, etc).
		options: Global application options/settings.
	"""
	CHART = 0
	COMPOUND = 1
	POSITIONS = 2
	SQUARE = 3

	UP_KEYS = tuple(k for k in (getattr(wx, 'WXK_UP', None), getattr(wx, 'WXK_NUMPAD_UP', None), 315) if k is not None)
	DOWN_KEYS = tuple(k for k in (getattr(wx, 'WXK_DOWN', None), getattr(wx, 'WXK_NUMPAD_DOWN', None), 317) if k is not None)
	LEFT_KEYS = tuple(k for k in (getattr(wx, 'WXK_LEFT', None), getattr(wx, 'WXK_NUMPAD_LEFT', None), 314) if k is not None)
	RIGHT_KEYS = tuple(k for k in (getattr(wx, 'WXK_RIGHT', None), getattr(wx, 'WXK_NUMPAD_RIGHT', None), 316) if k is not None)

	def __init__(self, chrt, radix, options, view_mode=0,
				 navigation_units=None, navigation_title_label=None,
				 stepper=None, on_change=None, display_datetime=None, display_anchor_chart=None,
				 lazy_optional_step_features=False):
		self.chart = chrt
		self._initial_chart = chrt
		self.display_datetime = self._normalize_display_datetime(
			display_datetime if display_datetime is not None else self._chart_display_datetime(chrt)
		)
		self.cursor_jd = self._cursor_jd_for_chart(chrt, self.display_datetime)
		self._initial_display_datetime = self.display_datetime
		self._initial_cursor_jd = self.cursor_jd
		self.radix = radix
		self.display_anchor_chart = display_anchor_chart
		self.options = options
		self.view_mode = view_mode
		self.navigation_units = navigation_units
		self.navigation_title_label = navigation_title_label
		self._stepper = stepper
		self._on_change = on_change
		self._exact_hit_metrics = self._current_exact_hit_metrics()
		self._last_tab_toggle = 0.0
		self._comparison_toggle_handler = None
		self._last_change_reason = 'normal'
		# The Tauri exporter materializes only the selected outer-ring family on
		# demand. Legacy wx drawing still expects Chart(full=True), so this is an
		# explicit session capability instead of a global behavior change.
		self.lazy_optional_step_features = bool(lazy_optional_step_features)

	def _normalized_nav_key(self, keycode):
		if keycode in self.UP_KEYS:
			return wx.WXK_UP
		if keycode in self.DOWN_KEYS:
			return wx.WXK_DOWN
		if keycode in self.LEFT_KEYS:
			return wx.WXK_LEFT
		if keycode in self.RIGHT_KEYS:
			return wx.WXK_RIGHT
		return keycode

	def _get_navigation_unit(self, shift_down=False, alt_down=False):
		if not self.navigation_units:
			return None
		if alt_down and shift_down:
			if len(self.navigation_units) > 3:
				return self.navigation_units[3]
			return self.navigation_units[2]
		if alt_down:
			return self.navigation_units[2]
		if shift_down:
			return self.navigation_units[1]
		return self.navigation_units[0]

	def _navigate_intrinsically(self, keycode, shift_down=False, alt_down=False):
		keycode = self._normalized_nav_key(keycode)
		if keycode in (wx.WXK_UP, wx.WXK_DOWN):
			if tuple((self.navigation_units or ())[:3]) != ('day', 'hour', 'minute'):
				return False
			if shift_down and not alt_down:
				delta = 1 if keycode == wx.WXK_UP else -1
				return self.navigate_to_classical_phase(delta)
			delta = 1 if keycode == wx.WXK_UP else -1
			return self.navigate_relative('week', delta)
		if keycode not in (wx.WXK_LEFT, wx.WXK_RIGHT):
			return False
		unit = self._get_navigation_unit(shift_down=shift_down, alt_down=alt_down)
		if unit is None:
			return False
		delta = -1 if keycode == wx.WXK_LEFT else 1
		return self.navigate_relative(unit, delta)

	def _forward_stepper_arrow(self, keycode, shift_down=False, alt_down=False, control_down=False, cmd_down=False, repeat=1):
		stepper = self._stepper
		if stepper is None:
			return False
		try:
			if hasattr(stepper, 'handle_navigation_key'):
				if repeat != 1:
					handled = stepper.handle_navigation_key(
						keycode, shift_down=shift_down, alt_down=alt_down,
						control_down=control_down, cmd_down=cmd_down, repeat=repeat,
					)
				else:
					handled = stepper.handle_navigation_key(
						keycode, shift_down=shift_down, alt_down=alt_down,
						control_down=control_down, cmd_down=cmd_down,
					)
				if handled:
					return True
			if keycode == wx.WXK_LEFT and hasattr(stepper, 'step_backward'):
				stepper.step_backward()
				return True
			if keycode == wx.WXK_RIGHT and hasattr(stepper, 'step_forward'):
				stepper.step_forward()
				return True
		except Exception:
			return False
		return False

	def navigate_relative(self, unit, delta):
		if unit not in ('day', 'hour', 'minute', 'second', 'week'):
			return False

		t = self.chart.time
		current_dt = self.display_datetime if self.display_datetime is not None else self._chart_display_datetime(self.chart)
		if current_dt is None:
			return False
		y, m, d, h, mi, s = [int(v) for v in current_dt[:6]]
		step_info = chart.Time.step_datetime_fields(
			y, m, d, h, mi, s, unit, delta,
			t.bc, t.cal, t.zt, t.plus, t.zh, t.zm, t.daylightsaving,
			self.chart.place, tzid=getattr(t, 'tzid', ''),
		)
		y, m, d, h, mi, s = step_info['tuple']

		needs_full_chart = self._navigation_requires_full_chart()
		newtime = chart.Time(
			y, m, d, h, mi, s,
			t.bc, t.cal, t.zt, step_info['plus'], step_info['zh'], step_info['zm'], step_info['daylightsaving'],
			self.chart.place, needs_full_chart, tzid=getattr(t, 'tzid', ''), tzauto=getattr(t, 'tzauto', False)
		)
		newchart = chart.Chart(
			self.chart.name, self.chart.male, newtime, self.chart.place,
			self.chart.htype, '', self.options, needs_full_chart
		)
		self._reuse_step_syzygy_if_valid(newchart)
		self.change_chart(newchart, display_datetime=step_info['tuple'], change_reason='step')
		return True

	def navigate_to_classical_phase(self, delta):
		try:
			newtime = moonphasejump.jump_to_classical_phase(self.chart.time, self.chart.place, delta)
		except Exception:
			return False
		if newtime is None:
			return False
		needs_full_chart = self._navigation_requires_full_chart()
		newchart = chart.Chart(
			self.chart.name, self.chart.male, newtime, self.chart.place,
			self.chart.htype, '', self.options, needs_full_chart
		)
		self._reuse_step_syzygy_if_valid(newchart)
		self.change_chart(newchart, change_reason='step')
		return True

	def _reuse_step_syzygy_if_valid(self, newchart):
		"""Retain the exact prenatal lunation inside its proven phase interval.

		Syzygy's expensive backward search changes only when the Sun/Moon phase
		classification crosses conjunction or opposition. The stepped chart has
		already calculated both bodies, so this check is constant-time and fails
		closed: any incomplete state leaves the new chart to calculate normally.
		At a bounded forward phase flip, the previous canonical lunation is passed
		as the new result's exact opposite seed, avoiding one redundant search.
		"""
		if not self.lazy_optional_step_features:
			return False
		previous = getattr(getattr(self, 'chart', None), 'syzygy', None)
		if previous is None or not hasattr(previous, 'newmoon'):
			return False
		try:
			previous_jd = float(previous.time.jd)
			stepped_jd = float(newchart.time.jd)
			# Classification repeats after two phase boundaries. A 20-day cap is
			# deliberately shorter than a synodic month, so a large batched jump
			# can never mistake the next same-kind lunation for the cached one.
			if stepped_jd <= previous_jd or stepped_jd - previous_jd >= 20.0:
				return False
			sun = newchart.planets.planets[astrology.SE_SUN].data[0]
			moon = newchart.planets.planets[astrology.SE_MOON].data[0]
			# Match Syzygy.__init__'s DMS normalization before classification.
			sd, sm, ss = util.decToDeg(sun)
			md, mm, ms = util.decToDeg(moon)
			diff = (md + mm / 60.0 + ms / 3600.0) - (sd + sm / 60.0 + ss / 3600.0)
			newmoon, ready = previous.isNewMoon(diff)
			if bool(newmoon) != bool(previous.newmoon):
				# The new canonical lunation still has to be calculated. Its
				# secondary/opposite search, however, would rediscover the exact
				# previous canonical result. Pass that result forward as a
				# one-shot, fail-closed seed instead of repeating the search.
				newchart._step_syzygy_previous_opposite = previous
				return False
			if ready:
				return False
			newchart.syzygy = previous
			return True
		except Exception:
			return False

	def _navigation_requires_full_chart(self):
		if self.lazy_optional_step_features:
			return False
		mode = getattr(self.options, 'showfixstars', options.Options.NONE)
		return mode in (
			options.Options.FIXSTARS,
			options.Options.ASTEROIDS,
			options.Options.MIDPOINTS,
			options.Options.HYBRID_HITS,
			options.Options.ARABICPARTS,
		)

	def reset_to_initial_chart(self):
		if self._initial_chart is None:
			return False
		stepper = self._stepper
		if stepper is not None and hasattr(stepper, 'reset_to_initial_state'):
			try:
				stepper.reset_to_initial_state()
			except Exception:
				pass
		if self.chart is not self._initial_chart:
			self.change_chart(self._initial_chart, display_datetime=self._initial_display_datetime)
		return True

	def toggleComparisonView(self):
		handler = getattr(self, '_comparison_toggle_handler', None)
		if callable(handler):
			try:
				return bool(handler())
			except Exception:
				import sys
				import traceback
				sys.stderr.write('[comparison-toggle-handler-failed]\n')
				traceback.print_exc()
				return False
		if self.view_mode == self.COMPOUND:
			self.view_mode = self.CHART
		elif self.view_mode == self.CHART:
			self.view_mode = self.COMPOUND
		self._fire_change()
		return True

	def _chart_display_datetime(self, chrt):
		if chrt is None or getattr(chrt, 'time', None) is None:
			return None
		t = chrt.time
		return (
			getattr(t, 'origyear', t.year),
			getattr(t, 'origmonth', t.month),
			getattr(t, 'origday', t.day),
			t.hour,
			t.minute,
			t.second,
		)

	def _normalize_display_datetime(self, display_datetime):
		if display_datetime is None:
			return None
		try:
			parts = [int(v) for v in tuple(display_datetime)[:6]]
		except Exception:
			return None
		if len(parts) < 4:
			return None
		while len(parts) < 6:
			parts.append(0)
		return tuple(parts[:6])

	def _cursor_jd_for_chart(self, chrt, display_datetime=None):
		if chrt is None or getattr(chrt, 'time', None) is None:
			return None
		display_dt = self._normalize_display_datetime(display_datetime)
		time_obj = getattr(chrt, 'time', None)
		if (
			display_dt is not None and
			getattr(time_obj, 'zt', chart.Time.ZONE) == chart.Time.GREENWICH and
			getattr(chrt, 'htype', None) in (chart.Chart.SOLAR, chart.Chart.LUNAR, chart.Chart.REVOLUTION)
		):
			try:
				return float(getattr(time_obj, 'jd', None))
			except Exception:
				pass
		if display_dt is not None and getattr(chrt, 'place', None) is not None:
			try:
				time_obj = chart.Time(
					display_dt[0], display_dt[1], display_dt[2], display_dt[3], display_dt[4], display_dt[5],
					bool(getattr(chrt.time, 'bc', False)),
					getattr(chrt.time, 'cal', chart.Time.GREGORIAN),
					getattr(chrt.time, 'zt', chart.Time.ZONE),
					bool(getattr(chrt.time, 'plus', True)),
					int(getattr(chrt.time, 'zh', 0) or 0),
					int(getattr(chrt.time, 'zm', 0) or 0),
					bool(getattr(chrt.time, 'daylightsaving', False)),
					chrt.place,
					False,
					tzid=getattr(chrt.time, 'tzid', ''),
					tzauto=bool(getattr(chrt.time, 'tzauto', False)),
				)
			except Exception:
				time_obj = getattr(chrt, 'time', None)
		try:
			return float(getattr(time_obj, 'jd', None))
		except Exception:
			return None

	def set_display_datetime(self, display_datetime, chart_obj=None):
		self.display_datetime = self._normalize_display_datetime(display_datetime)
		self.cursor_jd = self._cursor_jd_for_chart(chart_obj if chart_obj is not None else self.chart, self.display_datetime)

	def change_chart(self, chrt, display_datetime=None, change_reason='normal'):
		self.chart = chrt
		self.set_display_datetime(
			display_datetime if display_datetime is not None else self._chart_display_datetime(chrt),
			chart_obj=chrt,
		)
		self._last_change_reason = change_reason or 'normal'
		self._handle_chart_alerts()
		self._fire_change()

	def _current_exact_hit_metrics(self):
		if self.radix is None or self.chart is None:
			return {}
		if self.chart is self.radix:
			return {}
		return chartalerts.selected_step_alert_metrics(self.radix, self.chart, self.options)

	def _update_exact_hit_metrics(self):
		self._exact_hit_metrics, should_sound = chartalerts.update_step_alert_state(
			self._exact_hit_metrics, self.radix, self.chart, self.options,
		)
		return should_sound

	def _handle_chart_alerts(self):
		if self._update_exact_hit_metrics():
			soundfx.play_sound()

	def _fire_change(self):
		if self._on_change is not None:
			self._on_change(self)
