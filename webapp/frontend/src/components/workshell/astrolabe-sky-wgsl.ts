// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The physical sky's shading passes (astrolabe-sky.ts) in WGSL, for the
 * WebGPU device that also dithers the sky (astrolabe-sky-gpu.ts), so shading,
 * dithering and display stay on one device: the same scattering, plate
 * projection, metering, diffusion and tone curve as the GLSL passes there,
 * pass for pass. WebGPU's rows run top-down, so the composite needs no flip;
 * every lookup texture is written and read in that one row order. Textures
 * are sampled at explicit levels, which WGSL allows in non-uniform control
 * flow. Plus the palette's sample gather, the only readback.
 */

/** Float words of `Sky` as the renderer writes them (astrolabe-sky-gpu.ts). */
export const SKY_UNIFORM = {
  sunDir: 0, haze: 3, ext0: 4, ozone: 7, lat: 8, viewR: 10, beta: 11, camC: 12, sunMu: 13,
  expK: 14, expMax: 15, expScale: 16, edge: 17, diffuse: 18, bloomNorm: 19, origin: 20, texel: 22,
  dst: 24, block: 26, polar: 27, first: 28,
} as const;
/** Bytes of one `Sky` block. */
export const SKY_UNIFORM_BYTES = 128;

export const SKY_WGSL = /* wgsl */ `
struct Sky {
  sunDir: vec3<f32>,  // true Sun in the plate's horizon frame (east, north, up)
  haze: f32,
  ext0: vec3<f32>,
  ozone: f32,
  lat: vec2<f32>,     // sin, cos of the plate latitude
  viewR: f32,
  beta: f32,
  camC: f32,
  sunMu: f32,
  expK: f32,
  expMax: f32,
  expScale: f32,
  edge: f32,          // plate edge radius, plate units
  diffuse: f32,
  bloomNorm: f32,
  origin: vec2<f32>,  // composite: plate point of dot (0, 0)'s corner
  texel: vec2<f32>,   // diffusion: source texel
  dst: vec2<f32>,     // target size
  block: f32,         // composite: plate units per dot
  polar: u32,         // polar azimuthal equidistant plate, else stereographic
  first: u32,         // diffusion: the first downsample, which clamps fireflies
}

@group(0) @binding(0) var<uniform> sky: Sky;
@group(0) @binding(1) var lin: sampler;
@group(0) @binding(2) var trans: texture_2d<f32>;
@group(0) @binding(3) var ms: texture_2d<f32>;
@group(0) @binding(4) var skyView: texture_2d<f32>;
@group(0) @binding(5) var src: texture_2d<f32>;
@group(0) @binding(6) var bloom: texture_2d<f32>;
@group(0) @binding(7) var meter: texture_2d<f32>;

const PI = 3.14159265358979;
const HALF_PI = ${Math.PI / 2};
const RG = 6360.0;
const RT = 6460.0;
const T_SIZE = vec2<f32>(256.0, 64.0);
const MS_SIZE = 32.0;
const SV_SIZE = vec2<f32>(192.0, 108.0);
const SUN_E = 1000.0;
const LUMA = vec3<f32>(0.2126, 0.7152, 0.0722);
const SUN_R = 0.004675;
const NIGHT_SKY = vec3<f32>(2.8e-5, 4e-5, 8e-5);
const GROUND_ALBEDO = vec3<f32>(0.12, 0.11, 0.09);

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  let v = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4<f32>(v * 2.0 - 1.0, 0.0, 1.0);
}

fn toSub(x: f32, n: f32) -> f32 { return 0.5 / n + x * (1.0 - 1.0 / n); }
fn fromSub(u: f32, n: f32) -> f32 { return (u - 0.5 / n) / (1.0 - 1.0 / n); }

// Nearest positive hit of a ray (origin relative to the planet centre) with a sphere; -1 if none.
fn raySphere(ro: vec3<f32>, rd: vec3<f32>, R: f32) -> f32 {
  let b = dot(ro, rd);
  let c = dot(ro, ro) - R * R;
  let d = b * b - c;
  if (d < 0.0) { return -1.0; }
  let s = sqrt(d);
  if (-b - s > 0.0) { return -b - s; }
  if (-b + s > 0.0) { return -b + s; }
  return -1.0;
}

// Bruneton's parametrisation of transmittance to the top of the atmosphere.
fn transmittanceUv(r: f32, mu: f32) -> vec2<f32> {
  let H = sqrt(RT * RT - RG * RG);
  let rho = sqrt(max(0.0, r * r - RG * RG));
  let disc = r * r * (mu * mu - 1.0) + RT * RT;
  let d = max(0.0, -r * mu + sqrt(max(disc, 0.0)));
  let dMin = RT - r;
  let dMax = rho + H;
  let xMu = clamp((d - dMin) / (dMax - dMin), 0.0, 1.0);
  return vec2<f32>(toSub(xMu, T_SIZE.x), toSub(rho / H, T_SIZE.y));
}

fn transmittance(r: f32, mu: f32) -> vec3<f32> {
  return textureSampleLevel(trans, lin, transmittanceUv(r, mu), 0.0).rgb;
}

struct Medium { scatR: vec3<f32>, scatM: vec3<f32>, ext: vec3<f32> }

fn medium(h: f32) -> Medium {
  let dR = exp(-h / 8.0);
  let dM = exp(-h / 1.2) * sky.haze;
  let dO = max(0.0, 1.0 - abs(h - 25.0) / 15.0) * sky.ozone;
  var m: Medium;
  m.scatR = vec3<f32>(5.802e-3, 13.558e-3, 33.1e-3) * dR;
  m.scatM = vec3<f32>(3.996e-3 * dM);
  m.ext = m.scatR + vec3<f32>(4.44e-3 * dM) + vec3<f32>(0.650e-3, 1.881e-3, 0.085e-3) * dO;
  return m;
}

fn rayleighPhase(c: f32) -> f32 {
  return 3.0 / (16.0 * PI) * (1.0 + c * c);
}

// Cornette-Shanks: the forward peak is the bright aureole around the sun.
fn miePhase(c: f32) -> f32 {
  let g = 0.8;
  let k = 3.0 / (8.0 * PI) * (1.0 - g * g) / (2.0 + g * g);
  return k * (1.0 + c * c) / pow(1.0 + g * g - 2.0 * g * c, 1.5);
}

fn earthShadow(p: vec3<f32>, l: vec3<f32>) -> f32 {
  let b = dot(p, l);
  let c = dot(p, p) - RG * RG;
  if (b < 0.0 && b * b - c > 0.0) { return 0.0; }
  return 1.0;
}

@fragment
fn fsTrans(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = pos.xy / T_SIZE;
  let xMu = clamp(fromSub(uv.x, T_SIZE.x), 0.0, 1.0);
  let xR = clamp(fromSub(uv.y, T_SIZE.y), 0.0, 1.0);
  let H = sqrt(RT * RT - RG * RG);
  let rho = H * xR;
  let r = sqrt(rho * rho + RG * RG);
  let dMin = RT - r;
  let dMax = rho + H;
  let d = dMin + xMu * (dMax - dMin);
  var mu = 1.0;
  if (d != 0.0) { mu = clamp((H * H - rho * rho - d * d) / (2.0 * r * d), -1.0, 1.0); }
  let ro = vec3<f32>(0.0, 0.0, r);
  let rd = vec3<f32>(sqrt(max(0.0, 1.0 - mu * mu)), 0.0, mu);
  let dt = max(raySphere(ro, rd, RT), 0.0) / 40.0;
  var depth = vec3<f32>(0.0);
  for (var i = 0; i < 40; i++) {
    let p = ro + rd * ((f32(i) + 0.5) * dt);
    depth += medium(length(p) - RG).ext * dt;
  }
  return vec4<f32>(exp(-depth), 1.0);
}

// Hillaire's multiple-scattering LUT: second-order light from a uniform sphere, summed as a geometric series.
@fragment
fn fsMulti(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = pos.xy / MS_SIZE;
  let sunMu = clamp(fromSub(uv.x, MS_SIZE), 0.0, 1.0) * 2.0 - 1.0;
  let r = clamp(RG + clamp(fromSub(uv.y, MS_SIZE), 0.0, 1.0) * (RT - RG), RG + 0.01, RT - 0.01);
  let ro = vec3<f32>(0.0, 0.0, r);
  let l = vec3<f32>(sqrt(max(0.0, 1.0 - sunMu * sunMu)), 0.0, sunMu);
  var L2 = vec3<f32>(0.0);
  var fms = vec3<f32>(0.0);
  for (var i = 0; i < 8; i++) {
    for (var j = 0; j < 8; j++) {
      let th = 2.0 * PI * (f32(i) + 0.5) / 8.0;
      let ph = acos(1.0 - 2.0 * (f32(j) + 0.5) / 8.0);
      let rd = vec3<f32>(cos(th) * sin(ph), sin(th) * sin(ph), cos(ph));
      let tG = raySphere(ro, rd, RG);
      var tMax = max(raySphere(ro, rd, RT), 0.0);
      if (tG > 0.0) { tMax = tG; }
      let dt = tMax / 20.0;
      var thr = vec3<f32>(1.0);
      var L = vec3<f32>(0.0);
      var F = vec3<f32>(0.0);
      for (var k = 0; k < 20; k++) {
        let p = ro + rd * ((f32(k) + 0.5) * dt);
        let pr = length(p);
        let m = medium(pr - RG);
        let scat = m.scatR + m.scatM;
        let ext = max(m.ext, vec3<f32>(1e-7));
        let stepT = exp(-m.ext * dt);
        let S = transmittance(pr, dot(p / pr, l)) * earthShadow(p, l) * scat / (4.0 * PI);
        L += thr * (S - S * stepT) / ext;
        F += thr * (scat - scat * stepT) / ext;
        thr *= stepT;
      }
      if (tG > 0.0) {
        let p = ro + rd * tG;
        let mu = dot(normalize(p), l);
        L += thr * transmittance(RG, mu) * max(mu, 0.0) * 0.3 / PI;
      }
      L2 += L;
      fms += F;
    }
  }
  L2 /= 64.0;
  fms /= 64.0;
  return vec4<f32>(L2 / (1.0 - fms), 1.0);
}

fn multiScatter(r: f32, mu: f32) -> vec3<f32> {
  let uv = vec2<f32>(toSub(mu * 0.5 + 0.5, MS_SIZE), toSub(clamp((r - RG) / (RT - RG), 0.0, 1.0), MS_SIZE));
  return textureSampleLevel(ms, lin, uv, 0.0).rgb;
}

// Sky-view LUT: radiance seen from the observer, indexed by zenith angle (dense near the horizon) and azimuth from the sun.
@fragment
fn fsSky(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = pos.xy / SV_SIZE;
  let x = fromSub(uv.x, SV_SIZE.x);
  let y = fromSub(uv.y, SV_SIZE.y);
  let zh = PI - sky.beta;
  var viewMu: f32;
  if (y < 0.5) {
    let c = 1.0 - 2.0 * y;
    viewMu = cos(zh * (1.0 - c * c));
  } else {
    let c = y * 2.0 - 1.0;
    viewMu = cos(zh + sky.beta * c * c);
  }
  let lvc = 1.0 - 2.0 * x * x;
  let sinV = sqrt(max(0.0, 1.0 - viewMu * viewMu));
  let rd = vec3<f32>(sinV * lvc, sinV * sqrt(max(0.0, 1.0 - lvc * lvc)), viewMu);
  let ro = vec3<f32>(0.0, 0.0, sky.viewR);
  let l = vec3<f32>(sqrt(max(0.0, 1.0 - sky.sunMu * sky.sunMu)), 0.0, sky.sunMu);

  var tMax: f32;
  if (y >= 0.5) {
    let b = sky.viewR * viewMu;
    tMax = -b - sqrt(max(b * b - sky.camC, 0.0));
  } else {
    tMax = raySphere(ro, rd, RT);
  }

  let cosT = dot(rd, l);
  let pR = rayleighPhase(cosT);
  let pM = miePhase(cosT);
  var L = vec3<f32>(0.0);
  var thr = vec3<f32>(1.0);
  for (var i = 0; i < 40; i++) {
    let a0 = f32(i) / 40.0;
    let a1 = f32(i + 1) / 40.0;
    let t0 = tMax * a0 * a0;
    let dt = tMax * a1 * a1 - t0;
    let p = ro + rd * (t0 + 0.3 * dt);
    let pr = length(p);
    let m = medium(pr - RG);
    let stepT = exp(-m.ext * dt);
    let sMu = dot(p / pr, l);
    let sunT = transmittance(pr, sMu) * earthShadow(p, l);
    let S = SUN_E * (sunT * (m.scatR * pR + m.scatM * pM) + multiScatter(pr, sMu) * (m.scatR + m.scatM));
    L += thr * (S - S * stepT) / max(m.ext, vec3<f32>(1e-7));
    thr *= stepT;
  }
  return vec4<f32>(L, 1.0);
}

// One level of the sky-view LUT's mip chain from the level above (src).
@fragment
fn fsMip(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
  return textureSampleLevel(src, lin, pos.xy / sky.dst, 0.0);
}

// Plate point (plate units, +y down) -> (cos dec sin H, cos dec cos H, sin dec),
// as PLATE_INVERSE_GLSL (astrolabe-city.ts).
fn plateSphere(p: vec2<f32>, polarPlate: bool) -> vec3<f32> {
  let r2 = dot(p, p);
  var sinDec: f32;
  var k: f32;
  if (polarPlate) {
    // Polar equidistant: r = (90° - dec) / 90°.
    let r = sqrt(r2);
    let zeta = r * HALF_PI;
    sinDec = cos(zeta);
    k = select(HALF_PI, sin(zeta) / max(r, 1e-30), r > 0.0);
  } else {
    // Stereographic: r = tan((90° - dec) / 2).
    let q = 1.0 / (1.0 + r2);
    sinDec = (1.0 - r2) * q;
    k = 2.0 * q;
  }
  return vec3<f32>(vec2<f32>(p.x, -p.y) * k, sinDec);
}

// The same direction in the horizon frame (east, north, up), for the
// latitude's (sin, cos): bearing atan(east, north), altitude asin(up).
fn horizonVector(e: vec3<f32>, lat: vec2<f32>) -> vec3<f32> {
  return vec3<f32>(-e.x, e.z * lat.y - e.y * lat.x, lat.x * e.z + lat.y * e.y);
}

fn horizonMu() -> f32 { return -cos(sky.beta); }

// Sky direction of a plate point. The polar plate ends at the south pole
// (r = 2); points beyond it, outside every plate, stay on it.
fn plateDir(p0: vec2<f32>) -> vec3<f32> {
  var p = p0;
  if (sky.polar != 0u) { p *= min(1.0, 2.0 / max(length(p), 1e-6)); }
  return normalize(horizonVector(plateSphere(p, sky.polar != 0u), sky.lat));
}

fn skyUv(dir: vec3<f32>) -> vec2<f32> {
  let zh = PI - sky.beta;
  let th = acos(clamp(dir.z, -1.0, 1.0));
  var y: f32;
  if (th <= zh) {
    y = 0.5 * (1.0 - sqrt(max(0.0, 1.0 - th / zh)));
  } else {
    y = 0.5 + 0.5 * sqrt(clamp((th - zh) / sky.beta, 0.0, 1.0));
  }
  let hl = length(dir.xy);
  let sl = length(sky.sunDir.xy);
  var lvc = 1.0;
  if (hl > 1e-5 && sl > 1e-5) { lvc = dot(dir.xy / hl, sky.sunDir.xy / sl); }
  let x = sqrt(clamp(0.5 - 0.5 * lvc, 0.0, 1.0));
  return vec2<f32>(toSub(x, SV_SIZE.x), toSub(y, SV_SIZE.y));
}

// The Sun disc, darkened toward its limb and reddened by its path through the
// air. Where a pixel is wider than the disc its light spreads over the pixel,
// so the Sun neither flickers nor brightens with the plate's scale.
fn sunDisc(dir: vec3<f32>, pixAng: f32) -> vec3<f32> {
  let x = 2.0 * asin(min(1.0, 0.5 * length(dir - sky.sunDir)));
  let R = max(SUN_R, pixAng);
  let aa = pixAng / R;
  if (x > R * (1.0 + aa)) { return vec3<f32>(0.0); }
  let mask = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, x / R);
  let s = min(x / R, 1.0);
  let limb = 1.0 - 0.6 * (1.0 - sqrt(max(0.0, 1.0 - s * s)));
  let T = transmittance(sky.viewR, max(sky.sunDir.z, horizonMu() + 1e-4));
  return SUN_E / (PI * R * R) * T * limb * mask;
}

// The plain below the observer: its sunlit and skylit ground, veiled by
// airlight toward the horizon. Plate altitudes 0..-90 deg span the LUT's
// ground rows, so the ground meets the sky on the plate's true horizon.
fn ground(dir: vec3<f32>, avg: vec3<f32>) -> vec3<f32> {
  let zh = PI - sky.beta;
  let th = mix(zh, PI, clamp(-asin(clamp(dir.z, -1.0, 1.0)) / HALF_PI, 0.0, 1.0));
  var across = vec2<f32>(0.0, 1.0);
  if (length(dir.xy) > 1e-6) { across = normalize(dir.xy); }
  let d = vec3<f32>(across * sin(th), cos(th));
  let b = sky.viewR * d.z;
  let t = -b - sqrt(max(b * b - sky.camC, 0.0));
  let airlight = textureSampleLevel(skyView, lin, skyUv(d), 0.0).rgb;
  let sunVis = clamp(asin(clamp(sky.sunDir.z, -1.0, 1.0)) / (2.0 * SUN_R) + 0.5, 0.0, 1.0);
  let sunIrr = SUN_E * transmittance(sky.viewR, max(sky.sunDir.z, horizonMu() + 1e-4)) * sunVis;
  let surface = GROUND_ALBEDO / PI * (sunIrr * max(sky.sunDir.z, 0.0) + PI * (avg + NIGHT_SKY));
  return airlight + exp(-sky.ext0 * t) * surface;
}

// Exposed radiance: eye-like adaptation to the whole sky's mean (the LUT's
// last mip), only partial so twilight stays darker than day.
fn radiance(dir: vec3<f32>, pixAng: f32) -> vec3<f32> {
  let avg = textureSampleLevel(skyView, lin, vec2<f32>(0.5), 7.0).rgb;
  let E = min(sky.expK * pow(max(dot(avg, LUMA), 1e-9), -0.75), sky.expMax) * sky.expScale;
  var L: vec3<f32>;
  if (dir.z >= 0.0) {
    L = textureSampleLevel(skyView, lin, skyUv(dir), 0.0).rgb + NIGHT_SKY + sunDisc(dir, pixAng);
  } else {
    L = ground(dir, avg);
  }
  let c = L * E;
  return c * min(1.0, 30000.0 / max(max(c.r, c.g), max(c.b, 1e-6)));
}

// The whole plate square (±edge) as HDR, for metering and diffusion.
@fragment
fn fsPlate(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
  let p = (pos.xy / sky.dst * 2.0 - 1.0) * sky.edge;
  let dir = plateDir(p);
  let pixAng = max(length(dpdx(dir)), length(dpdy(dir)));
  return vec4<f32>(radiance(dir, pixAng), 1.0);
}

// Lens diffusion: a 13-tap downsample / tent upsample pyramid (Jimenez 2014).
fn tap(uv: vec2<f32>) -> vec3<f32> {
  var c = textureSampleLevel(src, lin, uv, 0.0).rgb;
  if (sky.first != 0u) { c *= min(1.0, 400.0 / max(max(c.r, c.g), max(c.b, 1e-6))); }
  return c;
}

@fragment
fn fsDown(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = pos.xy / sky.dst;
  let t = sky.texel;
  let a = tap(uv + t * vec2<f32>(-2.0, 2.0));
  let b = tap(uv + t * vec2<f32>(0.0, 2.0));
  let c = tap(uv + t * vec2<f32>(2.0, 2.0));
  let d = tap(uv + t * vec2<f32>(-2.0, 0.0));
  let e = tap(uv);
  let f = tap(uv + t * vec2<f32>(2.0, 0.0));
  let g = tap(uv + t * vec2<f32>(-2.0, -2.0));
  let h = tap(uv + t * vec2<f32>(0.0, -2.0));
  let i = tap(uv + t * vec2<f32>(2.0, -2.0));
  let j = tap(uv + t * vec2<f32>(-1.0, 1.0));
  let k = tap(uv + t * vec2<f32>(1.0, 1.0));
  let l = tap(uv + t * vec2<f32>(-1.0, -1.0));
  let m = tap(uv + t * vec2<f32>(1.0, -1.0));
  let sum = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  return vec4<f32>(sum, 1.0);
}

@fragment
fn fsUp(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = pos.xy / sky.dst;
  let t = sky.texel;
  var c = textureSampleLevel(src, lin, uv, 0.0).rgb * 4.0;
  c += (textureSampleLevel(src, lin, uv + vec2<f32>(t.x, 0.0), 0.0).rgb
      + textureSampleLevel(src, lin, uv - vec2<f32>(t.x, 0.0), 0.0).rgb
      + textureSampleLevel(src, lin, uv + vec2<f32>(0.0, t.y), 0.0).rgb
      + textureSampleLevel(src, lin, uv - vec2<f32>(0.0, t.y), 0.0).rgb) * 2.0;
  c += textureSampleLevel(src, lin, uv + t, 0.0).rgb + textureSampleLevel(src, lin, uv - t, 0.0).rgb
     + textureSampleLevel(src, lin, uv + vec2<f32>(t.x, -t.y), 0.0).rgb
     + textureSampleLevel(src, lin, uv + vec2<f32>(-t.x, t.y), 0.0).rgb;
  return vec4<f32>(c / 16.0, 1.0);
}

fn srgb(c: vec3<f32>) -> vec3<f32> {
  return mix(c * 12.92, 1.055 * pow(c, vec3<f32>(1.0 / 2.4)) - 0.055, step(vec3<f32>(0.0031308), c));
}

// One dither dot per fragment: the exact scene at its centre, the plate's
// diffusion mixed in, metered over the whole plate, then the per-channel
// exponential curve (saturated skies; over-bright light runs to white) and
// sRGB. Alpha marks the plate disc.
@fragment
fn fsComposite(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
  let p = sky.origin + pos.xy * sky.block;
  let dir = plateDir(p);
  let pixAng = max(length(dpdx(dir)), length(dpdy(dir)));
  var light = 0.0;
  for (var i = 0; i < 4; i++) {
    for (var j = 0; j < 4; j++) {
      light += dot(textureSampleLevel(meter, lin, (vec2<f32>(f32(i), f32(j)) + 0.5) / 4.0, 0.0).rgb, LUMA);
    }
  }
  let gain = clamp(pow(0.3 / max(light / 16.0, 1e-4), 0.5), 0.4, 1.25);
  let diffused = textureSampleLevel(bloom, lin, p / (2.0 * sky.edge) + 0.5, 0.0).rgb / sky.bloomNorm;
  let c = mix(radiance(dir, pixAng), diffused, sky.diffuse) * gain;
  let inside = select(0.0, 1.0, dot(p, p) <= sky.edge * sky.edge);
  return vec4<f32>(srgb(1.0 - exp(-max(c, vec3<f32>(0.0)))), inside);
}
`;

/** The palette's samples of a shaded picture (rows top-down), in the order
 * `medianCutPalette` takes them from a bottom-up readback: pixel i = k·step
 * of that readback for sample k, packed RGBA8. */
export const GATHER_WGSL = /* wgsl */ `
struct Gather { size: u32, step: u32, count: u32 }

@group(0) @binding(0) var picture: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> samples: array<u32>;
@group(0) @binding(2) var<uniform> gather: Gather;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let k = id.x;
  if (k >= gather.count) { return; }
  let i = k * gather.step;
  let texel = vec2<u32>(i % gather.size, gather.size - 1u - i / gather.size);
  let c = vec4<u32>(round(textureLoad(picture, texel, 0) * 255.0));
  samples[k] = c.x | (c.y << 8u) | (c.z << 16u) | (c.w << 24u);
}
`;
