# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Packaging self-check for the platform pieces a daemon build can lose silently.

``aries-daemon --verify-platform-runtime`` runs these after PyInstaller, so a
Windows build fails at packaging time instead of shipping a daemon that:

- has no IANA time-zone data (Windows has no system database; ``tzdata`` must
  be bundled), which drops every historical offset and DST rule;
- runs without Python UTF-8 mode, so text files decode in the ANSI code page;
- cannot open Swiss Ephemeris files from a non-ASCII directory and silently
  falls back to Moshier (no Chiron, no fixed stars);
- keeps Swiss Ephemeris state per thread, so daemon worker threads never see
  the ephemeris path, sidereal mode or observer set on another thread and
  silently compute with Moshier.

Every failure is reported in one message; nothing here touches user data.
"""
from __future__ import annotations

import datetime as dt
import os
import shutil
import sys
import tempfile
import threading
from pathlib import Path

# Offsets that only a real tz database knows: Berlin's 1945 double summer time,
# New York before and after the 2007 US DST change, Kolkata's half hour.
_ZONE_PROBES = (
    ("Europe/Berlin", dt.datetime(1945, 6, 1, 12, 0), 3 * 60),
    ("America/New_York", dt.datetime(2006, 3, 20, 12, 0), -5 * 60),
    ("America/New_York", dt.datetime(2007, 3, 20, 12, 0), -4 * 60),
    ("Asia/Kolkata", dt.datetime(2026, 1, 1, 12, 0), 5 * 60 + 30),
)
_EPHEMERIS_FILES = ("sepl_18.se1", "semo_18.se1", "seas_18.se1", "sefstars.txt")
_NON_ASCII_DIR = "Aries Ephemeriden Jürgen 星座"
_J2000 = 2451545.0


def check_time_zones() -> list[str]:
    problems = []
    try:
        from zoneinfo import ZoneInfo
    except ImportError as exc:
        return [f"zoneinfo unavailable: {exc}"]
    for tzid, local, expected_minutes in _ZONE_PROBES:
        try:
            offset = local.replace(tzinfo=ZoneInfo(tzid)).utcoffset()
        except Exception as exc:
            problems.append(f"time zone {tzid} cannot load ({type(exc).__name__}: {exc}); bundle tzdata")
            continue
        minutes = int(offset.total_seconds() // 60) if offset is not None else None
        if minutes != expected_minutes:
            problems.append(f"time zone {tzid} at {local:%Y-%m-%d}: offset {minutes} min, expected {expected_minutes}")
    return problems


def check_utf8_mode(*, required: bool) -> list[str]:
    if required and not sys.flags.utf8_mode:
        return ["Python UTF-8 mode is off (PyInstaller option 'X utf8' missing)"]
    return []


def check_swiss_ephemeris(base_dir: Path) -> list[str]:
    import astrology

    source = Path(base_dir) / "SWEP" / "Ephem"
    missing = [name for name in _EPHEMERIS_FILES if not (source / name).is_file()]
    if missing:
        return [f"Swiss Ephemeris files missing under {source}: {', '.join(missing)}"]
    problems = []
    root = Path(tempfile.mkdtemp(prefix="aries-selfcheck-"))
    try:
        target = root / _NON_ASCII_DIR
        target.mkdir()
        for name in _EPHEMERIS_FILES:
            shutil.copy2(source / name, target / name)
        flags = astrology.SEFLG_SWIEPH | astrology.SEFLG_SPEED
        with astrology.swiss_context(str(target)):
            moon_flag, _moon, moon_error = astrology.swe_calc_ut_ex(_J2000, astrology.SE_MOON, flags)
            _flag, _chiron, chiron_error = astrology.swe_calc_ut_ex(_J2000, astrology.SE_CHIRON, flags)
            _ret, star_name, _star, star_error = astrology.swe_fixstar_ut("Regulus", _J2000, flags)
        if not moon_flag & astrology.SEFLG_SWIEPH or moon_flag & astrology.SEFLG_MOSEPH:
            problems.append(f"Swiss Ephemeris fell back to Moshier for a non-ASCII path: {moon_error}")
        if chiron_error:
            problems.append(f"Swiss Ephemeris cannot read seas_18.se1 from a non-ASCII path: {chiron_error}")
        if star_error or "Regulus" not in str(star_name[0] if star_name else ""):
            problems.append(f"Swiss Ephemeris cannot read sefstars.txt from a non-ASCII path: {star_error}")
        if shared_state_required():
            problems.extend(check_shared_swiss_state(astrology, target))
    finally:
        try:
            astrology.swe_close()
        except Exception:
            pass
        shutil.rmtree(root, ignore_errors=True)
    return problems


def shared_state_required() -> bool:
    # macOS (sweodef.h, __APPLE__) and Windows (TLSOFF in SWEP/src/setup.py and
    # scripts/build_transit_kernel.py) build one process-wide Swiss Ephemeris
    # state. Linux developer builds keep GCC's per-thread state; none ships.
    return not sys.platform.startswith("linux")


def check_shared_swiss_state(astrology, ephemeris_dir: Path) -> list[str]:
    """Chiron on a thread that never set the ephemeris path itself."""
    flags = astrology.SEFLG_SWIEPH | astrology.SEFLG_SPEED
    result: dict[str, object] = {}

    def worker() -> None:
        # The raw call skips the wrapper's own re-apply of this thread's path.
        flag, _xx, error = astrology._RAW_SWE_FUNCTIONS["swe_calc_ut"](_J2000, astrology.SE_CHIRON, flags)
        while isinstance(flag, tuple) and len(flag) == 1:
            flag = flag[0]
        while isinstance(error, tuple) and len(error) == 1:
            error = error[0]
        result.update(flag=int(flag) & 0xFFFFFFFF, error=str(error or "").strip())

    with astrology.swiss_context(str(ephemeris_dir)):
        thread = threading.Thread(target=worker, name="aries-selfcheck-thread")
        thread.start()
        thread.join(60)
    if not result:
        return ["Swiss Ephemeris worker-thread check did not finish"]
    flag = int(result["flag"])
    if flag == 0xFFFFFFFF or not flag & astrology.SEFLG_SWIEPH or flag & astrology.SEFLG_MOSEPH:
        return [
            "Swiss Ephemeris keeps per-thread state (sweastrology needs TLSOFF): "
            f"a worker thread cannot compute Chiron: {result['error']}"
        ]
    return []


def run(base_dir: Path, *, frozen: bool) -> list[str]:
    return [
        *check_time_zones(),
        *check_utf8_mode(required=frozen),
        *check_swiss_ephemeris(base_dir),
    ]


def main(base_dir: Path) -> int:
    problems = run(base_dir, frozen=bool(getattr(sys, "frozen", False)))
    if problems:
        sys.stderr.write("Aries daemon platform self-check failed:\n")
        for problem in problems:
            sys.stderr.write(f"  - {problem}\n")
        return 1
    sys.stdout.write("Aries daemon platform self-check passed\n")
    return 0


if __name__ == "__main__":  # pragma: no cover - manual use from a checkout
    raise SystemExit(main(Path(os.environ.get("ARIES_DAEMON_BASE_DIR") or Path(__file__).resolve().parents[2])))
