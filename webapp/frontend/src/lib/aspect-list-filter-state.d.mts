export function isAspectListSecondaryRingFilterId(filterId: string): boolean;
export function isAspectListInclusionFilterId(filterId: string): boolean;
export function defaultAspectListSecondaryRingIncluded(mode: string): boolean;
export function isAspectListPhaseIncluded(
  phase: "applying" | "separating" | "exact" | "none",
  phaseFilter?: "applying" | "separating" | "both",
): boolean;

export function isAspectListRowIncluded(
  filterIds: readonly string[],
  focusedIds: ReadonlySet<string>,
  activeSecondaryRingFilterIds: ReadonlySet<string>,
  includeActiveSecondaryRing: boolean,
  motionMarkers?: readonly (string | null | undefined)[],
  rxFocusEnabled?: boolean,
  focusMatchMode?: "or" | "and",
  endpointFilterIds?: readonly (readonly string[])[] | null,
  includeHouseCusps?: boolean,
): boolean;
