import calendar
import math

import astrology
import chart
import util


def _calflag_from_chart(chrt):
	if chrt is not None and getattr(chrt.time, 'cal', chart.Time.GREGORIAN) == chart.Time.JULIAN:
		return astrology.SE_JUL_CAL
	return astrology.SE_GREG_CAL


def _is_leap_year(year_value, calflag):
	year_value = int(year_value)
	if calflag == astrology.SE_JUL_CAL:
		return year_value % 4 == 0
	return calendar.isleap(year_value)


def _sanitize_date_for_year(month_value, day_value, target_year, calflag):
	if int(month_value) == 2 and int(day_value) == 29 and not _is_leap_year(target_year, calflag):
		return int(month_value), 28
	return int(month_value), int(day_value)


def _jd_to_datetime_tuple(jd_value, calflag):
	y, m, d, hour = astrology.swe_revjul(float(jd_value), calflag)
	hh, mm, ss = util.decToDeg(hour)
	return int(y), int(m), int(d), int(hh), int(mm), int(ss)


def secondary_direction_symbolic_info(radix_chart, directed_chart):
	if radix_chart is None or directed_chart is None:
		return None

	birth_jd = float(radix_chart.time.jd)
	prog_jd = float(directed_chart.time.jd)
	delta_ephem_days = prog_jd - birth_jd

	calflag = _calflag_from_chart(radix_chart)
	birth_y, birth_m, birth_d, _ = astrology.swe_revjul(birth_jd, calflag)
	birth_y = int(birth_y)
	birth_m = int(birth_m)
	birth_d = int(birth_d)

	try:
		ut_anchor = float(radix_chart.time.time)
	except Exception:
		t = radix_chart.time
		ut_anchor = float(t.hour) + float(t.minute) / 60.0 + float(t.second) / 3600.0

	years_passed_int = int(math.floor(delta_ephem_days + 1e-12))
	frac_ephem = delta_ephem_days - years_passed_int
	if frac_ephem < 0.0:
		frac_ephem = 0.0

	anniv_year = birth_y + years_passed_int
	anniv_month, anniv_day = _sanitize_date_for_year(birth_m, birth_d, anniv_year, calflag)
	anniv_jd = astrology.swe_julday(anniv_year, anniv_month, anniv_day, ut_anchor, calflag)
	days_in_year = 366.0 if _is_leap_year(anniv_year, calflag) else 365.0

	real_jd = anniv_jd + frac_ephem * days_in_year
	real_dt = _jd_to_datetime_tuple(real_jd, calflag)
	progressed_dt = _jd_to_datetime_tuple(prog_jd, calflag)

	birth_anchor_month, birth_anchor_day = _sanitize_date_for_year(birth_m, birth_d, birth_y, calflag)
	birth_anchor_jd = astrology.swe_julday(birth_y, birth_anchor_month, birth_anchor_day, ut_anchor, calflag)
	delta_anchor_days = prog_jd - birth_anchor_jd
	if delta_anchor_days >= 0:
		age_years_int = int(math.floor(delta_anchor_days + 0.5))
	else:
		age_years_int = int(math.ceil(delta_anchor_days - 0.5))

	return {
		'progressed_datetime': progressed_dt,
		'signified_datetime': real_dt,
		'age_years': float(delta_ephem_days),
		'age_years_int': int(age_years_int),
		'delta_symbolic_days': float(delta_ephem_days),
	}
