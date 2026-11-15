import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
const source = await readFile(new URL('../src/lib/chart/wheel-style-menu.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ESNext}}).outputText;
const menu = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const styles = [
  {id:'factory.compact', name:'Compact', layout:'compact', factory:true},
  {id:'factory.traditional-morinus', name:'Traditional Morinus 6.03', layout:'compact', factory:true},
  {id:'user.saved', name:'New Style', layout:'compact', factory:false},
  {id:'working.compact', name:'Private', layout:'compact', factory:false},
];
const options = {catalog:{wheelStyles:styles}, display:{theme:1, wheel_preset_id:'factory.traditional-morinus'}};
test('additional built-in wheels appear and dispatch their own preset command', () => {
  assert.equal(menu.wheelStyleChoices(options).length, 3);
  const entries = menu.userWheelStyleMenuEntries(options);
  assert.deepEqual(entries.map(item => item.id), ['quick.options.wheel-preset:factory.traditional-morinus','quick.options.wheel-preset:user.saved']);
  assert.equal(entries[0].checked, true);
  assert.equal(menu.wheelStyleForCommand(entries[0].id, options).id, styles[1].id);
  assert.equal(menu.wheelStyleForCommand('quick.options.layout:1', options).id, 'factory.compact');
  assert.deepEqual(menu.wheelStyleMenuChecks(options).map(item => item.checked), [false,true,false]);
});
test('theme working copies check only the standard layout', () => {
  assert.deepEqual(menu.wheelStyleMenuChecks({...options, display:{theme:1,wheel_preset_id:'working.compact'}}).map(item => item.checked), [true,false,false]);
});
test('a Traditional working copy retains its presentation in selectors and native menu checks', () => {
  assert.equal(menu.wheelStyleDisplayId('working.compact', 'compact', {'wheel.presentation':'traditional-morinus'}), 'factory.traditional-morinus');
  assert.equal(menu.wheelStyleDisplayId('working.compact', 'compact', {}), 'factory.compact');
  assert.equal(menu.wheelStyleDisplayId('user.saved', 'compact', {'wheel.presentation':'traditional-morinus'}), 'user.saved');
  const working = {...options, display:{theme:1, wheel_preset_id:'working.compact', wheel_preset_style_id:'factory.traditional-morinus'}};
  assert.deepEqual(menu.wheelStyleMenuChecks(working).map(item => item.checked), [false,true,false]);
  assert.equal(menu.userWheelStyleMenuEntries(working)[0].checked, true);
});
