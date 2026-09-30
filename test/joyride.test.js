import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateJoyride, validateJoyride, seededRandom } from '../src/joyride.js';
import { compileEquation } from '../src/expression.js';

test('200 random seeds all give a slope a hands-off skier finishes cleanly', () => {
  const failures = [];
  const lengths = [];
  for (let seed = 1000; seed < 1200; seed += 1) {
    const course = generateJoyride(seed);
    if (!course) { failures.push(seed); continue; }
    lengths.push(course.finish.x);
  }
  assert.deepEqual(failures, []);
  // Long runs: every slope is at least 450 m to the finish.
  assert.ok(Math.min(...lengths) >= 450, `shortest ${Math.min(...lengths).toFixed(0)} m`);
  // Variety: slopes differ in length, not just in shape.
  assert.ok(Math.max(...lengths) - Math.min(...lengths) > 80, `lengths ${Math.min(...lengths)}–${Math.max(...lengths)}`);
});

test('the same seed gives the same slope; different seeds differ', () => {
  const a = generateJoyride(4242);
  const b = generateJoyride(4242);
  const c = generateJoyride(4243);
  assert.deepEqual(a.pieces, b.pieces);
  assert.notDeepEqual(a.pieces, c.pieces);
});

test('every generated piece is a readable equation that joins the next', () => {
  const course = generateJoyride(77);
  for (let index = 0; index < course.pieces.length; index += 1) {
    const piece = course.pieces[index];
    const fn = compileEquation(piece.equation);
    const next = course.pieces[index + 1];
    if (!next || next.fromX !== piece.toX) continue;
    const gap = Math.abs(fn(piece.toX) - compileEquation(next.equation)(next.fromX));
    assert.ok(gap < 0.01, `${piece.equation} → ${next.equation} steps ${gap}`);
  }
});

test('every slope has at least two jumps, one long enough to flip', () => {
  for (const seed of [9, 10, 11, 12, 13]) {
    const run = validateJoyride(generateJoyride(seed));
    assert.equal(run.status, 'finished');
    assert.ok(run.stats.longestAir >= 1);
    assert.ok(run.stats.jumps >= 2, `seed ${seed}: ${run.stats.jumps} jumps`);
  }
});

test('mogul fields ride clean hands-off but punish arriving too fast', async () => {
  const { createEquationPiece, buildSurfaces } = await import('../src/track.js');
  const { simulateRun } = await import('../src/run.js');
  // A mogul field is a 1 − cos train at least three bumps long.
  const isField = (piece) => {
    const match = piece.equation.match(/\(1 - cos\(([\d.]+)/);
    return match && ((piece.toX - piece.fromX) * Number(match[1])) / (2 * Math.PI) > 2.5;
  };
  let tuckedHits = 0;
  for (const seed of [21, 22, 23, 24, 25, 26]) {
    const course = generateJoyride(seed);
    const fields = course.pieces.filter(isField);
    assert.ok(fields.length >= 1, `seed ${seed} has no mogul field`);
    const near = (event) => fields.some((piece) => event.x >= piece.fromX && event.x <= piece.toX + 25);
    const pieces = course.pieces.map((spec) => createEquationPiece(spec.equation, spec.fromX, spec.toX, { locked: true }));
    const handsOff = simulateRun(course, pieces, buildSurfaces(pieces), {}, 220).log;
    assert.ok(!handsOff.some((event) => (event.type === 'hard' || event.type === 'crash') && near(event)), `seed ${seed}: hands-off hit the moguls`);
    const tucked = simulateRun(course, pieces, buildSurfaces(pieces), { tuck: true }, 220).log;
    tuckedHits += tucked.filter((event) => (event.type === 'hard' || event.type === 'crash') && near(event)).length;
  }
  assert.ok(tuckedHits >= 6, `tucked riders hit the moguls only ${tuckedHits} times`);
});

test('seeded random numbers are uniform enough', () => {
  const random = seededRandom(1);
  const buckets = new Array(10).fill(0);
  for (let index = 0; index < 10000; index += 1) buckets[Math.floor(random() * 10)] += 1;
  for (const count of buckets) assert.ok(count > 900 && count < 1100);
});
