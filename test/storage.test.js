import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCourseFile, serialiseCourse } from '../src/storage.js';
import { createEquationPiece, createSketchPiece } from '../src/track.js';

test('an original Skateboarding save still loads', () => {
  const original = JSON.stringify({
    trails: [[{ x: -10, y: '5' }, { x: -9.8, y: '5.1' }], [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0.5 }]],
    graphs: ['y=-0.5x', ''],
    gpinfo: [['-15', '25'], ['', '']],
    home: { x: 3, y: 7 },
  });
  const loaded = parseCourseFile(original);
  assert.deepEqual(loaded.start, { x: 3, y: 7 });
  assert.equal(loaded.pieces.length, 2);
  assert.equal(loaded.pieces[0].kind, 'equation');
  assert.equal(loaded.pieces[0].fromX, -15);
  assert.equal(loaded.pieces[1].kind, 'sketch');
  assert.equal(loaded.pieces[1].polylines[0].length, 3);
});

test('a Slope Lab course round-trips, leaving locked pieces out', () => {
  const pieces = [
    createEquationPiece('y = 2 - 0.1x', -5, 5, { locked: true }),
    createEquationPiece('y = sin(x)', 0, 10),
    createSketchPiece([{ x: 0, y: 0 }, { x: 3, y: -1 }], { raw: true }),
  ];
  const loaded = parseCourseFile(serialiseCourse('the-kicker', { x: 1, y: 2 }, pieces));
  assert.equal(loaded.courseId, 'the-kicker');
  assert.equal(loaded.pieces.length, 2);
  assert.equal(loaded.pieces[0].equation, 'y = sin(x)');
  assert.deepEqual(loaded.pieces[1].polylines[0], [{ x: 0, y: 0 }, { x: 3, y: -1 }]);
});

test('files that are not courses are rejected with a readable error', () => {
  assert.throws(() => parseCourseFile('{"hello": 1}'), /not a Slope Lab course/);
});
