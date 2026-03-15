import datetime

import chart
import houses
import profections
import util


def get_target_datetime(target_chart, display_datetime=None):
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


def get_lord_of_year(radix, target_chart, options, display_datetime=None):
	if radix is None:
		return None

	try:
		target = get_target_datetime(target_chart, display_datetime)
		if target is None:
			return None

		target_year, target_month, target_day, target_hour, target_minute, target_second = target
		t = target_hour + target_minute/60.0 + target_second/3600.0
		prof = profections.Profections(radix, target_year, target_month, target_day, t)

		prof_asc = util.normalize(radix.houses.ascmc[houses.Houses.ASC] + prof.offs)
		if options.ayanamsha != 0:
			prof_asc = util.normalize(prof_asc - radix.ayanamsha)

		sign_idx = int(prof_asc/chart.Chart.SIGN_DEG)
		for pid in range(min(7, len(options.dignities))):
			if options.dignities[pid][0][sign_idx]:
				return (sign_idx, pid)
	except Exception:
		return None

	return None
