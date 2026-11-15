export type AstrolabeNavigationKey = "left" | "right" | "up" | "down" | "space";
export type AstrolabeNavigationModifiers = { shift?: boolean; alt?: boolean };

export function registerAstrolabeNavigator(
  documentId: string,
  navigate: (key: AstrolabeNavigationKey, modifiers: AstrolabeNavigationModifiers) => boolean,
): () => void;

export function navigateAstrolabe(
  documentId: string,
  key: AstrolabeNavigationKey,
  modifiers?: AstrolabeNavigationModifiers,
): boolean;
