# SPDX-FileCopyrightText: Morinus contributors
# SPDX-FileCopyrightText: 2026 Max Lange (Aries modifications)
# SPDX-License-Identifier: GPL-3.0-or-later
# Modified for Aries in 2026 by Max Lange.

import sys

from setuptools import Extension, setup

# Windows builds keep one process-wide Swiss Ephemeris state, as macOS builds
# do (sweodef.h turns TLS off for __APPLE__ but tests WIN32, which MSVC never
# defines). With TLS on, the ephemeris path, sidereal mode and topocentric
# position set on one thread are missing on every other daemon thread, which
# then silently falls back to Moshier without Chiron or the fixed stars.
define_macros = [('TLSOFF', None)] if sys.platform == 'win32' else []

module1 = Extension('sweastrology', define_macros = define_macros, sources = ['astrologymodule.c', 'swecl.c', 'swedate.c', 'swehel.c', 'swehouse.c', 'swejpl.c', 'swemmoon.c', 'swemplan.c', 'swepcalc.c', 'swepdate.c', 'sweph.c', 'swephlib.c'])

setup(
    name="sweastrology",
    version="1.0",
    description="Astrology module",
    ext_modules=[module1],
)
