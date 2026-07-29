// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

const navigators = new Map();

export function registerGraphicEphemerisNavigator(documentId, navigate) {
  navigators.set(documentId, navigate);
  return () => {
    if (navigators.get(documentId) === navigate) {
      navigators.delete(documentId);
    }
  };
}

export function navigateGraphicEphemeris(documentId, key) {
  const navigate = navigators.get(documentId);
  if (!navigate) return false;
  navigate(key);
  return true;
}
