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

// Spotlight "current" on an ephemeris: the daemon centres the stored camera on
// the typed moment; the open view tweens there. `flush` writes a pending
// camera first so the typed date merges into the moment on screen.
const cameras = new Map();

export function registerGraphicEphemerisCamera(documentId, apply, flush) {
  const registration = { apply, flush };
  cameras.set(documentId, registration);
  return () => {
    if (cameras.get(documentId) === registration) cameras.delete(documentId);
  };
}

export function applyGraphicEphemerisCamera(documentId, camera) {
  const registration = cameras.get(documentId);
  if (!registration) return false;
  registration.apply(camera);
  return true;
}

export async function flushGraphicEphemerisCamera(documentId) {
  await cameras.get(documentId)?.flush();
}

// Tab on an ephemeris: show or hide the radix layer (natal lines and their
// crossings), the plate's twin of Tab toggling a chart's comparison ring.
const radixToggles = new Map();

export function registerGraphicEphemerisRadixToggle(documentId, toggle) {
  radixToggles.set(documentId, toggle);
  return () => {
    if (radixToggles.get(documentId) === toggle) radixToggles.delete(documentId);
  };
}

export function toggleGraphicEphemerisRadix(documentId) {
  const toggle = radixToggles.get(documentId);
  if (!toggle) return false;
  toggle();
  return true;
}
