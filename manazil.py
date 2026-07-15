# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Arabic lunar mansions (manāzil al-qamar) — equal-arc 28-fold subdivision.

v1: Moon-only display in the inspector. The engine surface is small and stable so
later v2 can plug in transit ingress detection by passing per-step Moon longitudes
through the same calc.

The 28 equal mansions span 360 / 28 = 12.857142...° each, starting at 0° of
whichever zodiacal frame the caller resolves first. Traditional manāzil are
fixed-star anchored (mildly unequal); v1 uses the engine-friendly equal form.
Arabic display forms are the conventional unvocalized names used in the
classical astronomical tradition.  Latin forms use a compact scholarly
transliteration (macrons, dotted consonants, ʿayn, and hamza).  Attested
variants stay in ``aliases_*`` instead of displacing the canonical label.
``gloss_key`` points to a localized, concise image gloss based primarily on
Emilie Savage-Smith, *Islamicate Celestial Globes* (1985), pp. 121-132.  Those
glosses preserve her caution that several names are ancient or uncertain; in
particular ``saʿd`` is rendered as "omen" rather than automatically as "luck".
"""

import astrology

MANZIL_WIDTH = 360.0 / 28.0


MANAZIL = (
	{'index':  0, 'name_ar': 'الشرطان',      'name_translit': 'al-Sharaṭān',           'gloss_key': 'manzilMeaning.twoSigns',          'star': 'β γ Arietis',                    'aliases_ar': ('الشرطين', 'النطح'), 'aliases_translit': ('al-Sharaṭayn', 'al-Naṭḥ')},
	{'index':  1, 'name_ar': 'البطين',       'name_translit': 'al-Buṭayn',             'gloss_key': 'manzilMeaning.littleBelly',        'star': 'ε δ ρ Arietis'},
	{'index':  2, 'name_ar': 'الثريا',       'name_translit': 'al-Thurayyā',           'gloss_key': 'manzilMeaning.pleiades',           'star': 'Pleiades'},
	{'index':  3, 'name_ar': 'الدبران',      'name_translit': 'al-Dabarān',            'gloss_key': 'manzilMeaning.follower',           'star': 'α Tauri (Aldebaran)'},
	{'index':  4, 'name_ar': 'الهقعة',       'name_translit': 'al-Haqʿa',              'gloss_key': 'manzilMeaning.distinguishingMark', 'star': 'λ φ¹ φ² Orionis'},
	{'index':  5, 'name_ar': 'الهنعة',       'name_translit': 'al-Hanʿa',              'gloss_key': 'manzilMeaning.brand',              'star': 'γ ξ Geminorum'},
	{'index':  6, 'name_ar': 'الذراع',       'name_translit': 'al-Dhirāʿ',             'gloss_key': 'manzilMeaning.foreleg',            'star': 'α β Geminorum'},
	{'index':  7, 'name_ar': 'النثرة',       'name_translit': 'al-Nathra',             'gloss_key': 'manzilMeaning.noseCartilage',      'star': 'Praesepe + γ δ Cancri'},
	{'index':  8, 'name_ar': 'الطرف',        'name_translit': 'al-Ṭarf',               'gloss_key': 'manzilMeaning.glance',             'star': 'κ Cancri + λ Leonis'},
	{'index':  9, 'name_ar': 'الجبهة',       'name_translit': 'al-Jabha',              'gloss_key': 'manzilMeaning.forehead',           'star': 'ζ γ η α Leonis'},
	{'index': 10, 'name_ar': 'الزبرة',       'name_translit': 'al-Zubra',              'gloss_key': 'manzilMeaning.mane',               'star': 'δ θ Leonis',                    'aliases_ar': ('الخراتان',), 'aliases_translit': ('al-Kharatān',)},
	{'index': 11, 'name_ar': 'الصرفة',       'name_translit': 'al-Ṣarfa',              'gloss_key': 'manzilMeaning.weatherChange',      'star': 'β Leonis (Denebola)'},
	{'index': 12, 'name_ar': 'العواء',       'name_translit': 'al-ʿAwwāʾ',             'gloss_key': 'manzilMeaning.howling',            'star': 'β η γ δ ε Virginis'},
	{'index': 13, 'name_ar': 'السماك',       'name_translit': 'al-Simāk',              'gloss_key': 'manzilMeaning.unarmedOne',         'star': 'α Virginis (Spica)'},
	{'index': 14, 'name_ar': 'الغفر',        'name_translit': 'al-Ghafr',              'gloss_key': 'manzilMeaning.covering',           'star': 'ι κ λ Virginis'},
	{'index': 15, 'name_ar': 'الزبانا',      'name_translit': 'al-Zubānā',             'gloss_key': 'manzilMeaning.claws',              'star': 'α β Librae',                    'aliases_ar': ('الزبانان',), 'aliases_translit': ('al-Zubānān',)},
	{'index': 16, 'name_ar': 'الإكليل',      'name_translit': 'al-Iklīl',              'gloss_key': 'manzilMeaning.crown',              'star': 'β δ π Scorpii'},
	{'index': 17, 'name_ar': 'القلب',        'name_translit': 'al-Qalb',               'gloss_key': 'manzilMeaning.heart',              'star': 'α Scorpii (Antares)'},
	{'index': 18, 'name_ar': 'الشولة',       'name_translit': 'al-Shawla',             'gloss_key': 'manzilMeaning.raisedTail',         'star': 'λ υ Scorpii'},
	{'index': 19, 'name_ar': 'النعائم',      'name_translit': 'al-Naʿāʾim',            'gloss_key': 'manzilMeaning.ostriches',          'star': 'γ δ ε η σ φ τ ζ Sagittarii'},
	{'index': 20, 'name_ar': 'البلدة',       'name_translit': 'al-Balda',              'gloss_key': 'manzilMeaning.emptyPlace',         'star': 'φ Sagittarii region'},
	{'index': 21, 'name_ar': 'سعد الذابح',   'name_translit': 'Saʿd al-Dhābiḥ',        'gloss_key': 'manzilMeaning.omenSlaughterer',    'star': 'α β Capricorni'},
	{'index': 22, 'name_ar': 'سعد بلع',      'name_translit': 'Saʿd Bulaʿ',            'gloss_key': 'manzilMeaning.omenSwallower',      'star': 'ε μ Aquarii'},
	{'index': 23, 'name_ar': 'سعد السعود',   'name_translit': 'Saʿd al-Suʿūd',         'gloss_key': 'manzilMeaning.omenGoodFortune',    'star': 'β ξ Aquarii'},
	{'index': 24, 'name_ar': 'سعد الأخبية',  'name_translit': 'Saʿd al-Akhbiya',       'gloss_key': 'manzilMeaning.omenTents',          'star': 'γ π ζ η Aquarii'},
	{'index': 25, 'name_ar': 'الفرغ المقدم', 'name_translit': 'al-Fargh al-Muqaddam',  'gloss_key': 'manzilMeaning.anteriorSpout',      'star': 'α β Pegasi'},
	{'index': 26, 'name_ar': 'الفرغ المؤخر', 'name_translit': 'al-Fargh al-Muʾakhkhar','gloss_key': 'manzilMeaning.posteriorSpout',     'star': 'γ Pegasi + α Andromedae',       'aliases_ar': ('الفرغ الثاني',), 'aliases_translit': ('al-Fargh al-Thānī',)},
	{'index': 27, 'name_ar': 'بطن الحوت',    'name_translit': 'Baṭn al-Ḥūt',           'gloss_key': 'manzilMeaning.bellyFish',          'star': 'β Andromedae (Mirach)',         'aliases_ar': ('الرشاء',), 'aliases_translit': ('al-Rishāʾ',)},
)


ZODIAC_AUTO = 'auto'
ZODIAC_SIDEREAL = 'sidereal'
ZODIAC_TROPICAL = 'tropical'

ZODIAC_MODES = (ZODIAC_AUTO, ZODIAC_SIDEREAL, ZODIAC_TROPICAL)


def mansion_of(lon):
	"""Pure: longitude (already in the desired zodiacal frame) → (index 0-27, deg_in_mansion, entry)."""
	lon = lon % 360.0
	idx = int(lon // MANZIL_WIDTH)
	if idx > 27:
		idx = 27
	return idx, lon - idx * MANZIL_WIDTH, MANAZIL[idx]


def resolve_lon(lon_tropical, zodiac_mode, chart_ayanamsha, jd):
	"""Convert a tropical longitude to the configured manāzil frame.

	- 'tropical'  → return tropical longitude unchanged.
	- 'auto'      → follow chart: subtract chart's ayanamsha (0 if chart is tropical).
	- 'sidereal'  → always sidereal: use chart's ayanamsha if non-zero, else compute
	                Fagan-Bradley from the given Julian day so the user gets a sensible
	                sidereal manāzil even when the main chart is tropical.
	"""
	if zodiac_mode == ZODIAC_TROPICAL:
		return lon_tropical
	if zodiac_mode == ZODIAC_AUTO:
		return lon_tropical - (chart_ayanamsha or 0.0)
	if chart_ayanamsha:
		return lon_tropical - chart_ayanamsha
	try:
		astrology.swe_set_sid_mode(astrology.SE_SIDM_FAGAN_BRADLEY, 0, 0)
		ayan = astrology.swe_get_ayanamsa_ut(jd)
		return lon_tropical - ayan
	except Exception:
		return lon_tropical


def resolve_chart_lon(lon_in_chart, zodiac_mode, chart_ayanamsha, jd, chart_is_sidereal):
	"""Resolve a longitude already expressed in the chart's zodiacal frame.

	Chart snapshots expose tropical longitudes for tropical charts and sidereal
	longitudes for sidereal charts.  Recover tropical once here, then apply the
	independent manzil frame choice through :func:`resolve_lon`.
	"""
	lon_tropical = float(lon_in_chart)
	if chart_is_sidereal:
		lon_tropical += float(chart_ayanamsha or 0.0)
	return resolve_lon(lon_tropical, zodiac_mode, chart_ayanamsha, jd) % 360.0
