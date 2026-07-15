# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Aries About-dialog metadata.

The daemon owns product identity, release metadata, licensing links, and the
historical contributor ledger. React owns the localized presentation. Help is
served through its native, current-app boundary and is intentionally not part
of this service.
"""
from __future__ import annotations

from typing import Optional

import astrology
import build_info


_BRAND = 'Aries'
_PRIMARY_AUTHOR = 'Max Lange'
_PRIMARY_CONTACT = 'contact@maxlange.cc'
_COPYRIGHT_YEAR = 2026

_WEBSITE_URL = 'https://aries.sh/'
_SOURCE_URL = 'https://github.com/primum-mobile/aries'
_LICENSE_URL = 'https://github.com/primum-mobile/aries/blob/main/LICENSE'
_NOTICES_URL = (
    'https://github.com/primum-mobile/aries/blob/main/THIRD_PARTY_NOTICES.txt'
)

_LEGACY_CONTRIBUTORS = (
    {
        'name': 'Robert Nagy',
        'contributionKey': 'about.contribution.originalAuthorThrough62',
    },
    {
        'name': 'Roberto Luporini',
        'contributionKey': 'about.contribution.morinus7',
    },
    {
        'name': 'Elías D. Molins',
        'contributionKey': 'about.contribution.morinus8',
    },
    {
        'name': 'Shin Ji-Hyeon',
        'contributionKey': 'about.contribution.morinus9',
    },
    {
        'name': 'James Ren',
        'contributionKey': 'about.contribution.morinus9',
    },
    {
        'name': 'Philippe Epaud',
        'contributionKey': 'about.contribution.frenchTranslation',
    },
    {
        'name': 'Margherita Fiorello',
        'contributionKey': 'about.contribution.astrologyAndItalianTranslation',
    },
    {
        'name': 'Martin Gansten',
        'contributionKey': 'about.contribution.astrology',
    },
    {
        'name': 'Jaime Chica Londoño',
        'contributionKey': 'about.contribution.spanishTranslation',
    },
    {
        'name': 'Petr Radek',
        'contributionKey': 'about.contribution.astrology',
    },
    {
        'name': 'Endre Csaba Simon',
        'contributionKey': 'about.contribution.programmingAndAstrology',
    },
    {
        'name': 'Václav Jan Špirhanzl',
        'contributionKey': 'about.contribution.macosVersion',
    },
    {
        'name': 'Denis Steinhoff',
        'contributionKey': 'about.contribution.astrologyAndRussianTranslation',
    },
)


def _release_version() -> str:
    return (getattr(build_info, 'RELEASE_VERSION', '') or '').strip() or 'dev'


def _build_stamp() -> Optional[str]:
    stamp = (getattr(build_info, 'BUILD_STAMP', '') or '').strip()
    return stamp or None


def _swiss_ephemeris_version() -> str:
    try:
        return str(astrology.swe_version())
    except Exception:
        return ''


class AboutService:
    """Stateless product and attribution payload builder."""

    def get_about(self) -> dict:
        return {
            'brand': _BRAND,
            'version': _release_version(),
            'buildStamp': _build_stamp(),
            'primaryAuthor': _PRIMARY_AUTHOR,
            'primaryContact': _PRIMARY_CONTACT,
            'copyrightYear': _COPYRIGHT_YEAR,
            'taglineKey': 'about.tagline',
            'copyrightKey': 'about.copyright',
            'swissEphemerisKey': 'about.swissEphemerisVersion',
            'swissEphemerisVersion': _swiss_ephemeris_version(),
            'websiteUrl': _WEBSITE_URL,
            'sourceUrl': _SOURCE_URL,
            'licenseUrl': _LICENSE_URL,
            'noticesUrl': _NOTICES_URL,
            'creditsHeadingKey': 'about.creditsHeading',
            'licenseNameKey': 'about.licenseName',
            'contributorsHeadingKey': 'about.contributorsHeading',
            'legacyContributors': list(_LEGACY_CONTRIBUTORS),
        }


about_service = AboutService()
