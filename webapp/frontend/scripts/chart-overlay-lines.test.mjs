import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/chart/chart-overlay-lines.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { informationCornerClass, radixOverlayTopLeftLines } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`,
);

test("paired identities retain full names regardless of radix-name preference", () => {
  const lines = ["Complete First Name", "14 March 1981", "12:34:56", "Chicago", "coordinates"];
  for (const showRadixNameInCanvas of [false, true]) {
    const chart = {
      meta: { name: "Relationship title", cornerLines: { pairedParticipants: true, topLeft: lines } },
      options: { showRadixNameInCanvas },
    };
    assert.deepEqual(radixOverlayTopLeftLines(chart, { meta: { name: "Different radix" } }), lines);
    assert.equal(informationCornerClass(chart, "bottomLeft"), informationCornerClass(chart, "topLeft"));
  }
});

test("ordinary chart corners keep independently authored typography", () => {
  const chart = { meta: {} };
  assert.equal(informationCornerClass(chart, "topLeft"), "chartOverlay.information.topLeft");
  assert.equal(informationCornerClass(chart, "bottomLeft"), "chartOverlay.information.bottomLeft");
});
