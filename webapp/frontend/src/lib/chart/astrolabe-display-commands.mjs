// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// Use command IDs from the shared shortcut manifest; the active Astrolabe owns
// its display commands even before its retained view has registered a handler.
const commands = new Set(["toggle-houses", "toggle-aspects", "toggle-minor-aspects"]);
const handlers = new Map();

export function registerAstrolabeDisplayCommands(documentId, handler) {
  handlers.set(documentId, handler);
  return () => {
    if (handlers.get(documentId) === handler) handlers.delete(documentId);
  };
}

export function dispatchAstrolabeDisplayCommand(documentId, command) {
  if (!commands.has(command)) return false;
  handlers.get(documentId)?.(command);
  // Never fall through to the source wheel's house/aspect state.
  return true;
}
