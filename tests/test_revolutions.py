import datetime
from types import SimpleNamespace

import revolutions


def _fake_chart():
    return SimpleNamespace(
        time=SimpleNamespace(year=2000, month=6, day=15, hour=12, minute=0, second=0),
        options=SimpleNamespace(ayanamsha=0, topocentric=False),
    )


def test_compute_planetary_before_datetime_can_step_before_birth_year(monkeypatch):
    revs = revolutions.Revolutions()
    chart = _fake_chart()
    hits = {
        (1999, 12): (
            (datetime.datetime(1999, 12, 20, 10, 0, 0), (1999, 12, 20, 10, 0, 0)),
        ),
        (2001, 1): (
            (datetime.datetime(2001, 1, 20, 10, 0, 0), (2001, 1, 20, 10, 0, 0)),
        ),
    }

    monkeypatch.setattr(
        revolutions.Revolutions,
        "_planetary_month_hits",
        lambda self, typ, year, month, chrt: hits.get((int(year), int(month)), ()),
    )

    ok = revs.compute_planetary_before_datetime(
        revolutions.Revolutions.MERCURY,
        datetime.datetime(2001, 1, 20, 10, 0, 0),
        chart,
    )

    assert ok is True
    assert tuple(revs.t) == (1999, 12, 20, 10, 0, 0)


def test_cycle_start_does_not_cross_into_separate_prebirth_cycle(monkeypatch):
    revs = revolutions.Revolutions()
    chart = _fake_chart()
    hits = {
        (1999, 12): (
            (datetime.datetime(1999, 12, 20, 10, 0, 0), (1999, 12, 20, 10, 0, 0)),
        ),
        (2001, 1): (
            (datetime.datetime(2001, 1, 20, 10, 0, 0), (2001, 1, 20, 10, 0, 0)),
        ),
    }

    monkeypatch.setattr(
        revolutions.Revolutions,
        "_planetary_month_hits",
        lambda self, typ, year, month, chrt: hits.get((int(year), int(month)), ()),
    )

    ok = revs.compute_planetary_cycle_start_datetime(
        revolutions.Revolutions.MERCURY,
        datetime.datetime(2001, 1, 25, 0, 0, 0),
        chart,
    )

    assert ok is True
    assert tuple(revs.t) == (2001, 1, 20, 10, 0, 0)
