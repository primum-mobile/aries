import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/date-display.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const { parseIsoDateTriple, formatIsoDateDisplay, formatIsoDateTimeDisplay,
  astronomicalToCivilYear, civilToAstronomicalYear, formatAstronomicalDateTriple } =
  new Function("exports", `${compiled}\nreturn exports;`)({});

test("BC Saros first dates retain the signed year for range navigation", () => {
  assert.deepEqual(parseIsoDateTriple("-756-03-12"), [-756, 3, 12]);
  assert.deepEqual(parseIsoDateTriple("-0756-03-12"), [-756, 3, 12]);
  assert.deepEqual(parseIsoDateTriple("0000-12-31"), [0, 12, 31]);
  assert.deepEqual(parseIsoDateTriple("0001-01-01"), [1, 1, 1]);
  assert.deepEqual(parseIsoDateTriple("2026-11-04"), [2026, 11, 4]);
  for (const value of [null, "", "-756-03-12junk", "-756-13-12", "-756-03-00"]) {
    assert.equal(parseIsoDateTriple(value), null);
  }
});

test("BC dates respect the selected display convention", () => {
  assert.equal(formatIsoDateDisplay("-756-03-12", "dmy"), "12.03.-756");
  assert.equal(formatIsoDateTimeDisplay("-756-03-12T04:42:57", "dmy"), "12.03.-756 04:42:57");
  assert.equal(formatIsoDateDisplay("0000-12-31", "dmy"), "31.12.0000");
  assert.equal(formatIsoDateDisplay("-001-12-31", "dmy"), "31.12.-001");
  assert.equal(formatIsoDateDisplay("-001-12-31", "current"), "-001-12-31");
  assert.equal(formatIsoDateDisplay("2026-11-04", "current"), "2026-11-04");
});

test("Nemrud's 109 BC stays 109 BC in the eclipse year control", () => {
  assert.equal(astronomicalToCivilYear(-108), -109);
  assert.equal(civilToAstronomicalYear(-109), -108);
  assert.equal(formatAstronomicalDateTriple([-108, 7, 14]), "-0109-07-14");
  assert.equal(formatAstronomicalDateTriple([-108, 7, 14], "dmy"), "-14.07.0109");
  assert.equal(formatAstronomicalDateTriple([-756, 3, 12]), "-0757-03-12");
});

test("civil display crosses from 1 BC to AD 1 without a year zero", () => {
  assert.deepEqual([-1, 0, 1, 2].map(astronomicalToCivilYear), [-2, -1, 1, 2]);
  assert.deepEqual([-2, -1, 1, 2].map(civilToAstronomicalYear), [-1, 0, 1, 2]);
  assert.equal(formatAstronomicalDateTriple([0, 12, 31]), "-0001-12-31");
  assert.equal(formatAstronomicalDateTriple([1, 1, 1]), "0001-01-01");
});
