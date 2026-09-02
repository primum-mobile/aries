# SPDX-FileCopyrightText: Morinus contributors
# SPDX-FileCopyrightText: 2026 Max Lange (Aries modifications)
# SPDX-License-Identifier: GPL-3.0-or-later
# Modified for Aries in 2026 by Max Lange.

from setuptools import Extension, setup

module1 = Extension('sweastrology', sources = ['astrologymodule.c', 'swecl.c', 'swedate.c', 'swehel.c', 'swehouse.c', 'swejpl.c', 'swemmoon.c', 'swemplan.c', 'swepcalc.c', 'swepdate.c', 'sweph.c', 'swephlib.c'])

setup(
    name="sweastrology",
    version="1.0",
    description="Astrology module",
    ext_modules=[module1],
)
