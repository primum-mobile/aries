import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../src/components/workshell/astrolabe-observers.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { observerRay, observerGround, observerFootScreen, observerHit } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-8, `${a} != ${b}`);
test('ground placement survives both plate projections, southern latitudes, camera pan and resize', () => {
  for (const projection of ['stereographic','polarEquidistant']) for (const lat of [-65,0,52]) {
    for (const layout of [{cx:400,cy:300,scale:150},{cx:-320,cy:870,scale:1100}]) {
      const frame = {projection,lat,layout,edge:100};
      for (const position of [[-2,7],[1,9],[2,4],[-8,-12]]) {
        const screen = observerFootScreen(position, frame);
        const ray = observerRay(...screen, frame);
        const actual = observerGround(ray);
        near(actual[0],position[0]); near(actual[1],position[1]);
      }
    }
  }
});
test('upright body picking also works above the horizon', () => {
  const position = [1,9], length = Math.hypot(1,9,0.5);
  assert.equal(observerHit([1/length,9/length,0.5/length],position,1),true);
});
test('placement rejects sky, plate exterior and near/far limits', () => {
  assert.equal(observerGround([0,1,0.01]),null);
  assert.equal(observerGround([0,1,-0.01]),null);
  assert.equal(observerGround([0,0.1,-1]),null);
  assert.equal(observerRay(500,0,{projection:'stereographic',lat:52,layout:{cx:0,cy:0,scale:100},edge:2}),null);
});
