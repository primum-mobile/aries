import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/stores/daemon-workspace-adapter.ts', import.meta.url), 'utf8');
const projection = source.slice(source.indexOf('const FEATURE_TO_PUBLIC:'), source.indexOf('type SnapshotCommandResult'));
const titleSource = readFileSync(new URL('../src/stores/workspace-store.ts', import.meta.url), 'utf8');
const titleFunction = titleSource.slice(titleSource.indexOf('export function localizedWorkspaceDocumentTitle('), titleSource.indexOf('type WorkspaceState ='));
const code = ts.transpileModule(projection + '\n' + titleFunction, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { projectDocuments, localizedWorkspaceDocumentTitle } = new Function('exports', 'SUPPLEMENTARY_KIND_LABELS',
  code + '\nreturn {projectDocuments, localizedWorkspaceDocumentTitle};')({}, {});

for (const featureKind of ['transits', 'solar_return', 'lunar_return', 'secondary', 'harmonic', 'profections', 'synastry']) {
  test(`saved ${featureKind} event uses its name through projection and localization`, () => {
    const summary = { documentId: 'event', parentDocumentId: 'radix', title: 'My wedding',
      savedEventId: 'wedding-event',
      titleKey: null, featureKind, launcherKind: featureKind, compoundKind: featureKind };
    for (const title of ['My wedding', 'Renamed event', 'Renamed event *']) {
      const [doc] = projectDocuments([{ ...summary, title }]);
      assert.equal(doc.savedEventId, 'wedding-event');
      assert.equal(doc.titleKey, null);
      assert.equal(localizedWorkspaceDocumentTitle(doc, () => 'Generic type'), title.replace(/ \*$/, ''));
    }
    const [ordinary] = projectDocuments([{ ...summary, savedEventId: undefined,
      eventNoteContext: { eventId: 'wedding-event', documentId: 'event' },
      titleKey: 'supplementary.transits' }]);
    assert.equal(ordinary.savedEventId, null); // Inherited notes do not claim an event identity.
    assert.equal(localizedWorkspaceDocumentTitle(ordinary, () => 'Localized type'), 'Localized type');
  });
}


test('plain supplementary ownership preserves the saved chart type and radix launcher ancestry', () => {
  const [event, independent] = projectDocuments([
    { documentId: 'event', parentDocumentId: 'root', radixDocumentId: 'root',
      featureKind: null, launcherKind: null, title: 'Copied chart', titleKey: null },
    { documentId: 'independent', parentDocumentId: 'root', radixDocumentId: 'independent',
      featureKind: null, launcherKind: null, title: 'Nested independent chart', titleKey: null },
  ]);
  assert.equal(event.kind, 'supplementary');
  assert.equal(event.supplementaryFeatureKind, undefined);
  assert.equal(event.title, 'Copied chart');
  assert.equal(independent.kind, 'radix');
});

test('relationship participant titles survive projection and localization', () => {
  for (const titleKey of [null, undefined]) {
    for (const [compoundKind, title] of [
      ['synastry', 'First + Second • Synastry'],
      ['synastry', 'Second + First • Synastry'],
      ['composite_from_synastry', 'First + Second • Composite'],
      ['composite_from_synastry', 'First + Second • Davison'],
    ]) {
      const [doc] = projectDocuments([{ documentId: 'relationship',
        launcherKind: 'synastry', compoundKind, title, titleKey }]);
      assert.equal(doc.titleKey, null);
      assert.equal(localizedWorkspaceDocumentTitle(doc, () => 'Generic type'), title);
    }
  }
});
