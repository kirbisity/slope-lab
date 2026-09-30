import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEquationPiece, sampleFunction, smoothStroke, polylineLength, groundBelow, buildSurfaces, createSketchPiece } from '../src/track.js';
import { TRACKS } from '../src/config.js';

test('equation tracks are sampled at even arc length, even when steep', () => {
  const piece = createEquationPiece('y = 3x', 0, 10);
  const points = piece.polylines[0];
  for (let index = 1; index < points.length; index += 1) {
    const gap = Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
    assert.ok(gap <= TRACKS.sampleSpacing * 1.05, `gap ${gap}`);
  }
  assert.equal(points[0].x, 0);
  assert.equal(points[points.length - 1].x, 10);
});

test('discontinuities split a track instead of drawing a wall', () => {
  assert.equal(sampleFunction((x) => 1 / x, -5, 5).length, 2);
  assert.equal(sampleFunction((x) => Math.sqrt(x), -5, 5).length, 1);
  assert.ok(sampleFunction(Math.tan, -4, 4).length >= 3);
});

test('equations with no real values in range are rejected', () => {
  assert.throws(() => createEquationPiece('y = sqrt(x)', -10, -1), /no real values/);
  assert.throws(() => createEquationPiece('y = x', 3, 3), /two different/);
});

test('smoothing a shaky stroke removes most of its corners', () => {
  const shaky = [];
  for (let index = 0; index <= 40; index += 1) shaky.push({ x: index * 0.3, y: index % 2 === 0 ? 0 : 0.25 });
  const turn = (points) => {
    let total = 0;
    for (let index = 2; index < points.length; index += 1) {
      const a = Math.atan2(points[index - 1].y - points[index - 2].y, points[index - 1].x - points[index - 2].x);
      const b = Math.atan2(points[index].y - points[index - 1].y, points[index].x - points[index - 1].x);
      total += Math.abs(b - a);
    }
    return total / polylineLength(points);
  };
  assert.ok(turn(smoothStroke(shaky)) < turn(shaky) / 4);
});

test('ground below finds the highest surface under a point', () => {
  const surfaces = buildSurfaces([createSketchPiece([{ x: -5, y: 0 }, { x: 5, y: 0 }], { raw: true }), createSketchPiece([{ x: -5, y: 3 }, { x: 5, y: 3 }], { raw: true })]);
  assert.equal(groundBelow(surfaces, 0, 10).y, 3);
  assert.equal(groundBelow(surfaces, 0, 2).y, 0);
  assert.equal(groundBelow(surfaces, 0, -1), null);
});
