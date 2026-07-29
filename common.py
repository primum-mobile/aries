# -*- coding: utf-8 -*-

import os
import sys
import wx
import astrology
import arabicparts
from antiscia import Antiscia
import fixstars
import fortune
import houses
import mtexts
import options
import planets
import wxcompat
import util
import fontprofiles


SIGN_ELEMENT_KEYS = (
	'fire', 'earth', 'air', 'water',
	'fire', 'earth', 'air', 'water',
	'fire', 'earth', 'air', 'water',
)

STEP_ALERT_BODY_IDS = (
	astrology.SE_SUN,
	astrology.SE_MOON,
	astrology.SE_MERCURY,
	astrology.SE_VENUS,
	astrology.SE_MARS,
	astrology.SE_JUPITER,
	astrology.SE_SATURN,
	astrology.SE_URANUS,
	astrology.SE_NEPTUNE,
	astrology.SE_PLUTO,
	astrology.SE_MEAN_NODE,
	astrology.SE_TRUE_NODE,
	astrology.SE_CHIRON,
)

CHART_OBJECT_VERTEX = astrology.SE_CHIRON + 1
CHART_ANGLE_GLYPHS = {
	'asc': '0',
	'dsc': '3',
	'mc': '1',
	'ic': '2',
}

# Unicode's astrological aspect set covers the classical 0/30/45/60/90/120/
# 135/150/180-degree marks. The remaining enabled Aries aspects use established
# compact table notation so plain-text exports never depend on Morinus.ttf.
ASPECT_TEXT_EXPORT_MARKS = (
	'☌', '⚺', '∠', '⚹', 'Q', '□', '△', '⚼', 'BQ', '⚻', '☍',
	'Sept', 'Par', 'CPar',
)
RAPT_PARALLEL_TEXT_EXPORT_MARK = 'RPar'


def aspect_text_export_mark(aspect_idx):
	try:
		index = int(aspect_idx)
	except (TypeError, ValueError):
		return ''
	if 0 <= index < len(ASPECT_TEXT_EXPORT_MARKS):
		return ASPECT_TEXT_EXPORT_MARKS[index]
	if index in (14, 15):
		return RAPT_PARALLEL_TEXT_EXPORT_MARK
	return ''


_SWE_READY = False
_SWE_READY_PATH = None


def _common_base_dir():
	"""Resolve the resource root without importing the legacy wx application.

	The packaged Tauri launcher supplies ``ARIES_DAEMON_BASE_DIR``.  The
	remaining branches deliberately mirror ``morinus._morinus_base_dir`` so the
	legacy frozen wx application continues to find its own bundle resources.
	"""
	override = os.environ.get('ARIES_DAEMON_BASE_DIR', '').strip()
	if override:
		return override

	if getattr(sys, 'frozen', False):
		try:
			contents_dir = os.path.abspath(os.path.join(os.path.dirname(sys.executable), '..'))
			resources_dir = os.path.join(contents_dir, 'Resources')
			if os.path.exists(os.path.join(resources_dir, 'Res', 'Morinus.jpg')):
				return resources_dir
		except Exception:
			pass

		mei = getattr(sys, '_MEIPASS', None)
		if mei:
			return mei

	return os.path.dirname(os.path.abspath(__file__))


def get_ephe_path():
	try:
		return common.ephepath
	except Exception:
		return os.path.join(os.path.dirname(os.path.abspath(__file__)), 'SWEP', 'Ephem')


def ensure_swe_ready():
	global _SWE_READY, _SWE_READY_PATH
	ephe_path = get_ephe_path()
	os.environ['SE_EPHE_PATH'] = ''
	astrology.swe_set_ephe_path(ephe_path)
	_SWE_READY = True
	_SWE_READY_PATH = ephe_path


def is_planet_visible(options, planet_idx):
	if planet_idx == CHART_OBJECT_VERTEX and not getattr(options, 'showvertex', False):
		return False
	if planet_idx == astrology.SE_URANUS and not options.transcendental[0]:
		return False
	if planet_idx == astrology.SE_NEPTUNE and not options.transcendental[1]:
		return False
	if planet_idx == astrology.SE_PLUTO and not options.transcendental[2]:
		return False
	if planet_idx == astrology.SE_CHIRON and not getattr(options, 'showchiron', True):
		return False
	if planet_idx in (astrology.SE_MEAN_NODE, astrology.SE_TRUE_NODE) and not options.shownodes:
		return False
	return True


def get_chart_planet(chrt, planet_idx):
	if chrt is None:
		return None
	if planet_idx == astrology.SE_CHIRON:
		return getattr(chrt, 'chiron', None)
	if planet_idx == astrology.SE_TRUE_NODE and hasattr(chrt, '_get_desc_node_body'):
		return chrt._get_desc_node_body()
	try:
		return chrt.planets.planets[planet_idx]
	except Exception:
		return None


def get_visible_chart_planet_ids(chrt, options, include_descnode=False, include_chiron=False):
	ids = []
	last_main = astrology.SE_TRUE_NODE if include_descnode else astrology.SE_MEAN_NODE
	for planet_idx in range(astrology.SE_SUN, last_main+1):
		if is_planet_visible(options, planet_idx):
			ids.append(planet_idx)
	if include_chiron and getattr(chrt, 'chiron', None) is not None and is_planet_visible(options, astrology.SE_CHIRON):
		ids.append(astrology.SE_CHIRON)
	return ids


def get_visible_fixstar_trigger_body_ids(chrt, options):
	return get_visible_chart_planet_ids(
		chrt,
		options,
		include_descnode=bool(getattr(options, 'showfixstarsnodes', False)),
		include_chiron=True,
	)


def get_step_alert_body_ids():
	return STEP_ALERT_BODY_IDS


def angular_distance(lon1, lon2):
	dist = abs(float(lon1) - float(lon2))
	if dist > 180.0:
		dist = 360.0 - dist
	return dist


def is_ring_direct_hit(lon1, lon2, orb):
	return angular_distance(lon1, lon2) <= float(orb)


def get_overlay_trigger_longitudes(chrt, options):
	if chrt is None:
		return []

	targets = []
	for body_id in get_visible_fixstar_trigger_body_ids(chrt, options):
		body = get_chart_planet(chrt, body_id)
		if body is None:
			continue
		try:
			targets.append((body_id, float(body.data[planets.Planet.LONG])))
		except Exception:
			continue

	try:
		asc = float(chrt.houses.ascmc[houses.Houses.ASC])
		mc = float(chrt.houses.ascmc[houses.Houses.MC])
		targets.extend((
			(None, asc),
			(None, util.normalize(asc + 180.0)),
			(None, mc),
			(None, util.normalize(mc + 180.0)),
		))
	except Exception:
		pass

	if getattr(options, 'showfixstarshcs', False):
		try:
			for cusp_idx in range(houses.Houses.HOUSE_NUM):
				targets.append((None, float(chrt.houses.cusps[cusp_idx+1])))
		except Exception:
			pass

	if getattr(options, 'showfixstarslof', False):
		try:
			targets.append((None, float(chrt.fortune.fortune[fortune.Fortune.LON])))
		except Exception:
			pass

	return targets


def chart_has_ring_direct_hit(chrt, options, lon, orb, skip_body_id=None):
	for body_id, target_lon in get_overlay_trigger_longitudes(chrt, options):
		if skip_body_id is not None and body_id == skip_body_id:
			continue
		if is_ring_direct_hit(lon, target_lon, orb):
			return True
	return False


def build_ring_text_rows(items):
	rows = []
	for item in items:
		name = item.get('name', '')
		rows.append([name, name, item.get('lon', 0.0), 0.0, 0.0, 0.0])
	return rows


def get_sign_element_key(sign_index):
	try:
		return SIGN_ELEMENT_KEYS[int(sign_index) % 12]
	except Exception:
		return 'fire'


def get_sign_color(options, sign_index, bw=False, force_element=False):
	if bw or getattr(options, 'bw', False):
		return (0, 0, 0)
	if not force_element and not getattr(options, 'usezodiacelementcolors', False):
		return options.clrsigns

	element = get_sign_element_key(sign_index)
	if element == 'earth':
		return getattr(options, 'clrsignelementearth', options.clrsigns)
	if element == 'air':
		return getattr(options, 'clrsignelementair', options.clrsigns)
	if element == 'water':
		return getattr(options, 'clrsignelementwater', options.clrsigns)
	return getattr(options, 'clrsignelementfire', options.clrsigns)


def collect_asteroid_ring_items(chrt, options):
	orb = float(getattr(options, 'ringorb_asteroids', 1.5))
	items = []
	asteroid_list = getattr(getattr(chrt, 'asteroids', None), 'asteroids', None) or []
	for body in asteroid_list:
		if not getattr(body, 'data', None) or len(body.data) < 4:
			continue
		lon = float(body.data[0])
		if not chart_has_ring_direct_hit(chrt, options, lon, orb, skip_body_id=getattr(body, 'aId', None)):
			continue
		items.append({
			'family': 'asteroid',
			'name': getattr(body, 'name', mtexts.txts.get('Asteroid', 'Asteroid')),
			'lon': lon,
			'bodyId': int(getattr(body, 'aId')),
			'speed': float(getattr(body, 'speed', 0.0)),
		})
	items.sort(key=lambda item: item['lon'])
	return items


def collect_midpoint_ring_items(chrt, options):
	orb = float(getattr(options, 'ringorb_midpoints', 1.5))
	items = []
	for midpoint in getattr(getattr(chrt, 'midpoints', None), 'mids', ()) or ():
		lon = float(midpoint.m)
		if not chart_has_ring_direct_hit(chrt, options, lon, orb):
			continue
		items.append({
			'family': 'midpoint',
			'p1': midpoint.p1,
			'p2': midpoint.p2,
			'lon': lon,
		})
	items.sort(key=lambda item: item['lon'])
	return items


def collect_hybrid_ring_items(chrt, options):
	orb = float(getattr(options, 'ringorb_hybrid', 1.5))
	items = []

	try:
		antis = Antiscia(
			chrt.planets.planets,
			chrt.houses.ascmc,
			chrt.fortune.fortune,
			getattr(chrt, 'obl', (0.0,))[0],
			getattr(options, 'ayanamsha', 0),
			getattr(chrt, 'ayanamsha_offset', 0.0),
			morin_antiscia=getattr(options, 'morin_antiscia', False),
		)
		for dodec in getattr(antis, 'pldodecatemoria', ()) or ():
			body_id = getattr(dodec, 'Id', None)
			if body_id is None or not is_planet_visible(options, body_id):
				continue
			lon = float(dodec.lon)
			if chart_has_ring_direct_hit(chrt, options, lon, orb):
				items.append({
					'family': 'dodecatemoria',
					'name': '%s dodec' % get_planet_name(body_id),
					'lon': lon,
					'bodyId': int(body_id),
				})
	except Exception:
		pass

	active_part_indices = []
	for config_index, configured_part in enumerate(getattr(options, 'arabicparts', ()) or ()):
		try:
			if not arabicparts.ArabicParts.is_active_item(configured_part):
				continue
		except Exception:
			pass
		active_part_indices.append(config_index)
	for active_index, part in enumerate(getattr(getattr(chrt, 'parts', None), 'parts', ()) or ()):
		try:
			lon = float(part[arabicparts.ArabicParts.LONG])
			name = part[arabicparts.ArabicParts.NAME]
		except Exception:
			continue
		if chart_has_ring_direct_hit(chrt, options, lon, orb):
			config_index = active_part_indices[active_index] if active_index < len(active_part_indices) else active_index
			items.append({
				'family': 'arabic_part',
				'name': name,
				'lon': lon,
				'configIndex': int(config_index),
			})

	fixstar_obj = getattr(chrt, 'fixstars', None)
	fixstar_codes = list(getattr(options, 'fixstars', {}).keys())
	for star_index, star in enumerate(getattr(fixstar_obj, 'data', ()) or ()):
		try:
			lon = float(star[fixstars.FixStars.LON])
			name = astrology.display_fixstar_name(star[fixstars.FixStars.NOMNAME], options, star[fixstars.FixStars.NAME])
		except Exception:
			continue
		if chart_has_ring_direct_hit(chrt, options, lon, orb):
			code = str(star[fixstars.FixStars.NOMNAME] or '')
			try:
				original_index = int(fixstar_obj.mixed[star_index])
				code = code or str(fixstar_codes[original_index])
			except Exception:
				pass
			items.append({'family': 'fixstar', 'name': name, 'lon': lon, 'starCode': code})

	asteroid_list = getattr(getattr(chrt, 'asteroids', None), 'asteroids', None) or []
	for body in asteroid_list:
		if not getattr(body, 'data', None) or len(body.data) < 4:
			continue
		lon = float(body.data[0])
		if chart_has_ring_direct_hit(chrt, options, lon, orb, skip_body_id=getattr(body, 'aId', None)):
			items.append({
				'family': 'asteroid',
				'name': getattr(body, 'name', mtexts.txts.get('Asteroid', 'Asteroid')),
				'lon': lon,
				'bodyId': int(getattr(body, 'aId')),
				'speed': float(getattr(body, 'speed', 0.0)),
			})

	items.sort(key=lambda item: item['lon'])
	return items


class Common:

	def __init__(self):
		_BASE_DIR = _common_base_dir()
		self.base_dir = _BASE_DIR

		self.ephepath = os.path.join(_BASE_DIR, 'SWEP', 'Ephem')
		self.symbols = os.path.join(_BASE_DIR, 'Res', 'Morinus.ttf')
		self.abc = os.path.join(_BASE_DIR, 'Res', 'FreeSans.ttf')
		self.abc_bold = os.path.join(_BASE_DIR, 'Res', 'FreeSansBold.ttf')
		self.abc_italic = self.abc
		self.abc_bold_italic = self.abc_bold
		self.abc_face = 'FreeSans'
		self.abc_bold_face = 'FreeSans'
		# Numeric/ASCII role; fontprofiles may replace this with a mono face.
		self.abc_ascii = os.path.join(_BASE_DIR, 'Res', 'FreeSans.ttf')
		self.abc_ascii_bold = os.path.join(_BASE_DIR, 'Res', 'FreeSansBold.ttf')
		self.abc_ascii_face = 'FreeSans'
		self.freesans_bold = os.path.join(_BASE_DIR, 'Res', 'FreeSansBold.ttf')
		self.serif = self.abc
		self.serif_bold = self.abc_bold
		self.serif_italic = self.abc
		self.serif_bold_italic = self.abc_bold
		self.serif_face = self.abc_face
		self.serif_bold_face = self.abc_bold_face

		# 프라이빗 폰트 등록: 이 프로세스에서만 파일의 폰트를 쓸 수 있게 함
		try:
			import ctypes
			from ctypes import wintypes
			FR_PRIVATE = 0x10
			AddFontResourceExW = ctypes.windll.gdi32.AddFontResourceExW
			AddFontResourceExW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.LPVOID]
			AddFontResourceExW.restype  = wintypes.INT

			# 절대경로로 등록 (상대경로면 현재 작업폴더에 따라 실패 가능)
			def _abs(p):
				base = os.path.dirname(os.path.abspath(sys.argv[0]))
				return os.path.abspath(os.path.join(base, p))

			AddFontResourceExW(_abs(self.symbols).decode('mbcs'), FR_PRIVATE, None)
			AddFontResourceExW(_abs(self.abc).decode('mbcs'),     FR_PRIVATE, None)
			AddFontResourceExW(_abs(self.abc_ascii).decode('mbcs'),     FR_PRIVATE, None)
			AddFontResourceExW(_abs(self.freesans_bold).decode('mbcs'), FR_PRIVATE, None)
		except Exception as _e:
			# 실패해도 앱은 계속 동작하도록 무시 (원인 추적 필요하면 print)
			pass

		#self.abc = os.path.join(u'Res', u'simhei.ttf')

		self._configure_fonts(options.Options())

		# Order matches Chart aspect-type constants. Every entry is a code
		# point into Morinus.ttf where the corresponding aspect glyph lives.
		# Septile (index 11) uses '[' (U+005B), a slot reserved in Morinus.ttf
		# for the custom septile glyph designed for Aries — see
		# `Res/Morinus.ttf` and the build provenance .bak siblings.
		# AspectFontRole is kept as an extension point: if a future aspect ever
		# needs to render in the sans-serif text face (e.g. because Morinus.ttf
		# doesn't have a slot for it), flip its entry to 'text' and consult
		# aspect_glyph() at the draw site.
		self.Aspects = ('M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', '[', 'X', 'Y')
		self.AspectFontRole = ('morinus',) * len(self.Aspects)
		self.Signs1 = ('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l')
		self.Signs2 = ('m', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x')
		self.Uranus = ('H', '6')
		self.Pluto = ('J', '7', '8', '9')
		self.Housenames = ('I', '2', '3', 'IV', '5', '6', 'VII', '8', '9', 'X', '11', '12')
		self.Housenames2 = ('1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12')
		self.Chiron = '}'
		self.Vertex = '!'
		self.Angles = CHART_ANGLE_GLYPHS
		self.reload_language_tables()
		self.fortune = '4'
		self.retr = 'Z'


	def reload_language_tables(self):
		"""Re-read the language-dependent text tables (month/day names) from the
		active mtexts language. Called at construction AND on a live language
		change (mtexts.setLang rebinds mtexts.txts, but these tuples were captured
		by value) so dates follow the language instead of freezing at boot."""
		self.months = (mtexts.txts['January'], mtexts.txts['February'], mtexts.txts['March'], mtexts.txts['April'], mtexts.txts['May'], mtexts.txts['June'], mtexts.txts['July'], mtexts.txts['August'], mtexts.txts['September'], mtexts.txts['October'], mtexts.txts['November'], mtexts.txts['December'])
		self.monthabbr = (mtexts.txts['Jan2'], mtexts.txts['Feb2'], mtexts.txts['Mar2'], mtexts.txts['Apr2'], mtexts.txts['May2'], mtexts.txts['Jun2'], mtexts.txts['Jul2'], mtexts.txts['Aug2'], mtexts.txts['Sep2'], mtexts.txts['Oct2'], mtexts.txts['Nov2'], mtexts.txts['Dec2'])
		self.days = (mtexts.txts['Monday'], mtexts.txts['Tuesday'], mtexts.txts['Wednesday'], mtexts.txts['Thursday'], mtexts.txts['Friday'], mtexts.txts['Saturday'], mtexts.txts['Sunday'])


	def update(self, options):
		self._configure_fonts(options)

		uranus = self.Uranus[0]
		if not options.uranus:
			uranus = self.Uranus[1]
		pluto = self.Pluto[options.pluto]

		self.Planets = ('A', 'B', 'C', 'D', 'E', 'F', 'G', uranus, 'I', pluto, 'K', 'L')

	def _configure_fonts(self, opts):
		fontprofiles.apply_to_common(self, opts, self.base_dir)
		symbols_path = os.path.abspath(self.symbols)
		wxcompat.register_private_font(self.symbols, wxcompat.MORINUS_BUNDLED_FACE)
		for font_path in fontprofiles.common_font_paths(self):
			if os.path.abspath(font_path) != symbols_path:
				wxcompat.register_private_font(font_path)

	def get_planet_glyph(self, planet_idx):
		if planet_idx == CHART_OBJECT_VERTEX:
			return self.Vertex
		if planet_idx == astrology.SE_CHIRON:
			return self.Chiron
		if 0 <= planet_idx < len(self.Planets):
			return self.Planets[planet_idx]
		return ''

	def aspect_glyph(self, aspect_idx):
		# (glyph, font_role) for an aspect index. font_role is 'morinus' for
		# Morinus.ttf's designed astrological glyphs, 'text' for the regular
		# sans-serif face (only septile today — see Aspects[] commentary).
		try:
			i = int(aspect_idx)
		except (TypeError, ValueError):
			return ('', 'morinus')
		if 0 <= i < len(self.Aspects):
			return (self.Aspects[i], self.AspectFontRole[i])
		return ('', 'morinus')

	def get_planet_name(self, planet_idx):
		if planet_idx == CHART_OBJECT_VERTEX:
			return mtexts.txts.get('Vertex', 'Vertex')
		if planet_idx == astrology.SE_CHIRON:
			return mtexts.txts.get('Chiron', 'Chiron')
		if planet_idx == astrology.SE_MEAN_NODE:
			return mtexts.txts.get('NorthNode', 'North Node')
		if planet_idx == astrology.SE_TRUE_NODE:
			return mtexts.txts.get('SouthNode', 'South Node')
		try:
			return astrology.swe_get_planet_name(planet_idx)
		except Exception:
			return mtexts.txts.get('TopicalPlanet', 'Planet')

	def get_planet_color_index(self, planet_idx):
		if planet_idx == astrology.SE_CHIRON:
			return astrology.SE_PLUTO+3
		if planet_idx == astrology.SE_TRUE_NODE:
			return astrology.SE_MEAN_NODE
		if planet_idx < 0:
			return 0
		if planet_idx >= len(self.Planets):
			return len(self.Planets)-1
		return planet_idx

	def is_planet_visible(self, options, planet_idx):
		return is_planet_visible(options, planet_idx)

	def get_chart_planet(self, chrt, planet_idx):
		return get_chart_planet(chrt, planet_idx)

	def get_visible_chart_planet_ids(self, chrt, options, include_descnode=False, include_chiron=False):
		return get_visible_chart_planet_ids(chrt, options, include_descnode=include_descnode, include_chiron=include_chiron)

	def get_visible_fixstar_trigger_body_ids(self, chrt, options):
		return get_visible_fixstar_trigger_body_ids(chrt, options)
