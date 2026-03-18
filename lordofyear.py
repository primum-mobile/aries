import datetime

import astrology
import chart
import houses
import revolutions
import util


MEAN_TROPICAL_YEAR_DAYS = 365.2421904


def _calflag_from_chart(chrt):
	if chrt is not None and getattr(chrt.time, 'cal', chart.Time.GREGORIAN) == chart.Time.JULIAN:
		return astrology.SE_JUL_CAL
	return astrology.SE_GREG_CAL


def _tuple_to_jd(y, m, d, hh, mm, ss, chrt):
	calflag = _calflag_from_chart(chrt)
	hour = float(hh) + float(mm) / 60.0 + float(ss) / 3600.0
	return astrology.swe_julday(int(y), int(m), int(d), hour, calflag)


def _solar_return_jd_for_year(radix, year_value):
	rev = revolutions.Revolutions()
	ok = rev.compute(
		revolutions.Revolutions.SOLAR,
		int(year_value),
		radix.time.month,
		radix.time.day,
		radix,
		target_year=int(year_value),
	)
	if not ok:
		return None
	y, m, d, hh, mm, ss = rev.t[0], rev.t[1], rev.t[2], rev.t[3], rev.t[4], rev.t[5]
	calflag = _calflag_from_chart(radix)
	hour = float(hh) + float(mm) / 60.0 + float(ss) / 3600.0
	return astrology.swe_julday(int(y), int(m), int(d), hour, calflag)


def _completed_solar_years(radix, cursor_jd):
	"""Count how many solar returns have occurred between radix birth and cursor_jd."""
	birth_year = int(getattr(radix.time, 'origyear', radix.time.year))
	elapsed = cursor_jd - radix.time.jd
	if elapsed < 0:
		return 0

	# Rough estimate, then verify and adjust by at most 1
	n = int(elapsed / MEAN_TROPICAL_YEAR_DAYS)

	sr = _solar_return_jd_for_year(radix, birth_year + n)
	if sr is None:
		return n

	if cursor_jd >= sr:
		# Check if the next SR has also passed
		sr_next = _solar_return_jd_for_year(radix, birth_year + n + 1)
		if sr_next is not None and cursor_jd >= sr_next:
			n += 1
	else:
		# Fell before this SR — step back one
		if n > 0:
			n -= 1

	return n


def _get_cursor_tuple(target_chart, display_datetime):
	"""Return the effective cursor time as a 6-tuple."""
	if display_datetime is not None:
		return display_datetime

	if target_chart is None:
		return None

	if target_chart.htype == chart.Chart.RADIX:
		now = datetime.datetime.now()
		return (now.year, now.month, now.day, now.hour, now.minute, now.second)

	t = target_chart.time
	return (
		getattr(t, 'origyear', t.year),
		getattr(t, 'origmonth', t.month),
		getattr(t, 'origday', t.day),
		t.hour,
		t.minute,
		t.second,
	)


def get_term_lord(radix, target_chart, options, display_datetime=None):
	"""Return (sign_idx, planet_id) for the circumambulation term lord at cursor time."""
	if radix is None:
		return None
	try:
		import circumambulation
		cursor = _get_cursor_tuple(target_chart, display_datetime)
		if cursor is None:
			return None
		cursor_jd = _tuple_to_jd(*cursor, radix)
		rows = circumambulation.compute_distributions(
			radix,
			options,
			key=circumambulation.years_per_degree_from_options(options),
			use_exact_oa=circumambulation.use_pd_circumoa_from_options(options),
		)
		if not rows:
			return None
		for row in rows:
			jd_s = row.get('jd_start', 0.0)
			jd_e = row.get('jd_end', 0.0)
			if jd_e > jd_s and jd_s <= cursor_jd < jd_e:
				return (row['sign_idx'], row['term_ruler_pid'])
		# cursor beyond all rows — return last
		last = rows[-1]
		return (last['sign_idx'], last['term_ruler_pid'])
	except Exception:
		return None


def get_lord_of_year(radix, target_chart, options, display_datetime=None):
	"""LOY = count solar returns elapsed before cursor, advance ASC by n*30°."""
	if radix is None:
		return None

	try:
		cursor = _get_cursor_tuple(target_chart, display_datetime)
		if cursor is None:
			return None

		cursor_jd = _tuple_to_jd(*cursor, radix)
		n = _completed_solar_years(radix, cursor_jd)

		prof_asc = util.normalize(radix.houses.ascmc[houses.Houses.ASC] + n * 30.0)
		if options.ayanamsha != 0:
			prof_asc = util.normalize(prof_asc - radix.ayanamsha)

		sign_idx = int(prof_asc / chart.Chart.SIGN_DEG)
		for pid in range(min(7, len(options.dignities))):
			if options.dignities[pid][0][sign_idx]:
				return (sign_idx, pid)
	except Exception:
		return None

	return None
