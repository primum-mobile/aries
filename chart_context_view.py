# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

import math

import astrology
import chart
import common
import dateformat
import mtexts
import posfordate
import primdirs
import symbolic_time
import util

import chart_context


def _ensure_context(ctx):
	return chart_context.context_from_session_like(ctx)


def _iso_datetime_text(dt, options=None):
	return dateformat.date_time_text(dt, options, show_seconds=True)


def _dot_date_text(dt, options=None):
	y, m, d = [int(v) for v in dt[:3]]
	return dateformat.date_text(y, m, d, options)


def _weekday_abbrev_from_datetime(dt, calflag):
	try:
		y, m, d, h, mi, s = [int(v) for v in dt]
		ut = float(h) + float(mi) / 60.0 + float(s) / 3600.0
		jd = astrology.swe_julday(y, m, d, ut, calflag)
		weekday_idx = int(math.floor(jd + 0.5)) % 7
		weekday_name = common.common.days[weekday_idx]
	except Exception:
		return None

	try:
		weekday_name = weekday_name.strip()
	except Exception:
		weekday_name = ''
	if not weekday_name:
		return None
	return weekday_name[:3]


def _show_seconds(options):
	if options is None:
		return True
	return getattr(options, 'showseconds', True)


def _compact_context_datetime_text(dt, calflag, show_seconds=True, options=None):
	y, m, d, h, mi, s = [int(v) for v in dt]
	weekday = _weekday_abbrev_from_datetime((y, m, d, h, mi, s), calflag)
	return dateformat.date_time_text((y, m, d, h, mi, s), options, show_seconds=show_seconds, weekday=weekday)


def _progression_method(ctx):
	ctx = _ensure_context(ctx)
	if ctx is None:
		return posfordate.SECONDARY
	stepper = getattr(ctx, '_stepper', None)
	if stepper is not None:
		return posfordate.progression_method(getattr(stepper, 'method', posfordate.SECONDARY))
	return posfordate.progression_chart_method(getattr(ctx, 'chart', None), default=posfordate.SECONDARY)


def _progression_day_type(ctx, options=None):
	ctx = _ensure_context(ctx)
	default = getattr(options, 'progression_day_type', posfordate.PROGRESSION_DAY_TYPE_Q2)
	if ctx is None:
		return posfordate.progression_day_type(default)
	return posfordate.progression_chart_day_type(getattr(ctx, 'chart', None), default=default)


def get_context_datetime_text(ctx, options=None):
	ctx = _ensure_context(ctx)
	if ctx is None or ctx.chart is None:
		return None
	dt = chart_context.context_display_datetime(ctx)
	if dt is None:
		return None
	try:
		dy, dm, dd, dh, dmi, ds = [int(v) for v in dt]
	except Exception:
		return None
	base_chart = ctx.radix if getattr(ctx, 'radix', None) is not None else ctx.chart
	try:
		calflag = symbolic_time._calflag_from_chart(base_chart)
		return _compact_context_datetime_text((dy, dm, dd, dh, dmi, ds), calflag, show_seconds=_show_seconds(options), options=options)
	except Exception:
		return dateformat.date_time_text((dy, dm, dd, dh, dmi, ds), options, show_seconds=_show_seconds(options))


def _pd_years_per_degree(options):
	if options is None:
		return 1.0
	if options.pdkeydyn:
		coeff = primdirs.PrimDirs.staticData[primdirs.PrimDirs.NAIBOD][primdirs.PrimDirs.COEFF]
		return coeff if coeff > 0.0 else 1.0
	if options.pdkeys == primdirs.PrimDirs.CUSTOMER:
		deg_per_year = options.pdkeydeg + options.pdkeymin / 60.0 + options.pdkeysec / 3600.0
		if deg_per_year <= 0.0:
			return 1.0
		return 1.0 / deg_per_year
	coeff = primdirs.PrimDirs.staticData[options.pdkeys][primdirs.PrimDirs.COEFF]
	return coeff if coeff > 0.0 else 1.0


def _format_runtime_status_datetime(ctx, options=None):
	chrt = getattr(ctx, 'chart', None)
	if chrt is None or getattr(chrt, 'time', None) is None:
		return None
	if getattr(chrt, 'is_solar_average', False):
		age_min = int(getattr(chrt, 'solar_average_age_min', 0))
		age_max = int(getattr(chrt, 'solar_average_age_max', age_min))
		return mtexts.txts.get('SolarAverageAge', 'Average • Age %d-%d') % (age_min, age_max)
	t = chrt.time
	dt = chart_context.context_display_datetime(ctx)
	if dt is None:
		dt = (
			getattr(t, 'origyear', t.year),
			getattr(t, 'origmonth', t.month),
			getattr(t, 'origday', t.day),
			t.hour,
			t.minute,
			t.second,
		)
	y, m, d, h, mi, s = [int(v) for v in dt]
	ztxt = ''
	if t.zt == chart.Time.ZONE:
		ztxt = mtexts.txts['ZN']
	elif t.zt == chart.Time.LOCALMEAN or t.zt == chart.Time.LOCALAPPARENT:
		ztxt = mtexts.txts['LC']
	try:
		month_name = common.common.months[m - 1]
	except Exception:
		month_name = str(m).zfill(2)
	date_txt = dateformat.date_text_named_month(
		y, month_name, d, options, bc=getattr(t, 'bc', False))
	return '%s, %s:%s:%s%s' % (
		date_txt,
		str(h).zfill(2),
		str(mi).zfill(2),
		str(s).zfill(2),
		ztxt,
	)


def _solar_average_text(ctx):
	ctx = _ensure_context(ctx)
	chrt = getattr(ctx, 'chart', None)
	if chrt is None or not getattr(chrt, 'is_solar_average', False):
		return None
	age_min = int(getattr(chrt, 'solar_average_age_min', 0))
	age_max = int(getattr(chrt, 'solar_average_age_max', age_min))
	return mtexts.txts.get('SolarAverageAge', 'Average • Age %d-%d') % (age_min, age_max)


def get_pd_datetime_and_age(ctx, options=None):
	ctx = _ensure_context(ctx)
	if ctx is None or ctx.radix is None or ctx.chart is None:
		return None
	if ctx.lineage != chart_context.LINEAGE_PD and getattr(ctx.chart, 'htype', None) != chart.Chart.PDINCHART:
		return None
	calflag = symbolic_time._calflag_from_chart(ctx.radix)
	exact_jd = ctx.metadata.get('pd_exact_jd')
	try:
		exact_jd = float(exact_jd)
	except Exception:
		exact_jd = None
	if exact_jd is not None:
		y, m, d, h = astrology.swe_revjul(exact_jd, 1)
		ho, mi, se = util.decToDeg(h)
	else:
		t = ctx.chart.time
		y = getattr(t, 'origyear', t.year)
		m = getattr(t, 'origmonth', t.month)
		d = getattr(t, 'origday', t.day)
		ho = t.hour
		mi = t.minute
		se = t.second
	dt = (int(y), int(m), int(d), int(ho), int(mi), int(se))
	date_txt = _compact_context_datetime_text(dt, calflag, show_seconds=_show_seconds(options), options=options)
	arc_abs = ctx.metadata.get('pd_arc_abs')
	try:
		arc_abs = float(arc_abs)
	except Exception:
		arc_abs = None
	if arc_abs is None:
		try:
			base_jd = exact_jd if exact_jd is not None else float(ctx.chart.time.jd)
			arc_abs = math.fabs(base_jd - float(ctx.radix.time.jd)) / 365.2425
		except Exception:
			return None
	return date_txt, arc_abs * _pd_years_per_degree(options)


def get_context_datetime_and_age(ctx, options=None):
	ctx = _ensure_context(ctx)
	if ctx is None or ctx.radix is None or ctx.chart is None:
		return None
	is_astrolabe = bool(ctx.metadata.get('astrolabe'))
	if ctx.chart is ctx.radix and not is_astrolabe:
		return None
	pd_info = get_pd_datetime_and_age(ctx, options=options)
	if pd_info is not None:
		return pd_info
	dt = chart_context.context_display_datetime(ctx)
	if dt is None:
		return None
	try:
		dy, dm, dd, dh, dmi, ds = [int(v) for v in dt]
	except Exception:
		return None
	try:
		calflag = symbolic_time._calflag_from_chart(ctx.radix)
		date_txt = _compact_context_datetime_text((dy, dm, dd, dh, dmi, ds), calflag, show_seconds=_show_seconds(options), options=options)
		ut_disp = float(dh) + float(dmi) / 60.0 + float(ds) / 3600.0
		disp_jd = astrology.swe_julday(dy, dm, dd, ut_disp, calflag)
		age_base_jd = ctx.metadata.get('age_base_jd')
		age_base_years = ctx.metadata.get('age_base_years')
		if age_base_jd is not None:
			age_delta = (disp_jd - float(age_base_jd)) / 365.2425
			if ctx.metadata.get('age_base_mode') == 'offset':
				age_years = age_delta
			elif age_base_years is not None:
				age_years = float(age_base_years) + age_delta
			else:
				age_years = age_delta
		else:
			age_years = (disp_jd - float(ctx.radix.time.jd)) / 365.2425
	except Exception:
		date_txt = dateformat.date_time_text((dy, dm, dd, dh, dmi, ds), options, show_seconds=_show_seconds(options))
		age_years = 0.0
	return date_txt, age_years


def get_secondary_symbolic_datetime_and_age(ctx, options=None):
	ctx = _ensure_context(ctx)
	if ctx is None or ctx.radix is None or ctx.chart is None:
		return None
	info = symbolic_time.secondary_direction_symbolic_info(
		ctx.radix,
		ctx.chart,
		method=_progression_method(ctx),
		day_type=_progression_day_type(ctx, options),
	)
	if info is None:
		return None
	sy, sm, sd, sh, smi, ss = info['progressed_datetime']
	ry, rm, rd, rh, rmi, rs = info['signified_datetime']
	date_txt = mtexts.txts.get('SecondarySymbolicReal', 'Symbolic: %s • Real: %s') % (
		dateformat.date_time_text((sy, sm, sd, sh, smi, ss), options, show_seconds=True),
		dateformat.date_time_text((ry, rm, rd, rh, rmi, rs), options, show_seconds=True),
	)
	return date_txt, info['age_years']


def get_secondary_real_datetime_and_age(ctx, options=None):
	ctx = _ensure_context(ctx)
	if ctx is None or ctx.radix is None or ctx.chart is None:
		return None
	info = symbolic_time.secondary_direction_symbolic_info(
		ctx.radix,
		ctx.chart,
		method=_progression_method(ctx),
		day_type=_progression_day_type(ctx, options),
	)
	if info is None:
		return None
	ry, rm, rd, rh, rmi, rs = info['signified_datetime']
	return _iso_datetime_text((ry, rm, rd, rh, rmi, rs), options), info['age_years']


def get_secondary_real_status(ctx, options=None):
	ctx = _ensure_context(ctx)
	if ctx is None or ctx.radix is None or ctx.chart is None:
		return None
	info = symbolic_time.secondary_direction_symbolic_info(
		ctx.radix,
		ctx.chart,
		method=_progression_method(ctx),
		day_type=_progression_day_type(ctx, options),
	)
	if info is None:
		return None
	real_dt = info['signified_datetime']
	return {
		'age_years_int': int(info['age_years_int']),
		'real_date_tuple': tuple(int(v) for v in real_dt[:3]),
		'real_date_text': _dot_date_text(real_dt, options),
		'age_status_text': '%s: %d' % (mtexts.txts['Age'], int(info['age_years_int'])),
		'real_status_text': '%s: %s' % (mtexts.txts['Real'], _dot_date_text(real_dt, options)),
	}


def get_age_text(ctx, options=None):
	info = get_context_datetime_and_age(ctx, options=options)
	if info is None:
		return None
	return mtexts.txts.get('AgeYears', 'Age: %.2fy') % info[1]


def get_header_text(ctx, options=None):
	solar_average_txt = _solar_average_text(ctx)
	if solar_average_txt is not None:
		return solar_average_txt
	info = get_context_datetime_and_age(ctx, options=options)
	if info is None:
		return None
	date_txt, age_years = info
	if getattr(getattr(_ensure_context(ctx), 'radix', None), 'htype', None) == chart.Chart.HORARY:
		return date_txt
	age_txt = mtexts.txts.get('AgeYears', 'Age: %.2fy') % age_years
	return '%s, %s' % (date_txt, age_txt)


def get_status_text(ctx, options=None):
	ctx = _ensure_context(ctx)
	solar_average_txt = _solar_average_text(ctx)
	if solar_average_txt is not None:
		return solar_average_txt
	return _format_runtime_status_datetime(ctx, options=options)


def get_title_suffix(ctx, options=None):
	solar_average_txt = _solar_average_text(ctx)
	if solar_average_txt is not None:
		return solar_average_txt
	info = get_context_datetime_and_age(ctx, options=options)
	if info is None:
		return None
	date_txt, age_years = info
	if getattr(getattr(_ensure_context(ctx), 'radix', None), 'htype', None) == chart.Chart.HORARY:
		return date_txt
	age_txt = mtexts.txts.get('AgeYears', 'Age: %.2fy') % age_years
	return '%s • %s' % (date_txt, age_txt)


def get_tab_title_suffix(ctx, options=None):
	solar_average_txt = _solar_average_text(ctx)
	if solar_average_txt is not None:
		return solar_average_txt
	info = get_context_datetime_and_age(ctx, options=options)
	if info is None:
		return None
	date_txt, _age_years = info
	return date_txt


def get_capabilities(ctx, options=None):
	ctx = _ensure_context(ctx)
	return {
		'has_chart': ctx.chart is not None,
		'has_radix': ctx.radix is not None,
		'has_display_datetime': chart_context.context_display_datetime(ctx) is not None,
		'is_child': ctx.radix is not None and ctx.chart is not None and ctx.chart is not ctx.radix,
		'is_pd': ctx.lineage == chart_context.LINEAGE_PD,
		'is_secondary': ctx.lineage == chart_context.LINEAGE_SECONDARY,
		'can_reset': ctx.initial_chart is not None,
		'can_toggle_mode': ctx.mode in (chart_context.MODE_CHART, chart_context.MODE_COMPOUND),
	}
