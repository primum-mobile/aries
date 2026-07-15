# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""
Thin bridge between chart hover/click regions and the Valens CorpusDB.
Lazy-loads the corpus on first use; returns [] on any failure.
"""

import os
import sys


def _candidate_roots():
	override = os.environ.get('ARIES_DAEMON_BASE_DIR', '').strip()
	if override:
		yield os.path.abspath(os.path.expanduser(override))

	if getattr(sys, 'frozen', False):
		mei = getattr(sys, '_MEIPASS', None)
		if mei:
			yield os.path.abspath(mei)
		try:
			contents_dir = os.path.abspath(os.path.join(os.path.dirname(sys.executable), '..'))
			yield os.path.join(contents_dir, 'Resources')
		except Exception:
			pass

	yield os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
	try:
		yield os.getcwd()
	except Exception:
		pass


def _resource_root():
	candidates = []
	for root in _candidate_roots():
		if root and root not in candidates:
			candidates.append(root)

	# The Tauri app bundles corpus/parsers as app resources and passes that root
	# through ARIES_DAEMON_BASE_DIR. PyInstaller's _MEIPASS does not contain
	# these data files, so prefer a root that actually has the Valens assets.
	for root in candidates:
		corpus_path = os.path.join(root, 'corpus', 'parsed', 'valens.json')
		parser_path = os.path.join(root, 'parsers', 'query_corpus.py')
		if os.path.isfile(corpus_path) and os.path.isfile(parser_path):
			return root

	for root in candidates:
		if os.path.isdir(root):
			return root
	return candidates[0] if candidates else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def corpus_paths():
	"""Expose resolved paths for packaging tests and diagnostics."""
	return {
		'root': _RESOURCE_ROOT,
		'parsers_dir': _PARSERS_DIR,
		'corpus_path': _CORPUS_PATH,
		'corpus_exists': os.path.isfile(_CORPUS_PATH),
		'parser_exists': os.path.isfile(os.path.join(_PARSERS_DIR, 'query_corpus.py')),
	}


_RESOURCE_ROOT = _resource_root()
_PARSERS_DIR = os.path.join(_RESOURCE_ROOT, 'parsers')
_CORPUS_PATH = os.path.join(_RESOURCE_ROOT, 'corpus', 'parsed', 'valens.json')

_db = None
_db_attempted = False
_cache = {}          # region_key → (passages_list,)  — avoids re-query on hover
_signification_cache = {}       # planet tag -> preview dict or None
_sign_signification_cache = {}  # sign tag -> preview dict or None


def _get_db():
	global _db, _db_attempted
	if _db_attempted:
		return _db
	_db_attempted = True
	try:
		if _PARSERS_DIR not in sys.path:
			sys.path.insert(0, _PARSERS_DIR)
		from query_corpus import CorpusDB
		_db = CorpusDB(_CORPUS_PATH)
	except Exception:
		_db = None
	return _db


# Map planet object_id (0-based, matching chartinspector._PLANET_NAMES order) to tag
_PLANET_TAGS = [
	'sun',       # 0
	'moon',      # 1
	'mercury',   # 2
	'venus',     # 3
	'mars',      # 4
	'jupiter',   # 5
	'saturn',    # 6
	None,        # 7 Uranus
	None,        # 8 Neptune
	None,        # 9 Pluto
	'north_node',  # 10 Mean Node
	'north_node',  # 11 True Node
]

_SIGN_TAGS = [
	'aries', 'taurus', 'gemini', 'cancer', 'leo', 'virgo',
	'libra', 'scorpio', 'sagittarius', 'capricorn', 'aquarius', 'pisces',
]

_ANGLE_TAGS = {
	'asc':  'ascendant',
	'mc':   'midheaven',
	'desc': 'descendant',
	'ic':   'ic',
}

_PLANET_HEADINGS = {
	'sun': '[Sun]',
	'moon': '[Moon]',
	'mercury': '[Mercury]',
	'venus': '[Venus]',
	'mars': '[Mars]',
	'jupiter': '[Jupiter]',
	'saturn': '[Saturn]',
}

_SIGN_HEADINGS = {
	'aries':       '[Aries]',
	'taurus':      '[Taurus]',
	'gemini':      '[Gemini]',
	'cancer':      '[Cancer]',
	'leo':         '[Leo]',
	'virgo':       '[Virgo]',
	'libra':       '[Libra]',
	'scorpio':     '[Scorpio]',
	'sagittarius': '[Sagittarius]',
	'capricorn':   '[Capricorn]',
	'aquarius':    '[Aquarius]',
	'pisces':      '[Pisces]',
}


def region_key(region):
	"""Stable cache key for a region dict."""
	if not region:
		return None
	return (region.get('kind'), region.get('object_id'))


def passages_for_region(region, max_results=4):
	"""
	Return up to max_results corpus passages relevant to the given chart region.

	region is a dict as produced by graphchart/chartinspector with keys:
	  kind       – 'planet' | 'sign' | 'angle' | 'fortune' | 'house' | ...
	  object_id  – integer index (planets/signs) or string key (angles)
	  data       – dict with chart data

	Results are cached by (kind, object_id) for hover performance.
	"""
	if not region:
		return []

	rk = region_key(region)
	if rk in _cache:
		cached = _cache[rk]
		return cached[:max_results]

	db = _get_db()
	if db is None:
		return []

	kind = region.get('kind')
	obj_id = region.get('object_id')

	tag = None
	secondary_tag = None

	if kind == 'planet':
		idx = obj_id if isinstance(obj_id, int) else -1
		if 0 <= idx < len(_PLANET_TAGS):
			tag = _PLANET_TAGS[idx]
		# secondary: sign the planet is in
		data = region.get('data') or {}
		lon = data.get('display_lon') or data.get('longitude')
		if lon is not None:
			try:
				sign_idx = int(float(lon) / 30) % 12
				secondary_tag = _SIGN_TAGS[sign_idx]
			except Exception:
				pass

	elif kind == 'sign':
		idx = obj_id if isinstance(obj_id, int) else -1
		if 0 <= idx < len(_SIGN_TAGS):
			tag = _SIGN_TAGS[idx]

	elif kind == 'angle':
		key = str(obj_id) if obj_id is not None else ''
		tag = _ANGLE_TAGS.get(key)

	elif kind == 'fortune':
		tag = 'lot_of_fortune'

	elif kind == 'house':
		# No direct house-number tags in corpus; fall back to nothing
		return []

	if tag is None:
		return []

	try:
		results = db.search_by_tag(tag)
	except Exception:
		return []

	# If fewer than 2 hits on primary tag, supplement with secondary
	if len(results) < 2 and secondary_tag and secondary_tag != tag:
		try:
			extra = db.search_by_tag(secondary_tag)
			seen = {r.get('idx') for r in results}
			for e in extra:
				if e.get('idx') not in seen:
					results.append(e)
					seen.add(e.get('idx'))
		except Exception:
			pass

	_cache[rk] = results
	return results[:max_results]


def _clean_preview_text(text):
	text = ' '.join((text or '').split())
	return text.strip()


def _first_paragraph(text):
	parts = [p.strip() for p in (text or '').split('\n\n') if p.strip()]
	if not parts:
		return ''
	return _clean_preview_text(parts[0])


def planet_signification_preview(region):
	"""Return a fixed teaser from Valens' general planet significations."""
	if not region or region.get('kind') != 'planet':
		return None
	obj_id = region.get('object_id')
	if not isinstance(obj_id, int) or obj_id < 0 or obj_id >= len(_PLANET_TAGS):
		return None
	tag = _PLANET_TAGS[obj_id]
	if tag not in _PLANET_HEADINGS:
		return None
	if tag in _signification_cache:
		return _signification_cache[tag]

	db = _get_db()
	if db is None:
		return None

	try:
		results = db.search_by_tag(tag)
	except Exception:
		return None

	target_heading = _PLANET_HEADINGS[tag]
	section = None
	for item in results:
		if (item.get('heading') or '').strip() == target_heading:
			section = item
			break
	if section is None and results:
		section = results[0]
	if section is None:
		_signification_cache[tag] = None
		return None

	text = _clean_preview_text(section.get('text', ''))
	if not text:
		_signification_cache[tag] = None
		return None

	lines = [ln.strip() for ln in section.get('text', '').splitlines() if ln.strip()]
	if lines:
		first = lines[0]
		if first.startswith(_PLANET_HEADINGS[tag].strip('[]')) or first in (
			'Sun ☉', 'Moon ☽', 'Mercury ☿', 'Venus ♀', 'Mars ♂', 'Jupiter ♃', 'Saturn ♄',
		):
			text = _clean_preview_text(' '.join(lines[1:]))

	para_text = _first_paragraph(text) or text
	section_for_preview = dict(section)
	section_for_preview['text'] = para_text

	preview = {
		'source': 'Valens, Anthologies 0.7',
		'text': para_text,
		'full_text': para_text,
		'section': section_for_preview,
		'full_section': section,
	}
	_signification_cache[tag] = preview
	return preview


def sign_signification_preview(region):
	"""Return a fixed teaser from Valens' general sign significations."""
	if not region or region.get('kind') != 'sign':
		return None
	obj_id = region.get('object_id')
	if not isinstance(obj_id, int) or obj_id < 0 or obj_id >= len(_SIGN_TAGS):
		return None
	tag = _SIGN_TAGS[obj_id]
	if tag not in _SIGN_HEADINGS:
		return None
	if tag in _sign_signification_cache:
		return _sign_signification_cache[tag]

	db = _get_db()
	if db is None:
		return None

	try:
		results = db.search_by_tag(tag)
	except Exception:
		return None

	target_heading = _SIGN_HEADINGS[tag]
	section = None
	for item in results:
		if (item.get('heading') or '').strip() == target_heading:
			section = item
			break
	if section is None and results:
		section = results[0]
	if section is None:
		_sign_signification_cache[tag] = None
		return None

	text = _clean_preview_text(section.get('text', ''))
	if not text:
		_sign_signification_cache[tag] = None
		return None

	lines = [ln.strip() for ln in section.get('text', '').splitlines() if ln.strip()]
	if lines:
		first = lines[0]
		sign_name = tag.capitalize()
		if first.startswith(sign_name) or first == target_heading.strip('[]'):
			text = _clean_preview_text(' '.join(lines[1:]))

	para_text = _first_paragraph(text) or text
	section_for_preview = dict(section)
	section_for_preview['text'] = para_text

	preview = {
		'source': 'Valens, Anthologies 0.7',
		'text': para_text,
		'full_text': para_text,
		'section': section_for_preview,
		'full_section': section,
	}
	_sign_signification_cache[tag] = preview
	return preview
