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

export type GraphicEphemerisCamera = { startJd: number; spanDays: number };

export function registerGraphicEphemerisCamera(
  documentId: string,
  apply: (camera: GraphicEphemerisCamera) => void,
  flush: () => Promise<void>,
): () => void;

export function applyGraphicEphemerisCamera(
  documentId: string,
  camera: GraphicEphemerisCamera,
): boolean;

export function flushGraphicEphemerisCamera(documentId: string): Promise<void>;

export function registerGraphicEphemerisRadixToggle(
  documentId: string,
  toggle: () => void,
): () => void;

export function toggleGraphicEphemerisRadix(documentId: string): boolean;
