import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSkier, stepSkier, placeOnSurface } from '../src/physics.js';
import { buildSurfaces, createEquationPiece } from '../src/track.js';
import { PHYSICS } from '../src/config.js';

const dt = PHYSICS.stepSeconds;

/** Brake for `seconds` (or `brakeSeconds` of them) on a straight slope `degrees` steep. */
function hockeyStop(degrees, speed, seconds, brakeSeconds = seconds) {
  const gradient = Math.tan((degrees * Math.PI) / 180);
  const slope = buildSurfaces([createEquationPiece(`y = -${gradient.toFixed(5)}x`, -5, 395)]);
  const skier = createSkier({ x: 0, y: 0.05 });
  assert.ok(placeOnSurface(skier, slope, speed, 1));
  const events = [];
  for (let time = 0; time < seconds && skier.mode === 'ground'; time += dt) {
    events.push(...stepSkier(skier, slope, { brake: time < brakeSeconds }, dt));
  }
  return { skier, crash: events.find((event) => event.type === 'crash') };
}

const gripSlope = (Math.atan(PHYSICS.hockeyGrip) * 180) / Math.PI;

test('a hockey stop brings the skier to a stop on moderate ground', () => {
  for (const degrees of [0, 10, gripSlope - 8]) {
    const stop = hockeyStop(degrees, 15, 12);
    assert.equal(stop.crash, undefined, `${degrees}°`);
    assert.ok(Math.abs(stop.skier.speed) < 0.5, `${degrees}°: still ${stop.skier.speed.toFixed(1)} m/s`);
  }
});

test('steeper than the edges can hold, a hockey stop only caps the speed', () => {
  const degrees = gripSlope + 6;
  const braking = hockeyStop(degrees, 5, 10);
  const coasting = hockeyStop(degrees, 5, 10, 0);
  assert.equal(braking.crash, undefined);
  assert.ok(braking.skier.speed > 3, `braking settles at ${braking.skier.speed.toFixed(1)} m/s, never stopping`);
  assert.ok(braking.skier.speed < coasting.skier.speed * 0.5, 'but well below coasting');
});

test('too fast or too steep, the edge catches and the skier goes over the tips', () => {
  const tooFast = hockeyStop(0, PHYSICS.hockeyCrashSpeed + 5, 1);
  assert.equal(tooFast.crash?.kind, 'edge');
  const steepAndQuick = hockeyStop(30, 25, 1);
  assert.equal(steepAndQuick.crash?.kind, 'edge');
  const gentleAndQuick = hockeyStop(10, 25, 1);
  assert.equal(gentleAndQuick.crash, undefined, 'the same speed on gentle ground holds');
});

test('a quick dab of brake never gets the skis across, so never catches an edge', () => {
  const dab = hockeyStop(0, PHYSICS.hockeyCrashSpeed + 5, 1, PHYSICS.hockeyTurnSeconds * 0.8);
  assert.equal(dab.crash, undefined);
});
