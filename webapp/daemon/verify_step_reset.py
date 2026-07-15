# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Characterization test for the space-reset / step-again offset bug.

Regression workflow: open a radix, open a solar-revolution child,
step the return forward N times, press space (reset to initial), then step once
more. The displayed return year must be initial+1 — NOT initial+(N+1).

Before the fix the daemon reset rewound only the ChartSession (chart +
display_datetime) and left the supplementary *binding offset* stale, so the next
step resumed from the old offset. The fix plugs a wx-free SupplementaryStepper
into ``cs._stepper`` (the slot ``ChartSession.reset_to_initial_chart`` already
rewinds) so step AND reset share one source of truth.

Run:  webapp/.venv/bin/python3 webapp/daemon/verify_step_reset.py
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import common
common.ensure_swe_ready()

from webapp.daemon.workspace_service import workspace_service as ws

N_STEPS = 3


def _child_year(doc_id):
    session = ws._controller.session(doc_id)
    cs = session.get('chart_session') if session else None
    dd = getattr(cs, 'display_datetime', None) if cs else None
    return int(dd[0]) if dd else None


def _child_offset(doc_id):
    session = ws._controller.session(doc_id) or {}
    binding = session.get('supplementary_binding') or {}
    retained = binding.get('retained_state') or {}
    return retained.get('solar_year_offset')


def main() -> int:
    radix = ws.open_document(kind='chart', source_name='Morinus')
    radix_id = radix['documentId']
    child = ws.open_document(
        kind='chart',
        parent_document_id=radix_id,
        feature_kind='solar-revolution',
    )
    child_id = child['documentId']

    initial_year = _child_year(child_id)
    print(f"initial:           year={initial_year} offset={_child_offset(child_id)}")
    if initial_year is None:
        print("FAIL: could not read initial return year", file=sys.stderr)
        return 2

    for i in range(N_STEPS):
        ws.navigate_key(child_id, 'right')
    stepped_year = _child_year(child_id)
    print(f"after {N_STEPS}x right:    year={stepped_year} offset={_child_offset(child_id)}")

    ws.navigate_key(child_id, 'space')
    reset_year = _child_year(child_id)
    print(f"after space:       year={reset_year} offset={_child_offset(child_id)}")

    ws.navigate_key(child_id, 'right')
    final_year = _child_year(child_id)
    print(f"after 1x right:    year={final_year} offset={_child_offset(child_id)}")

    ok = True
    if stepped_year != initial_year + N_STEPS:
        print(f"FAIL: {N_STEPS}x step expected {initial_year + N_STEPS}, got {stepped_year}", file=sys.stderr)
        ok = False
    if reset_year != initial_year:
        print(f"FAIL: space did not reset to {initial_year}, got {reset_year}", file=sys.stderr)
        ok = False
    if final_year != initial_year + 1:
        print(
            f"FAIL: step after reset expected {initial_year + 1} "
            f"(BUG would give {initial_year + N_STEPS + 1}), got {final_year}",
            file=sys.stderr,
        )
        ok = False

    if ok:
        print("\nPASS — space then step starts from the initial offset.")
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
