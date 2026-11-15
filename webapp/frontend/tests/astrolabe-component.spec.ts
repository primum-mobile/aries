// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import type { AstrolabeAsterisms, AstrolabeViewState } from "../src/lib/daemon/client";
import { astrolabeReteTurn, hitAstrolabeRete, type AstrolabeHoverTarget, type AstrolabeReteSurface } from "../src/components/workshell/astrolabe-canvas";
import type { HoverRegion } from "../src/stores/workspace-store";
import stereo from "../src/design-lab/fixtures/morinus/astrolabe-stereographic.json";
import polar from "../src/design-lab/fixtures/morinus/astrolabe-polar.json";

let bundle: string;
test.beforeEach(({ page }) => {
  page.on("pageerror", (error) => { throw error; });
});
const asterismFixture: AstrolabeAsterisms = { paths: [], stars: [
  { name: "Alpheratz", nom: "alAnd", x: -0.4, y: 0.3, ra: 2, decl: 29, lon: 14, position: "14° Aries", mag: 2.07 },
  { name: "HIP 13949", nom: "HIP 13949", x: 0.4, y: -0.3, ra: 40, decl: 20, lon: 40, position: "10° Taurus", mag: 5.89 },
] };
test.beforeAll(async () => {
  const result = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React, {useState,useEffect} from 'react';
      import {createRoot} from 'react-dom/client';
      import {AstrolabeView,renderStereographicAstrolabe} from './src/components/workshell/astrolabe-view';
      import {renderPolarAzimuthal} from './src/components/workshell/astrolabe-polar-render';
      import {resolveAstrolabeRenderStyle} from './src/lib/chart/astrolabe-render-style';
      import {readCommonRingFill,findHoverTarget,createAstrolabeReteSurface} from './src/components/workshell/astrolabe-canvas';
      import {astrolabeZoomFromCamera} from './src/lib/chart/astrolabe-camera';
      import {useWorkspaceStore} from './src/stores/workspace-store';
      import {useDaemonWorkspaceStore} from './src/stores/daemon-workspace-store';
      import {useFrameLayoutStore} from './src/stores/frame-layout-store';
      import snapshot from './src/design-lab/fixtures/morinus/snapshot.json';
      import {shouldRestoreWorkspaceKeyboardFocus} from './src/components/workshell/workspace-keyboard-focus';
      window.__ARIES_DAEMON_URL__=location.origin;
      function Host(){
        const [target,setTarget]=useState(null);
        useEffect(()=>{
          if(!target)return;
          const frame=requestAnimationFrame(()=>{
            if(shouldRestoreWorkspaceKeyboardFocus(target))target.focus({preventScroll:true});
          });
          return ()=>cancelAnimationFrame(frame);
        },[target]);
        return <AstrolabeView documentId="astrolabe-test" inspectorDocumentId="radix-test"
          inspectorChart={{...snapshot,document:{documentId:'radix-test'}}}
          sourceName="Test" onKeyboardFocusTarget={setTarget}/>;
      }
      const root=createRoot(document.getElementById('root'));
      useDaemonWorkspaceStore.setState({documents:[{
        documentId:'astrolabe-test',parentDocumentId:'radix-test',launcherKind:'astrolabe',
        kind:'chart',title:'Astrolabe',sourceName:'Test',dirty:false,fpath:'',enabledActions:{},
      }]});
      window.mountAstrolabe=()=>root.render(<Host/>);
      window.unmountAstrolabe=()=>root.render(null);
      window.closeAstrolabe=()=>{
        useDaemonWorkspaceStore.setState({documents:[]});
        root.render(null);
      };
      window.inspectorState=()=>{
        const state=useWorkspaceStore.getState();
        return {hovered:state.hoveredRegion,pinned:state.inspectorActiveRegion};
      };
      window.openInspector=(open)=>useFrameLayoutStore.getState().setInspectorOpen(open);
      const renderPlate=(geo,state)=>{
        const host=document.querySelector('div[tabindex="0"]');
        const canvas=document.createElement('canvas');
        const style=resolveAstrolabeRenderStyle(host);
        const zoom=astrolabeZoomFromCamera(state.cameras[state.projection],900,800);
        const rete=createAstrolabeReteSurface();
        const args=[900,800,style,(key)=>key,readCommonRingFill(host),0,undefined,zoom,rete];
        const targets=geo.projection==='stereographic'
          ?renderStereographicAstrolabe(canvas,geo,state,...args)
          :renderPolarAzimuthal(canvas,geo,null,state,...args);
        return {rete,targets};
      };
      window.collectRete=(geo,state)=>renderPlate(geo,state).rete;
      window.collectTargets=(geo,state)=>{
        const {targets}=renderPlate(geo,state);
        return targets.filter(target=>findHoverTarget(targets,target.x,target.y,9)===target
          && target.x>30 && target.x<870 && target.y>30 && target.y<770);
      };
      window.mountAstrolabe();
    ` },
    bundle: true, write: false, format: "iife", platform: "browser", target: "es2022",
    define: {
      "process.env.NODE_ENV": '"production"',
      "process.env.NEXT_PUBLIC_ARIES_DAEMON_TOKEN": '""',
      "process.env.NEXT_PUBLIC_ARIES_DAEMON_URL": '""',
    }, logLevel: "silent",
    plugins: [{ name: "isolated-localization", setup(builder) {
      builder.onResolve({ filter: /\/i18n\/i18n$/ }, () => ({ path: "test-i18n", namespace: "test" }));
      builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({ loader: "js", contents: `
        const translate=(key,params)=>key==='astrolabe.zoomLevel'?params.level+'×':key;
        export const useT=()=>translate, useLocale=()=> 'en', useTFallback=()=>((_key,fallback)=>fallback);
        export const I18nProvider=({children})=>children, useSyncLocale=()=>()=>{};
      ` }));
    } }],
  });
  bundle = result.outputFiles[0].text;
});

const initialState = (): AstrolabeViewState => ({
  deltaDeg: 0, projection: "stereographic", atmospheric: true, regioHouses: true,
  zodiacWheel: true, terms: true, decans: false, almucantars: false, azimuths: false, hourLines: false,
  stars: true, asterisms: false, earthMap: false, declinationCircles: false, fullSphere: false,
  zodiacalHorizon: false, zodiacalMeridian: false, pdReprojection: false, earthInFront: false, earthOpacity: 1,
  eclipticStyle: "scale", starField: "catalogue", starLabels: "settings", markedStars: [],
});

async function mount(page: Page, holdRestore = false, overrides: Partial<AstrolabeViewState> = {}) {
  let saved = { ...initialState(), ...overrides };
  saved.cameras = overrides.cameras ?? {
    stereographic: { k: 4, centerX: 0.45, centerY: 0.55 },
    polarEquidistant: { k: 4, centerX: 0.55, centerY: 0.45 },
  };
  let release!: () => void;
  const restoreGate = new Promise<void>((resolve) => { release = resolve; });
  const stores: AstrolabeViewState[] = [];
  const projections: string[] = [];
  const arcs: number[] = [];
  const asterismRequests: boolean[] = [];
  const flagRequests: URLSearchParams[] = [];
  let reads = 0;
  await page.route("http://astrolabe.test/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    let body: unknown = {};
    if (url.pathname === "/") {
      await route.fulfill({ contentType: "text/html", body: `<div id="root"></div><style>
        html,body{margin:0}#root{width:900px;height:800px}
        div[tabindex="0"]{position:relative;width:900px;height:800px;outline:none}
        canvas{position:absolute;inset:0} [role="toolbar"]{position:absolute;right:16px;top:100px}
      </style>` });
      return;
    }
    if (url.pathname.endsWith("/astrolabe/view-state")) {
      if (request.method() === "POST") {
        saved = structuredClone(request.postDataJSON().state);
        stores.push(saved);
        body = { ok: true, state: saved };
      } else {
        const snapshot = structuredClone(saved);
        if (reads++ === 0 && holdRestore) await restoreGate;
        body = { state: snapshot };
      }
    } else if (url.pathname === "/api/astrolabe") {
      const projection = url.searchParams.get("projection") ?? "stereographic";
      projections.push(projection);
      arcs.push(Number(url.searchParams.get("delta")));
      asterismRequests.push(url.searchParams.get("asterisms") === "true");
      const geometry = projection === "polarEquidistant" ? polar : stereo;
      body = url.searchParams.get("asterisms") === "true" ? { ...geometry, asterisms: asterismFixture } : geometry;
    } else if (url.pathname === "/api/astrolabe/earth") {
      body = { lon: 0, lines: [] };
    } else if (url.pathname === "/api/inspector/flag") {
      flagRequests.push(url.searchParams);
      body = { title: `Inspector ${url.searchParams.get("kind")}`, glyph: "", accent: null, rows: [] };
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto("http://astrolabe.test/");
  await page.addScriptTag({ content: bundle });
  await expect(page.locator("canvas").first()).toBeVisible();
  await expect(page.locator('div[tabindex="0"]')).toBeFocused();
  return { stores, projections, arcs, asterismRequests, flagRequests, release, saved: () => saved };
}
const zoomLabel = (page: Page) => page.getByRole("button", { name: "astrolabe.zoomReset" });
const unmount = (page: Page) => page.evaluate(() => (window as unknown as { unmountAstrolabe(): void }).unmountAstrolabe());
const remount = (page: Page) => page.evaluate(() => (window as unknown as { mountAstrolabe(): void }).mountAstrolabe());

// The harness menu does not scroll, so the menu tests use a window it fits in.
const MENU_VIEWPORT = { width: 1280, height: 1400 };

test("polar Zodiac ring uses the shared persisted toggle without fetching geometry", async ({ page }) => {
  await page.setViewportSize(MENU_VIEWPORT);
  const fixture = await mount(page, false, { projection: "polarEquidistant" });
  await expect(zoomLabel(page)).toHaveText("4.0×");
  const requests = fixture.projections.length;
  const openEcliptic = async () => {
    await page.locator("canvas").first().click({ button: "right", position: { x: 400, y: 350 } });
    await page.getByRole("menuitem", { name: "astrolabe.ecliptic", exact: true }).click();
  };
  await openEcliptic();
  const zodiac = page.getByRole("menuitemcheckbox", { name: "astrolabe.zodiacRing", exact: true });
  await expect(zodiac).toHaveAttribute("aria-checked", "true");
  await zodiac.click();
  await expect.poll(() => fixture.saved().zodiacWheel).toBe(false);
  expect(fixture.projections).toHaveLength(requests);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.locator('div[tabindex="0"]').focus();
  await page.keyboard.press("Tab");
  await expect.poll(() => fixture.saved().projection).toBe("stereographic");
  await openEcliptic();
  await expect(zodiac).toHaveAttribute("aria-checked", "false");
});

test("the ecliptic style is a persisted display choice without fetching geometry", async ({ page }) => {
  await page.setViewportSize(MENU_VIEWPORT);
  const fixture = await mount(page);
  const requests = fixture.projections.length;
  await page.locator("canvas").first().click({ button: "right", position: { x: 400, y: 350 } });
  await page.getByRole("menuitem", { name: "astrolabe.ecliptic", exact: true }).click();
  await expect(page.getByRole("menuitemradio", { name: "astrolabe.eclipticScale", exact: true }))
    .toHaveAttribute("aria-checked", "true");
  await page.getByRole("menuitemradio", { name: "astrolabe.eclipticDividedBand", exact: true }).click();
  await expect.poll(() => fixture.saved().eclipticStyle).toBe("dividedBand");
  expect(fixture.projections).toHaveLength(requests);
});

type InspectorTestWindow = Window & {
  inspectorState(): { hovered: HoverRegion | null; pinned: HoverRegion | null };
  openInspector(open: boolean): void;
  collectTargets(geo: unknown, state: AstrolabeViewState): AstrolabeHoverTarget[];
  collectRete(geo: unknown, state: AstrolabeViewState): AstrolabeReteSurface;
};
const inspectorState = (page: Page) => page.evaluate(() => (window as unknown as InspectorTestWindow).inspectorState());

async function reteSurface(page: Page, state: AstrolabeViewState) {
  return page.evaluate(({ geo, state }) => (window as unknown as InspectorTestWindow).collectRete(geo, state), {
    geo: state.projection === "stereographic" ? stereo : polar, state,
  });
}
function retePoint(surface: AstrolabeReteSurface) {
  const points = surface.band ? Array.from({ length: 72 }, (_, index) => {
    const a = index * Math.PI / 36, band = surface.band!;
    return { x: band.x + band.outer * Math.cos(a), y: band.y + band.outer * Math.sin(a) };
  }) : surface.segments.map(([ax, ay, bx, by]) => ({ x: (ax + bx) / 2, y: (ay + by) / 2 }));
  const point = points.find(({ x, y }) => x > 80 && x < 820 && y > 80 && y < 720);
  expect(point).toBeTruthy();
  return { x: Math.round(point!.x), y: Math.round(point!.y) };
}
function rotatedPoint(point: { x: number; y: number }, center: [number, number], degrees: number) {
  const x = point.x - center[0], y = point.y - center[1], a = degrees * Math.PI / 180;
  return { x: Math.round(center[0] + x * Math.cos(a) - y * Math.sin(a)),
    y: Math.round(center[1] + x * Math.sin(a) + y * Math.cos(a)) };
}
function pointerTurn(from: { x: number; y: number }, to: { x: number; y: number }, center: [number, number]) {
  return astrolabeReteTurn(Math.atan2(from.y - center[1], from.x - center[0]),
    Math.atan2(to.y - center[1], to.x - center[0]));
}
async function mountAtRete(page: Page, projection: AstrolabeViewState["projection"], k: number) {
  let fixture = await mount(page, false, { projection, deltaDeg: 10, cameras: {
    [projection]: { k: 1, centerX: 0.5, centerY: 0.5 },
  } });
  await expect(zoomLabel(page)).toHaveText("1.0×");
  const fitted = retePoint(await reteSurface(page, fixture.saved()));
  if (k > 1) fixture = await mount(page, false, { projection, deltaDeg: 10, cameras: {
    [projection]: { k, centerX: fitted.x / 900, centerY: fitted.y / 800 },
  } });
  await expect(zoomLabel(page)).toHaveText(`${k.toFixed(1)}×`);
  return { fixture, point: k === 1 ? fitted : { x: 450, y: 400 } };
}

for (const projection of ["stereographic", "polarEquidistant"] as const) {
  test(`${projection} radial dragging and crossing the pole do not change the arc`, async ({ page }) => {
    const { fixture, point } = await mountAtRete(page, projection, 1);
    const surface = await reteSurface(page, fixture.saved());
    const requests = fixture.arcs.length;
    const canvas = page.locator("canvas").first();
    const pointer = { button: 0, pointerId: 52 };
    await canvas.dispatchEvent("pointerdown", { ...pointer, clientX: point.x, clientY: point.y });
    for (const scale of [1.2, -0.7]) {
      await canvas.dispatchEvent("pointermove", { ...pointer,
        clientX: surface.center[0] + (point.x - surface.center[0]) * scale,
        clientY: surface.center[1] + (point.y - surface.center[1]) * scale });
    }
    await canvas.dispatchEvent("pointerup", { ...pointer,
      clientX: surface.center[0] - (point.x - surface.center[0]) * 0.7,
      clientY: surface.center[1] - (point.y - surface.center[1]) * 0.7 });
    await expect.poll(() => fixture.stores.length).toBe(1);
    expect(fixture.saved().deltaDeg).toBe(10);
    expect(fixture.arcs).toHaveLength(requests);
  });

  test(`${projection} empty-space drag pans while modifier-drag can pan over the rete`, async ({ page }) => {
    const { fixture } = await mountAtRete(page, projection, 4);
    const surface = await reteSurface(page, fixture.saved());
    const empty = [{ x: 300, y: 300 }, { x: 500, y: 500 }, { x: 200, y: 600 }]
      .find(({ x, y }) => !hitAstrolabeRete(surface, x, y))!;
    const requests = fixture.arcs.length;
    const original = structuredClone(fixture.saved().cameras![projection]!);
    await page.mouse.move(empty.x, empty.y);
    await page.mouse.down();
    await page.mouse.move(empty.x + 30, empty.y + 20);
    await page.mouse.up();
    await expect.poll(() => fixture.saved().cameras![projection]!.centerX).not.toBe(original.centerX);
    expect(fixture.saved().deltaDeg).toBe(10);
    expect(fixture.arcs).toHaveLength(requests);
    const moved = structuredClone(fixture.saved().cameras![projection]!);
    const point = retePoint(await reteSurface(page, fixture.saved()));
    const modifier = await page.evaluate(() => /Mac/.test(navigator.platform)) ? "Meta" : "Control";
    await page.keyboard.down(modifier);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x - 25, point.y + 15);
    await page.mouse.up();
    await page.keyboard.up(modifier);
    await expect.poll(() => fixture.saved().cameras![projection]!.centerX).not.toBe(moved.centerX);
    expect(fixture.saved().deltaDeg).toBe(10);
    expect(fixture.arcs).toHaveLength(requests);
  });
}

for (const projection of ["stereographic", "polarEquidistant"] as const) {
  test(`${projection} asterism stars share Inspector hover, flags, click pinning and clearing`, async ({ page }) => {
    const fixture = await mount(page, false, { projection, asterisms: true, cameras: {
      stereographic: { k: 1, centerX: 0.5, centerY: 0.5 },
      polarEquidistant: { k: 1, centerX: 0.5, centerY: 0.5 },
    } });
    await expect(zoomLabel(page)).toHaveText("1.0×");
    const geometry = { ...(projection === "stereographic" ? stereo : polar), asterisms: asterismFixture };
    const targets = await page.evaluate(({ geo, state }) => (
      window as unknown as InspectorTestWindow
    ).collectTargets(geo, state), { geo: geometry, state: fixture.saved() });
    await page.evaluate(() => (window as unknown as InspectorTestWindow).openInspector(true));
    for (const star of asterismFixture.stars) {
      const target = targets.find((item) => item.inspector?.kind === "fixed_star" && item.inspector.code === star.nom)!;
      expect(target).toBeTruthy();
      await page.mouse.move(target.x, target.y);
      const expected = { kind: "secondary_ring", family: "fixstar", itemId: star.nom,
        starCode: star.nom, label: star.name, longitude: star.lon, viewDocumentId: "radix-test" };
      await expect.poll(async () => (await inspectorState(page)).hovered).toEqual(expected);
      await expect(page.getByText("Inspector secondary_ring", { exact: true })).toBeVisible();
      expect(fixture.flagRequests.at(-1)?.get("objectId")).toContain(star.nom);
      await page.locator("canvas").first().click({ position: target });
      await expect.poll(async () => (await inspectorState(page)).pinned).toEqual(expected);
      await page.mouse.move(950, 810);
      await expect.poll(async () => (await inspectorState(page)).hovered).toBeNull();
      expect((await inspectorState(page)).pinned).toEqual(expected);
    }
  });
}

for (const projection of ["stereographic", "polarEquidistant"] as const) {
  test(`${projection} division hover and click share inspector identities without pinning gestures`, async ({ page }) => {
    const fixture = await mount(page, false, { projection, decans: true, cameras: {
      stereographic: { k: 1, centerX: 0.5, centerY: 0.5 },
      polarEquidistant: { k: 1, centerX: 0.5, centerY: 0.5 },
    } });
    await expect(zoomLabel(page)).toHaveText("1.0×");
    await page.evaluate(() => (window as unknown as InspectorTestWindow).openInspector(true));
    const targets = await page.evaluate(({ geo, state }) => (
      window as unknown as InspectorTestWindow
    ).collectTargets(geo, state), { geo: projection === "stereographic" ? stereo : polar, state: fixture.saved() });
    const canvas = page.locator("canvas").first();
    for (const kind of ["planet", "term", "decan"] as const) {
      const target = targets.find((item) => item.inspector?.kind === kind)!;
      expect(target).toBeTruthy();
      await page.mouse.move(target.x, target.y);
      await expect.poll(async () => (await inspectorState(page)).hovered?.kind).toBe(kind);
      const expected = (await inspectorState(page)).hovered;
      expect(expected).toMatchObject({ ...target.inspector, viewDocumentId: "radix-test" });
      await expect(page.getByText(`Inspector ${kind}`, { exact: true })).toBeVisible();
      expect(fixture.flagRequests.at(-1)?.get("docId")).toBe("radix-test");
      await canvas.click({ position: target });
      await expect.poll(async () => (await inspectorState(page)).pinned).toEqual(expected);
      await page.mouse.move(950, 810);
      await expect.poll(async () => (await inspectorState(page)).hovered).toBeNull();
      expect((await inspectorState(page)).pinned).toEqual(expected);
    }
    const pinned = (await inspectorState(page)).pinned;
    // Returning a drag to its start still counts as a gesture, not a click.
    await page.mouse.move(400, 350);
    await page.mouse.down();
    await page.mouse.move(430, 350);
    await page.mouse.move(400, 350);
    await page.mouse.up();
    expect((await inspectorState(page)).pinned).toEqual(pinned);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(420, 350);
    await page.mouse.up({ button: "middle" });
    expect((await inspectorState(page)).pinned).toEqual(pinned);
    await canvas.dispatchEvent("pointerdown", { button: 0, pointerId: 40, clientX: 400, clientY: 350 });
    await canvas.dispatchEvent("pointercancel", { button: 0, pointerId: 40, clientX: 400, clientY: 350 });
    expect((await inspectorState(page)).pinned).toEqual(pinned);
    await canvas.click({ position: { x: 5, y: 5 } });
    await expect.poll(async () => (await inspectorState(page)).pinned).toBeNull();
    await page.evaluate(() => (window as unknown as InspectorTestWindow).openInspector(false));
    await canvas.click({ position: targets.find((item) => item.inspector?.kind === "term")! });
    expect((await inspectorState(page)).pinned).toBeNull();
  });
}

test("asterisms persist through reopen and projection changes independently of fixed stars", async ({ page }) => {
  const fixture = await mount(page, false, { stars: false });
  await expect.poll(() => fixture.asterismRequests.at(-1)).toBe(false);
  await page.locator("canvas").first().click({ button: "right", position: { x: 300, y: 300 } });
  await page.getByRole("menuitem", { name: "astrolabe.fixedStars", exact: true }).click();
  const option = page.getByRole("menuitemcheckbox", { name: "astrolabe.asterisms", exact: true });
  await option.click();
  await expect(option).toBeChecked();
  await expect.poll(() => fixture.asterismRequests.at(-1)).toBe(true);
  await expect.poll(() => fixture.saved().asterisms).toBe(true);
  expect(fixture.saved().stars).toBe(false);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.locator('div[tabindex="0"]').focus();
  await page.keyboard.press("Tab");
  await expect.poll(() => fixture.projections.at(-1)).toBe("polarEquidistant");
  expect(fixture.asterismRequests.at(-1)).toBe(true);
  await unmount(page);
  await remount(page);
  await expect.poll(() => fixture.asterismRequests.at(-1)).toBe(true);
  await page.locator("canvas").first().click({ button: "right", position: { x: 300, y: 300 } });
  await page.getByRole("menuitem", { name: "astrolabe.fixedStars", exact: true }).click();
  await expect(option).toBeChecked();
  await option.click();
  await expect.poll(() => fixture.asterismRequests.at(-1)).toBe(false);
});

test("background opacity is a menu choice stored with the background picture", async ({ page }) => {
  await page.setViewportSize(MENU_VIEWPORT);
  const fixture = await mount(page);
  const requests = fixture.projections.length;
  await page.locator("canvas").first().click({ button: "right", position: { x: 400, y: 350 } });
  await page.getByRole("menuitem", { name: "astrolabe.skyAndEarth", exact: true }).click();
  // Earth opacity offers the same percentages, so read the background's own group.
  const stops = page.getByRole("group").filter({ hasText: "astrolabe.backgroundOpacity" }).last();
  await expect(stops.getByRole("menuitemradio", { name: "80%", exact: true })).toHaveAttribute("aria-checked", "true");
  await stops.getByRole("menuitemradio", { name: "60%", exact: true }).click();
  await expect(stops.getByRole("menuitemradio", { name: "60%", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => page.evaluate(() => (
    JSON.parse(window.localStorage.getItem("aries.designTuner.astrolabeCity") ?? "{}").strength
  ))).toBe(60);
  expect(fixture.projections).toHaveLength(requests);
});

test("opening registers the keyboard surface and Tab retains zoom without a click", async ({ page }) => {
  const fixture = await mount(page);
  await expect(zoomLabel(page)).toHaveText("4.0×");
  await page.keyboard.press("+");
  await expect(zoomLabel(page)).toHaveText("5.0×");
  await page.keyboard.press("Tab");
  await expect.poll(() => fixture.projections.at(-1)).toBe("polarEquidistant");
  await expect(zoomLabel(page)).toHaveText("5.0×");
  await page.keyboard.press("Tab");
  await expect.poll(() => fixture.projections.at(-1)).toBe("stereographic");
  await expect(zoomLabel(page)).toHaveText("5.0×");
});

test("a late restore cannot undo immediate zoom and projection intent", async ({ page }) => {
  const fixture = await mount(page, true);
  await page.keyboard.press("+");
  await page.keyboard.press("+");
  await page.keyboard.press("Tab");
  await expect.poll(() => fixture.projections.at(-1)).toBe("polarEquidistant");
  await expect(zoomLabel(page)).toHaveText("1.6×");
  expect(fixture.stores).toHaveLength(0);
  fixture.release();
  await expect.poll(() => fixture.saved().projection).toBe("polarEquidistant");
  await expect(zoomLabel(page)).toHaveText("1.6×");
  expect(fixture.saved().cameras?.polarEquidistant?.k).toBeCloseTo(1.5625);
});

test("each plate remembers its pan while resized panes retain the same viewing centre", async ({ page }) => {
  const fixture = await mount(page);
  await expect(zoomLabel(page)).toHaveText("4.0×");
  await page.mouse.move(400, 350);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(445, 380);
  await page.mouse.up({ button: "middle" });
  await expect.poll(() => fixture.stores.length).toBeGreaterThan(0);
  const original = structuredClone(fixture.saved().cameras!.stereographic!);
  await page.keyboard.press("Tab");
  await expect.poll(() => fixture.projections.at(-1)).toBe("polarEquidistant");
  await page.keyboard.press("Tab");
  await expect.poll(() => fixture.saved().projection).toBe("stereographic");
  expect(fixture.saved().cameras!.stereographic).toEqual(original);
  await page.locator('div[tabindex="0"]').evaluate((element) => {
    element.style.width = "600px"; element.style.height = "600px";
  });
  await expect(page.locator("canvas").first()).toHaveCSS("width", "600px");
  await page.keyboard.press("+");
  await expect.poll(() => fixture.saved().cameras?.stereographic?.k).toBe(5);
  expect(fixture.saved().cameras!.stereographic!.centerX).toBeCloseTo(original.centerX);
  expect(fixture.saved().cameras!.stereographic!.centerY).toBeCloseTo(original.centerY);
});

test("zoom survives leaving and immediately reopening before initial restore completes", async ({ page }) => {
  const fixture = await mount(page, true);
  await page.keyboard.press("+");
  await page.keyboard.press("+");
  await unmount(page);
  await expect(page.locator("canvas")).toHaveCount(0);
  await remount(page);
  fixture.release();
  await expect(zoomLabel(page)).toHaveText("1.6×");
  expect(fixture.saved().cameras?.stereographic?.k).toBeCloseTo(1.5625);
});

test("closing an edited Astrolabe does not save through its removed document", async ({ page }) => {
  const fixture = await mount(page);
  await expect(zoomLabel(page)).toHaveText("4.0×");
  await page.keyboard.press("+");
  await expect.poll(() => fixture.saved().cameras?.stereographic?.k).toBe(5);
  const stores = fixture.stores.length;
  await page.evaluate(() => (window as unknown as { closeAstrolabe(): void }).closeAstrolabe());
  await expect(page.locator("canvas")).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(fixture.stores).toHaveLength(stores);
});

test("held pan and pinch save their cameras only after release", async ({ page }) => {
  const fixture = await mount(page);
  await expect(zoomLabel(page)).toHaveText("4.0×");
  const before = fixture.stores.length;
  await page.mouse.move(400, 350);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(445, 380);
  await page.waitForTimeout(350);
  expect(fixture.stores).toHaveLength(before);
  await page.mouse.up({ button: "middle" });
  await expect.poll(() => fixture.stores.length).toBe(before + 1);
  await page.evaluate(() => {
    const target = document.querySelector('div[tabindex="0"]')!;
    target.dispatchEvent(new Event("gesturestart", { cancelable: true }));
    target.dispatchEvent(Object.assign(new Event("gesturechange", { cancelable: true }), { scale: 1.5, clientX: 400, clientY: 350 }));
  });
  await page.waitForTimeout(350);
  expect(fixture.stores).toHaveLength(before + 1);
  await page.evaluate(() => document.querySelector('div[tabindex="0"]')!.dispatchEvent(new Event("gestureend", { cancelable: true })));
  await expect.poll(() => fixture.stores.length).toBe(before + 2);
});

test("a rotation response paints once while actual host resizing still repaints", async ({ page }) => {
  await page.addInitScript(() => {
    const original = CanvasRenderingContext2D.prototype.fillRect;
    const counts = { backgrounds: 0 };
    Object.assign(window, { astrolabePaintCounts: counts });
    CanvasRenderingContext2D.prototype.fillRect = function (...args) {
      if (args[0] === 0 && args[1] === 0 && args[2] >= 800 && args[3] >= 700) counts.backgrounds++;
      return original.apply(this, args);
    };
  });
  const state = await mount(page);
  await expect(zoomLabel(page)).toHaveText("4.0×");
  // Drain initial font/restore/ResizeObserver deliveries before the gesture.
  await page.waitForTimeout(100);
  const count = () => page.evaluate(() => (
    window as unknown as { astrolabePaintCounts: { backgrounds: number } }
  ).astrolabePaintCounts.backgrounds);
  const surface = await reteSurface(page, state.saved());
  const start = retePoint(surface), end = rotatedPoint(start, surface.center, 4);
  const before = await count();
  const requests = state.projections.length;
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y);
  await expect.poll(() => state.projections.length).toBe(requests + 1);
  await expect.poll(count).toBe(before + 1);
  // A newly registered observer used to enqueue a second paint next frame.
  await page.waitForTimeout(100);
  expect(await count()).toBe(before + 1);
  await page.mouse.up();
  await page.locator('div[tabindex="0"]').evaluate((host) => { host.style.width = "850px"; });
  await expect.poll(count).toBeGreaterThan(before + 1);
});

for (const projection of ["stereographic", "polarEquidistant"] as const) {
  for (const k of [1, 12]) {
    test(`${projection} rete follows angular dragging at ${k}× with the pole on or offscreen`, async ({ page }) => {
      const { fixture, point: start } = await mountAtRete(page, projection, k);
      await expect.poll(() => fixture.arcs.at(-1)).toBe(10);
      const surface = await reteSurface(page, fixture.saved());
      expect(hitAstrolabeRete(surface, start.x, start.y)).toBe(true);
      if (k === 12) expect(surface.center[0] < 0 || surface.center[0] > 900
        || surface.center[1] < 0 || surface.center[1] > 800).toBe(true);
      const savedBefore = fixture.stores.length;
      await page.mouse.move(start.x, start.y);
      expect(await page.locator("canvas").first().evaluate((canvas) => getComputedStyle(canvas).cursor)).toBe("grab");
      await page.mouse.down();
      const end = rotatedPoint(start, surface.center, 1.75);
      await page.mouse.move(end.x, end.y);
      const expected = 10 + pointerTurn(start, end, surface.center);
      await expect.poll(() => fixture.arcs.at(-1)).toBeCloseTo(expected, 8);
      expect(fixture.stores).toHaveLength(savedBefore);
      // Reverse without restarting the drag: the original anchor still owns it.
      const back = rotatedPoint(start, surface.center, 0.625);
      await page.mouse.move(back.x, back.y);
      await page.mouse.up();
      const final = 10 + pointerTurn(start, back, surface.center);
      await expect.poll(() => fixture.saved().deltaDeg).toBeCloseTo(final, 8);
      await expect.poll(() => fixture.arcs.at(-1)).toBeCloseTo(final, 8);
      expect(fixture.stores).toHaveLength(savedBefore + 1);
    });
  }
}

test("drag coalesces pointer events and release flushes the last unpainted position", async ({ page }) => {
  const fixture = await mount(page, false, { deltaDeg: 10 });
  await expect(zoomLabel(page)).toHaveText("4.0×");
  await expect.poll(() => fixture.arcs.at(-1)).toBe(10);
  await page.waitForTimeout(100);
  const before = fixture.arcs.length;
  const surface = await reteSurface(page, fixture.saved());
  const start = retePoint(surface);
  // Hold presentation callbacks to exercise multiple input tasks between frames.
  await page.evaluate(() => {
    const raf = window.requestAnimationFrame;
    const cancel = window.cancelAnimationFrame;
    const callbacks = new Map<number, FrameRequestCallback>();
    let id = 0;
    window.requestAnimationFrame = (callback) => { callbacks.set(++id, callback); return id; };
    window.cancelAnimationFrame = (key) => { callbacks.delete(key); };
    Object.assign(window, { releaseDragFrame: () => {
      window.requestAnimationFrame = raf;
      window.cancelAnimationFrame = cancel;
      for (const callback of callbacks.values()) raf(callback);
    } });
  });
  const canvas = page.locator("canvas").first();
  await canvas.dispatchEvent("pointerdown", { button: 0, pointerId: 41, clientX: start.x, clientY: start.y });
  for (const degrees of [1, 2, 3]) {
    const point = rotatedPoint(start, surface.center, degrees);
    await canvas.dispatchEvent("pointermove", { button: 0, pointerId: 41, clientX: point.x, clientY: point.y });
  }
  expect(fixture.arcs).toHaveLength(before);
  expect(fixture.stores).toHaveLength(0);
  const end = rotatedPoint(start, surface.center, 3);
  await canvas.dispatchEvent("pointerup", { button: 0, pointerId: 41, clientX: end.x, clientY: end.y });
  const expected = 10 + pointerTurn(start, end, surface.center);
  await expect.poll(() => fixture.saved().deltaDeg).toBeCloseTo(expected, 8);
  await expect.poll(() => fixture.arcs.at(-1)).toBeCloseTo(expected, 8);
  expect(fixture.arcs).toHaveLength(before + 1);
  await page.evaluate(() => (window as unknown as { releaseDragFrame(): void }).releaseDragFrame());
  await page.waitForTimeout(100);
  expect(fixture.arcs).toHaveLength(before + 1);
});
