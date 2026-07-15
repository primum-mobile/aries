# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

from dataclasses import dataclass, field
from typing import Any, Dict, Optional, Tuple

import chart


DisplayDateTime = Tuple[int, int, int, int, int, int]

MODE_CHART = 'chart'
MODE_COMPOUND = 'compound'
MODE_POSITIONS = 'positions'
MODE_SQUARE = 'square'

LINEAGE_ROOT = 'root'
LINEAGE_TRANSIT = 'transit'
LINEAGE_SECONDARY = 'secondary'
LINEAGE_PROFECTION = 'profection'
LINEAGE_RETURN = 'return'
LINEAGE_PD = 'pd'
LINEAGE_ELECTION = 'election'


@dataclass
class ChartContext:
	chart: Any
	radix: Optional[Any] = None
	mode: str = MODE_CHART
	lineage: str = LINEAGE_ROOT
	display_datetime: Optional[DisplayDateTime] = None
	navigation_units: Optional[Tuple[str, ...]] = None
	navigation_title_label: Optional[str] = None
	initial_chart: Optional[Any] = None
	initial_display_datetime: Optional[DisplayDateTime] = None
	overlay_flags: Dict[str, Any] = field(default_factory=dict)
	capabilities: Dict[str, bool] = field(default_factory=dict)
	metadata: Dict[str, Any] = field(default_factory=dict)


_MODE_MAP = {
	0: MODE_CHART,
	1: MODE_COMPOUND,
	2: MODE_POSITIONS,
	3: MODE_SQUARE,
	MODE_CHART: MODE_CHART,
	MODE_COMPOUND: MODE_COMPOUND,
	MODE_POSITIONS: MODE_POSITIONS,
	MODE_SQUARE: MODE_SQUARE,
}


def _chart_display_datetime(chrt):
	if chrt is None or getattr(chrt, 'time', None) is None:
		return None
	t = chrt.time
	return (
		int(getattr(t, 'origyear', t.year)),
		int(getattr(t, 'origmonth', t.month)),
		int(getattr(t, 'origday', t.day)),
		int(t.hour),
		int(t.minute),
		int(t.second),
	)


def _coerce_mode(raw_mode):
	return _MODE_MAP.get(raw_mode, MODE_CHART)


def _looks_like_secondary_stepper(stepper):
	if stepper is None:
		return False
	return getattr(stepper.__class__, '__name__', '') == 'StepperDlg'


def _looks_like_secondary_source(source, stepper):
	if _looks_like_secondary_stepper(stepper):
		return True
	class_name = getattr(getattr(source, '__class__', None), '__name__', '')
	return class_name == 'SecDirFrame'


def _infer_lineage(source, chrt, radix, stepper):
	if _looks_like_secondary_source(source, stepper):
		return LINEAGE_SECONDARY
	if chrt is None:
		return LINEAGE_ROOT
	htype = getattr(chrt, 'htype', None)
	if htype == chart.Chart.PDINCHART:
		return LINEAGE_PD
	if htype == chart.Chart.PROFECTION:
		return LINEAGE_PROFECTION
	if htype in (chart.Chart.SOLAR, chart.Chart.LUNAR, chart.Chart.REVOLUTION):
		return LINEAGE_RETURN
	if htype == chart.Chart.TRANSIT and radix is not None and chrt is not radix:
		return LINEAGE_TRANSIT
	return LINEAGE_ROOT


def make_context(chart_obj, radix=None, mode=MODE_CHART, lineage=LINEAGE_ROOT,
		display_datetime=None, navigation_units=None, navigation_title_label=None,
		initial_chart=None, initial_display_datetime=None, metadata=None,
		overlay_flags=None, capabilities=None):
	display_dt = display_datetime if display_datetime is not None else _chart_display_datetime(chart_obj)
	return ChartContext(
		chart=chart_obj,
		radix=radix,
		mode=_coerce_mode(mode),
		lineage=lineage,
		display_datetime=display_dt,
		navigation_units=navigation_units,
		navigation_title_label=navigation_title_label,
		initial_chart=initial_chart if initial_chart is not None else chart_obj,
		initial_display_datetime=initial_display_datetime if initial_display_datetime is not None else display_dt,
		metadata=dict(metadata or {}),
		overlay_flags=dict(overlay_flags or {}),
		capabilities=dict(capabilities or {}),
	)


def context_display_datetime(ctx) -> Optional[DisplayDateTime]:
	if ctx is None:
		return None
	if getattr(ctx, 'display_datetime', None) is not None:
		return ctx.display_datetime
	return _chart_display_datetime(getattr(ctx, 'chart', None))


def change_chart(ctx, new_chart, display_datetime=None):
	if ctx is None:
		return None
	ctx.chart = new_chart
	ctx.display_datetime = display_datetime if display_datetime is not None else _chart_display_datetime(new_chart)
	return ctx


def reset_context(ctx):
	if ctx is None or ctx.initial_chart is None:
		return None
	ctx.chart = ctx.initial_chart
	ctx.display_datetime = ctx.initial_display_datetime
	return ctx


def toggle_mode(ctx):
	if ctx is None:
		return None
	if ctx.mode == MODE_COMPOUND:
		ctx.mode = MODE_CHART
	elif ctx.mode == MODE_CHART:
		ctx.mode = MODE_COMPOUND
	return ctx


def context_from_session_like(source, metadata=None, overlay_flags=None, capabilities=None):
	if isinstance(source, ChartContext):
		return source
	if source is None:
		return make_context(None, metadata=metadata, overlay_flags=overlay_flags, capabilities=capabilities)

	chart_obj = getattr(source, 'chart', None)
	radix = getattr(source, 'radix', None)
	stepper = getattr(source, '_stepper', None)
	ctx_metadata = dict(getattr(source, 'metadata', {}) or {})
	ctx_metadata.update(metadata or {})
	if _looks_like_secondary_stepper(stepper):
		ctx_metadata.setdefault('secondary_symbolic', True)
	if getattr(source, '_astrolabe_session', False):
		ctx_metadata.setdefault('astrolabe', True)
	if chart_obj is not None and hasattr(chart_obj, '_pd_arc_abs'):
		ctx_metadata.setdefault('pd_arc_abs', getattr(chart_obj, '_pd_arc_abs'))
	if chart_obj is not None and hasattr(chart_obj, '_pd_arc_signed'):
		ctx_metadata.setdefault('pd_arc_signed', getattr(chart_obj, '_pd_arc_signed'))
	if chart_obj is not None and hasattr(chart_obj, '_pd_exact_event'):
		pd_exact = getattr(chart_obj, '_pd_exact_event') or {}
		if isinstance(pd_exact, dict):
			if 'time' in pd_exact:
				ctx_metadata.setdefault('pd_exact_jd', pd_exact.get('time'))

	return make_context(
		chart_obj=chart_obj,
		radix=radix,
		mode=getattr(source, 'mode', getattr(source, 'view_mode', getattr(source, 'selection', MODE_CHART))),
		lineage=_infer_lineage(source, chart_obj, radix, stepper),
		display_datetime=getattr(source, 'display_datetime', None),
		navigation_units=getattr(source, 'navigation_units', None),
		navigation_title_label=getattr(source, 'navigation_title_label', None),
		initial_chart=getattr(source, '_initial_chart', None),
		initial_display_datetime=getattr(source, '_initial_display_datetime', None),
		metadata=ctx_metadata,
		overlay_flags=overlay_flags,
		capabilities=capabilities,
	)
