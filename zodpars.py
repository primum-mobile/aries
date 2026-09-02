# -*- coding: utf-8 -*-
# SPDX-FileCopyrightText: Morinus contributors
# SPDX-FileCopyrightText: 2026 Max Lange (Aries modifications)
# SPDX-License-Identifier: GPL-3.0-or-later
# Modified for Aries in 2026 by Max Lange.

import astrology
import planets
import zodparsbase


class ZodPars(zodparsbase.ZodParsBase):
	"""Computes zodiacal parallels"""

	def __init__(self, pls, obl):
		zodparsbase.ZodParsBase.__init__(self, obl)

		self.pls = pls
		self.pars = []

		self.calc()
	

	def calc(self):
		NODES = 2

		for p in range(planets.Planets.PLANETS_NUM-NODES):#Nodes are excluded
			pl = self.pls.planets[p]
			onEcl = False
			if (p == astrology.SE_SUN) or (abs(pl.speculums[0][planets.Planet.LAT]) < 1e-8):
				onEcl = True
			self.pars.append(self.getEclPoints(pl.speculums[0][planets.Planet.LONG], pl.speculums[0][planets.Planet.DECL], onEcl))