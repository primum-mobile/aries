export function isAspectListSecondaryRingFilterId(filterId: string): boolean;
export function defaultAspectListSecondaryRingIncluded(mode: string): boolean;

export function isAspectListRowIncluded(
  filterIds: readonly string[],
  focusedIds: ReadonlySet<string>,
  activeSecondaryRingFilterIds: ReadonlySet<string>,
  includeActiveSecondaryRing: boolean,
  motionMarkers?: readonly (string | null | undefined)[],
  rxFocusEnabled?: boolean,
  focusMatchMode?: "or" | "and",
  endpointFilterIds?: readonly (readonly string[])[] | null,
): boolean;
