export type GraphicEphemerisStepKey = "left" | "right" | "up" | "down";
export type GraphicEphemerisNavigationKey = GraphicEphemerisStepKey | "space";

export function registerGraphicEphemerisNavigator(
  documentId: string,
  navigate: (key: GraphicEphemerisNavigationKey) => void,
  release: (key: GraphicEphemerisStepKey | null) => void,
): () => void;

export function navigateGraphicEphemeris(
  documentId: string,
  key: GraphicEphemerisNavigationKey,
): boolean;

export function releaseGraphicEphemerisNavigation(
  documentId: string,
  key: GraphicEphemerisStepKey | null,
): boolean;
