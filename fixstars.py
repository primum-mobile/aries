# SPDX-FileCopyrightText: Morinus contributors
# SPDX-FileCopyrightText: 2026 Max Lange (Aries modifications)
# SPDX-License-Identifier: GPL-3.0-or-later
# Modified for Aries in 2026 by Max Lange.

import astrology
import util

class FixStars:
	"""Calculates the positions of the fixstars"""

	NAME = 0
	NOMNAME = 1
	LON = 2
	LAT = 3
	RA = 4
	DECL = 5

	def __init__(self, tjd_ut, flag, names, obl, ayanamsha_offset=0.0):
		
		self.data = []
		# Settings position of each row; primary directions index
		# pdfixstarssel through ``mixed``, so a skipped row must not shift it.
		source_index = []

		for i, k in enumerate(names.keys()):
			ret, name, dat, serr = astrology.swe_fixstar_ut(','+k, tjd_ut, flag)
			# A failed lookup returns zeros; never draw it as a star at 0° Aries.
			if ret < 0 or len(dat) < 2:
				continue

			nam = name[0].strip()
			nomnam = ''
			DELIMITER = ','
			if nam.find(DELIMITER) != -1:
				snam = nam.split(DELIMITER)
				nam = snam[0].strip()
				nomnam = snam[1].strip()

			# ★ pyd가 laSco를 'Mula'로 돌려줘도 표시명은 'Shaula'로 강제 통일
			if nomnam == u'laSco' or nam == u'Mula':
				nam = u'Shaula'

			row = ['', '', 0.0, 0.0, 0.0, 0.0]
			row[FixStars.NAME] = nam
			row[FixStars.NOMNAME] = nomnam

			row[FixStars.LON] = dat[0]
			row[FixStars.LAT] = dat[1]
			tropical_lon = util.to_tropical_lon(dat[0], ayanamsha_offset)
			ra, decl, dist = astrology.swe_cotrans(tropical_lon, dat[1], 1.0, -obl)
			row[FixStars.RA] = ra
			row[FixStars.DECL] = decl
			self.data.append(row)
			source_index.append(i)

		self.sort(source_index)


	def sort(self, source_index=None):
		num = len(self.data)
		self.mixed = list(source_index) if source_index is not None else list(range(num))

		for i in range(num):
			for j in range(num-1):
				if (self.data[j][FixStars.LON] > self.data[j+1][FixStars.LON]):
					tmp = self.data[j][:]
					self.data[j] = self.data[j+1][:]
					self.data[j+1] = tmp[:]
					tmp = self.mixed[j]
					self.mixed[j] = self.mixed[j+1]
					self.mixed[j+1] = tmp





