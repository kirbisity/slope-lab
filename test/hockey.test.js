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

/** Brake on these surfaces from `start` at `speed`; the first crash, if any. */
function brakeOver(pieces, start, speed, controls = { brake: true }, seconds = 4) {
  const surfaces = buildSurfaces(pieces);
  const skier = createSkier(start);
  assert.ok(placeOnSurface(skier, surfaces, speed, 1));
  const events = [];
  for (let time = 0; time < seconds; time += dt) events.push(...stepSkier(skier, surfaces, time < 0.4 ? { brake: true } : controls, dt));
  return events.find((event) => event.type === 'crash');
}

test('braking through a dip or a crest catches an edge; on even snow it does not', () => {
  const straight = [createEquationPiece('y = -0.25x', -5, 120)];
  assert.equal(brakeOver(straight, { x: 0, y: 0.05 }, 18), undefined);
  // The slope eases out of a dip: pressure builds on the skis.
  const dip = [createEquationPiece('y = -0.25x', -5, 12), createEquationPiece('y = -3 - 0.25(x-12) + 0.03(x-12)^2', 12, 40)];
  assert.equal(brakeOver(dip, { x: 0, y: 0.05 }, 18)?.kind, 'edge', 'a dip taken braking');
  // The same dip taken slowly presses too little to matter.
  assert.equal(brakeOver(dip, { x: 0, y: 0.05 }, 2), undefined, 'a dip taken slowly');
});

test('popping while braking leaves the snow with the skis across: a crash', () => {
  const straight = [createEquationPiece('y = -0.25x', -5, 120)];
  const crash = brakeOver(straight, { x: 0, y: 0.05 }, 10, { brake: true, jump: true }, 1);
  assert.equal(crash?.kind, 'edge');
});

test('landing backwards takes a smaller impact than landing forwards', () => {
  // Off a ledge onto flat: ~0.8 s of air, ~8 m/s into the snow.
  const ledge = [createEquationPiece('y = 3.3', -5, 0), createEquationPiece('y = 0', 0.3, 60)];
  const drop = (switchStance) => {
    const skier = createSkier({ x: -3, y: 3.35 });
    const surfaces = buildSurfaces(ledge);
    placeOnSurface(skier, surfaces, 3, 1);
    skier.switchStance = switchStance;
    const events = [];
    for (let time = 0; time < 3; time += dt) events.push(...stepSkier(skier, surfaces, {}, dt));
    return { touchdown: events.find((event) => event.type === 'touchdown'), crashed: skier.crashed };
  };
  const forward = drop(false);
  const backwards = drop(true);
  assert.ok(forward.touchdown.impact > PHYSICS.switchCrashLandingSpeed && forward.touchdown.impact < PHYSICS.crashLandingSpeed, `impact ${forward.touchdown.impact}`);
  assert.equal(forward.crashed, false);
  assert.equal(backwards.crashed, true);
});
