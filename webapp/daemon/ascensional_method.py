# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Canonical comparison intent and persisted AT calculation choice.

Dates do not establish intent. Natal synastry uses each participant's own
birth frame (Millard pp.17–18; Marr Prediction II ch.9). The optional event
correction is the existing Marr/Estadella implementation, not Polich/Page's
contact-specific E.T. variant. Its annual precession rate is a global measure
choice; applying it to non-event comparisons is an explicit experiment.
"""


def comparison_purpose(session):
    if session.get('compound_kind') == 'synastry':
        return 'natal-synastry'
    feature = session.get('supplementary_feature_kind')
    if feature == 'transits' or session.get('launcher_kind') == 'transits':
        return 'event'
    if feature:
        return 'derived'
    if session.get('ascensional_event_jd') is not None:
        return 'event'
    if session.get('chart_visual_mode') == 'ascensional_transits' or (
        session.get('launcher_kind') == 'ascensional_transits'
        and not session.get('ascensional_presentation_only')
    ):
        return 'event'
    return 'chart'


def precession_measure(options=None):
    """Global annual-rate choice ('ecliptic' Marr/Estadella, 'equatorial' Millard)."""
    if options is None:
        from webapp.daemon.chart_service import chart_snapshot_service
        options = chart_snapshot_service.options
    value = getattr(options, 'ascensional_precession_measure', 'ecliptic')
    return value if value in ('ecliptic', 'equatorial') else 'ecliptic'


def initial_precession(session, options=None):
    """Remembered inspector choice for a newly opened ascensional context."""
    if options is None:
        from webapp.daemon.chart_service import chart_snapshot_service
        options = chart_snapshot_service.options
    return bool(getattr(options, 'ascensional_precession_defaults', {}).get(comparison_purpose(session), False))


def apply_precession(session):
    """Old AT records lacking a choice retain their effective corrected method.

    New sessions explicitly store False. Never infer prenatal intent from
    participant chronology or rewrite a remembered choice during stepping.
    Non-event comparisons (synastry, derived, multi-chart) may opt in
    experimentally; they default to the source-backed uncorrected frames.
    """
    if comparison_purpose(session) != 'event':
        return bool(session.get('ascensional_apply_precession', False))
    return bool(session.get('ascensional_apply_precession',
        session.get('launcher_kind') == 'ascensional_transits'
        or session.get('chart_visual_mode') == 'ascensional_transits'))


def method_payload(session, options=None):
    purpose = comparison_purpose(session)
    applied = apply_precession(session)
    return {
        'purpose': purpose,
        'method': ('marr-estadella' if purpose == 'event' else 'experimental') if applied else 'ordinary',
        'applyPrecession': applied,
        'measure': precession_measure(options),
        # Only event transits carry a source-attested correction.
        'experimental': purpose != 'event',
    }
