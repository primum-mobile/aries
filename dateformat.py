# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

DATE_CONVENTION_CURRENT = 'current'
DATE_CONVENTION_DMY = 'dmy'
DATE_CONVENTIONS = (DATE_CONVENTION_CURRENT, DATE_CONVENTION_DMY)


def coerce_date_convention(value):
	try:
		normalized = str(value).strip().lower()
	except Exception:
		return DATE_CONVENTION_CURRENT
	if normalized in ('current', 'default', 'ymd', 'yyyy-mm-dd', 'yyyy/mm/dd', 'yyyy.mm.dd'):
		return DATE_CONVENTION_CURRENT
	if normalized in ('euro', 'eu', 'european', 'dmy', 'dd.mm.yyyy', 'dd/mm/yyyy'):
		return DATE_CONVENTION_DMY
	return DATE_CONVENTION_CURRENT


def date_convention_from_options(options=None):
	return coerce_date_convention(getattr(options, 'dateconvention', DATE_CONVENTION_CURRENT))


def date_text(year, month, day, options=None, *, bc=False):
	try:
		y = int(year)
		m = int(month)
		d = int(day)
	except Exception:
		return ''
	sign = '-' if bc else ''
	if date_convention_from_options(options) == DATE_CONVENTION_DMY:
		return '%s%02d.%02d.%04d' % (sign, d, m, y)
	return '%s%04d-%02d-%02d' % (sign, y, m, d)


def date_text_named_month(year, month_name, day, options=None, *, bc=False, pad_year=True, pad_day=True):
	try:
		y = int(year)
		d = int(day)
	except Exception:
		return ''
	sign = '-' if bc else ''
	year_txt = str(y).zfill(4) if pad_year else str(y)
	day_txt = str(d).zfill(2) if pad_day else str(d)
	month_txt = str(month_name).strip()
	if date_convention_from_options(options) == DATE_CONVENTION_DMY:
		return '%s%s.%s.%s' % (sign, day_txt, month_txt, year_txt)
	return '%s%s.%s.%s' % (sign, year_txt, month_txt, day_txt)


def month_year_text(year, month_name, options=None, *, bc=False, pad_year=True):
	try:
		y = int(year)
	except Exception:
		return ''
	sign = '-' if bc else ''
	year_txt = str(y).zfill(4) if pad_year else str(y)
	month_txt = str(month_name).strip()
	if date_convention_from_options(options) == DATE_CONVENTION_DMY:
		return '%s%s.%s' % (sign, month_txt, year_txt)
	return '%s%s.%s' % (sign, year_txt, month_txt)


def date_time_text(dt_tuple, options=None, *, show_seconds=True, weekday=None):
	y, m, d, h, mi, s = [int(v) for v in tuple(dt_tuple)[:6]]
	date_txt = date_text(y, m, d, options)
	if show_seconds:
		time_txt = '%02d:%02d:%02d' % (h, mi, s)
	else:
		time_txt = '%02d:%02d' % (h, mi)
	prefix = (str(weekday).strip() + ' ') if weekday else ''
	return '%s%s %s' % (prefix, date_txt, time_txt)


def iso_date_text(year, month, day):
	return '%04d-%02d-%02d' % (int(year), int(month), int(day))


def iso_datetime_text(dt_tuple):
	return '%04d-%02d-%02dT%02d:%02d:%02d' % tuple(int(v) for v in tuple(dt_tuple)[:6])
