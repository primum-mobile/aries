"""Language IDs offered by the Aries release UI.

IDs retain their positions in the inherited mtexts tables; the other catalogs
remain available to legacy code but are not release language choices.
"""

RELEASE_LANG_IDS = (0, 3, 5, 2, 9)  # English, French, Spanish, Italian, German


def release_langid(value) -> int:
    """Use English for a saved legacy language outside the release set."""
    try:
        langid = int(value)
    except (TypeError, ValueError, OverflowError):
        return 0
    return langid if langid in RELEASE_LANG_IDS else 0
