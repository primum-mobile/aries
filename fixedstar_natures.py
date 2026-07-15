# -*- coding: utf-8 -*-
# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Traditional planetary natures for fixed stars.

Keys are Swiss Ephemeris nomenclature codes. This keeps the metadata tied to
the same stable identifiers used by options.fixstars and chart.fixstars.
"""


class FixedStarNature:
	def __init__(self, nature, sources=None, variants=None, note=''):
		self.nature = nature
		self.sources = sources or ()
		self.variants = variants or ()
		self.note = note


_NATURES = {
	# Current factory/user default catalog.
	'alTau': FixedStarNature('Mars', ('Ptolemy, Tetrabiblos I.9', 'Robson')),
	'bePer': FixedStarNature(
		'Saturn/Jupiter',
		('Ptolemy, Tetrabiblos I.10', 'Robson'),
		('Mars/Saturn in some later tabulations',),
	),
	'alSco': FixedStarNature('Mars/Jupiter', ('Ptolemy, Tetrabiblos I.9', 'Robson')),
	'alLeo': FixedStarNature('Mars/Jupiter', ('Ptolemy, Tetrabiblos I.9', 'Robson')),
	'alCMa': FixedStarNature('Jupiter/Mars', ('Ptolemy, Tetrabiblos I.11', 'Robson')),
	'alVir': FixedStarNature('Venus/Mars', ('Ptolemy, Tetrabiblos I.9', 'Robson')),
	'SgrA*': FixedStarNature('', note='No classical planetary nature found.'),
	'GA': FixedStarNature('', note='No classical planetary nature found.'),
	'M44': FixedStarNature('Mars/Moon', ('Ptolemy, Tetrabiblos I.9', 'Robson')),
	'alUMi': FixedStarNature('Saturn/Venus', ('Ptolemy, Tetrabiblos I.10', 'Robson')),
	'beOri': FixedStarNature('Jupiter/Saturn', ('Ptolemy, Tetrabiblos I.11', 'Robson')),
	'beAnd': FixedStarNature('Venus', ('Ptolemy, Tetrabiblos I.10', 'Robson')),
	'ga-1And': FixedStarNature('Venus', ('Ptolemy, Tetrabiblos I.10', 'Robson')),
	'alBoo': FixedStarNature('Mars/Jupiter', ('Ptolemy, Tetrabiblos I.10', 'Robson')),
	'alCar': FixedStarNature('Saturn/Jupiter', ('Ptolemy, Tetrabiblos I.11', 'Robson')),
	'alCen': FixedStarNature('Venus/Jupiter', ('Ptolemy, Tetrabiblos I.11', 'Robson')),
	'alCMi': FixedStarNature('Mercury/Mars', ('Ptolemy, Tetrabiblos I.11', 'Robson')),
	'gaCnc': FixedStarNature('Mars/Sun', ('Ptolemy, Tetrabiblos I.9', 'Robson')),
	'deCnc': FixedStarNature('Mars/Sun', ('Ptolemy, Tetrabiblos I.9', 'Robson')),
	'alCrB': FixedStarNature('Venus/Mercury', ('Ptolemy, Tetrabiblos I.10', 'Robson')),
	'deCrv': FixedStarNature('Mars/Saturn', ('Ptolemy, Tetrabiblos I.11', 'Robson')),
	'alGem': FixedStarNature('Mercury', ('Ptolemy, Tetrabiblos I.9', 'Robson')),
	'beGem': FixedStarNature('Mars', ('Ptolemy, Tetrabiblos I.9', 'Robson')),
	'beLeo': FixedStarNature('Saturn/Venus', ('Ptolemy, Tetrabiblos I.9', 'Robson')),
	'al-2Lib': FixedStarNature('Saturn/Mars', ('Ptolemy, Tetrabiblos I.9', 'Robson')),
	'beLib': FixedStarNature('Jupiter/Mercury', ('Ptolemy, Tetrabiblos I.9', 'Robson')),
	'alLyr': FixedStarNature('Venus/Mercury', ('Ptolemy, Tetrabiblos I.10', 'Robson')),
	'alOri': FixedStarNature('Mars/Mercury', ('Ptolemy, Tetrabiblos I.11', 'Robson')),
	'alPeg': FixedStarNature('Mars/Mercury', ('Ptolemy, Tetrabiblos I.10', 'Robson')),
	'alPsA': FixedStarNature('Venus/Mercury', ('Ptolemy, Tetrabiblos I.11', 'Robson')),
	'alSer': FixedStarNature('Saturn/Mars', ('Ptolemy, Tetrabiblos I.10', 'Robson')),
	'etTau': FixedStarNature(
		'Moon/Mars',
		('Ptolemy, Tetrabiblos I.9', 'Robson'),
		('Moon/Jupiter in some secondary tables',),
	),
	'etUMa': FixedStarNature(
		'Moon/Venus',
		('Robson / Behenian tradition',),
		('Ptolemy gives Ursa Major generally as Mars.',),
	),

	# Morin reading catalog / likely user additions.
	'alHya': FixedStarNature('Saturn/Venus', ('Ptolemy, Tetrabiblos I.11', 'Robson')),
	'alAql': FixedStarNature('Mars/Jupiter', ('Ptolemy, Tetrabiblos I.10', 'Robson')),
	'alCyg': FixedStarNature('Venus/Mercury', ('Ptolemy, Tetrabiblos I.10', 'Robson')),
	'gaGem': FixedStarNature('Mercury/Venus', ('Ptolemy, Tetrabiblos I.9', 'Robson')),
	'deOri': FixedStarNature('Jupiter/Saturn', ('Ptolemy, Tetrabiblos I.11', 'Robson')),
	'epOri': FixedStarNature('Jupiter/Saturn', ('Ptolemy, Tetrabiblos I.11', 'Robson')),
	'zeOri': FixedStarNature('Jupiter/Saturn', ('Ptolemy, Tetrabiblos I.11', 'Robson')),
}


def get(code):
	return _NATURES.get(code)


def as_payload(code):
	entry = get(code)
	if entry is None:
		return None
	return {
		'nature': entry.nature,
		'sources': list(entry.sources),
		'variants': list(entry.variants),
		'note': entry.note,
	}
