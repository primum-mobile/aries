export type GraphicEphemerisNavigationKey = "left" | "right" | "up" | "down";

export function registerGraphicEphemerisNavigator(
  documentId: string,
  navigate: (key: GraphicEphemerisNavigationKey) => void,
): () => void;

export function navigateGraphicEphemeris(
  documentId: string,
  key: GraphicEphemerisNavigationKey,
): boolean;
