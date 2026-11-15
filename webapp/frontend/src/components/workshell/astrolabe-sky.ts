// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Physical sky on the atmospheric astrolabe plate, stereographic or polar
 * azimuthal equidistant: the sunrise and sunset glow, the bright aureole round
 * the Sun, the Earth's shadow with the Belt of Venus opposite it, and twilight
 * fading to night, over a dark plain below the horizon. Atkinson-dithered in
 * the sky's own colours (astrolabe-sky-dither.ts, on the GPU through
 * astrolabe-sky-gpu.ts where WebGPU allows), Horizon Aura's preset 2
 * look, and laid as grit over
 * the daemon's flat sky colour at `strength`, so the plate keeps the flat
 * colour's light tint in bright themes.
 *
 * The sky is Hillaire's (2020): Rayleigh, Mie and ozone scattering in a
 * spherical atmosphere (km), single scattering ray-marched into lookup
 * textures plus a multiple-scattering term. Transmittance and multiple
 * scattering are rebuilt only when haze or ozone change; the sky-view texture
 * when the Sun's altitude changes. The shaders are the horizon-aura
 * prototype's; the plate is
 * geometric, so the Sun disc sits at the true Sun with no refraction lift.
 *
 * Every plate pixel is taken back to the sky with the city's inverse
 * projection (PLATE_INVERSE_GLSL). Exposure metering and lens diffusion come
 * from a fixed plate-space image. The sky is then a picture of the whole
 * plate, like the woodcut city: one dithered dot per CSS px of the unzoomed
 * plate, near the city's grain, magnified with the plate under zoom and pan,
 * so those only redraw it. With the tune's `finerZoom` switch, from
 * FINE_FROM_ZOOM on, as the city switches to its fine picture, a second
 * picture with twice the dots across is drawn, and with the GPU dither one
 * with four times the dots from FINEST_FROM_ZOOM, each dithered on the first
 * one's palette, so a dot stays 0.75..1.5 CSS px up to 6x. A new Sun position
 * or look shades and dithers only the picture shown. The daemon ships the
 * directed Sun's true altitude and azimuth; nothing about the Sun is computed
 * here.
 *
 * With the switch and WebGPU up, the on-screen pictures, the 1x one too, are
 * shaded (astrolabe-sky-wgsl.ts), dithered and copied for display on the GPU
 * (astrolabe-sky-gpu.ts), asynchronously and one at a time. A frame whose
 * plate, Sun or look has no picture yet is not painted: `prepareAstrolabeSky`
 * says "wait", the plate keeps its previous coherent frame, sky and rete
 * together, and the frame is painted once its picture is made. A frame whose
 * picture differs only in dots across draws the nearest one meanwhile. Exports,
 * a frame that cannot keep its predecessor, and plates without WebGPU shade
 * with WebGL and dither on the CPU, synchronously.
 *
 * Needs WebGL2 and EXT_color_buffer_float (or WebGPU); without them the sky
 * paints nothing and the plate keeps the daemon's flat sky colour.
 */

import type { AstrolabeProjection } from "@/lib/daemon/client";
import type { Layout } from "./astrolabe-canvas";
import { PLATE_INVERSE_GLSL, plateDeviceBox, type CityFrame } from "./astrolabe-city";
import { ditherPlatePicture, platePalette } from "./astrolabe-sky-dither";
import { ditherPictureOnGpu, dropGpuSky, gpuSkyReady, makeSkyPicture, type SkyShading } from "./astrolabe-sky-gpu";

import {
  BETA, BLOOM_FALLOFF, BLOOM_LEVELS, CAM_C, PLATE_PX, VIEW_R,
  skyPictureSizes, skyShading, type AstrolabeSkyLayer, type SkyTiers, type Tier,
} from "./astrolabe-sky-model";

export { ASTROLABE_SKY_DEFAULT, astrolabeSkyLayer, skyPictureSizes } from "./astrolabe-sky-model";
export type { AstrolabeSkyLayer, AstrolabeSkyTune, SkyTiers } from "./astrolabe-sky-model";

// ---------------------------------------------------------------------------
// Shaders (z is up; km). COMMON, MEDIUM, TRANS, MULTI, SKY, skyUv, DOWN and UP
// are the prototype's; the plate's scene and composite replace its camera.
// ---------------------------------------------------------------------------

const COMMON = `
const float PI = 3.14159265358979;
const float RG = 6360.0;
const float RT = 6460.0;
const vec2 T_SIZE = vec2(256.0, 64.0);
const float MS_SIZE = 32.0;
const vec2 SV_SIZE = vec2(192.0, 108.0);
const float SUN_E = 1000.0;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

uniform highp sampler2D uTrans;

float toSub(float x, float n) { return 0.5 / n + x * (1.0 - 1.0 / n); }
float fromSub(float u, float n) { return (u - 0.5 / n) / (1.0 - 1.0 / n); }

// Nearest positive hit of a ray (origin relative to the planet centre) with a sphere; -1 if none.
float raySphere(vec3 ro, vec3 rd, float R) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - R * R;
  float d = b * b - c;
  if (d < 0.0) return -1.0;
  float s = sqrt(d);
  if (-b - s > 0.0) return -b - s;
  if (-b + s > 0.0) return -b + s;
  return -1.0;
}

// Bruneton's parametrisation of transmittance to the top of the atmosphere.
vec2 transmittanceUv(float r, float mu) {
  float H = sqrt(RT * RT - RG * RG);
  float rho = sqrt(max(0.0, r * r - RG * RG));
  float disc = r * r * (mu * mu - 1.0) + RT * RT;
  float d = max(0.0, -r * mu + sqrt(max(disc, 0.0)));
  float dMin = RT - r;
  float dMax = rho + H;
  float xMu = clamp((d - dMin) / (dMax - dMin), 0.0, 1.0);
  return vec2(toSub(xMu, T_SIZE.x), toSub(rho / H, T_SIZE.y));
}

vec3 transmittance(float r, float mu) {
  return texture(uTrans, transmittanceUv(r, mu)).rgb;
}
`;

const MEDIUM = `
uniform float uHaze;
uniform float uOzone;

struct Medium { vec3 scatR; vec3 scatM; vec3 ext; };

Medium medium(float h) {
  float dR = exp(-h / 8.0);
  float dM = exp(-h / 1.2) * uHaze;
  float dO = max(0.0, 1.0 - abs(h - 25.0) / 15.0) * uOzone;
  Medium m;
  m.scatR = vec3(5.802e-3, 13.558e-3, 33.1e-3) * dR;
  m.scatM = vec3(3.996e-3 * dM);
  m.ext = m.scatR + vec3(4.44e-3 * dM) + vec3(0.650e-3, 1.881e-3, 0.085e-3) * dO;
  return m;
}

float rayleighPhase(float c) {
  return 3.0 / (16.0 * PI) * (1.0 + c * c);
}

// Cornette-Shanks: the forward peak is the bright aureole around the sun.
float miePhase(float c) {
  const float g = 0.8;
  float k = 3.0 / (8.0 * PI) * (1.0 - g * g) / (2.0 + g * g);
  return k * (1.0 + c * c) / pow(1.0 + g * g - 2.0 * g * c, 1.5);
}

float earthShadow(vec3 p, vec3 l) {
  float b = dot(p, l);
  float c = dot(p, p) - RG * RG;
  return (b < 0.0 && b * b - c > 0.0) ? 0.0 : 1.0;
}
`;

const TRANS = `
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / T_SIZE;
  float xMu = clamp(fromSub(uv.x, T_SIZE.x), 0.0, 1.0);
  float xR = clamp(fromSub(uv.y, T_SIZE.y), 0.0, 1.0);
  float H = sqrt(RT * RT - RG * RG);
  float rho = H * xR;
  float r = sqrt(rho * rho + RG * RG);
  float dMin = RT - r;
  float dMax = rho + H;
  float d = dMin + xMu * (dMax - dMin);
  float mu = d == 0.0 ? 1.0 : clamp((H * H - rho * rho - d * d) / (2.0 * r * d), -1.0, 1.0);
  vec3 ro = vec3(0.0, 0.0, r);
  vec3 rd = vec3(sqrt(max(0.0, 1.0 - mu * mu)), 0.0, mu);
  float dt = max(raySphere(ro, rd, RT), 0.0) / 40.0;
  vec3 depth = vec3(0.0);
  for (int i = 0; i < 40; i++) {
    vec3 p = ro + rd * ((float(i) + 0.5) * dt);
    depth += medium(length(p) - RG).ext * dt;
  }
  outColor = vec4(exp(-depth), 1.0);
}
`;

// Hillaire's multiple-scattering LUT: second-order light from a uniform sphere, summed as a geometric series.
const MULTI = `
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / MS_SIZE;
  float sunMu = clamp(fromSub(uv.x, MS_SIZE), 0.0, 1.0) * 2.0 - 1.0;
  float r = clamp(RG + clamp(fromSub(uv.y, MS_SIZE), 0.0, 1.0) * (RT - RG), RG + 0.01, RT - 0.01);
  vec3 ro = vec3(0.0, 0.0, r);
  vec3 l = vec3(sqrt(max(0.0, 1.0 - sunMu * sunMu)), 0.0, sunMu);
  vec3 L2 = vec3(0.0);
  vec3 fms = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    for (int j = 0; j < 8; j++) {
      float th = 2.0 * PI * (float(i) + 0.5) / 8.0;
      float ph = acos(1.0 - 2.0 * (float(j) + 0.5) / 8.0);
      vec3 rd = vec3(cos(th) * sin(ph), sin(th) * sin(ph), cos(ph));
      float tG = raySphere(ro, rd, RG);
      float tMax = tG > 0.0 ? tG : max(raySphere(ro, rd, RT), 0.0);
      float dt = tMax / 20.0;
      vec3 thr = vec3(1.0);
      vec3 L = vec3(0.0);
      vec3 F = vec3(0.0);
      for (int k = 0; k < 20; k++) {
        vec3 p = ro + rd * ((float(k) + 0.5) * dt);
        float pr = length(p);
        Medium m = medium(pr - RG);
        vec3 scat = m.scatR + m.scatM;
        vec3 ext = max(m.ext, vec3(1e-7));
        vec3 stepT = exp(-m.ext * dt);
        vec3 S = transmittance(pr, dot(p / pr, l)) * earthShadow(p, l) * scat / (4.0 * PI);
        L += thr * (S - S * stepT) / ext;
        F += thr * (scat - scat * stepT) / ext;
        thr *= stepT;
      }
      if (tG > 0.0) {
        vec3 p = ro + rd * tG;
        float mu = dot(normalize(p), l);
        L += thr * transmittance(RG, mu) * max(mu, 0.0) * 0.3 / PI;
      }
      L2 += L;
      fms += F;
    }
  }
  L2 /= 64.0;
  fms /= 64.0;
  outColor = vec4(L2 / (1.0 - fms), 1.0);
}
`;

// Sky-view LUT: radiance seen from the observer, indexed by zenith angle (dense near the horizon) and azimuth from the sun.
const SKY = `
uniform highp sampler2D uMS;
uniform float uViewR;
uniform float uBeta;
uniform float uCamC;
uniform float uSunMu;
out vec4 outColor;

vec3 multiScatter(float r, float mu) {
  vec2 uv = vec2(toSub(mu * 0.5 + 0.5, MS_SIZE), toSub(clamp((r - RG) / (RT - RG), 0.0, 1.0), MS_SIZE));
  return texture(uMS, uv).rgb;
}

void main() {
  vec2 uv = gl_FragCoord.xy / SV_SIZE;
  float x = fromSub(uv.x, SV_SIZE.x);
  float y = fromSub(uv.y, SV_SIZE.y);
  float zh = PI - uBeta;
  float viewMu;
  if (y < 0.5) {
    float c = 1.0 - 2.0 * y;
    viewMu = cos(zh * (1.0 - c * c));
  } else {
    float c = y * 2.0 - 1.0;
    viewMu = cos(zh + uBeta * c * c);
  }
  float lvc = 1.0 - 2.0 * x * x;
  float sinV = sqrt(max(0.0, 1.0 - viewMu * viewMu));
  vec3 rd = vec3(sinV * lvc, sinV * sqrt(max(0.0, 1.0 - lvc * lvc)), viewMu);
  vec3 ro = vec3(0.0, 0.0, uViewR);
  vec3 l = vec3(sqrt(max(0.0, 1.0 - uSunMu * uSunMu)), 0.0, uSunMu);

  float tMax;
  if (y >= 0.5) {
    float b = uViewR * viewMu;
    tMax = -b - sqrt(max(b * b - uCamC, 0.0));
  } else {
    tMax = raySphere(ro, rd, RT);
  }

  float cosT = dot(rd, l);
  float pR = rayleighPhase(cosT);
  float pM = miePhase(cosT);
  vec3 L = vec3(0.0);
  vec3 thr = vec3(1.0);
  for (int i = 0; i < 40; i++) {
    float a0 = float(i) / 40.0;
    float a1 = float(i + 1) / 40.0;
    float t0 = tMax * a0 * a0;
    float dt = tMax * a1 * a1 - t0;
    vec3 p = ro + rd * (t0 + 0.3 * dt);
    float pr = length(p);
    Medium m = medium(pr - RG);
    vec3 stepT = exp(-m.ext * dt);
    float sMu = dot(p / pr, l);
    vec3 sunT = transmittance(pr, sMu) * earthShadow(p, l);
    vec3 S = SUN_E * (sunT * (m.scatR * pR + m.scatM * pM) + multiScatter(pr, sMu) * (m.scatR + m.scatM));
    L += thr * (S - S * stepT) / max(m.ext, vec3(1e-7));
    thr *= stepT;
  }
  outColor = vec4(L, 1.0);
}
`;

// The plate's scene: sky from the LUT and the Sun disc above the true
// horizon, a dark plain below it; exposed HDR.
const PLATE = `
uniform highp sampler2D uSky;
uniform bool uPolar;
uniform vec2 uLat;      // sin, cos of the plate latitude
uniform vec3 uSunDir;   // true Sun in the plate's horizon frame (east, north, up)
uniform float uViewR;
uniform float uBeta;
uniform float uCamC;
uniform vec3 uExt0;
uniform float uExpK;
uniform float uExpMax;
uniform float uExpScale;

const float SUN_R = 0.004675;
const vec3 NIGHT_SKY = vec3(0.35, 0.5, 1.0) * 8e-5;
const vec3 GROUND_ALBEDO = vec3(0.12, 0.11, 0.09);

float horizonMu() { return -cos(uBeta); }

// Sky direction of a plate point. The polar plate ends at the south pole
// (r = 2); points beyond it, outside every plate, stay on it.
vec3 plateDir(vec2 p) {
  if (uPolar) p *= min(1.0, 2.0 / max(length(p), 1e-6));
  return normalize(horizonVector(plateSphere(p, uPolar), uLat));
}

vec2 skyUv(vec3 dir) {
  float zh = PI - uBeta;
  float th = acos(clamp(dir.z, -1.0, 1.0));
  float y = th <= zh
    ? 0.5 * (1.0 - sqrt(max(0.0, 1.0 - th / zh)))
    : 0.5 + 0.5 * sqrt(clamp((th - zh) / uBeta, 0.0, 1.0));
  float hl = length(dir.xy);
  float sl = length(uSunDir.xy);
  float lvc = (hl > 1e-5 && sl > 1e-5) ? dot(dir.xy / hl, uSunDir.xy / sl) : 1.0;
  float x = sqrt(clamp(0.5 - 0.5 * lvc, 0.0, 1.0));
  return vec2(toSub(x, SV_SIZE.x), toSub(y, SV_SIZE.y));
}

// The Sun disc, darkened toward its limb and reddened by its path through the
// air. Where a pixel is wider than the disc its light spreads over the pixel,
// so the Sun neither flickers nor brightens with the plate's scale.
vec3 sunDisc(vec3 dir, float pixAng) {
  float x = 2.0 * asin(min(1.0, 0.5 * length(dir - uSunDir)));
  float R = max(SUN_R, pixAng);
  float aa = pixAng / R;
  if (x > R * (1.0 + aa)) return vec3(0.0);
  float mask = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, x / R);
  float s = min(x / R, 1.0);
  float limb = 1.0 - 0.6 * (1.0 - sqrt(max(0.0, 1.0 - s * s)));
  vec3 T = transmittance(uViewR, max(uSunDir.z, horizonMu() + 1e-4));
  return SUN_E / (PI * R * R) * T * limb * mask;
}

// The plain below the observer: its sunlit and skylit ground, veiled by
// airlight toward the horizon. Plate altitudes 0..-90 deg span the LUT's
// ground rows, so the ground meets the sky on the plate's true horizon.
vec3 ground(vec3 dir, vec3 avg) {
  float zh = PI - uBeta;
  float th = mix(zh, PI, clamp(-asin(clamp(dir.z, -1.0, 1.0)) / HALF_PI, 0.0, 1.0));
  vec2 across = length(dir.xy) > 1e-6 ? normalize(dir.xy) : vec2(0.0, 1.0);
  vec3 d = vec3(across * sin(th), cos(th));
  float b = uViewR * d.z;
  float t = -b - sqrt(max(b * b - uCamC, 0.0));
  vec3 airlight = textureLod(uSky, skyUv(d), 0.0).rgb;
  float sunVis = clamp(asin(clamp(uSunDir.z, -1.0, 1.0)) / (2.0 * SUN_R) + 0.5, 0.0, 1.0);
  vec3 sunIrr = SUN_E * transmittance(uViewR, max(uSunDir.z, horizonMu() + 1e-4)) * sunVis;
  vec3 surface = GROUND_ALBEDO / PI * (sunIrr * max(uSunDir.z, 0.0) + PI * (avg + NIGHT_SKY));
  return airlight + exp(-uExt0 * t) * surface;
}

// Exposed radiance: eye-like adaptation to the whole sky's mean (the LUT's
// last mip), only partial so twilight stays darker than day.
vec3 radiance(vec3 dir, float pixAng) {
  vec3 avg = textureLod(uSky, vec2(0.5), 7.0).rgb;
  float E = min(uExpK * pow(max(dot(avg, LUMA), 1e-9), -0.75), uExpMax) * uExpScale;
  vec3 L = dir.z >= 0.0
    ? textureLod(uSky, skyUv(dir), 0.0).rgb + NIGHT_SKY + sunDisc(dir, pixAng)
    : ground(dir, avg);
  vec3 c = L * E;
  return c * min(1.0, 30000.0 / max(max(c.r, c.g), max(c.b, 1e-6)));
}
`;

// The whole plate square (±uEdge) as HDR, for metering and diffusion.
const PLATE_HDR = `
uniform vec2 uSize;
uniform float uEdge;
out vec4 outColor;
void main() {
  vec2 p = (gl_FragCoord.xy / uSize * 2.0 - 1.0) * uEdge;
  vec3 dir = plateDir(p);
  float pixAng = max(length(dFdx(dir)), length(dFdy(dir)));
  outColor = vec4(radiance(dir, pixAng), 1.0);
}
`;

// Lens diffusion: a 13-tap downsample / tent upsample pyramid (Jimenez 2014).
const DOWN = `
uniform highp sampler2D uSrc;
uniform vec2 uTexel;
uniform vec2 uDst;
uniform float uFirst;
out vec4 outColor;

vec3 tap(vec2 uv) {
  vec3 c = texture(uSrc, uv).rgb;
  if (uFirst > 0.5) c *= min(1.0, 400.0 / max(max(c.r, c.g), max(c.b, 1e-6)));
  return c;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uDst;
  vec2 t = uTexel;
  vec3 a = tap(uv + t * vec2(-2.0, 2.0));
  vec3 b = tap(uv + t * vec2(0.0, 2.0));
  vec3 c = tap(uv + t * vec2(2.0, 2.0));
  vec3 d = tap(uv + t * vec2(-2.0, 0.0));
  vec3 e = tap(uv);
  vec3 f = tap(uv + t * vec2(2.0, 0.0));
  vec3 g = tap(uv + t * vec2(-2.0, -2.0));
  vec3 h = tap(uv + t * vec2(0.0, -2.0));
  vec3 i = tap(uv + t * vec2(2.0, -2.0));
  vec3 j = tap(uv + t * vec2(-1.0, 1.0));
  vec3 k = tap(uv + t * vec2(1.0, 1.0));
  vec3 l = tap(uv + t * vec2(-1.0, -1.0));
  vec3 m = tap(uv + t * vec2(1.0, -1.0));
  vec3 sum = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  outColor = vec4(sum, 1.0);
}
`;

const UP = `
uniform highp sampler2D uSrc;
uniform vec2 uTexel;
uniform vec2 uDst;
out vec4 outColor;

void main() {
  vec2 uv = gl_FragCoord.xy / uDst;
  vec2 t = uTexel;
  vec3 c = texture(uSrc, uv).rgb * 4.0;
  c += (texture(uSrc, uv + vec2(t.x, 0.0)).rgb + texture(uSrc, uv - vec2(t.x, 0.0)).rgb
      + texture(uSrc, uv + vec2(0.0, t.y)).rgb + texture(uSrc, uv - vec2(0.0, t.y)).rgb) * 2.0;
  c += texture(uSrc, uv + t).rgb + texture(uSrc, uv - t).rgb
     + texture(uSrc, uv + vec2(t.x, -t.y)).rgb + texture(uSrc, uv + vec2(-t.x, t.y)).rgb;
  outColor = vec4(c / 16.0, 1.0);
}
`;

// One dither block per fragment: the exact scene at its centre, the plate's
// diffusion mixed in, metered over the whole plate, then the per-channel
// exponential curve (saturated skies; over-bright light runs to white) and
// sRGB. Alpha marks the plate disc.
const COMPOSITE = `
uniform highp sampler2D uBloom;  // plate-space diffusion over the square ±uEdge
uniform highp sampler2D uMeter;  // the pyramid's smallest level
uniform vec2 uOrigin;   // top-left corner of block (0, 0), device px, y down
uniform float uBlock;   // device px per block
uniform float uRows;    // blocks down
uniform vec2 uCentre;   // plate centre, device px, y down
uniform float uUnit;    // plate units per device px
uniform float uEdge;    // plate edge radius, plate units
uniform float uDiffuse;
uniform float uBloomNorm;
out vec4 outColor;

vec3 srgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  vec2 device = uOrigin + vec2(gl_FragCoord.x, uRows - gl_FragCoord.y) * uBlock;
  vec2 p = (device - uCentre) * uUnit;
  vec3 dir = plateDir(p);
  float pixAng = max(length(dFdx(dir)), length(dFdy(dir)));
  float meter = 0.0;
  for (int i = 0; i < 4; i++) {
    for (int j = 0; j < 4; j++) {
      meter += dot(texture(uMeter, (vec2(float(i), float(j)) + 0.5) / 4.0).rgb, LUMA);
    }
  }
  float gain = clamp(pow(0.3 / max(meter / 16.0, 1e-4), 0.5), 0.4, 1.25);
  vec3 bloom = texture(uBloom, p / (2.0 * uEdge) + 0.5).rgb / uBloomNorm;
  vec3 c = mix(radiance(dir, pixAng), bloom, uDiffuse) * gain;
  outColor = vec4(srgb(1.0 - exp(-max(c, vec3(0.0)))), dot(p, p) <= uEdge * uEdge ? 1.0 : 0.0);
}
`;

const VERT = `#version 300 es
void main() {
  vec2 v = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(v * 2.0 - 1.0, 0.0, 1.0);
}`;

const HEAD = "#version 300 es\nprecision highp float;\nprecision highp int;\n";
const FRAGMENTS = {
  trans: HEAD + COMMON + MEDIUM + TRANS,
  multi: HEAD + COMMON + MEDIUM + MULTI,
  sky: HEAD + COMMON + MEDIUM + SKY,
  plate: HEAD + COMMON + PLATE_INVERSE_GLSL + PLATE + PLATE_HDR,
  down: HEAD + COMMON + DOWN,
  up: HEAD + COMMON + UP,
  composite: HEAD + COMMON + PLATE_INVERSE_GLSL + PLATE + COMPOSITE,
} as const;
type ProgramName = keyof typeof FRAGMENTS;
/** The shader sources, for an offline compile check. */
export const ASTROLABE_SKY_SHADERS = { vertex: VERT, fragments: FRAGMENTS };

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

/** WebGL-shaded pictures (exports) up to this many dots across are dithered
 * on the CPU even with the GPU up: with the readback, upload and copy back
 * the GPU is no faster there (800 px: ~20 ms either way). */
const CPU_DITHER_MAX = 1024;

const TIERS: readonly Tier[] = ["base", "fine", "finest"];
type Uniform = number | readonly number[] | { int: number };
type Program = { program: WebGLProgram; locations: Map<string, WebGLUniformLocation | null> };
type Target = { texture: WebGLTexture; framebuffer: WebGLFramebuffer; w: number; h: number };
type SkyGl = {
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement;
  programs: Record<ProgramName, Program>;
  trans: Target;
  multi: Target;
  skyView: Target;
  hdr: Target;
  mips: Target[];
  /** The shaded pictures before dithering, read back from here. */
  pictures: Record<Tier, Target | null>;
  /** What the lookup textures and the plate-space image were last built for. */
  atmosKey: string;
  skyKey: string;
  plateKey: string;
};

/** undefined = not set up yet (or the context was lost), null = unavailable. */
let sky: SkyGl | null | undefined;

/** The last dithered pictures of the whole plate square, one per tier, each
 * kept while its plate, Sun, look and size stay the same. */
const pictures: Record<Tier, { key: string; size: number; canvas: HTMLCanvasElement } | null> = {
  base: null, fine: null, finest: null,
};

/** The base picture's palette, which the finer ones share, so zooming shifts
 * neither the sky's colours nor the Sun's. */
let palette: { key: string; colours: Float32Array } | null = null;

function compile(gl: WebGL2RenderingContext, vertex: WebGLShader, source: string): Program {
  const shader = gl.createShader(gl.FRAGMENT_SHADER)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, shader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`${gl.getProgramInfoLog(program)} ${gl.getShaderInfoLog(shader)}`);
  }
  return { program, locations: new Map() };
}

function target(gl: WebGL2RenderingContext, w: number, h: number, kind: "float" | "float-mips" | "bytes"): Target {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  if (kind === "bytes") gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, kind === "float-mips" ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error("the GPU cannot render to this texture format");
  }
  return { texture, framebuffer, w, h };
}

function dropTarget(gl: WebGL2RenderingContext, t: Target | null) {
  if (!t) return;
  gl.deleteTexture(t.texture);
  gl.deleteFramebuffer(t.framebuffer);
}

function skyGl(): SkyGl | null {
  if (sky !== undefined) return sky;
  if (typeof document === "undefined") return (sky = null);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false });
  try {
    if (!gl) throw new Error("WebGL2 is unavailable");
    if (!gl.getExtension("EXT_color_buffer_float")) throw new Error("EXT_color_buffer_float is unavailable");
    const vertex = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vertex, VERT);
    gl.compileShader(vertex);
    const programs = Object.fromEntries(Object.entries(FRAGMENTS).map(([name, source]) => (
      [name, compile(gl, vertex, source)]))) as Record<ProgramName, Program>;
    gl.bindVertexArray(gl.createVertexArray());
    const mips: Target[] = [];
    for (let i = 1, size = PLATE_PX >> 1; i <= BLOOM_LEVELS; i++, size >>= 1) mips.push(target(gl, size, size, "float"));
    sky = {
      gl, canvas, programs, mips,
      trans: target(gl, 256, 64, "float"),
      multi: target(gl, 32, 32, "float"),
      skyView: target(gl, 192, 108, "float-mips"),
      hdr: target(gl, PLATE_PX, PLATE_PX, "float"),
      pictures: { base: null, fine: null, finest: null },
      atmosKey: "", skyKey: "", plateKey: "",
    };
  } catch (err) {
    console.warn("[astrolabe-sky] The physical sky is unavailable; the plate keeps its flat sky.", err);
    return (sky = null);
  }
  // A lost context is dropped whole; the next paint sets up again.
  canvas.addEventListener("webglcontextlost", () => {
    if (sky?.canvas === canvas) sky = undefined;
  });
  return sky;
}

function uniformLocation(s: SkyGl, program: Program, name: string) {
  if (!program.locations.has(name)) program.locations.set(name, s.gl.getUniformLocation(program.program, name));
  return program.locations.get(name) ?? null;
}

function pass(
  s: SkyGl,
  name: ProgramName,
  dst: Target,
  uniforms: Record<string, Uniform>,
  textures: Record<string, WebGLTexture> = {},
) {
  const { gl } = s;
  const program = s.programs[name];
  gl.bindFramebuffer(gl.FRAMEBUFFER, dst.framebuffer);
  gl.viewport(0, 0, dst.w, dst.h);
  gl.useProgram(program.program);
  Object.entries(textures).forEach(([uniform, texture], unit) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(uniformLocation(s, program, uniform), unit);
  });
  for (const [uniform, value] of Object.entries(uniforms)) {
    const location = uniformLocation(s, program, uniform);
    if (location === null) continue;
    if (typeof value === "number") gl.uniform1f(location, value);
    else if ("int" in value) gl.uniform1i(location, value.int);
    else if (value.length === 2) gl.uniform2f(location, value[0], value[1]);
    else gl.uniform3f(location, value[0], value[1], value[2]);
  }
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

/** Lookup textures, then the plate-space image and its diffusion pyramid, for this Sun and look. */
function preparePlate(s: SkyGl, shading: SkyShading) {
  const { gl } = s;
  const atmos = { uHaze: shading.haze, uOzone: shading.ozone };
  if (shading.atmosKey !== s.atmosKey) {
    pass(s, "trans", s.trans, atmos);
    pass(s, "multi", s.multi, atmos, { uTrans: s.trans.texture });
    s.atmosKey = shading.atmosKey;
    s.skyKey = "";
  }
  if (shading.skyKey !== s.skyKey) {
    pass(s, "sky", s.skyView, { ...atmos, uViewR: VIEW_R, uBeta: BETA, uCamC: CAM_C, uSunMu: shading.sunDir[2] },
      { uTrans: s.trans.texture, uMS: s.multi.texture });
    gl.bindTexture(gl.TEXTURE_2D, s.skyView.texture);
    gl.generateMipmap(gl.TEXTURE_2D);
    s.skyKey = shading.skyKey;
    s.plateKey = "";
  }
  if (shading.plateKey === s.plateKey) return;
  pass(s, "plate", s.hdr, { ...glUniforms(shading), uSize: [PLATE_PX, PLATE_PX] },
    { uTrans: s.trans.texture, uSky: s.skyView.texture });
  let src = s.hdr;
  s.mips.forEach((m, i) => {
    pass(s, "down", m, { uTexel: [1 / src.w, 1 / src.h], uDst: [m.w, m.h], uFirst: i === 0 ? 1 : 0 },
      { uSrc: src.texture });
    src = m;
  });
  // Each wider level adds at BLOOM_FALLOFF of the one inside it: a long, soft tail.
  gl.enable(gl.BLEND);
  gl.blendColor(BLOOM_FALLOFF, BLOOM_FALLOFF, BLOOM_FALLOFF, 1);
  gl.blendFunc(gl.CONSTANT_COLOR, gl.ONE);
  for (let i = s.mips.length - 1; i > 0; i--) {
    const from = s.mips[i];
    const to = s.mips[i - 1];
    pass(s, "up", to, { uTexel: [1 / from.w, 1 / from.h], uDst: [to.w, to.h] }, { uSrc: from.texture });
  }
  gl.disable(gl.BLEND);
  s.plateKey = shading.plateKey;
}

function composite(s: SkyGl, dst: Target, uniforms: Record<string, Uniform>) {
  pass(s, "composite", dst, uniforms, {
    uTrans: s.trans.texture,
    uSky: s.skyView.texture,
    uBloom: s.mips[0].texture,
    uMeter: s.mips[s.mips.length - 1].texture,
  });
}

/** The whole plate square shaded `size` dots across, read back (RGBA, rows bottom-up). */
function shadePicture(s: SkyGl, uniforms: Record<string, Uniform>, rEdge: number, size: number, tier: Tier): Uint8Array {
  const { gl } = s;
  let dst = s.pictures[tier];
  if (dst?.w !== size) {
    dropTarget(gl, dst);
    dst = s.pictures[tier] = target(gl, size, size, "bytes");
  }
  composite(s, dst, {
    ...uniforms, uOrigin: [-rEdge, -rEdge], uBlock: (2 * rEdge) / size, uRows: size, uCentre: [0, 0], uUnit: 1,
  });
  const pixels = new Uint8Array(size * size * 4);
  gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  return pixels;
}

/** Dither a shaded picture onto `colours` into the tier's canvas: on the GPU
 * when `gpu` and the picture is larger than CPU_DITHER_MAX, else on the CPU. */
function installPicture(tier: Tier, key: string, size: number, pixels: Uint8Array, colours: Float32Array, gpu: boolean) {
  const canvas = pictures[tier]?.canvas ?? document.createElement("canvas");
  if (!gpu || size <= CPU_DITHER_MAX || !ditherPictureOnGpu(pixels, size, colours, canvas)) {
    if (canvas.width !== size) canvas.width = size;
    if (canvas.height !== size) canvas.height = size;
    canvas.getContext("2d")?.putImageData(new ImageData(ditherPlatePicture(pixels, size, colours), size, size), 0, 0);
  }
  return (pictures[tier] = { key, size, canvas });
}

/** Free a stale tier's picture and, above the base tier (whose target shades
 * every palette), its shading target. */
function releasePicture(s: SkyGl, tier: Tier) {
  const canvas = pictures[tier]?.canvas;
  if (canvas) canvas.width = canvas.height = 0;
  pictures[tier] = null;
  if (tier === "base") return;
  dropTarget(s.gl, s.pictures[tier]);
  s.pictures[tier] = null;
}

/** The WebGL passes' uniforms for one plate, Sun and look. */
function glUniforms(shading: SkyShading): Record<string, Uniform> {
  return {
    uPolar: { int: shading.polar ? 1 : 0 },
    uLat: shading.lat,
    uSunDir: shading.sunDir,
    uViewR: shading.viewR,
    uBeta: shading.beta,
    uCamC: shading.camC,
    uExt0: shading.ext0,
    uExpK: shading.expK,
    uExpMax: shading.expMax,
    uExpScale: shading.expScale,
    uEdge: shading.edge,
    uDiffuse: shading.diffuse,
    uBloomNorm: shading.bloomNorm,
  };
}

/** A kept picture of the whole plate square. */
type Picture = { size: number; canvas: HTMLCanvasElement };

/** The WebGL-shaded picture for this frame, made now; null when WebGL cannot draw it. */
function glPicture(
  shading: SkyShading,
  content: string,
  fittedRadiusPx: number,
  magnification: number,
  tiers: SkyTiers,
): Picture | null {
  const s = skyGl();
  if (!s) return null;
  const { base, shown: size, tier } = skyPictureSizes(fittedRadiusPx, magnification, tiers);
  const paletteKey = `${content}|${base}`;
  const key = `${paletteKey}|${size}`;
  let shown = pictures[tier];
  try {
    if (shown?.key !== key) {
      preparePlate(s, shading);
      const uniforms = glUniforms(shading);
      let pixels: Uint8Array | null = null;
      if (palette?.key !== paletteKey) {
        // A new plate, Sun or look leaves every kept picture stale.
        for (const other of TIERS) if (other !== tier) releasePicture(s, other);
        pixels = shadePicture(s, uniforms, shading.edge, base, "base");
        palette = { key: paletteKey, colours: platePalette(pixels) };
      }
      if (tier !== "base" || !pixels) pixels = shadePicture(s, uniforms, shading.edge, size, tier);
      shown = installPicture(tier, key, size, pixels, palette.colours, tiers === "gpu");
    }
  } catch (err) {
    console.warn("[astrolabe-sky] The physical sky failed; the plate keeps its flat sky.", err);
    sky = null;
    pictures.base = pictures.fine = pictures.finest = null;
    palette = null;
    return null;
  }
  return shown;
}

// ---------------------------------------------------------------------------
// The GPU's pictures (`finerZoom` with WebGPU up), made asynchronously
// ---------------------------------------------------------------------------

type GpuPicture = Picture & { content: string };
type GpuWant = { content: string; paletteKey: string; base: number; size: number; tier: Tier; shading: SkyShading };
type GpuRequest = GpuWant & { key: string; callbacks: Array<() => void> };

/** The GPU's pictures of the current plate, Sun and look, one per tier. */
const gpuPictures: Record<Tier, GpuPicture | null> = { base: null, fine: null, finest: null };
/** The palette of the base picture the GPU last made, which its finer pictures share. */
let gpuPalette: { key: string; colours: Float32Array } | null = null;
/** The picture being made, and the newest frame's picture waiting for it. */
let building: GpuRequest | null = null;
let queued: GpuRequest | null = null;

/** The GPU's picture of this plate, Sun and look nearest `size` dots across. */
function nearestGpuPicture(content: string, size: number): GpuPicture | null {
  let nearest: GpuPicture | null = null;
  for (const tier of TIERS) {
    const held = gpuPictures[tier];
    if (held?.content !== content) continue;
    if (!nearest || Math.abs(held.size - size) < Math.abs(nearest.size - size)) nearest = held;
  }
  return nearest;
}

/** Ask the GPU for a picture; `callback` runs once it is made, or once the
 * GPU sky failed. One picture is made at a time: a newer frame's request
 * replaces the one waiting, whose frame is then never painted. */
function requestGpuPicture(want: GpuWant, callback?: () => void) {
  const key = `${want.paletteKey}|${want.size}`;
  const same = building?.key === key ? building : queued?.key === key ? queued : null;
  if (same) {
    if (callback && !same.callbacks.includes(callback)) same.callbacks.push(callback);
    return;
  }
  const request: GpuRequest = { ...want, key, callbacks: callback ? [callback] : [] };
  if (building) queued = request;
  else void makeGpuPicture(request);
}

async function makeGpuPicture(request: GpuRequest) {
  building = request;
  try {
    const canvas = gpuPictures[request.tier]?.canvas ?? document.createElement("canvas");
    const known = gpuPalette?.key === request.paletteKey ? gpuPalette.colours : null;
    const colours = await makeSkyPicture(request.shading, request.base, request.size, known, canvas);
    // A new plate, Sun or look leaves every other kept picture stale.
    for (const tier of TIERS) {
      const held = gpuPictures[tier];
      if (tier === request.tier || !held || held.content === request.content) continue;
      held.canvas.width = held.canvas.height = 0;
      gpuPictures[tier] = null;
    }
    gpuPalette = { key: request.paletteKey, colours };
    gpuPictures[request.tier] = { content: request.content, size: request.size, canvas };
  } catch (err) {
    dropGpuSky(err);
    gpuPictures.base = gpuPictures.fine = gpuPictures.finest = null;
    gpuPalette = null;
  }
  building = null;
  const next = queued;
  queued = null;
  // Start the next picture before the frames run, so their own requests queue behind it.
  if (next && gpuSkyReady()) void makeGpuPicture(next);
  else if (next) request.callbacks.push(...next.callbacks);
  for (const callback of request.callbacks) callback();
}

// ---------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------

/** One frame's physical sky, painted over the plate disc (the caller clips to
 * it and has filled the flat sky): true when it was drawn, false when there
 * is no physical sky and the flat one stays. The earth in front paints it a
 * second time over the ground. */
export type AstrolabeSkyFrame = { paint(ctx: CanvasRenderingContext2D): boolean };

/** A live plate's part in the GPU's asynchronous pictures. */
export type AstrolabeSkyLive = {
  /** When given, a frame whose plate, Sun or look has no picture yet is not
   * painted (`prepareAstrolabeSky` returns "wait") and this runs once its
   * picture is made: the caller keeps its previous frame meanwhile. */
  wait?: () => void;
  /** Runs when a picture painted for now (another size, or WebGL's) has the
   * GPU's own one ready. */
  repaint?: () => void;
};

const NO_SKY: AstrolabeSkyFrame = { paint: () => false };
const OFF_CANVAS: AstrolabeSkyFrame = { paint: () => true };

/** Draw a picture's visible dots, each a block of the plate's current scale, without smoothing. */
function skyFrame(layout: Layout, rEdge: number, strength: number, picture: Picture | null): AstrolabeSkyFrame {
  if (!picture) return NO_SKY;
  return {
    paint(ctx) {
      const box = plateDeviceBox(ctx, layout, rEdge);
      if (!box) return true;
      // The picture spans the plate square.
      const { size, canvas } = picture;
      const radius = rEdge * layout.scale * ctx.getTransform().a;
      const span = (2 * radius) / size;
      const left = Math.round(box.ox - radius);
      const top = Math.round(box.oy - radius);
      const sx0 = Math.max(0, Math.floor((box.x0 - left) / span));
      const sy0 = Math.max(0, Math.floor((box.y0 - top) / span));
      const sx1 = Math.min(size, Math.ceil((box.x1 - left) / span));
      const sy1 = Math.min(size, Math.ceil((box.y1 - top) / span));
      if (sx1 <= sx0 || sy1 <= sy0) return true;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = strength;
      ctx.drawImage(canvas, sx0, sy0, sx1 - sx0, sy1 - sy0,
        left + sx0 * span, top + sy0 * span, (sx1 - sx0) * span, (sy1 - sy0) * span);
      ctx.restore();
      return true;
    },
  };
}

/**
 * The physical sky of one frame at the current zoom and pan: sky above the
 * horizon, ground below. `rEdge` is the plate edge (the Capricorn circle or
 * the polar rim) in plate units and `fittedRadiusPx` the unzoomed plate's
 * edge radius in CSS px; `frame` is the city's plate frame (plate latitude
 * and pole). Call it before painting anything of the frame: with `live.wait`
 * it may return "wait" (see AstrolabeSkyLive). Without `live` the picture is
 * always made now (exports).
 */
export function prepareAstrolabeSky(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  projection: AstrolabeProjection,
  frame: CityFrame,
  rEdge: number,
  fittedRadiusPx: number,
  layer: AstrolabeSkyLayer,
  live?: AstrolabeSkyLive,
): AstrolabeSkyFrame | "wait" {
  const { tune } = layer;
  const finer = (tune.finerZoom ?? 0) > 0;
  const gpuLive = Boolean(finer && live && gpuSkyReady());
  if (!gpuLive && !skyGl()) return NO_SKY;
  if (!plateDeviceBox(ctx, layout, rEdge)) return OFF_CANVAS;
  const { shading, content } = skyShading(projection, frame, rEdge, layer);
  // The city's measure: zoom, or device pixels beyond a Retina (2x) screen's, as on a poster.
  const magnification = Math.max(1, ctx.getTransform().a / 2) * (layout.scale * rEdge) / fittedRadiusPx;
  if (gpuLive && live) {
    const { base, shown: size, tier } = skyPictureSizes(fittedRadiusPx, magnification, "gpu");
    const want: GpuWant = { content, paletteKey: `${content}|${base}`, base, size, tier, shading };
    const exact = gpuPictures[tier];
    if (exact?.content === content && exact.size === size) return skyFrame(layout, rEdge, tune.strength, exact);
    const near = nearestGpuPicture(content, size);
    if (!near && live.wait) {
      requestGpuPicture(want, live.wait);
      return "wait";
    }
    requestGpuPicture(want, live.repaint);
    // Nothing of this plate, Sun and look on the GPU yet, and the caller
    // cannot keep its frame: WebGL and the CPU's base picture for now.
    return skyFrame(layout, rEdge, tune.strength, near ?? glPicture(shading, content, fittedRadiusPx, magnification, "single"));
  }
  const tiers: SkyTiers = !finer ? "single" : gpuSkyReady() ? "gpu" : "cpu";
  return skyFrame(layout, rEdge, tune.strength, glPicture(shading, content, fittedRadiusPx, magnification, tiers));
}
