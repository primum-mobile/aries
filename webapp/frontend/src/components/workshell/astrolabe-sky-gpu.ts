// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The astrolabe's sky pictures (astrolabe-sky.ts) on one WebGPU device:
 * shaded by the WGSL passes (astrolabe-sky-wgsl.ts), Atkinson-dithered with
 * WebGPU compute and copied into the caller's 2D canvas without leaving the
 * GPU. Only the ~6000 pixels the palette's median cut takes come back to
 * JavaScript. The dither is the same error diffusion, palette and 5-bit
 * nearest-colour lookup as astrolabe-sky-dither.ts, in Float32
 * (ditherAtkinsonFloat32 is its exact reference).
 *
 * Error diffusion is serial along a row, but the six Atkinson neighbours of a
 * pixel all lie on earlier skew wavefronts u = x + 2y, so pixels with the same
 * u are independent. A tile is one workgroup: ROWS rows, one invocation each,
 * stepping through SPAN values of u with a storage barrier between steps.
 * Tiles with the same block row plus u column run in one dispatch, after every
 * tile they read (Metaxas 1999, Optimal Parallel Error-Diffusion Dithering).
 * The error kept between steps is small: each row's last eight results, and
 * the last two rows of each block for the block below, so a 3200 px picture
 * needs under 1 MB.
 *
 * `makeSkyPicture` is asynchronous, so the main thread never waits for the
 * GPU: the shading and the palette's samples in one submission, the median
 * cut once they are back, then the dither, and the copy into the 2D canvas
 * after the GPU has finished. `ditherPictureOnGpu` dithers a picture shaded
 * elsewhere (the WebGL sky of exports) synchronously: WebKit waits for the
 * GPU where a WebGPU canvas is drawn into a 2D canvas. Device and pipelines
 * come up asynchronously on first ask and must pass a self-test against the
 * Float32 reference; until then, and after any failure, the caller shades
 * with WebGL and dithers on the CPU.
 */

import { ditherAtkinsonFloat32, paletteLookupTable, paletteSampleStep, platePalette, platePaletteOfSamples } from "./astrolabe-sky-dither";
import { GATHER_WGSL, SKY_UNIFORM, SKY_UNIFORM_BYTES, SKY_WGSL } from "./astrolabe-sky-wgsl";

/** Rows (invocations) per tile and u steps per tile: the fastest measured in
 * the app's WebKit on an M2 (64 x 64 was up to 25 % slower, a workgroup-memory
 * ring no faster). */
const ROWS = 64;
const SPAN = 32;
/** Results kept per row: the six reads reach four steps back while the row writes the current one. */
const RING = 8;
/** u values kept of each block's last two rows: the block below reads up to a
 * tile behind while the block writes a tile ahead. */
const EDGE = 4 * SPAN;
/** Bytes between the dispatches' parameters (minUniformBufferOffsetAlignment). */
const PARAMS_STRIDE = 256;
/** Palette colours the kernel's buffer holds; platePalette makes 17. */
const PALETTE_MAX = 32;
/** Self-test picture side: three row blocks, the last one partial, and several tiles in u. */
const TEST_SIZE = 131;
/** Bytes between the sky passes' uniform blocks, and blocks kept: more than
 * one picture's passes (lookups, mip chain, plate, diffusion, two composites). */
const UNIFORM_SLOT = 256;
const UNIFORM_SLOTS = 32;
/** Picture sizes whose targets are kept: the three tiers. */
const PICTURES_KEPT = 3;

/** The kernel, exported for the offline check against ditherAtkinsonFloat32. */
export const ATKINSON_WGSL = /* wgsl */ `
struct Params { w: u32, h: u32, stage: u32, span: u32, edge: u32 }

@group(0) @binding(0) var source: texture_2d<f32>;                    // RGBA8, rows top-down
@group(0) @binding(1) var<storage, read> palette: array<vec4<f32>>;   // sRGB 0..255
@group(0) @binding(2) var<storage, read> lookup: array<u32>;          // 32768 palette indices
@group(0) @binding(3) var<storage, read_write> ring: array<vec4<f32>>;  // h x ${RING}, by u
@group(0) @binding(4) var<storage, read_write> edge: array<vec4<f32>>;  // blocks x 2 x edge, by u
@group(0) @binding(5) var dithered: texture_storage_2d<rgba8unorm, write>;  // rows top-down
@group(0) @binding(6) var<uniform> params: Params;

override rows: u32 = ${ROWS}u;

// The error share pixel (x, y) passed on, read by a pixel of block \`block\`.
// Rows above the block come from that block's last two rows.
fn residual(x: i32, y: i32, block: u32) -> vec4<f32> {
  if (x < 0 || y < 0 || x >= i32(params.w)) { return vec4<f32>(0.0); }
  let u = u32(x + 2 * y);
  if (u32(y) < block * rows) {
    return edge[((block - 1u) * 2u + (u32(y) & 1u)) * params.edge + u % params.edge];
  }
  return ring[u32(y) * ${RING}u + (u & ${RING - 1}u)];
}

@compute @workgroup_size(rows)
fn main(@builtin(local_invocation_index) row: u32, @builtin(workgroup_id) group: vec3<u32>) {
  let block = group.x;
  let i = i32(params.stage) - i32(block);
  let reach = params.w + 2u * (params.h - 1u);
  if (i < 0 || u32(i) * params.span >= reach) { return; }
  let y = i32(block * rows + row);
  for (var du = 0u; du < params.span; du++) {
    let u = u32(i) * params.span + du;
    let x = i32(u) - 2 * y;
    if (y < i32(params.h) && x >= 0 && x < i32(params.w)) {
      // The six incoming shares, added in raster order as the CPU does.
      var e = residual(x, y - 2, block);
      e = e + residual(x - 1, y - 1, block);
      e = e + residual(x, y - 1, block);
      e = e + residual(x + 1, y - 1, block);
      e = e + residual(x - 2, y, block);
      e = e + residual(x - 1, y, block);
      let c = vec4<f32>(round(textureLoad(source, vec2<i32>(x, y), 0).xyz * 255.0), 255.0) + e;
      let cell = vec3<u32>(clamp(c.xyz, vec3<f32>(0.0), vec3<f32>(255.0))) >> vec3<u32>(3u);
      let p = palette[lookup[(cell.x << 10u) | (cell.y << 5u) | cell.z]];
      let share = (c - vec4<f32>(p.xyz, 255.0)) * 0.125;
      ring[u32(y) * ${RING}u + (u & ${RING - 1}u)] = share;
      if (row + 2u >= rows) { edge[(block * 2u + (u32(y) & 1u)) * params.edge + u % params.edge] = share; }
      textureStore(dithered, vec2<i32>(x, y), vec4<f32>(round(p.xyz), 255.0) / 255.0);
    }
    storageBarrier();
  }
}
`;

// ---------------------------------------------------------------------------
// The few WebGPU types used here (TypeScript's DOM library has none yet).
// ---------------------------------------------------------------------------

export type GpuBuffer = {
  size: number;
  destroy(): void;
  mapAsync(mode: number): Promise<void>;
  getMappedRange(): ArrayBuffer;
  unmap(): void;
};
type GpuTextureView = object;
export type GpuTexture = {
  width: number;
  height: number;
  createView(descriptor?: { baseMipLevel?: number; mipLevelCount?: number }): GpuTextureView;
  destroy(): void;
};
type GpuPipeline = { getBindGroupLayout(index: number): object };
type GpuComputePass = {
  setPipeline(pipeline: object): void;
  setBindGroup(index: number, group: object, offsets?: number[]): void;
  dispatchWorkgroups(x: number): void;
  end(): void;
};
type GpuRenderPass = {
  setPipeline(pipeline: object): void;
  setBindGroup(index: number, group: object): void;
  setBlendConstant(colour: { r: number; g: number; b: number; a: number }): void;
  draw(vertices: number): void;
  end(): void;
};
export type GpuCommandEncoder = {
  beginComputePass(): GpuComputePass;
  beginRenderPass(descriptor: { colorAttachments: object[] }): GpuRenderPass;
  copyBufferToBuffer(source: GpuBuffer, sourceOffset: number, target: GpuBuffer, targetOffset: number, size: number): void;
  copyTextureToTexture(source: { texture: GpuTexture }, target: { texture: GpuTexture }, size: [number, number]): void;
  finish(): object;
};
export type GpuDevice = {
  queue: {
    writeBuffer(buffer: GpuBuffer, offset: number, data: ArrayBufferView): void;
    writeTexture(target: { texture: GpuTexture }, data: ArrayBufferView, layout: { bytesPerRow: number; rowsPerImage: number }, size: [number, number]): void;
    submit(buffers: object[]): void;
    onSubmittedWorkDone(): Promise<void>;
  };
  lost: Promise<{ message: string }>;
  createBuffer(descriptor: { size: number; usage: number }): GpuBuffer;
  createTexture(descriptor: { size: [number, number]; format: string; usage: number; mipLevelCount?: number }): GpuTexture;
  createSampler(descriptor: object): object;
  createShaderModule(descriptor: { code: string }): object;
  createBindGroupLayout(descriptor: { entries: object[] }): object;
  createPipelineLayout(descriptor: { bindGroupLayouts: object[] }): object;
  createComputePipelineAsync(descriptor: object): Promise<GpuPipeline>;
  createRenderPipelineAsync(descriptor: object): Promise<GpuPipeline>;
  createBindGroup(descriptor: { layout: object; entries: object[] }): object;
  createCommandEncoder(): GpuCommandEncoder;
  addEventListener(type: "uncapturederror", listener: (event: Event & { error?: { message: string } }) => void): void;
  destroy(): void;
};
type GpuCanvasContext = {
  configure(configuration: { device: GpuDevice; format: string; usage: number; alphaMode: string }): void;
  getCurrentTexture(): GpuTexture;
};
type Gpu = { requestAdapter(): Promise<{ requestDevice(): Promise<GpuDevice> } | null> };

const BUFFER = { MAP_READ: 1, COPY_SRC: 4, COPY_DST: 8, UNIFORM: 64, STORAGE: 128 } as const;
const TEXTURE = { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 } as const;
const STAGE_COMPUTE = 4;
const MAP_READ = 1;

type Sized = { buffer: GpuBuffer; bytes: number };
/** The compiled kernel and its buffers on one device, sized for the largest picture yet. */
export type AtkinsonKernel = {
  device: GpuDevice;
  pipeline: object;
  layout: object;
  paletteBuffer: GpuBuffer;
  lookupBuffer: GpuBuffer;
  /** The palette the palette and lookup buffers hold. */
  palette: Float32Array | null;
  ring: Sized | null;
  edge: Sized | null;
  params: Sized | null;
  /** The picture size `params` holds the dispatches' parameters for. */
  paramsSize: number;
};

/** Dispatches for a `w` x `h` picture: one per tile column plus block row. */
const stagesFor = (w: number, h: number) => Math.ceil((w + 2 * (h - 1)) / SPAN) + Math.ceil(h / ROWS) - 1;

/** A buffer at least `bytes` long, the old one kept when it already is. */
function sized(device: GpuDevice, held: Sized | null, bytes: number, usage: number): Sized {
  if (held && held.bytes >= bytes) return held;
  held?.buffer.destroy();
  const size = Math.max(16, Math.ceil(bytes / 16) * 16);
  return { buffer: device.createBuffer({ size, usage }), bytes: size };
}

/** Compile the kernel on `device`; the offline check runs it under Deno. */
export async function createAtkinsonKernel(device: GpuDevice): Promise<AtkinsonKernel> {
  const storage = (binding: number, type: "read-only-storage" | "storage") => (
    { binding, visibility: STAGE_COMPUTE, buffer: { type } });
  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: STAGE_COMPUTE, texture: { sampleType: "float" } },
      storage(1, "read-only-storage"),
      storage(2, "read-only-storage"),
      storage(3, "storage"),
      storage(4, "storage"),
      { binding: 5, visibility: STAGE_COMPUTE, storageTexture: { access: "write-only", format: "rgba8unorm" } },
      { binding: 6, visibility: STAGE_COMPUTE, buffer: { type: "uniform", hasDynamicOffset: true } },
    ],
  });
  const pipeline = await device.createComputePipelineAsync({
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: { module: device.createShaderModule({ code: ATKINSON_WGSL }), entryPoint: "main", constants: { rows: ROWS } },
  });
  return {
    device, pipeline, layout,
    paletteBuffer: device.createBuffer({ size: PALETTE_MAX * 16, usage: BUFFER.STORAGE | BUFFER.COPY_DST }),
    lookupBuffer: device.createBuffer({ size: 4 << 15, usage: BUFFER.STORAGE | BUFFER.COPY_DST }),
    palette: null, ring: null, edge: null, params: null, paramsSize: 0,
  };
}

/**
 * Encode the dither of one shaded picture (`source`, a view of an RGBA8
 * texture `size` square, rows top-down) onto `palette` (at most PALETTE_MAX
 * colours) into `output`, a view of an rgba8unorm storage texture at least
 * `size` square, rows top-down. Returns the command buffer to submit next.
 */
export function encodeAtkinson(kernel: AtkinsonKernel, source: GpuTextureView, size: number, palette: Float32Array, output: GpuTextureView): object {
  const { device } = kernel;
  if (palette.length > PALETTE_MAX * 3) throw new Error(`the GPU dither takes at most ${PALETTE_MAX} colours`);
  if (kernel.palette !== palette) {
    const colours = new Float32Array(PALETTE_MAX * 4);
    for (let k = 0; k < palette.length / 3; k++) colours.set(palette.subarray(3 * k, 3 * k + 3), 4 * k);
    device.queue.writeBuffer(kernel.paletteBuffer, 0, colours);
    device.queue.writeBuffer(kernel.lookupBuffer, 0, Uint32Array.from(paletteLookupTable(palette)));
    kernel.palette = palette;
  }
  const blocks = Math.ceil(size / ROWS);
  const stages = stagesFor(size, size);
  kernel.ring = sized(device, kernel.ring, size * RING * 16, BUFFER.STORAGE);
  kernel.edge = sized(device, kernel.edge, blocks * 2 * EDGE * 16, BUFFER.STORAGE);
  kernel.params = sized(device, kernel.params, stages * PARAMS_STRIDE, BUFFER.UNIFORM | BUFFER.COPY_DST);
  if (kernel.paramsSize !== size) {
    const params = new Uint32Array((stages * PARAMS_STRIDE) / 4);
    for (let stage = 0; stage < stages; stage++) params.set([size, size, stage, SPAN, EDGE], (stage * PARAMS_STRIDE) / 4);
    device.queue.writeBuffer(kernel.params.buffer, 0, params);
    kernel.paramsSize = size;
  }
  const group = device.createBindGroup({
    layout: kernel.layout,
    entries: [
      { binding: 0, resource: source },
      { binding: 1, resource: { buffer: kernel.paletteBuffer } },
      { binding: 2, resource: { buffer: kernel.lookupBuffer } },
      { binding: 3, resource: { buffer: kernel.ring.buffer } },
      { binding: 4, resource: { buffer: kernel.edge.buffer } },
      { binding: 5, resource: output },
      { binding: 6, resource: { buffer: kernel.params.buffer, size: 32 } },
    ],
  });
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(kernel.pipeline);
  for (let stage = 0; stage < stages; stage++) {
    pass.setBindGroup(0, group, [stage * PARAMS_STRIDE]);
    pass.dispatchWorkgroups(blocks);
  }
  pass.end();
  return encoder.finish();
}

// ---------------------------------------------------------------------------
// Sky shading
// ---------------------------------------------------------------------------

/** Everything the sky's passes take for one plate, Sun and look (astrolabe-sky.ts). */
export type SkyShading = {
  polar: boolean;
  /** sin, cos of the plate latitude. */
  lat: readonly [number, number];
  /** The true Sun in the plate's horizon frame (east, north, up). */
  sunDir: readonly [number, number, number];
  haze: number;
  ozone: number;
  ext0: readonly [number, number, number];
  viewR: number;
  beta: number;
  camC: number;
  expK: number;
  expMax: number;
  expScale: number;
  /** Plate edge radius, plate units. */
  edge: number;
  diffuse: number;
  bloomNorm: number;
  bloomFalloff: number;
  /** Plate-space image px across, and diffusion levels. */
  platePx: number;
  bloomLevels: number;
  /** What the lookup textures, the sky view and the plate-space image depend on. */
  atmosKey: string;
  skyKey: string;
  plateKey: string;
};

type SkyPass = "trans" | "multi" | "sky" | "mip" | "plate" | "down" | "up" | "composite";
const PASS_ENTRY: Record<SkyPass, string> = {
  trans: "fsTrans", multi: "fsMulti", sky: "fsSky", mip: "fsMip",
  plate: "fsPlate", down: "fsDown", up: "fsUp", composite: "fsComposite",
};
/** Texture bindings of SKY_WGSL; any texture takes the sampler (binding 1) along. */
const TEXTURE_BINDING_OF = { trans: 2, ms: 3, skyView: 4, src: 5, bloom: 6, meter: 7 } as const;
type SkyTextures = Partial<Record<keyof typeof TEXTURE_BINDING_OF, GpuTextureView>>;
type PassUniforms = {
  dst?: readonly [number, number];
  texel?: readonly [number, number];
  origin?: readonly [number, number];
  block?: number;
  first?: boolean;
};
const SKY_VIEW = [192, 108] as const;
const SKY_VIEW_LEVELS = 8;

/** One picture size's targets: the shaded picture and its dither. */
export type PictureTargets = { shaded: GpuTexture; dithered: GpuTexture };
export type SkyShader = {
  pipelines: Record<SkyPass, GpuPipeline>;
  gather: GpuPipeline;
  sampler: object;
  uniforms: GpuBuffer;
  slot: number;
  trans: GpuTexture;
  multi: GpuTexture;
  skyView: GpuTexture;
  /** The plate-space image and its diffusion pyramid, made at the first picture. */
  hdr: GpuTexture | null;
  mips: GpuTexture[];
  /** Targets by dots across, most recent last. */
  pictures: Map<number, PictureTargets>;
  atmosKey: string;
  skyKey: string;
  plateKey: string;
};

/** Compile the sky's passes and the palette's gather on `device`; the offline check runs them under Deno. */
export async function createSkyShader(device: GpuDevice): Promise<SkyShader> {
  const shaders = device.createShaderModule({ code: SKY_WGSL });
  const additive = { srcFactor: "constant", dstFactor: "one", operation: "add" };
  const pipeline = (pass: SkyPass) => device.createRenderPipelineAsync({
    layout: "auto",
    vertex: { module: shaders, entryPoint: "vs" },
    fragment: {
      module: shaders,
      entryPoint: PASS_ENTRY[pass],
      targets: [{
        format: pass === "composite" ? "rgba8unorm" : "rgba16float",
        ...(pass === "up" ? { blend: { color: additive, alpha: additive } } : {}),
      }],
    },
    primitive: { topology: "triangle-list" },
  });
  const passes = Object.keys(PASS_ENTRY) as SkyPass[];
  const [compiled, gather] = await Promise.all([
    Promise.all(passes.map(pipeline)),
    device.createComputePipelineAsync({
      layout: "auto",
      compute: { module: device.createShaderModule({ code: GATHER_WGSL }), entryPoint: "main" },
    }),
  ]);
  const lookup = (w: number, h: number, mipLevelCount = 1) => device.createTexture({
    size: [w, h], format: "rgba16float", usage: TEXTURE.RENDER_ATTACHMENT | TEXTURE.TEXTURE_BINDING, mipLevelCount,
  });
  return {
    pipelines: Object.fromEntries(passes.map((pass, i) => [pass, compiled[i]])) as Record<SkyPass, GpuPipeline>,
    gather,
    sampler: device.createSampler({
      magFilter: "linear", minFilter: "linear", mipmapFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge",
    }),
    uniforms: device.createBuffer({ size: UNIFORM_SLOT * UNIFORM_SLOTS, usage: BUFFER.UNIFORM | BUFFER.COPY_DST }),
    slot: 0,
    trans: lookup(256, 64),
    multi: lookup(32, 32),
    skyView: lookup(SKY_VIEW[0], SKY_VIEW[1], SKY_VIEW_LEVELS),
    hdr: null,
    mips: [],
    pictures: new Map(),
    atmosKey: "", skyKey: "", plateKey: "",
  };
}

/** One `Sky` uniform block (SKY_UNIFORM's word layout). */
function skyBlock(shading: SkyShading, pass: PassUniforms): Float32Array {
  const words = new Float32Array(SKY_UNIFORM_BYTES / 4);
  const ints = new Uint32Array(words.buffer);
  const at = SKY_UNIFORM;
  words.set(shading.sunDir, at.sunDir);
  words[at.haze] = shading.haze;
  words.set(shading.ext0, at.ext0);
  words[at.ozone] = shading.ozone;
  words.set(shading.lat, at.lat);
  words[at.viewR] = shading.viewR;
  words[at.beta] = shading.beta;
  words[at.camC] = shading.camC;
  words[at.sunMu] = shading.sunDir[2];
  words[at.expK] = shading.expK;
  words[at.expMax] = shading.expMax;
  words[at.expScale] = shading.expScale;
  words[at.edge] = shading.edge;
  words[at.diffuse] = shading.diffuse;
  words[at.bloomNorm] = shading.bloomNorm;
  words.set(pass.origin ?? [0, 0], at.origin);
  words.set(pass.texel ?? [0, 0], at.texel);
  words.set(pass.dst ?? [0, 0], at.dst);
  words[at.block] = pass.block ?? 0;
  ints[at.polar] = shading.polar ? 1 : 0;
  ints[at.first] = pass.first ? 1 : 0;
  return words;
}

/** One full-target triangle of `pass` into `target`; `blend` adds onto it at the bloom falloff. */
function drawPass(
  device: GpuDevice,
  shader: SkyShader,
  encoder: GpuCommandEncoder,
  pass: SkyPass,
  target: GpuTextureView,
  shading: SkyShading,
  uniforms: PassUniforms,
  textures: SkyTextures = {},
  blend = false,
) {
  const offset = (shader.slot++ % UNIFORM_SLOTS) * UNIFORM_SLOT;
  device.queue.writeBuffer(shader.uniforms, offset, skyBlock(shading, uniforms));
  const pipeline = shader.pipelines[pass];
  const entries: object[] = [{ binding: 0, resource: { buffer: shader.uniforms, offset, size: SKY_UNIFORM_BYTES } }];
  const views = Object.entries(textures) as Array<[keyof typeof TEXTURE_BINDING_OF, GpuTextureView]>;
  if (views.length) entries.push({ binding: 1, resource: shader.sampler });
  for (const [name, view] of views) entries.push({ binding: TEXTURE_BINDING_OF[name], resource: view });
  const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries });
  const render = encoder.beginRenderPass({
    colorAttachments: [{ view: target, loadOp: blend ? "load" : "clear", clearValue: { r: 0, g: 0, b: 0, a: 0 }, storeOp: "store" }],
  });
  render.setPipeline(pipeline);
  render.setBindGroup(0, group);
  if (blend) render.setBlendConstant({ r: shading.bloomFalloff, g: shading.bloomFalloff, b: shading.bloomFalloff, a: 1 });
  render.draw(3);
  render.end();
}

/** Lookup textures, then the plate-space image and its diffusion pyramid, for this Sun and look. */
function prepareSky(device: GpuDevice, shader: SkyShader, encoder: GpuCommandEncoder, shading: SkyShading) {
  if (shading.atmosKey !== shader.atmosKey) {
    drawPass(device, shader, encoder, "trans", shader.trans.createView(), shading, {});
    drawPass(device, shader, encoder, "multi", shader.multi.createView(), shading, {}, { trans: shader.trans.createView() });
    shader.atmosKey = shading.atmosKey;
    shader.skyKey = "";
  }
  if (shading.skyKey !== shader.skyKey) {
    const level = (mip: number) => shader.skyView.createView({ baseMipLevel: mip, mipLevelCount: 1 });
    drawPass(device, shader, encoder, "sky", level(0), shading, {},
      { trans: shader.trans.createView(), ms: shader.multi.createView() });
    for (let mip = 1; mip < SKY_VIEW_LEVELS; mip++) {
      const dst = [Math.max(1, SKY_VIEW[0] >> mip), Math.max(1, SKY_VIEW[1] >> mip)] as const;
      drawPass(device, shader, encoder, "mip", level(mip), shading, { dst }, { src: level(mip - 1) });
    }
    shader.skyKey = shading.skyKey;
    shader.plateKey = "";
  }
  if (shading.plateKey === shader.plateKey) return;
  if (shader.hdr?.width !== shading.platePx || shader.mips.length !== shading.bloomLevels) {
    shader.hdr?.destroy();
    for (const m of shader.mips) m.destroy();
    const target = (side: number) => device.createTexture({
      size: [side, side], format: "rgba16float", usage: TEXTURE.RENDER_ATTACHMENT | TEXTURE.TEXTURE_BINDING,
    });
    shader.hdr = target(shading.platePx);
    shader.mips = Array.from({ length: shading.bloomLevels }, (_, i) => target(shading.platePx >> (i + 1)));
  }
  const hdr = shader.hdr;
  drawPass(device, shader, encoder, "plate", hdr.createView(), shading, { dst: [shading.platePx, shading.platePx] },
    { trans: shader.trans.createView(), skyView: shader.skyView.createView() });
  let src = hdr;
  shader.mips.forEach((m, i) => {
    drawPass(device, shader, encoder, "down", m.createView(), shading,
      { texel: [1 / src.width, 1 / src.height], dst: [m.width, m.height], first: i === 0 }, { src: src.createView() });
    src = m;
  });
  // Each wider level adds at the bloom falloff of the one inside it: a long, soft tail.
  for (let i = shader.mips.length - 1; i > 0; i--) {
    const from = shader.mips[i];
    const to = shader.mips[i - 1];
    drawPass(device, shader, encoder, "up", to.createView(), shading,
      { texel: [1 / from.width, 1 / from.height], dst: [to.width, to.height] }, { src: from.createView() }, true);
  }
  shader.plateKey = shading.plateKey;
}

/** The targets of a picture `size` dots across, kept for the last few sizes. */
function pictureTargets(device: GpuDevice, shader: SkyShader, size: number): PictureTargets {
  const held = shader.pictures.get(size);
  if (held) {
    shader.pictures.delete(size);
    shader.pictures.set(size, held);
    return held;
  }
  const targets = {
    shaded: device.createTexture({
      size: [size, size], format: "rgba8unorm",
      usage: TEXTURE.RENDER_ATTACHMENT | TEXTURE.TEXTURE_BINDING | TEXTURE.COPY_DST | TEXTURE.COPY_SRC,
    }),
    dithered: device.createTexture({
      size: [size, size], format: "rgba8unorm", usage: TEXTURE.STORAGE_BINDING | TEXTURE.COPY_SRC,
    }),
  };
  shader.pictures.set(size, targets);
  for (const [old, stale] of shader.pictures) {
    if (shader.pictures.size <= PICTURES_KEPT) break;
    stale.shaded.destroy();
    stale.dithered.destroy();
    shader.pictures.delete(old);
  }
  return targets;
}

/** Encode the whole plate square shaded `size` dots across for `shading`
 * (lookups and plate image first where they changed) into that size's
 * targets, rows top-down; returns them. */
export function encodeSkyShading(
  device: GpuDevice,
  shader: SkyShader,
  encoder: GpuCommandEncoder,
  shading: SkyShading,
  size: number,
): PictureTargets {
  prepareSky(device, shader, encoder, shading);
  const targets = pictureTargets(device, shader, size);
  const mips = shader.mips;
  drawPass(device, shader, encoder, "composite", targets.shaded.createView(), shading,
    { origin: [-shading.edge, -shading.edge], block: (2 * shading.edge) / size },
    {
      trans: shader.trans.createView(),
      skyView: shader.skyView.createView(),
      bloom: mips[0].createView(),
      meter: mips[mips.length - 1].createView(),
    });
  return targets;
}

/** Encode the copy of the palette's samples of a shaded picture (`size`
 * square) into a mappable buffer, in `platePalette`'s order over a bottom-up
 * readback; map it once submitted. */
export function gatherSamples(device: GpuDevice, shader: SkyShader, encoder: GpuCommandEncoder, shaded: GpuTexture, size: number): GpuBuffer {
  const total = size * size;
  const step = paletteSampleStep(total);
  const count = Math.ceil(total / step);
  const bytes = count * 4;
  const samples = device.createBuffer({ size: bytes, usage: BUFFER.STORAGE | BUFFER.COPY_SRC });
  const read = device.createBuffer({ size: bytes, usage: BUFFER.MAP_READ | BUFFER.COPY_DST });
  const params = device.createBuffer({ size: 16, usage: BUFFER.UNIFORM | BUFFER.COPY_DST });
  device.queue.writeBuffer(params, 0, Uint32Array.from([size, step, count, 0]));
  const pass = encoder.beginComputePass();
  pass.setPipeline(shader.gather);
  pass.setBindGroup(0, device.createBindGroup({
    layout: shader.gather.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: shaded.createView() },
      { binding: 1, resource: { buffer: samples } },
      { binding: 2, resource: { buffer: params } },
    ],
  }));
  pass.dispatchWorkgroups(Math.ceil(count / 64));
  pass.end();
  encoder.copyBufferToBuffer(samples, 0, read, 0, bytes);
  return read;
}

// ---------------------------------------------------------------------------
// Device, presentation and the public calls
// ---------------------------------------------------------------------------

type GpuSky = {
  kernel: AtkinsonKernel;
  shader: SkyShader;
  canvas: HTMLCanvasElement;
  context: GpuCanvasContext;
  /** Targets for pictures shaded elsewhere and uploaded (`ditherPictureOnGpu`). */
  upload: PictureTargets | null;
};

/** undefined = not asked yet (or the device was lost), null = unavailable,
 * a promise while it comes up. */
let gpu: GpuSky | Promise<GpuSky | null> | null | undefined;

async function startGpu(): Promise<GpuSky | null> {
  const navigatorGpu = (navigator as Navigator & { gpu?: Gpu }).gpu;
  if (!navigatorGpu) return null;
  const adapter = await navigatorGpu.requestAdapter();
  if (!adapter) return null;
  const device = await adapter.requestDevice();
  const [kernel, shader] = await Promise.all([createAtkinsonKernel(device), createSkyShader(device)]);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("webgpu") as unknown as GpuCanvasContext | null;
  if (!context) throw new Error("there is no WebGPU canvas");
  context.configure({
    device,
    format: "rgba8unorm",
    usage: TEXTURE.COPY_DST | TEXTURE.RENDER_ATTACHMENT,
    alphaMode: "opaque",
  });
  const state: GpuSky = { kernel, shader, canvas, context, upload: null };
  device.addEventListener("uncapturederror", (event) => {
    console.warn("[astrolabe-sky] The GPU sky failed; the sky is shaded with WebGL and dithered on the CPU.", event.error?.message);
    if (gpu === state) gpu = null;
  });
  void device.lost.then((info) => {
    if (gpu !== state) return;
    console.warn("[astrolabe-sky] The GPU sky's device was lost.", info.message);
    gpu = undefined;
  });
  if (!selfTest(state)) {
    device.destroy();
    throw new Error("its pictures differ from the Float32 reference");
  }
  return state;
}

/** Rows bottom-up (a readback) to rows top-down (a texture). */
function topDown(pixels: Uint8Array, size: number): Uint8Array {
  const row = size * 4;
  const rows = new Uint8Array(size * row);
  for (let y = 0; y < size; y++) rows.set(pixels.subarray((size - 1 - y) * row, (size - y) * row), y * row);
  return rows;
}

/** Copy a dithered picture through the WebGPU canvas into `into` (a 2D canvas, sized here). */
function present(state: GpuSky, texture: GpuTexture, size: number, into: HTMLCanvasElement) {
  const { kernel, canvas, context } = state;
  if (canvas.width !== size) canvas.width = size;
  if (canvas.height !== size) canvas.height = size;
  const encoder = kernel.device.createCommandEncoder();
  encoder.copyTextureToTexture({ texture }, { texture: context.getCurrentTexture() }, [size, size]);
  kernel.device.queue.submit([encoder.finish()]);
  if (into.width !== size) into.width = size;
  if (into.height !== size) into.height = size;
  const ctx = into.getContext("2d");
  if (!ctx) throw new Error("there is no 2D canvas");
  // WebKit finishes the GPU work here: the picture is in `into` on return.
  ctx.drawImage(canvas, 0, 0);
}

/** Upload a picture (RGBA, rows bottom-up) and dither it into `into`, synchronously. */
function ditherUploaded(state: GpuSky, pixels: Uint8Array, size: number, palette: Float32Array, into: HTMLCanvasElement) {
  const { device } = state.kernel;
  if (state.upload?.shaded.width !== size) {
    state.upload?.shaded.destroy();
    state.upload?.dithered.destroy();
    state.upload = {
      shaded: device.createTexture({ size: [size, size], format: "rgba8unorm", usage: TEXTURE.TEXTURE_BINDING | TEXTURE.COPY_DST }),
      dithered: device.createTexture({ size: [size, size], format: "rgba8unorm", usage: TEXTURE.STORAGE_BINDING | TEXTURE.COPY_SRC }),
    };
  }
  const { shaded, dithered } = state.upload;
  device.queue.writeTexture({ texture: shaded }, topDown(pixels, size), { bytesPerRow: size * 4, rowsPerImage: size }, [size, size]);
  device.queue.submit([encodeAtkinson(state.kernel, shaded.createView(), size, palette, dithered.createView())]);
  present(state, dithered, size, into);
}

/** Dither a picture with gradients, a sharp disc and grain on the GPU, through
 * the real canvas path, and on the CPU's Float32 reference; true when every
 * dot matches. */
function selfTest(state: GpuSky): boolean {
  const n = TEST_SIZE;
  const pixels = new Uint8Array(n * n * 4);
  let seed = 7;
  const byte = (v: number) => Math.min(255, Math.max(0, Math.round(v)));
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      const grain = (seed >>> 24) / 255 - 0.5;
      const sun = Math.hypot(x - 90, y - 40) < 9 ? 1 : 0;
      const o = (y * n + x) * 4;
      pixels[o] = byte(30 + 180 * (x / n) + 60 * grain + 255 * sun);
      pixels[o + 1] = byte(60 + 120 * (y / n) * (x / n) + 40 * grain + 200 * sun);
      pixels[o + 2] = byte(200 - 150 * (y / n) + 30 * grain);
      pixels[o + 3] = 255;
    }
  }
  const palette = platePalette(pixels);
  const target = document.createElement("canvas");
  ditherUploaded(state, pixels, n, palette, target);
  const got = target.getContext("2d")?.getImageData(0, 0, n, n).data;
  const expected = new Uint8ClampedArray(n * n * 4);
  ditherAtkinsonFloat32(pixels, n, n, palette, paletteLookupTable(palette), expected);
  return Boolean(got && got.every((value, i) => value === expected[i]));
}

const readyGpu = (): GpuSky | null => (gpu && !(gpu instanceof Promise) ? gpu : null);

/** True once the GPU sky is up; the first ask starts it. */
export function gpuSkyReady(): boolean {
  if (gpu === undefined && typeof document !== "undefined") {
    const starting = startGpu().catch((err) => {
      console.warn("[astrolabe-sky] The GPU sky is unavailable; the sky is shaded with WebGL and dithered on the CPU.", err);
      return null;
    });
    gpu = starting;
    void starting.then((state) => {
      if (gpu === starting) gpu = state;
    });
  }
  return Boolean(readyGpu());
}

/** Give the GPU sky up after a failure the caller met; WebGL and the CPU take over. */
export function dropGpuSky(err: unknown) {
  console.warn("[astrolabe-sky] The GPU sky failed; the sky is shaded with WebGL and dithered on the CPU.", err);
  gpu = null;
}

/**
 * Dither one shaded plate picture (RGBA, rows bottom-up, `size` square) onto
 * `palette` into the 2D canvas `into`, rows top-down, on the GPU. False when
 * the GPU sky is not up or fails; the caller then dithers on the CPU.
 */
export function ditherPictureOnGpu(pixels: Uint8Array, size: number, palette: Float32Array, into: HTMLCanvasElement): boolean {
  const state = readyGpu();
  if (!state) return false;
  try {
    ditherUploaded(state, pixels, size, palette, into);
    return true;
  } catch (err) {
    dropGpuSky(err);
    return false;
  }
}

/**
 * Shade the whole plate square `size` dots across for `shading` and dither it
 * into the 2D canvas `into`, all on the GPU, on `palette`, or when that is
 * null on the median cut of the base picture (`base` dots across) plus its
 * brightest pixel, as `platePalette` takes it. Resolves with the palette once
 * the picture is in `into`; rejects when the GPU sky is not up or is lost.
 */
export async function makeSkyPicture(
  shading: SkyShading,
  base: number,
  size: number,
  palette: Float32Array | null,
  into: HTMLCanvasElement,
): Promise<Float32Array> {
  const state = readyGpu();
  if (!state) throw new Error("the GPU sky is not up");
  const { kernel, shader } = state;
  const { device } = kernel;
  const encoder = device.createCommandEncoder();
  const baseTargets = encodeSkyShading(device, shader, encoder, shading, base);
  const read = palette ? null : gatherSamples(device, shader, encoder, baseTargets.shaded, base);
  device.queue.submit([encoder.finish()]);
  let colours = palette;
  if (read) {
    await read.mapAsync(MAP_READ);
    const samples = new Uint8Array(read.getMappedRange().slice(0));
    read.unmap();
    read.destroy();
    colours = platePaletteOfSamples(samples);
  }
  if (readyGpu() !== state || !colours) throw new Error("the GPU sky was lost");
  const second = device.createCommandEncoder();
  const shown = size === base ? baseTargets : encodeSkyShading(device, shader, second, shading, size);
  device.queue.submit([second.finish(), encodeAtkinson(kernel, shown.shaded.createView(), size, colours, shown.dithered.createView())]);
  await device.queue.onSubmittedWorkDone();
  if (readyGpu() !== state) throw new Error("the GPU sky was lost");
  present(state, shown.dithered, size, into);
  return colours;
}
