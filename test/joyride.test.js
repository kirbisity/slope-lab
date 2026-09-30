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

test('seeded random numbers are uniform enough', () => {
  const random = seededRandom(1);
  const buckets = new Array(10).fill(0);
  for (let index = 0; index < 10000; index += 1) buckets[Math.floor(random() * 10)] += 1;
  for (const count of buckets) assert.ok(count > 900 && count < 1100);
});
