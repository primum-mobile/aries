# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Display-only asterism figures shared by both Astrolabe projections."""

from functools import lru_cache
import math
import os
from pathlib import Path
import sys

import asterism_projection as figures
import astrolabe_projection as stereo
import astrology
import fixstars
from webapp.daemon import polar_azimuthal_service as polar


def _resource_dir() -> Path:
    base = os.environ.get("ARIES_DAEMON_BASE_DIR", "").strip()
    if base:
        root = Path(base).expanduser()
    elif getattr(sys, "frozen", False) and getattr(sys, "_MEIPASS", None):
        root = Path(sys._MEIPASS)
    else:
        root = Path(__file__).resolve().parents[2]
    return root / "Res" / "astrocart"


@lru_cache(maxsize=8)
def _catalog_stars(resource_dir: Path) -> tuple[dict, ...]:
    """Attach Swiss identities only to matching J2000 coordinates (within 1").

    Preserve HIP identities for stars absent from Swiss; a nearby different
    star must never supply their Inspector content.
    """
    from webapp.daemon.options_service import _fixstar_catalog_path, _fixstar_split_name, _read_fixstar_catalog

    path = _fixstar_catalog_path()
    candidates = []
    seen = set()
    valid_codes = {row["code"] for row in _read_fixstar_catalog()}
    for line in path.read_text(encoding="utf-8").splitlines() if path else ():
        fields = [part.strip() for part in line.split(",")]
        if line.startswith("#") or len(fields) < 9 or fields[2] not in ("ICRS", "2000"):
            continue
        code = fields[1]
        if code in seen or code not in valid_codes:
            continue
        ra = 15 * (float(fields[3]) + float(fields[4]) / 60 + float(fields[5]) / 3600)
        dec = (abs(float(fields[6])) + float(fields[7]) / 60 + float(fields[8]) / 3600)
        dec *= -1 if fields[6].startswith("-") else 1
        candidates.append((code, ra, dec))
        seen.add(code)
    catalog = figures.load_catalog(resource_dir / "constellations.stars.min.geojson")
    stars = []
    for feature in catalog["features"]:
        props = feature["properties"]
        ra, dec = feature["geometry"]["coordinates"]
        def separation(candidate):
            _, other_ra, other_dec = candidate
            return math.hypot(((other_ra - ra + 180) % 360 - 180) * math.cos(math.radians(dec)), other_dec - dec)
        closest = min(candidates, key=separation) if candidates else None
        code = closest[0] if closest and separation(closest) <= 1 / 3600 else f"HIP {props['id']}"
        if not code.startswith("HIP "):
            # Swiss can canonicalize component aliases on lookup (zePscA →
            # zePsc); use exactly the identity returned by FixStars/Inspector.
            _, raw_name, _, _ = astrology.swe_fixstar_ut("," + code, figures.J2000_JD, 0)
            _, code = _fixstar_split_name(raw_name)
        stars.append({"nom": code, "name": props.get("name") or f"HIP {props['id']}",
                      "ra": ra, "decl": dec, "mag": float(props["mag"])})
    return tuple(stars)


def fallback_star_rows(chrt, codes) -> list:
    """Resolve bundled HIP stars through the same FixStars row contract."""
    wanted = set(codes)
    rows = []
    for star in _catalog_stars(_resource_dir()):
        if star["nom"] not in wanted:
            continue
        ra, dec = figures.precess_j2000_equatorial(star["ra"], star["decl"], chrt.time.jd)
        lon, lat, _ = astrology.swe_cotrans(ra, dec, 1.0, chrt.obl[0])
        lon = (lon - float(getattr(chrt, "ayanamsha_offset", 0.0) or 0.0)) % 360
        rows.append([star["name"], star["nom"], lon, lat, ra, dec])
    return rows


@lru_cache(maxsize=8)
def _epoch_catalog(resource_dir: Path, jd: float) -> tuple:
    """Keep precession and spherical sampling out of routine rete rotation."""
    catalog = figures.load_catalog(resource_dir / "constellations.lines.min.geojson")
    lines = tuple(
        tuple(figures.equatorial_line(line, jd))
        for feature in catalog["features"]
        for line in feature["geometry"]["coordinates"]
    )
    points = tuple(
        {**star, "ra": ra, "decl": dec}
        for star in _catalog_stars(resource_dir)
        for ra, dec in [figures.precess_j2000_equatorial(star["ra"], star["decl"], jd)]
    )
    return lines, points


def geometry(chrt, opts, eramc: float, projection: str, rim: float) -> dict:
    """Project the physical sky; zodiac offsets and star selection do not apply.

    Lines extend beyond the plate and are clipped by the renderer's existing
    disk clip, so figures meeting its edge retain their boundary segments.
    """
    from webapp.daemon.astrolabe_service import astrolabe_star_rows, _star_display_name
    from webapp.daemon.surveil_service import format_zodiac_position

    lines, stars = _epoch_catalog(_resource_dir(), float(chrt.time.jd))
    rows = {row[fixstars.FixStars.NOMNAME]: row for row in astrolabe_star_rows(
        chrt, tuple(star["nom"] for star in stars),
    )}

    pole = stereo.plate_pole(float(chrt.place.lat))

    def project(ra, dec):
        if projection == "polarEquidistant":
            return polar.project(eramc - ra, dec)
        return stereo.equatorial_to_xy(ra, dec, eramc, 1.0, pole)

    paths = [
        [[round(x, 6), round(y, 6)] for x, y in (project(*point) for point in line)]
        for line in lines
    ]
    points = []
    for star in stars:
        ra, dec = star["ra"], star["decl"]
        x, y = project(ra, dec)
        if math.hypot(x, y) <= rim:
            row = rows[star["nom"]]
            lon = float(row[fixstars.FixStars.LON])
            points.append({**star, "x": round(x, 6), "y": round(y, 6),
                           "name": _star_display_name(row, opts), "lon": lon,
                           "position": format_zodiac_position(lon)})
    return {"paths": paths, "stars": points}
