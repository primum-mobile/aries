# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Fixed-star orb rules; ``options.fixstars`` remains the engine contract.

Traditional classes are transcribed from Avelar & Ribeiro, List of Fixed Stars
and their natures, v1.1 (2008), pp. 1–4:
https://academyofastrology.eu/wp-content/uploads/2019/10/Fixedstarstable.pdf
They are visibility classes, never rounded Swiss photometric magnitudes.
Alkaid's second class supplements that list from the historical 1911 Britannica:
https://en.wikisource.org/wiki/1911_Encyclop%C3%A6dia_Britannica/Ursa_Major
Stars outside the published four-class scale retain their individual values.
"""
from __future__ import annotations

import math

MODES = ('uniform', 'traditional', 'individual')
DEFAULT_ORB = 1.5
MAX_ORB = 10.0
TRADITIONAL_ORBS = {1: 7.5, 2: 5.5, 3: 3.5, 4: 1.5}
_CLASS_CODES = {
    1: (
        'alTau', 'beOri', 'alAur', 'alOri', 'alCMa', 'alCar', 'beGem', 'alCMi',
        'alLeo', 'alVir', 'alBoo', 'beCen', 'alCen', 'alSco', 'alLyr', 'alAql',
        'alPsA', 'alCyg', 'alEri',
    ),
    2: (
        'beCet', 'alAnd', 'beAnd', 'alAri', 'alCas', 'ga-1And', 'bePer', 'gaOri',
        'deOri', 'beTau', 'epOri', 'beAur', 'gaGem', 'alGem', 'alHya', 'deLeo',
        'beLeo', 'alCrB', 'deSco', 'etOph', 'alOph', 'alPeg', 'bePeg', 'siSgr', 'etUMa',
    ),
    3: (
        'gaPeg', 'omiCet', 'beAri', 'alCet', 'gaEri', 'etTau', 'epTau', 'zeTau',
        'etGem', 'muGem', 'deGem', 'epLeo', 'zeLeo', 'etLeo', 'kaVel', 'epVir',
        'deCrv', 'gaBoo', 'etCar', 'deBoo', 'al-2Lib', 'beLib', 'alSer', 'deOph',
        'be-1Sco', 'zeOph', 'alHer', 'upSco', 'M7', 'nuOph', 'zeSgr', 'deAql',
        'be-1Cyg', 'beCap', 'be-1Cap', 'beAqr', 'deCap', 'alAqr', 'deAqr',
    ),
    4: (
        'zeCet', 'etPsc', 'NGC869', 'M42', 'deCnc', 'alCnc', 'deCrt', 'beVir',
        'etVir', 'laVir', 'muSgr', 'omiSgr', 'al-2Cap', 'gaCap', 'thCap', 'ze-2Sco', 'gaTau',
    ),
    5: (
        'M31', 'gaCnc', 'M6', 'omeSgr', 'al-1Cap', 'piCap', 'rhCap', 'etCap',
        'epCap',
    ),
    6: (
        'NGC6530', 'M22',
    ),
}
TRADITIONAL_MAGNITUDES = {
    code: magnitude for magnitude, codes in _CLASS_CODES.items() for code in codes
}


def valid_orb(value):
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None
    return value if math.isfinite(value) and 0 <= value <= MAX_ORB else None


def mode(opts):
    value = getattr(opts, 'fixstar_orb_mode', 'individual')
    return value if value in MODES else 'individual'


def individual_orbs(opts):
    raw = getattr(opts, 'fixstar_orb_individual', {})
    return {
        code: value for code, raw_value in (raw.items() if isinstance(raw, dict) else ())
        if isinstance(code, str) and (value := valid_orb(raw_value)) is not None
    }


def uniform_orb(opts):
    value = valid_orb(getattr(opts, 'fixstar_orb_uniform', None))
    if value is not None:
        return value
    values = list((getattr(opts, 'fixstars', {}) or {}).values())
    return float(max(values, key=values.count)) if values else DEFAULT_ORB


def sync(opts):
    """Materialize the active rule after loading or changing the selected set."""
    selected = getattr(opts, 'fixstars', {}) or {}
    active = mode(opts)
    saved = individual_orbs(opts)
    if active == 'individual':
        saved.update(selected)
    else:
        for code, value in selected.items():
            saved.setdefault(code, value)
    opts.fixstar_orb_mode = active
    opts.fixstar_orb_uniform = uniform_orb(opts)
    opts.fixstar_orb_individual = saved
    opts.fixstars = {
        code: (opts.fixstar_orb_uniform if active == 'uniform' else
               TRADITIONAL_ORBS.get(TRADITIONAL_MAGNITUDES.get(code), saved[code])
               if active == 'traditional' else saved[code])
        for code in selected
    }


def apply(opts, fields):
    """Preserve individual values when selecting a rule; edits keep stable codes."""
    requested = fields.get('fixstarsOrbMode')
    uniform = valid_orb(fields.get('fixstarsOrbAll'))
    row = fields.get('fixstarsOrb')
    selected = getattr(opts, 'fixstars', {}) or {}
    single = isinstance(row, dict) and isinstance(row.get('name'), str) and row['name'] in selected
    value = valid_orb(row.get('orb')) if single else None
    if requested not in MODES and uniform is None and value is None:
        return False
    before = (mode(opts), uniform_orb(opts), individual_orbs(opts), dict(selected))
    sync(opts)
    if requested in MODES:
        opts.fixstar_orb_mode = requested
    if uniform is not None:
        opts.fixstar_orb_uniform = uniform
        opts.fixstar_orb_mode = 'uniform'
    if value is not None:
        # Editing a preset starts from the values currently shown. Selecting
        # Individual in the rule menu instead restores the saved custom values.
        if mode(opts) != 'individual':
            opts.fixstar_orb_individual.update(opts.fixstars)
        opts.fixstar_orb_individual[row['name']] = value
        opts.fixstar_orb_mode = 'individual'
    # Avoid capturing the old effective values over the restored custom map.
    if mode(opts) == 'individual':
        opts.fixstars = {code: opts.fixstar_orb_individual[code] for code in selected}
    sync(opts)
    return before != (mode(opts), uniform_orb(opts), individual_orbs(opts), opts.fixstars)
