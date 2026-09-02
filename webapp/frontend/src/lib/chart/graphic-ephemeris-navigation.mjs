// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

const navigators = new Map();

export function registerGraphicEphemerisNavigator(documentId, navigate, release) {
  const registration = { navigate, release };
  navigators.set(documentId, registration);
  return () => {
    if (navigators.get(documentId) === registration) {
      navigators.delete(documentId);
    }
  };
}

export function navigateGraphicEphemeris(documentId, key) {
  const registration = navigators.get(documentId);
  if (!registration) return false;
  registration.navigate(key);
  return true;
}

export function releaseGraphicEphemerisNavigation(documentId, key) {
  const registration = navigators.get(documentId);
  if (!registration) return false;
  registration.release(key);
  return true;
}
