import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHALLENGES, SANDBOX } from '../src/courses.js';
import { createEquationPiece, buildSurfaces, pieceLength } from '../src/track.js';
import { simulateRun, evaluateStars } from '../src/run.js';

function ride(course, extra, controls = {}) {
  const pieces = [...course.pieces, ...extra].map((spec) => createEquationPiece(spec.equation, spec.fromX, spec.toX, { locked: true }));
  return simulateRun(course, pieces, buildSurfaces(pieces), controls, 90).run;
}

for (const course of CHALLENGES) {
  test(`${course.name}: the reference solution finishes cleanly`, () => {
    const run = ride(course, course.solution);
    assert.equal(run.status, 'finished');
    const stars = evaluateStars(course, run);
    assert.ok(stars[0].met);
  });

  test(`${course.name}: an empty course cannot be finished`, () => {
    assert.notEqual(ride(course, []).status, 'finished');
  });

  test(`${course.name}: the naive attempt earns fewer stars than the reference`, () => {
    const count = (run) => evaluateStars(course, run).filter((star) => star.met).length;
    assert.ok(count(ride(course, course.naive)) < count(ride(course, course.solution)));
  });

  test(`${course.name}: the reference fits the ink budget`, () => {
    const used = course.solution.reduce((sum, spec) => sum + pieceLength(createEquationPiece(spec.equation, spec.fromX, spec.toX)), 0);
    assert.ok(used <= course.ink, `${used.toFixed(0)} m of ${course.ink} m`);
  });
}

test('the sandbox demo lands its jump and finishes', () => {
  const pieces = SANDBOX.pieces.map((spec) => createEquationPiece(spec.equation, spec.fromX, spec.toX));
  const { run, log } = simulateRun(SANDBOX, pieces, buildSurfaces(pieces), {}, 60);
  assert.ok(log.some((event) => event.type === 'takeoff'));
  assert.ok(!log.some((event) => event.type === 'crash' || event.type === 'hard'));
  assert.equal(run.status, 'finished');
});
