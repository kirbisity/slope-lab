import { test } from 'node:test';
import assert from 'node:assert/strict';
import { throwGear, stepGear, stepAllGear } from '../src/debris.js';
import { buildSurfaces, createSketchPiece, createEquationPiece } from '../src/track.js';
import { groundBelow } from '../src/track.js';

const flat = buildSurfaces([createSketchPiece([{ x: -50, y: 0 }, { x: 50, y: 0 }], { raw: true })]);
const seeded = (seed) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

test('a dropped helmet bounces lower each time and comes to rest on the snow', () => {
  const helmet = { kind: 'helmet', x: 0, y: 3, vx: 0, vy: 0, angle: 0, spin: 0, resting: false };
  const peaks = [];
  let rising = false;
  let lastY = helmet.y;
  for (let step = 0; step < 240 * 8 && !helmet.resting; step += 1) {
    stepGear(helmet, flat, 1 / 240);
    if (helmet.y > lastY) rising = true;
    else if (rising) { peaks.push(lastY); rising = false; }
    lastY = helmet.y;
    assert.ok(helmet.y >= 0, `fell through at ${helmet.y}`);
  }
  assert.ok(helmet.resting, 'settles');
  assert.ok(peaks.length >= 1 && peaks.every((peak, index) => index === 0 || peak < peaks[index - 1]));
  assert.ok(peaks[0] < 3 * 0.1, `first bounce ${peaks[0]} m from a 3 m drop`);
});

test('thrown gear follows its own paths and never ends up under a slope', () => {
  const slope = buildSurfaces([createEquationPiece('y = -0.4x + sin(0.3x)', -20, 120)]);
  const skier = { x: 0, y: 0.2, vx: 14, vy: -5, pitch: -0.4 };
  let gear = throwGear(skier, seeded(42));
  assert.equal(gear.length, 5);
  assert.ok(new Set(gear.map((item) => item.vx.toFixed(3))).size > 1, 'pieces fly apart');
  for (let frame = 0; frame < 60 * 10; frame += 1) {
    gear = stepAllGear(gear, slope, 1 / 60, -200);
    for (const item of gear) {
      const ground = groundBelow(slope, item.x, item.y + 0.1);
      assert.ok(ground, `${item.kind} at (${item.x.toFixed(1)}, ${item.y.toFixed(1)}) is under the slope`);
    }
  }
});

test('gear sliding on a gentle slope stops; on a steep one it keeps going', () => {
  const run = (equation) => {
    const surfaces = buildSurfaces([createEquationPiece(equation, -10, 380)]);
    const ski = { kind: 'ski', x: 0, y: 0.5, vx: 3, vy: 0, angle: 0, spin: 0, resting: false };
    for (let step = 0; step < 240 * 6; step += 1) stepGear(ski, surfaces, 1 / 240);
    return ski;
  };
  assert.equal(run('y = -0.05x').resting, true);
  assert.equal(run('y = -1.2x').resting, false);
});
