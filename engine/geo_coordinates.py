# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Parse coordinate pairs for Aries place queries."""

import re


_DMS = r"""([0-9]{1,3})\s*°\s*([0-9]{1,2})\s*['′’]\s*([0-9]{1,2}(?:\.[0-9]+)?)\s*["″”]\s*([NSEW])"""
_DMS_PAIR = re.compile(rf"{_DMS}\s*,?\s*{_DMS}", re.IGNORECASE)
_DECIMAL = r"([+−-]?(?:[0-9]{1,3}(?:\.[0-9]+)?|\.[0-9]+))"
_DECIMAL_PAIR = re.compile(rf"{_DECIMAL}(\s*,\s*|\s+){_DECIMAL}")


def parse_coordinate_pair(text: str, *, spotlight: bool = False) -> tuple[float, float] | None:
    """Return signed (longitude, latitude); unlabelled pairs are latitude first.

    A matching pair with invalid components raises ValueError.
    Spotlight also accepts partial dates, so bare integers stay dates there.
    A whitespace-separated decimal pair in Spotlight needs two decimal points
    to distinguish it from a day followed by a dot-format time.
    """
    text = text.strip()
    match = _DMS_PAIR.fullmatch(text)
    if match:
        deg1, min1, sec1, axis1, deg2, min2, sec2, axis2 = match.groups()
        axis1, axis2 = axis1.upper(), axis2.upper()
        if (axis1 in "NS") == (axis2 in "NS"):
            raise ValueError("coordinates must include both latitude and longitude")
        if max(int(min1), int(min2)) >= 60 or max(float(sec1), float(sec2)) >= 60:
            raise ValueError("coordinate minutes and seconds must be less than 60")
        first = (int(deg1) + int(min1) / 60 + float(sec1) / 3600) * (-1 if axis1 in "SW" else 1)
        second = (int(deg2) + int(min2) / 60 + float(sec2) / 3600) * (-1 if axis2 in "SW" else 1)
        lat, lon = (first, second) if axis1 in "NS" else (second, first)
    else:
        match = _DECIMAL_PAIR.fullmatch(text)
        if not match:
            return None
        first, separator, second = match.groups()
        if spotlight:
            if "," in separator:
                if not any(mark in text for mark in ".+−-"):
                    return None
            elif "." not in first or "." not in second:
                return None
        lat, lon = (float(value.replace("−", "-")) for value in (first, second))
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise ValueError("coordinates are outside geographic bounds")
    return lon, lat
