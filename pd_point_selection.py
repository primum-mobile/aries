# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Canonical role selections for the existing dynamic primary-direction path."""
import asteroids


ROLE_FIELDS = {
    True: {'partsEnabled': 'pdpromarabicparts', 'partNames': 'pdpromarabicpartnames',
           'legacyName': 'pdpromarabicpartname', 'asteroidsEnabled': 'pdpromasteroids',
           'asteroidNumbers': 'pdpromasteroidnumbers', 'chironEnabled': 'pdpromchiron',
           'legacyKey': 'arabic_part_prom'},
    False: {'partsEnabled': 'pdsigarabicparts', 'partNames': 'pdsigarabicpartnames',
            'legacyName': 'pdsigarabicpartname', 'asteroidsEnabled': 'pdsigasteroids',
            'asteroidNumbers': 'pdsigasteroidnumbers', 'chironEnabled': 'pdsigchiron',
            'legacyKey': 'arabic_part_sig'},
}


def arabic_part_names(opts, promissor=False):
    fields = ROLE_FIELDS[promissor]
    choices = [item[0] for item in getattr(opts, 'arabicparts', ()) or ()
               if item and (len(item) <= 4 or bool(item[4]))]
    selected = getattr(opts, fields['partNames'], None)
    if selected is None:
        legacy = getattr(opts, fields['legacyName'], '')
        selected = [legacy] if legacy in choices else []
    return list(dict.fromkeys(name for name in selected if name in choices))


def asteroid_numbers(opts, promissor=False):
    fields = ROLE_FIELDS[promissor]
    available = asteroids.normalize_asteroid_numbers(getattr(opts, 'asteroids', None))
    selected = asteroids.normalize_asteroid_numbers(
        getattr(opts, fields['asteroidNumbers'], []), defaults=())
    return [number for number in selected if number in available]
