// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

/** Ordinary bodies and points share one Focus facet. OR includes a row when
 * either endpoint is focused; AND includes only relationships whose two
 * ordinary endpoints both belong to the focused set. Motion is a separate
 * narrowing facet. Secondary-ring families remain calculation inputs, but only
 * the active family owned by the directional receiving chart can enter the
 * visible projection. */
export function isAspectListSecondaryRingFilterId(filterId) {
  return filterId.startsWith("outer:");
}

export function defaultAspectListSecondaryRingIncluded(mode) {
  return mode !== "arabic_parts";
}

function isRxFocusMotionMarker(marker) {
  return marker === "R" || marker === "SR" || marker === "SD";
}

export function isAspectListRowIncluded(
  filterIds,
  focusedIds,
  activeSecondaryRingFilterIds,
  includeActiveSecondaryRing,
  motionMarkers = [],
  rxFocusEnabled = false,
  focusMatchMode = "or",
  endpointFilterIds = null,
) {
  const secondaryRingIds = filterIds.filter(
    isAspectListSecondaryRingFilterId,
  );
  if (
    secondaryRingIds.some((filterId) => !activeSecondaryRingFilterIds.has(filterId))
  ) {
    return false;
  }
  if (secondaryRingIds.length > 0 && !includeActiveSecondaryRing) return false;
  const rxMatches = motionMarkers.some(isRxFocusMotionMarker);
  if (focusedIds.size === 0) return !rxFocusEnabled || rxMatches;

  const ordinaryFilterIds = filterIds.filter(
    (id) => !isAspectListSecondaryRingFilterId(id),
  );
  const useAnd = focusMatchMode === "and" && focusedIds.size >= 2;
  const endpointGroups =
    endpointFilterIds ?? ordinaryFilterIds.map((id) => [id]);
  const focusedPointMatches = useAnd
    ? endpointGroups.length === 2
      && endpointGroups
        .map((ids) => ids.filter((id) => !isAspectListSecondaryRingFilterId(id)))
        .every(
          (ids) => ids.length > 0 && ids.some((id) => focusedIds.has(id)),
        )
    : ordinaryFilterIds.some((id) => focusedIds.has(id));
  return focusedPointMatches && (!rxFocusEnabled || rxMatches);
}
