// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Public compositor effects for the three retained wheel paint layers.
 *
 * These values deliberately stay in CSS: WebKit does not provide a complete
 * CanvasRenderingContext2D.filter implementation, while CSS filters on the
 * retained canvases are hardware composited and do not alter chart geometry.
 */
export const WHEEL_EFFECT_RENDER_TOKEN_SPECS = Object.freeze({
  geometryOpacity: ["--aries-wheel-effect-geometry-opacity", 1],
  geometryBlur: ["--aries-wheel-effect-geometry-blur", 0],
  geometryBrightnessScale: ["--aries-wheel-effect-geometry-brightness-scale", 1],
  geometryContrastScale: ["--aries-wheel-effect-geometry-contrast-scale", 1],
  geometrySaturateScale: ["--aries-wheel-effect-geometry-saturate-scale", 1],
  geometryHueRotate: ["--aries-wheel-effect-geometry-hue-rotate", 0],
  geometryGrayscaleOpacity: ["--aries-wheel-effect-geometry-grayscale-opacity", 0],
  geometryInvertOpacity: ["--aries-wheel-effect-geometry-invert-opacity", 0],
  geometrySepiaOpacity: ["--aries-wheel-effect-geometry-sepia-opacity", 0],
  geometryShadowOffsetX: ["--aries-wheel-effect-geometry-shadow-offset-x", 0],
  geometryShadowOffsetY: ["--aries-wheel-effect-geometry-shadow-offset-y", 0],
  geometryShadowBlur: ["--aries-wheel-effect-geometry-shadow-blur", 0],

  dynamicOpacity: ["--aries-wheel-effect-dynamic-opacity", 1],
  dynamicBlur: ["--aries-wheel-effect-dynamic-blur", 0],
  dynamicBrightnessScale: ["--aries-wheel-effect-dynamic-brightness-scale", 1],
  dynamicContrastScale: ["--aries-wheel-effect-dynamic-contrast-scale", 1],
  dynamicSaturateScale: ["--aries-wheel-effect-dynamic-saturate-scale", 1],
  dynamicHueRotate: ["--aries-wheel-effect-dynamic-hue-rotate", 0],
  dynamicGrayscaleOpacity: ["--aries-wheel-effect-dynamic-grayscale-opacity", 0],
  dynamicInvertOpacity: ["--aries-wheel-effect-dynamic-invert-opacity", 0],
  dynamicSepiaOpacity: ["--aries-wheel-effect-dynamic-sepia-opacity", 0],
  dynamicShadowOffsetX: ["--aries-wheel-effect-dynamic-shadow-offset-x", 0],
  dynamicShadowOffsetY: ["--aries-wheel-effect-dynamic-shadow-offset-y", 0],
  dynamicShadowBlur: ["--aries-wheel-effect-dynamic-shadow-blur", 0],

  outerLabelOpacity: ["--aries-wheel-effect-outer-label-opacity", 1],
  outerLabelBlur: ["--aries-wheel-effect-outer-label-blur", 0],
  outerLabelBrightnessScale: ["--aries-wheel-effect-outer-label-brightness-scale", 1],
  outerLabelContrastScale: ["--aries-wheel-effect-outer-label-contrast-scale", 1],
  outerLabelSaturateScale: ["--aries-wheel-effect-outer-label-saturate-scale", 1],
  outerLabelHueRotate: ["--aries-wheel-effect-outer-label-hue-rotate", 0],
  outerLabelGrayscaleOpacity: ["--aries-wheel-effect-outer-label-grayscale-opacity", 0],
  outerLabelInvertOpacity: ["--aries-wheel-effect-outer-label-invert-opacity", 0],
  outerLabelSepiaOpacity: ["--aries-wheel-effect-outer-label-sepia-opacity", 0],
  outerLabelShadowOffsetX: ["--aries-wheel-effect-outer-label-shadow-offset-x", 0],
  outerLabelShadowOffsetY: ["--aries-wheel-effect-outer-label-shadow-offset-y", 0],
  outerLabelShadowBlur: ["--aries-wheel-effect-outer-label-shadow-blur", 0],
} as const);

export const WHEEL_EFFECT_RENDER_PALETTE_SPECS = Object.freeze({
  geometryShadowColor: ["--aries-wheel-effect-geometry-shadow-color", "rgba(0,0,0,0)"],
  dynamicShadowColor: ["--aries-wheel-effect-dynamic-shadow-color", "rgba(0,0,0,0)"],
  outerLabelShadowColor: ["--aries-wheel-effect-outer-label-shadow-color", "rgba(0,0,0,0)"],
} as const);
