export type AstrolabeDisplayCommand =
  | "toggle-houses"
  | "toggle-aspects"
  | "toggle-minor-aspects";

export function registerAstrolabeDisplayCommands(
  documentId: string,
  handler: (command: AstrolabeDisplayCommand) => void,
): () => void;

export function dispatchAstrolabeDisplayCommand(documentId: string, command: string): boolean;
