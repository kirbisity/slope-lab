import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSkier, stepSkier, placeOnSurface } from '../src/physics.js';
import { buildSurfaces, createEquationPiece } from '../src/track.js';
import { PHYSICS } from '../src/config.js';

const dt = PHYSICS.stepSeconds;
// A level lip 5 m up after a smooth in-run, and a landing hill shaped like
// the flight so that impact speed never decides the outcome; only rotation does.
const surfaces = buildSurfaces([
  createEquationPiece('y = 0.02(x-2)^2 + 5', -40, 2),
  createEquationPiece('y = 4.6 - 0.012(x-2)^2', 2.3, 70),
]);

/** Ride the jump, holding Flip for `holdSeconds` after takeoff. */
function jump(holdSeconds) {
  const skier = createSkier({ x: -39, y: 38.7 });
  assert.ok(placeOnSurface(skier, surfaces, 0, 1), 'the skier starts on the in-run');
  const events = [];
  let takeoffTime = null;
  let time = 0;
  while (time < 20 && !events.some((event) => event.type === 'touchdown')) {
    const airborne = takeoffTime !== null;
    const trick = airborne && time - takeoffTime < holdSeconds;
    for (const event of stepSkier(skier, surfaces, { trick }, dt)) {
      events.push(event);
      if (event.type === 'takeoff' && takeoffTime === null) takeoffTime = time;
    }
    time += dt;
  }
  return { skier, events, airtime: time - takeoffTime };
}

const plain = jump(0);
// Spin in total: tucked for h seconds, open for the rest of the flight.
const holdForTurns = (turns) => {
  const tucked = PHYSICS.spinRateTucked;
  const open = tucked * PHYSICS.openSpinFactor;
  return (turns * 2 * Math.PI - open * plain.airtime) / (tucked - open);
};

test('a plain jump is unaffected by the stunt rules', () => {
  assert.ok(plain.events.some((event) => event.type === 'takeoff'));
  assert.ok(plain.events.some((event) => event.type === 'touchdown'));
  assert.ok(plain.airtime > 1.2 && plain.airtime < 5, `airtime ${plain.airtime}`);
  assert.ok(!plain.events.some((event) => event.type === 'crash' || event.type === 'trick'));
});

test('holding Flip for the right time lands a clean backflip', () => {
  const { events, skier } = jump(holdForTurns(1));
  const trick = events.find((event) => event.type === 'trick');
  assert.ok(trick, events.map((event) => event.type).join(','));
  assert.equal(trick.flips, 1);
  assert.equal(trick.clean, true);
  assert.equal(skier.crashed, false);
});

test('holding Flip too long over-rotates into a crash', () => {
  const { events, skier } = jump(holdForTurns(1.25));
  assert.equal(skier.crashed, true);
  assert.equal(events.find((event) => event.type === 'crash').kind, 'over-rotated');
});

test('letting go too early under-rotates into a crash', () => {
  const { events, skier } = jump(holdForTurns(0.75));
  assert.equal(skier.crashed, true);
  assert.equal(events.find((event) => event.type === 'crash').kind, 'under-rotated');
});

test('a slightly short rotation is a sketchy but survivable landing', () => {
  const shortBy = (PHYSICS.trickSketchyAngle + PHYSICS.trickCrashAngle) / 2 / (2 * Math.PI);
  const { events, skier } = jump(holdForTurns(1 - shortBy));
  assert.equal(skier.crashed, false);
  assert.ok(events.some((event) => event.type === 'hard' && event.kind === 'sketchy'));
  assert.equal(events.find((event) => event.type === 'trick').clean, false);
});

test('opening up slows the spin by the moment-of-inertia factor', () => {
  const skier = createSkier({ x: 0, y: 100 });
  stepSkier(skier, [], { trick: true }, dt);
  const tucked = skier.spinRate;
  stepSkier(skier, [], { trick: false }, dt);
  assert.ok(Math.abs(skier.spinRate / tucked - PHYSICS.openSpinFactor) < 1e-9);
});

test('the pop is higher than before: v²/2g of the impulse', () => {
  assert.ok((PHYSICS.jumpImpulse ** 2) / (2 * PHYSICS.gravity) > 0.75);
});
