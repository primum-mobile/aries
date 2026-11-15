// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Decorative picture on the astrolabe plate, stereographic or polar azimuthal
 * equidistant (astrolabe design tuner, development builds only).
 *
 * The city panorama wraps round the plate horizon: picture x is bearing,
 * picture y is altitude, its horizon line on the plate horizon. The globe
 * pictures are two hemisphere discs each: a world map (each place under its
 * own zenith, as the polar plate's world layer) or a star chart (riding the
 * rete). Each plate pixel is taken back through the plate's projection to the
 * sky, then to the picture's own coordinates, sampled and quantized to one bit
 * or three levels, coloured with two theme tokens (the middle level is their
 * OKLab mix). Assets and calibration: public/astrolabe/README.md.
 *
 * Rendering is a WebGL2 fragment shader that does this mapping for every
 * device pixel of the plate, on an offscreen canvas the size of the plate
 * canvas, copied 1:1 onto it. Each picture is one mipmapped texture
 * (trilinear when minified, bilinear when magnified), uploaded once, so every
 * frame is exact at any zoom and pan with nothing cached or queued. A
 * picture's full-resolution version loads in the background once the base one
 * is up and is drawn from FINE_FROM_ZOOM on, or once the device pixels across
 * the plate reach that share of a Retina screen's (print and poster exports).
 * Only the shown picture stays on the GPU.
 */

import Color from "colorjs.io";
import { OBSERVER_HEIGHTS, OBSERVER_ANCHORS, OBSERVER_FOOT, type ObserverPosition, type ObserverFrame } from "./astrolabe-observers";
import type { AstrolabeProjection } from "@/lib/daemon/client";
import type { Layout } from "./astrolabe-canvas";

/** A horizon panorama: picture x is bearing, picture y is altitude. */
export type CityPanorama = {
  src: string;
  /** The same picture at twice the resolution, for the zoomed plate. */
  fineSrc?: string;
  /** Degrees of plate horizon the picture spans, centred north. */
  fov: number;
  /** Degrees below the horizon the picture's bottom edge lands. */
  depth: number;
  /** Picture horizon line as a fraction of the picture height. */
  horizon: number;
  /** Where the print is fully printed, as fractions of the picture width (left,
   * right): beyond these the picture runs on as its mirror image, so a pale
   * printed edge is not doubled into a gap. Default the whole width. */
  printed?: readonly [number, number];
  /** Beyond the printed width only the mirrored ground below the horizon is
   * drawn: a city's mirrored hills would rise into the sky. */
  groundBeyond?: boolean;
};

/**
 * Horizon panoramas, each with its own calibration from the print (README).
 * Hollar's dunes and Holmes's cinder cones keep Florence's proportions
 * (vertical degrees per pixel 0.856 of horizontal), so each print reaches as
 * far below the horizon as it is drawn: 26° and 46°.
 */
const PANORAMAS = {
  catena: {
    src: "/astrolabe/catena-woodcut.webp",
    fineSrc: "/astrolabe/catena-woodcut-fine.webp",
    fov: 247,
    depth: 71,
    horizon: 0.205,
    // The stitched side sheets' printed edges lean (0.18° left, 0.39° right):
    // below the horizon up to 10 px (left) and 17 px (right) of the 7200 px
    // fine picture are blank or pale.
    printed: [10 / 7200, 1 - 17 / 7200],
    groundBeyond: true,
  },
  naarden: {
    src: "/astrolabe/hollar-naarden.webp",
    fineSrc: "/astrolabe/hollar-naarden-fine.webp",
    fov: 247,
    depth: 26.21,
    horizon: 0.2327,
  },
  cinderCones: {
    src: "/astrolabe/holmes-cinder-cones.webp",
    fineSrc: "/astrolabe/holmes-cinder-cones-fine.webp",
    fov: 247,
    depth: 46.12,
    horizon: 0.3273,
    printed: [5 / 5751, 1 - 1 / 5751],
  },
} as const satisfies Record<string, CityPanorama>;

/** One hemisphere disc of a globe picture, in texture px. */
type GlobeDisc = {
  centre: readonly [number, number];
  /** Screen angle (deg, y down) of picture longitude 0. */
  turn: number;
  /** +1 when longitude runs clockwise in the picture, -1 counterclockwise. */
  direction: 1 | -1;
  /** Radii of the polar distances in `knots`; stereographic discs use only the last (90°). */
  radius: readonly [number, number, number];
  /** Largest polar distance (deg) the disc's picture is used for. */
  zetaMax: number;
};

type GlobePicture = {
  src: string;
  /** The same picture at twice the resolution, drawn from FINE_FROM_ZOOM on. */
  fineSrc?: string;
  /** Grey picture without alpha, uploaded as one channel (a quarter of the GPU memory). */
  grey?: boolean;
  /** Pixel frame of the calibration below (the largest level's size). */
  size: readonly [number, number];
  /** earth: terrestrial longitude/latitude; sky: J2000 ecliptic longitude/latitude. */
  frame: "earth" | "sky";
  /** knots: radius piecewise linear in polar distance through `knots` (deg); stereographic: radius[2]·tan(ζ/2). */
  law: "knots" | "stereographic";
  knots: readonly [number, number, number];
  /** Picture longitude minus true longitude (earth frame). */
  lonOffset: number;
  north: GlobeDisc;
  south: GlobeDisc;
};

/**
 * Globe pictures, calibrated from the prints themselves (README).
 * Monte: one north-polar equidistant disc out to the South Pole, the polar
 * plate's own projection. Pole and scale fitted to its equator and Capricorn
 * circles (1° = 22.68 px); longitude registered on Italy (Corsica, Sicily),
 * so the map's long Mediterranean puts Iberia west and the Levant east.
 * Dürer: polar stereographic about the ecliptic poles, fitted to bright
 * stars (Vega, Arcturus, Capella, Deneb, Altair, Polaris; Sirius, Rigel,
 * Betelgeuse, Canopus, Procyon, Alphard, Diphda) to 16 / 20 px rms.
 */
const GLOBES = {
  monte: {
    src: "/astrolabe/monte-1587.webp",
    fineSrc: "/astrolabe/monte-1587-fine.webp",
    grey: true,
    size: [8192, 8192],
    frame: "earth",
    law: "knots",
    knots: [60, 120, 180],
    lonOffset: 0,
    north: { centre: [4096, 4096], turn: 66.1, direction: -1, radius: [1360.85, 2721.7, 4082.54], zetaMax: 180 },
    // A single disc: the south one is never used.
    south: { centre: [4096, 4096], turn: 0, direction: 1, radius: [1, 1, 1], zetaMax: -1 },
  },
  durer: {
    src: "/astrolabe/durer-1515.webp",
    size: [4909, 2866],
    frame: "sky",
    law: "stereographic",
    knots: [0, 0, 90],
    lonOffset: 0,
    north: { centre: [1241.55, 1591.65], turn: 315.78, direction: -1, radius: [0, 0, 1064.7], zetaMax: 110.8 },
    south: { centre: [3824.33, 1084.95], turn: -144.62, direction: 1, radius: [0, 0, 1094.03], zetaMax: 90 },
  },
} as const satisfies Record<string, GlobePicture>;

export type CityPicture = keyof typeof PANORAMAS | keyof typeof GLOBES;
export type CityMode = "one" | "three";
export type Rgb = readonly [number, number, number];
export type AstrolabeCityLayer = {
  picture: CityPicture;
  observers?: ObserverPosition[];
  observerFrame?: (frame: ObserverFrame) => void;
  /** A panorama drawn in place of `picture` (design-lab previews of candidate prints). */
  panorama?: CityPanorama;
  mode: CityMode;
  fg: Rgb;
  bg: Rgb;
  /** Foreground share of the middle level (three-level mode), 0..1. */
  mix: number;
  /** How strongly the picture stands over the plate's ground, 0..1 (1 = full). */
  strength?: number;
  /** Repaint the plate once a picture has loaded. Export has none and paints what is loaded. */
  requestRepaint?: () => void;
};
/** The chart frame the pictures are placed in: place, rete and moment.
 * `lat` is the plate's own latitude: a southern stereographic plate is drawn
 * for |lat| with the sky reflected (`pole` -1). */
export type CityFrame = {
  lat: number; lon: number; eramc: number; obliquity: number; jd?: number;
  pole?: 1 | -1;
};

/** Woodcut tone (0 ink .. 1 paper) below which a pixel is ink / middle. */
const ONE_BIT_INK = 0.55;
const THREE_INK = 0.3;
const THREE_MID = 0.72;
/** Zoom from which a picture's full-resolution version is drawn. */
const FINE_FROM_ZOOM = 1.5;

/**
 * Plate point to the sky, shared by the plate shaders (this picture and the
 * physical sky, astrolabe-sky.ts). Both plates put hour angle H at
 * atan2(x, −y), so h = (x, −y)·k = cos dec·(sin H, cos H) with k = cos dec / r.
 */
export const PLATE_INVERSE_GLSL = `
const float HALF_PI = ${Math.PI / 2};
// Plate point (plate units, +y down) -> (cos dec sin H, cos dec cos H, sin dec).
vec3 plateSphere(vec2 p, bool polarPlate) {
  float r2 = dot(p, p);
  float sinDec;
  float k;
  if (polarPlate) {
    // Polar equidistant: r = (90° - dec) / 90°.
    float r = sqrt(r2);
    float zeta = r * HALF_PI;
    sinDec = cos(zeta);
    k = r > 0.0 ? sin(zeta) / r : HALF_PI;
  } else {
    // Stereographic: r = tan((90° - dec) / 2).
    float q = 1.0 / (1.0 + r2);
    sinDec = (1.0 - r2) * q;
    k = 2.0 * q;
  }
  return vec3(vec2(p.x, -p.y) * k, sinDec);
}
// The same direction in the horizon frame (east, north, up), for the
// latitude's (sin, cos): bearing atan(east, north), altitude asin(up).
vec3 horizonVector(vec3 e, vec2 lat) {
  return vec3(-e.x, e.z * lat.y - e.y * lat.x, lat.x * e.z + lat.y * e.y);
}
`;

/** One triangle over the viewport. */
const VERTEX_SHADER = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID & 1) << 2), float((gl_VertexID & 2) << 1));
  gl_Position = vec4(p - 1.0, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform sampler2D picture;
uniform bool observers;
uniform vec2 observerPositions[3];
const float observerHeights[3] = float[3](${OBSERVER_HEIGHTS.map(value => value.toFixed(3)).join(",")});
const float observerAnchors[3] = float[3](${OBSERVER_ANCHORS.join(",")});
uniform vec2 centre;   // plate centre, device px from the drawing buffer's bottom left
uniform float unit;    // plate units per device px
uniform bool polar;    // polar azimuthal equidistant plate, else stereographic
uniform float rEdge2;  // plate edge radius squared, plate units
uniform vec2 lat;      // sin, cos of the chart latitude
uniform vec2 levels;   // tone below which a pixel is ink, middle
uniform vec3 ink;
uniform vec3 middle;
uniform vec3 paper;
uniform vec3 panorama;     // horizon panorama: fov, depth (deg), horizon line (fraction of height)
uniform bool globe;        // two hemisphere discs, else the horizon panorama
uniform vec2 printed;      // panorama's fully printed width (fractions); mirrored beyond
uniform bool groundBeyond; // beyond it, only the mirrored ground below the horizon
uniform bool paperClear;   // paper level left transparent
uniform bool holes;        // output the panorama's empty ground (below the horizon, not drawn) instead
uniform mat3 toPicture;    // plate (cos dec sin H, cos dec cos H, sin dec) -> picture sphere
uniform vec2 pictureSize;  // texture px
uniform bool stereoDiscs;  // radius = R90 tan(zeta / 2), else piecewise through knots
uniform vec3 knots;        // polar distances (deg) of the radii below
uniform vec3 northRadius;
uniform vec3 southRadius;
uniform vec2 northCentre;
uniform vec2 southCentre;
uniform mat2 northTurn;    // picture longitude direction -> disc direction
uniform mat2 southTurn;
uniform vec2 zetaMax;      // north, south polar distance limits (deg)
out vec4 colour;
${PLATE_INVERSE_GLSL}
float discRadius(float zeta, vec3 radius) {
  if (stereoDiscs) return radius.z * tan(radians(zeta) * 0.5);
  if (zeta < knots.x) return radius.x * zeta / knots.x;
  if (zeta < knots.y) return mix(radius.x, radius.y, (zeta - knots.x) / (knots.y - knots.x));
  return mix(radius.y, radius.z, (zeta - knots.y) / (knots.z - knots.y));
}
vec2 discPoint(float zeta, vec2 lonDir, vec2 discCentre, mat2 turn, vec3 radius, float limit) {
  return (discCentre + discRadius(min(zeta, limit), radius) * (turn * lonDir)) / pictureSize;
}
// Tone of a disc texel, or 2.0 where the disc's picture does not reach.
// Gradients are per disc, so the switch between discs does not blur.
float discTone(vec2 st, float zeta, float limit) {
  vec4 texel = textureGrad(picture, st, dFdx(st), dFdy(st));
  return zeta <= limit && texel.a >= 0.5 ? 1.0 - texel.a + texel.r : 2.0;
}
void main() {
  // Plate point of this pixel's centre (+y down).
  vec2 p = vec2(gl_FragCoord.x - centre.x, centre.y - gl_FragCoord.y) * unit;
  // Back to the sky (PLATE_INVERSE_GLSL), then altitude and bearing
  // (azimuth from north) for the panorama.
  float r2 = dot(p, p);
  vec3 e = plateSphere(p, polar);
  if (observers) {
    vec3 ray = horizonVector(e, lat);
    vec4 result = vec4(0.0);
    float nearest = 1e20;
    for (int i = 0; i < 3; i++) {
      vec2 pos = observerPositions[i];
      float distance = length(pos);
      vec2 normal = pos / distance;
      float facing = dot(ray.xy, normal);
      float travel = distance / max(facing, 0.00001);
      float h = observerHeights[i];
      float across = dot(ray.xy, vec2(normal.y, -normal.x)) * travel;
      float up = 1.6 + ray.z * travel;
      vec2 local = vec2(observerAnchors[i] + across / h, ${OBSERVER_FOOT} - up / h);
      vec2 st = vec2((float(i) + local.x) / 3.0, local.y);
      vec4 texel = texture(picture, st);
      if (facing > 0.0 && all(greaterThanEqual(local, vec2(0.0))) && all(lessThanEqual(local, vec2(1.0))) && texel.a > 0.1 && travel < nearest) {
        nearest = travel;
        // Each mip stores premultiplied coverage of the shared tone bands.
        // Color after filtering: fine hatching survives at any distance.
        vec3 rgb = texel.r * ink + texel.g * middle + texel.b * paper;
        result = vec4(rgb, texel.a);
      }
    }
    colour = r2 <= rEdge2 ? result : vec4(0.0);
    return;
  }
  vec2 h = e.xy;
  float sinDec = e.z;
  float tone;
  bool drawn;
  bool below = false;
  if (globe) {
    // Picture sphere point: polar distance from the north disc's pole and
    // the direction of its longitude.
    vec3 v = toPicture * vec3(h, sinDec);
    float rho = length(v.xy);
    float zeta = degrees(atan(rho, v.z));
    vec2 lonDir = rho > 0.0 ? v.xy / rho : vec2(1.0, 0.0);
    vec2 stN = discPoint(zeta, lonDir, northCentre, northTurn, northRadius, zetaMax.x);
    vec2 stS = discPoint(180.0 - zeta, lonDir, southCentre, southTurn, southRadius, zetaMax.y);
    // Where both discs reach (a chart's figures beyond its rim), ink wins.
    tone = min(discTone(stN, zeta, zetaMax.x), discTone(stS, 180.0 - zeta, zetaMax.y));
    drawn = tone <= 1.0;
  } else {
    vec3 v = horizonVector(e, lat);
    float alt = asin(clamp(v.z, -1.0, 1.0));
    below = alt < 0.0;
    float bearing = atan(v.x, v.y);
    float horizon = panorama.z;
    vec2 st = vec2(0.5 - degrees(bearing) / panorama.x, horizon - degrees(alt) * (1.0 - horizon) / panorama.y);
    // Beyond its fully printed width the print runs on as its own mirror
    // image, so its skyline and texture are unbroken; the two mirrored ends
    // meet due south. A city (groundBeyond) keeps only the mirrored ground
    // there, up to the horizon. Gradients come from the bearing, unwrapped
    // across south.
    float span = 360.0 / panorama.x;
    vec2 dx = dFdx(st), dy = dFdy(st);
    if (abs(dx.x) > 0.5 * span) dx.x -= sign(dx.x) * span;
    if (abs(dy.x) > 0.5 * span) dy.x -= sign(dy.x) * span;
    float u = (st.x - printed.x) / (printed.y - printed.x);
    vec2 folded = vec2(printed.x + (1.0 - abs(mod(u, 2.0) - 1.0)) * (printed.y - printed.x), st.y);
    // Premultiplied texel: rgb = tone * city, a = city; sky reads as paper.
    vec4 texel = textureGrad(picture, folded, dx, dy);
    tone = 1.0 - texel.a + texel.r;
    bool beyond = st.x < printed.x || st.x > printed.y;
    drawn = (beyond && groundBeyond ? alt < 0.0 : texel.a >= 0.5) && st.y >= 0.0 && st.y <= 1.0;
    // Ground below the print's bottom edge is paper, so the plate's whole
    // ground is covered.
    if (st.y > 1.0 && alt < 0.0) {
      tone = 1.0;
      drawn = true;
    }
  }
  if (holes) {
    colour = r2 <= rEdge2 && below && !drawn ? vec4(1.0) : vec4(0.0);
    return;
  }
  bool shown = r2 <= rEdge2 && drawn && (tone < levels.y || !paperClear);
  colour = shown ? vec4(tone < levels.x ? ink : tone < levels.y ? middle : paper, 1.0) : vec4(0.0);
}`;

const UNIFORMS = [
  "observers", "observerPositions[0]", "centre", "unit", "polar", "rEdge2", "lat", "levels", "ink", "middle", "paper", "panorama",
  "globe", "printed", "groundBeyond", "paperClear", "holes", "toPicture", "pictureSize", "stereoDiscs", "knots", "northRadius", "southRadius",
  "northCentre", "southCentre", "northTurn", "southTurn", "zetaMax",
] as const;
type CityGl = {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  uniforms: Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>;
  /** Uploaded pictures and pending loads, by source. */
  textures: Map<string, WebGLTexture>;
  loads: Map<string, Promise<void>>;
  /** Picture sources (base and fine) of the latest plates drawn, newest first. */
  recent: string[][];
};

/** Pictures kept uploaded: a poster's two plates (a stereographic city and a
 * polar globe) each keep theirs instead of re-decoding both every paint. */
const KEPT_PICTURES = 2;

/** undefined = not set up yet (or the context was lost), null = no WebGL2. */
let city: CityGl | null | undefined;
/** The latest plate's repaint, run when a picture finishes loading. */
let repaintOnLoad: (() => void) | undefined;

function compileProgram(gl: WebGL2RenderingContext): WebGLProgram | null {
  const program = gl.createProgram();
  const shaders = ([[gl.VERTEX_SHADER, VERTEX_SHADER], [gl.FRAGMENT_SHADER, FRAGMENT_SHADER]] as const).map(([type, source]) => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
    return shader;
  });
  gl.linkProgram(program);
  if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program;
  console.error("[astrolabe-city]", gl.getProgramInfoLog(program), ...shaders.map((shader) => gl.getShaderInfoLog(shader)));
  return null;
}

function cityGl(): CityGl | null {
  if (city !== undefined) return city;
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: true,
  });
  const program = gl && compileProgram(gl);
  if (!gl || !program) {
    if (!gl) console.warn("[astrolabe-city] WebGL2 is unavailable; the city is not drawn.");
    city = null;
    return city;
  }
  gl.useProgram(program);
  const uniforms = Object.fromEntries(UNIFORMS.map((name) => [name, gl.getUniformLocation(program, name)])) as CityGl["uniforms"];
  // A lost context is dropped whole; the next paint sets up and uploads again.
  canvas.addEventListener("webglcontextlost", () => {
    if (city?.canvas === canvas) city = undefined;
  });
  city = { canvas, gl, uniforms, textures: new Map(), loads: new Map(), recent: [] };
  return city;
}

/** The picture's texture, or null while it loads (the load starts on first ask). */
function pictureTexture(c: CityGl, src: string, grey = false): WebGLTexture | null {
  const texture = c.textures.get(src);
  if (texture) return texture;
  if (!c.loads.has(src)) {
    c.loads.set(src, (async () => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const { gl } = c;
      if (gl.isContextLost()) return;
      if (Math.max(img.naturalWidth, img.naturalHeight) > gl.getParameter(gl.MAX_TEXTURE_SIZE)) {
        throw new Error(`${img.src} exceeds the GPU texture size`);
      }
      const next = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, next);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, !grey);
      if (grey) gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, img);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      c.textures.set(src, next);
      repaintOnLoad?.();
    })().catch((err) => console.error("[astrolabe-city]", src, err)));
  }
  return null;
}

/** Mark `sources` as the latest picture drawn and free the uploads of pictures
 * older than the last KEPT_PICTURES; loads still in flight finish and are freed later. */
function releaseOtherPictures(c: CityGl, sources: string[]) {
  if (sources[0].includes("/munster-observers-")) return;
  c.recent = [sources, ...c.recent.filter((one) => one[0] !== sources[0])].slice(0, KEPT_PICTURES);
  const keep = [...c.recent.flat(), "/astrolabe/munster-observers-three-coverage.png", "/astrolabe/munster-observers-one-coverage.png"];
  for (const [src, texture] of c.textures) {
    if (keep.includes(src)) continue;
    c.gl.deleteTexture(texture);
    c.textures.delete(src);
    c.loads.delete(src);
  }
}

let probe: CanvasRenderingContext2D | null = null;

/** A CSS colour (any syntax the canvas parses) as sRGB bytes, or null. */
export function cssColorRgb(value: string): Rgb | null {
  if (!value) return null;
  probe ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!probe) return null;
  probe.canvas.width = probe.canvas.height = 1;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = "#000";
  probe.fillStyle = value;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
  return a === 0 ? null : [r, g, b];
}

/** A token's colour as resolved on `host` (var() chains substituted). */
export function tokenRgb(host: HTMLElement, token: string): Rgb | null {
  return cssColorRgb(getComputedStyle(host).getPropertyValue(token).trim());
}

export function mixOklab(fg: Rgb, bg: Rgb, fgShare: number): Rgb {
  const a = new Color("srgb", fg.map((v) => v / 255) as [number, number, number]).to("oklab").coords;
  const b = new Color("srgb", bg.map((v) => v / 255) as [number, number, number]).to("oklab").coords;
  const t = Math.min(1, Math.max(0, fgShare));
  const mixed = new Color("oklab", [0, 1, 2].map((i) => (b[i] ?? 0) + ((a[i] ?? 0) - (b[i] ?? 0)) * t) as [number, number, number])
    .to("srgb").toGamut().coords;
  return mixed.map((v) => Math.round(Math.min(1, Math.max(0, v ?? 0)) * 255)) as unknown as Rgb;
}

const D = Math.PI / 180;
type Mat3 = readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]];

function mul3(a: Mat3, b: Mat3): Mat3 {
  const row = (i: number) => [0, 1, 2].map((j) => a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j]) as [number, number, number];
  return [row(0), row(1), row(2)];
}

/** General precession in longitude since J2000 (IAU 2006 p_A), degrees. */
function precessionSinceJ2000(jd: number | undefined): number {
  if (jd === undefined) return 0;
  const T = (jd - 2451545.0) / 36525;
  return (5028.796195 * T + 1.1054348 * T * T) / 3600;
}

/**
 * Plate vector (cos dec sin H, cos dec cos H, sin dec) to the globe picture's
 * sphere (x toward its longitude 0, z toward its north pole), column-major.
 * Picture longitude is A − H: A is the place's longitude (each place under
 * its own zenith) or the rete's RAMC (right ascension), then the star chart
 * turns to the ecliptic of date and back by precession to J2000. A southern
 * plate's declinations are reflected (`pole` -1), so its z column flips.
 */
function globeMatrix(picture: GlobePicture, frame: CityFrame): Float32Array {
  const a = (picture.frame === "earth" ? frame.lon + picture.lonOffset : frame.eramc) * D;
  let m: Mat3 = [[Math.sin(a), Math.cos(a), 0], [-Math.cos(a), Math.sin(a), 0], [0, 0, 1]];
  if (picture.frame === "sky") {
    const e = frame.obliquity * D;
    const p = precessionSinceJ2000(frame.jd) * D;
    m = mul3([[1, 0, 0], [0, Math.cos(e), Math.sin(e)], [0, -Math.sin(e), Math.cos(e)]], m);
    m = mul3([[Math.cos(p), Math.sin(p), 0], [-Math.sin(p), Math.cos(p), 0], [0, 0, 1]], m);
  }
  const z = frame.pole ?? 1;
  return Float32Array.from([m[0][0], m[1][0], m[2][0], m[0][1], m[1][1], m[2][1], z * m[0][2], z * m[1][2], z * m[2][2]]);
}

/** Disc angle = turn + direction · longitude, as a column-major mat2 on (cos lon, sin lon). */
function discTurn(disc: GlobeDisc): Float32Array {
  const c = Math.cos(disc.turn * D);
  const s = Math.sin(disc.turn * D);
  return Float32Array.from([c, s, -disc.direction * s, disc.direction * c]);
}

/**
 * The plate disc in device px, as the 2D context maps CSS px: its centre and
 * the on-canvas part of its bounding box, or null when none of it is on the
 * canvas.
 */
function layerPicture(layer: AstrolabeCityLayer) {
  if (layer.observers) return {
    panorama: null, globe: null, src: `/astrolabe/munster-observers-${layer.mode}-coverage.png`, fineSrc: undefined, grey: false,
  };
  const panorama: CityPanorama | null = layer.panorama
    ?? (layer.picture in PANORAMAS ? PANORAMAS[layer.picture as keyof typeof PANORAMAS] : null);
  const globe: GlobePicture | null = panorama ? null : GLOBES[layer.picture as keyof typeof GLOBES];
  const { src, fineSrc } = panorama ?? globe!;
  return { panorama, globe, src, fineSrc, grey: globe?.grey ?? false };
}

/** Upload the layer's picture and its full-resolution version, for an export
 * that must paint them on its first pass. Resolves without them when the GPU
 * cannot draw the pictures. */
export async function loadAstrolabeCityPictures(layer: AstrolabeCityLayer): Promise<void> {
  const c = cityGl();
  if (!c) return;
  const { src, fineSrc, grey } = layerPicture(layer);
  for (const source of fineSrc ? [src, fineSrc] : [src]) {
    pictureTexture(c, source, grey);
    await c.loads.get(source);
  }
}

export function plateDeviceBox(ctx: CanvasRenderingContext2D, layout: Layout, rEdge: number) {
  const m = ctx.getTransform();
  const ox = m.a * layout.cx + m.e;
  const oy = m.d * layout.cy + m.f;
  const radius = rEdge * layout.scale * m.a;
  const { width, height } = ctx.canvas;
  const x0 = Math.max(0, Math.floor(ox - radius));
  const y0 = Math.max(0, Math.floor(oy - radius));
  const x1 = Math.min(width, Math.ceil(ox + radius));
  const y1 = Math.min(height, Math.ceil(oy + radius));
  return x1 > x0 && y1 > y0 ? { ox, oy, x0, y0, x1, y1 } : null;
}

/**
 * Paint the picture onto the plate, between the atmospheric fill and the
 * lattice: one quantized colour per device pixel inside the plate edge (the
 * Capricorn circle, or the polar plate's rim), at the current zoom and pan.
 * `rEdge` is that edge in plate units and `fittedRadiusPx` the unzoomed
 * plate's edge radius in CSS px. Synchronous; draws nothing until the picture
 * is up. `output` "holes" instead erases, from what `ctx` holds, a panorama's
 * empty ground: below the horizon, where its cut-out is sky (the earth in
 * front stays open there).
 */
export function paintAstrolabeCity(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  projection: AstrolabeProjection,
  frame: CityFrame,
  rEdge: number,
  fittedRadiusPx: number,
  layer: AstrolabeCityLayer,
  output: "picture" | "holes" = "picture",
) {
  const c = cityGl();
  if (!c) return;
  if (layer.requestRepaint) repaintOnLoad = layer.requestRepaint;
  const { panorama, globe, src, fineSrc, grey } = layerPicture(layer);
  releaseOtherPictures(c, fineSrc ? [src, fineSrc] : [src]);
  const base = pictureTexture(c, src, grey);
  const fine = base && fineSrc ? pictureTexture(c, fineSrc, grey) : null;
  const m = ctx.getTransform();
  // Zoom, or device pixels beyond a Retina (2x) screen's, as on a print.
  const magnification = Math.max(1, m.a / 2) * (layout.scale * rEdge) / fittedRadiusPx;
  const texture = fine && magnification >= FINE_FROM_ZOOM ? fine : base;
  if (!texture) return;

  const { canvas, gl, uniforms } = c;
  const { width, height } = ctx.canvas;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  if (gl.drawingBufferWidth !== width || gl.drawingBufferHeight !== height) return;
  const plate = plateDeviceBox(ctx, layout, rEdge);
  if (!plate) return;
  const { ox, oy, x0, y0, x1, y1 } = plate;

  gl.uniform1i(uniforms.observers, layer.observers ? 1 : 0);
  if (layer.observers) {
    gl.uniform2fv(uniforms["observerPositions[0]"], layer.observers.flat());
    layer.observerFrame?.({ layout, projection, lat: frame.lat, edge: rEdge });
  }
  const one = layer.mode === "one";
  const middle = one ? layer.fg : mixOklab(layer.fg, layer.bg, layer.mix);
  gl.viewport(x0, height - y1, x1 - x0, y1 - y0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.uniform2f(uniforms.centre, ox, height - oy);
  gl.uniform1f(uniforms.unit, 1 / (layout.scale * m.a));
  gl.uniform1i(uniforms.polar, projection === "polarEquidistant" ? 1 : 0);
  gl.uniform1f(uniforms.rEdge2, rEdge * rEdge);
  gl.uniform2f(uniforms.lat, Math.sin(frame.lat * D), Math.cos(frame.lat * D));
  gl.uniform2f(uniforms.levels, one ? ONE_BIT_INK : THREE_INK, one ? ONE_BIT_INK : THREE_MID);
  gl.uniform3f(uniforms.ink, layer.fg[0] / 255, layer.fg[1] / 255, layer.fg[2] / 255);
  gl.uniform3f(uniforms.middle, middle[0] / 255, middle[1] / 255, middle[2] / 255);
  gl.uniform3f(uniforms.paper, layer.bg[0] / 255, layer.bg[1] / 255, layer.bg[2] / 255);
  gl.uniform1i(uniforms.globe, globe ? 1 : 0);
  // The globe pictures cover the whole sphere: their paper stays clear so the
  // plate's sky and ground show through.
  gl.uniform1i(uniforms.paperClear, globe ? 1 : 0);
  gl.uniform1i(uniforms.holes, output === "holes" ? 1 : 0);
  if (panorama) gl.uniform3f(uniforms.panorama, panorama.fov, panorama.depth, panorama.horizon);
  if (panorama) gl.uniform2f(uniforms.printed, ...(panorama.printed ?? [0, 1]));
  gl.uniform1i(uniforms.groundBeyond, panorama?.groundBeyond ? 1 : 0);
  if (globe) {
    gl.uniformMatrix3fv(uniforms.toPicture, false, globeMatrix(globe, frame));
    gl.uniform2f(uniforms.pictureSize, globe.size[0], globe.size[1]);
    gl.uniform1i(uniforms.stereoDiscs, globe.law === "stereographic" ? 1 : 0);
    gl.uniform3f(uniforms.knots, ...globe.knots);
    gl.uniform3f(uniforms.northRadius, ...globe.north.radius);
    gl.uniform3f(uniforms.southRadius, ...globe.south.radius);
    gl.uniform2f(uniforms.northCentre, ...globe.north.centre);
    gl.uniform2f(uniforms.southCentre, ...globe.south.centre);
    gl.uniformMatrix2fv(uniforms.northTurn, false, discTurn(globe.north));
    gl.uniformMatrix2fv(uniforms.southTurn, false, discTurn(globe.south));
    gl.uniform2f(uniforms.zetaMax, globe.north.zetaMax, globe.south.zetaMax);
  }
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  if (output === "holes") {
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "destination-out";
  } else {
    // Foreground people are solid cutouts. Background strength and any
    // caller's decorative fade must not make the landscape show through them.
    ctx.globalAlpha = layer.observers ? 1 : ctx.globalAlpha * (layer.strength ?? 1);
  }
  ctx.drawImage(canvas, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
  ctx.restore();
}
