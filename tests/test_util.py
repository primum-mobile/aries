import util


def test_normalize_wraps_negative_and_large_angles():
    assert util.normalize(-30.0) == 330.0
    assert util.normalize(725.0) == 5.0


def test_round_deg_rolls_minutes_and_degrees():
    assert util.roundDeg(10, 5, 31) == (10, 6)
    assert util.roundDeg(29, 59, 59) == (0, 0)


def test_increment_and_decrement_day_across_month_boundaries():
    assert util.incrDay(2024, 2, 28) == (2024, 2, 29)
    assert util.incrDay(2023, 2, 28) == (2023, 3, 1)
    assert util.decrDay(2024, 3, 1) == (2024, 2, 29)


def test_add_and_subtract_minutes_cross_day_boundaries():
    assert util.addMins(2024, 12, 31, 23, 59, 1) == (2025, 1, 1, 0, 0)
    assert util.subtractMins(2025, 1, 1, 0, 0, 1) == (2024, 12, 31, 23, 59)
