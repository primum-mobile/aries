// Exercise production projection and launcher routing with real daemon summaries.
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const adapter = readFileSync(new URL('../src/stores/daemon-workspace-adapter.ts', import.meta.url), 'utf8');
const parents = readFileSync(new URL('../src/components/workshell/chart-launch-parent.ts', import.meta.url), 'utf8');
const home = readFileSync(new URL('../src/components/workshell/home-client.tsx', import.meta.url), 'utf8');
const source = adapter.slice(adapter.indexOf('const FEATURE_TO_PUBLIC:'), adapter.indexOf('type SnapshotCommandResult'))
  + adapter.slice(adapter.indexOf('export function findDaemonRadixAncestor('), adapter.indexOf('// Chart launchers —'))
  + parents
  + home.slice(home.indexOf('const RADIX_SIBLING_LAUNCHER_IDS'), home.indexOf('function isReturnRelocationKind'))
  + home.slice(home.indexOf('function findSupplementaryChildByKind('), home.indexOf('function planetaryBodyByType('));
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const evaluate = new Function('exports', 'SUPPLEMENTARY_KIND_LABELS', 'runtimeActionIdForShellMenu', code + `
  return (summaries, activeId) => {
    const documents = projectDocuments(summaries);
    const active = documents.find(doc => doc.id === activeId);
    const radix = findDaemonRadixAncestor(documents, activeId);
    const parent = findChartLaunchParent(documents, activeId);
    return {
      kind: active.kind,
      transitParent: chartLauncherParentForAction('transits', parent, radix)?.id,
      ascensionalParent: chartLauncherParentForAction('ascensional-transits', parent, radix)?.id,
      transitRecall: findSupplementaryChildByKind(documents, radix?.id, 'transits')?.id,
    };
  };`);
// Inputs are canonical daemon action IDs; native-menu aliases are outside this contract.
const project = evaluate({}, {}, id => id);
const { summaries, activeId } = JSON.parse(readFileSync(0, 'utf8'));
process.stdout.write(JSON.stringify(project(summaries, activeId)));
