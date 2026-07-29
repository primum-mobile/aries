// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

function comparablePaneState(value) {
  if (!value || typeof value !== "object") return value;

  const comparable = { ...value };
  delete comparable.openSeq;

  const followPolicy = comparable.followPolicy;
  if (
    followPolicy &&
    typeof followPolicy === "object" &&
    followPolicy.cursor === "source-live"
  ) {
    comparable.focusDatetime = null;
    comparable.followPolicy = {
      ...followPolicy,
      focusDatetime: null,
    };
  }

  return comparable;
}

function equalActivationValue(left, right) {
  if (Object.is(left, right)) return true;
  if (
    !left ||
    !right ||
    typeof left !== "object" ||
    typeof right !== "object" ||
    Array.isArray(left) !== Array.isArray(right)
  ) {
    return false;
  }

  if (Array.isArray(left)) {
    return (
      left.length === right.length &&
      left.every((value, index) => equalActivationValue(value, right[index]))
    );
  }

  const leftKeys = Object.keys(left).filter((key) => left[key] !== undefined).sort();
  const rightKeys = Object.keys(right).filter((key) => right[key] !== undefined).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] &&
        equalActivationValue(left[key], right[key]),
    )
  );
}

export function sameRetainedPaneActivation(current, requested) {
  if (!current || !requested) return false;
  return equalActivationValue(
    comparablePaneState(current),
    comparablePaneState(requested),
  );
}
