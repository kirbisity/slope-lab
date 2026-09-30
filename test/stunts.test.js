import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSkier, stepSkier, placeOnSurface } from '../src/physics.js';
import { buildSurfaces, createEquationPiece } from '../src/track.js';
import { PHYSICS } from '../src/config.js';

const dt = PHYSICS.stepSeconds;
const degrees = (value) => (value * Math.PI) / 180;

// A level lip 5 m up after a smooth in-run, and a landing hill shaped like
// the flight, so impact speed never decides the outcome; only heading does.
const bigJump = buildSurfaces([
  createEquationPiece('y = 0.02(x-2)^2 + 5', -40, 2),
  createEquationPiece('y = 4.6 - 0.012(x-2)^2', 2.3, 70),
]);
// A long gentle slope for pops: a hop of ~0.85 s.
const gentle = buildSurfaces([createEquationPiece('y = -0.2x', -5, 300)]);

/**
 * Ride until the first touchdown after takeoff. `hold` is how long Spin is
 * held from takeoff; `pop` pops (with Spin, when hold > 0) on the snow at x = 5.
 */
function ride({ surfaces, start, speed = 0, hold = 0, pop = false, brake = false, extraSeconds = 0 }) {
  const skier = createSkier(start);
  assert.ok(placeOnSurface(skier, surfaces, speed, 1), 'the skier starts on the snow');
  const events = [];
  let takeoffTime = null;
  let time = 0;
  let landedAt = null;
  while (time < 20) {
    const airborne = takeoffTime !== null;
    const jump = pop && !airborne && skier.x > 5;
    const trick = (airborne && time - takeoffTime < hold) || (jump && hold > 0);
    // Brake only after touchdown, so both runs arrive at the landing alike.
    for (const event of stepSkier(skier, surfaces, { trick, jump, brake: brake && landedAt !== null }, dt)) {
      events.push(event);
      if (event.type === 'takeoff' && takeoffTime === null) takeoffTime = time;
      if (event.type === 'touchdown' && landedAt === null) landedAt = time;
    }
    time += dt;
    if (landedAt !== null && time - landedAt >= extraSeconds) break;
  }
  const landing = events.find((event) => event.type === 'touchdown');
  return { skier, events, airtime: landing ? landing.airSeconds : null, touched: Boolean(landing) };
}

const onBigJump = (options) => ride({ surfaces: bigJump, start: { x: -39, y: 38.7 }, ...options });
const onGentle = (options) => ride({ surfaces: gentle, start: { x: 0, y: 0.05 }, speed: 8, pop: true, ...options });

// Heading turned by touchdown: wrapped up for h seconds, open for the rest.
function holdFor(angle, airtime) {
  const tucked = PHYSICS.spinRateTucked;
  const open = tucked * PHYSICS.openSpinFactor;
  return (angle - open * airtime) / (tucked - open);
}

const bigAir = onBigJump({}).airtime;
const hopAir = onGentle({}).airtime;

test('the scenarios happen: a big jump and a pop hop, with plain landings', () => {
  assert.ok(bigAir > PHYSICS.switchMaxAirSeconds && bigAir < 4, `big jump ${bigAir}`);
  assert.ok(hopAir > 0.5 && hopAir < PHYSICS.switchMaxAirSeconds, `hop ${hopAir}`);
  for (const plain of [onBigJump({}), onGentle({})]) {
    assert.ok(!plain.events.some((event) => event.type === 'crash' || event.type === 'trick'));
    assert.equal(plain.skier.switchStance, false);
  }
});

test('a 360 lands facing forward and scores its rotation', () => {
  const { events, skier } = onBigJump({ hold: holdFor(2 * Math.PI, bigAir) });
  const trick = events.find((event) => event.type === 'trick');
  assert.ok(trick, events.map((event) => event.type).join(','));
  assert.equal(trick.degrees, 360);
  assert.equal(trick.clean, true);
  assert.equal(skier.crashed, false);
  assert.equal(skier.switchStance, false);
});

test('facing forward is forgiving: 30° short of a 360 is sketchy, not a crash', () => {
  const { events, skier } = onBigJump({ hold: holdFor(degrees(330), bigAir) });
  assert.equal(skier.crashed, false);
  assert.ok(events.some((event) => event.type === 'hard' && event.kind === 'sketchy'));
});

test('backwards is tight: 30° past a 180 is sideways and crashes', () => {
  const { events, skier } = onGentle({ hold: holdFor(degrees(210), hopAir) });
  assert.equal(skier.crashed, true);
  assert.equal(events.find((event) => event.type === 'crash').kind, 'sideways');
});

test('landing sideways crashes', () => {
  const { events, skier } = onGentle({ hold: holdFor(degrees(90), hopAir) });
  assert.ok(Math.abs(holdFor(degrees(90), hopAir)) < 0.2, 'a quick tap turns a quarter on a hop');
  assert.equal(skier.crashed, true);
  assert.equal(events.find((event) => event.type === 'crash').kind, 'sideways');
});

test('a 180 off a pop lands switch: riding backwards', () => {
  const { events, skier } = onGentle({ hold: holdFor(Math.PI, hopAir) });
  assert.equal(skier.crashed, false);
  assert.equal(skier.switchStance, true);
  assert.ok(events.some((event) => event.type === 'switch'));
  assert.equal(events.find((event) => event.type === 'trick').degrees, 180);
});

test('a 180 off a big jump is too much air to land backwards', () => {
  const { events, skier } = onBigJump({ hold: holdFor(Math.PI, bigAir) });
  assert.equal(skier.crashed, true);
  assert.equal(events.find((event) => event.type === 'crash').kind, 'switch-big-air');
});

test('riding switch there are no brakes', () => {
  const coasting = onGentle({ hold: holdFor(Math.PI, hopAir), extraSeconds: 2 });
  const braking = onGentle({ hold: holdFor(Math.PI, hopAir), extraSeconds: 2, brake: true });
  assert.equal(braking.skier.switchStance, true);
  assert.ok(Math.abs(braking.skier.speed - coasting.skier.speed) < 1e-6);
  const forwardBraking = onGentle({ extraSeconds: 2, brake: true });
  assert.ok(Math.abs(forwardBraking.skier.speed) < Math.abs(coasting.skier.speed) * 0.8, 'facing forward the brake works');
});

test('another 180 turns a switch rider forward again', () => {
  const skier = createSkier({ x: 0, y: 0.05 });
  placeOnSurface(skier, gentle, 8, 1);
  skier.switchStance = true;
  const hold = holdFor(Math.PI, hopAir);
  let time = 0;
  let takeoff = null;
  const events = [];
  while (time < 6 && !events.some((event) => event.type === 'touchdown')) {
    const airborne = takeoff !== null;
    const jump = !airborne && skier.x > 5;
    for (const event of stepSkier(skier, gentle, { jump, trick: jump || (airborne && time - takeoff < hold) }, dt)) {
      events.push(event);
      if (event.type === 'takeoff' && takeoff === null) takeoff = time;
    }
    time += dt;
  }
  assert.equal(skier.crashed, false);
  assert.equal(skier.switchStance, false);
});

test('pop chains with spin: one step both leaves the snow and starts turning', () => {
  const skier = createSkier({ x: 0, y: 0.05 });
  placeOnSurface(skier, gentle, 8, 1);
  const events = stepSkier(skier, gentle, { jump: true, trick: true }, dt);
  assert.equal(events.find((event) => event.type === 'takeoff').reason, 'jump');
  stepSkier(skier, gentle, { trick: true }, dt);
  assert.ok(skier.spin > 0);
});

test('opening up slows the spin by the moment-of-inertia factor', () => {
  const skier = createSkier({ x: 0, y: 100 });
  stepSkier(skier, [], { trick: true }, dt);
  const tucked = skier.spinRate;
  stepSkier(skier, [], { trick: false }, dt);
  assert.ok(Math.abs(skier.spinRate / tucked - PHYSICS.openSpinFactor) < 1e-9);
});
