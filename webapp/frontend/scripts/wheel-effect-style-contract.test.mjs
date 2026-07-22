import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(
  join(frontendRoot, "src/styles/style-token-public.generated.json"),
  "utf8",
));
const globals = readFileSync(join(frontendRoot, "src/app/globals.css"), "utf8");
const chartCanvas = readFileSync(
  join(frontendRoot, "src/components/workshell/chart-canvas.tsx"),
  "utf8",
);
const drawChart = readFileSync(join(frontendRoot, "src/lib/chart/draw-chart.ts"), "utf8");

test("wheel compositor exposes the complete bounded paint-only effect set", () => {
  const effects = manifest.tokens.filter(({ cssVar }) => cssVar.includes("-wheel-effect-"));
  assert.equal(effects.length, 39);
  assert.equal(effects.filter(({ type }) => type === "color").length, 3);
  assert.equal(effects.filter(({ type }) => type === "number").length, 36);

  for (const layer of ["geometry", "dynamic", "outer-label"]) {
    for (const role of [
      "opacity",
      "blur",
      "brightness-scale",
      "contrast-scale",
      "saturate-scale",
      "hue-rotate",
      "grayscale-opacity",
      "invert-opacity",
      "sepia-opacity",
      "shadow-offset-x",
      "shadow-offset-y",
      "shadow-blur",
      "shadow-color",
    ]) {
      assert.ok(
        effects.some(({ cssVar }) => cssVar === `--aries-wheel-effect-${layer}-${role}`),
        `${layer} ${role} must remain authorable`,
      );
    }
  }

  for (const token of effects.filter(({ cssVar }) => cssVar.endsWith("-blur"))) {
    assert.deepEqual(token.bounds, { min: 0, max: 64, step: 0.5 });
    assert.equal(token.unit, "px");
  }
});

test("effects stay on retained canvas compositing and out of chart geometry", () => {
  assert.match(globals, /\.aries-chart-paint-effects > canvas:nth-of-type\(1\)/);
  assert.match(globals, /\.aries-chart-paint-effects > canvas:nth-of-type\(2\)/);
  assert.match(globals, /\.aries-chart-paint-effects > canvas:nth-of-type\(3\)/);
  for (const filter of [
    "blur(",
    "brightness(",
    "contrast(",
    "saturate(",
    "hue-rotate(",
    "grayscale(",
    "invert(",
    "sepia(",
    "drop-shadow(",
  ]) {
    assert.ok(globals.includes(filter), `${filter} must stay in the CSS compositor`);
  }
  assert.match(chartCanvas, /aries-chart-paint-effects/);
  assert.doesNotMatch(drawChart, /--aries-wheel-effect-/);
});
