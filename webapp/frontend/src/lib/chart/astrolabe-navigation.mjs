// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// The chart navbar steps an open Astrolabe's rete arc through the view that
// owns it, like the Graphic Ephemeris navigator: the arc is view state, not a
// daemon chart cursor.
const navigators = new Map();

export function registerAstrolabeNavigator(documentId, navigate) {
  navigators.set(documentId, navigate);
  return () => {
    if (navigators.get(documentId) === navigate) navigators.delete(documentId);
  };
}

export function navigateAstrolabe(documentId, key, modifiers = {}) {
  const navigate = navigators.get(documentId);
  return navigate ? navigate(key, modifiers) : false;
}
