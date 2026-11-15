import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/chart/chart-overlay-lines.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { hasRelationshipCornerInformation, informationCornerClass, radixOverlayTopLeftLines, traditionalCenterInformationGeometry } = await import(
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

test("Traditional keeps paired participants in corners and Davison information in the centre", () => {
  assert.equal(hasRelationshipCornerInformation({ meta: { cornerLines: { pairedParticipants: true } } }), true);
  assert.equal(hasRelationshipCornerInformation({ meta: {
    kind: "radix", cornerLines: { singleChart: true, topLeft: ["Davison", "Date", "Time", "Place", "Coordinates"], bottomLeft: [] },
  } }), false);
  assert.equal(hasRelationshipCornerInformation({ meta: { kind: "radix" } }), false);
});

test("Davison identity never inherits a participant's radix name", () => {
  const topLeft = ["First + Second • Davison", "Date", "Time", "Place", "Coordinates"];
  assert.deepEqual(radixOverlayTopLeftLines({
    meta: { kind: "radix", cornerLines: { singleChart: true, topLeft } },
    options: { showRadixNameInCanvas: true },
  }, { meta: { name: "First participant" } }), topLeft);
});


test("Traditional centre information keeps single-wheel sizing in comparisons for every subdivision state", () => {
  const chart = {meta: {centerLines: ['Date', 'Time', 'Place', 'Coordinates', 'Name', 'Transit']}};
  for (const maxRadius of [200, 400, 600])
    for (const showTerms of [false, true]) for (const showDecans of [false, true]) {
      const input = {maxRadius, showTerms, showDecans};
      const single = traditionalCenterInformationGeometry(chart, {...input, mode: 'single'}, [maxRadius, maxRadius]);
      const comparison = traditionalCenterInformationGeometry(chart, {...input, mode: 'comparison'}, [maxRadius, maxRadius]);
      assert.deepEqual(comparison, single);
      assert.equal(comparison.size, maxRadius / (showTerms && showDecans ? 32 : 24));
    }
});
