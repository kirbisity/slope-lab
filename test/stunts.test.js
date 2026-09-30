import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSkier, stepSkier, placeOnSurface, landingOutcome, setRandomSource } from '../src/physics.js';
import { seededRandom } from '../src/joyride.js';
import { buildSurfaces, createEquationPiece } from '../src/track.js';
import { PHYSICS } from '../src/config.js';

const dt = PHYSICS.stepSeconds;
// These tests pin the line-up with a rider who stops a spin exactly on the
// heading; the last test measures how often a real, imperfect one crashes.
const SPOT_ERROR = PHYSICS.spinSpotError;
const FLIP_SPOT_ERROR = PHYSICS.flipSpotError;
PHYSICS.spinSpotError = 0;
PHYSICS.flipSpotError = 0;
const degrees = (value) => (value * Math.PI) / 180;
const tucked = PHYSICS.spinRateTucked;

// A level lip 5 m up after a smooth in-run, and a landing hill shaped like
// the flight, so impact speed never decides the outcome; only heading does.
const bigJump = buildSurfaces([
  createEquationPiece('y = 0.02(x-2)^2 + 5', -40, 2),
  createEquationPiece('y = 4.6 - 0.012(x-2)^2', 2.3, 70),
]);
// A long gentle slope for pops: a hop of ~0.85 s.
const gentle = buildSurfaces([createEquationPiece('y = -0.2x', -5, 300)]);

/**
 * Ride until the first touchdown after takeoff. Spin is pressed for a single
 * physics step `tapAt` seconds after takeoff (null: never), or held for
 * `hold` seconds. `pop` pops at x = 5 (with a tap of Spin when tapAt is 0).
 */
function ride({ surfaces, start, speed = 0, hold = 0, tapAt = null, pop = false, brake = false, extraSeconds = 0, switchStance = false }) {
  const skier = createSkier(start);
  assert.ok(placeOnSurface(skier, surfaces, speed, 1), 'the skier starts on the snow');
  skier.switchStance = switchStance;
  const events = [];
  let takeoffTime = null;
  let time = 0;
  let landedAt = null;
  while (time < 20) {
    const airborne = takeoffTime !== null && landedAt === null;
    const jump = pop && takeoffTime === null && skier.x > 5;
    const sinceTakeoff = airborne ? time - takeoffTime : -1;
    const tapped = tapAt !== null && airborne && sinceTakeoff >= tapAt && sinceTakeoff < tapAt + dt;
    const trick = (airborne && sinceTakeoff < hold) || tapped || (jump && (hold > 0 || tapAt === 0));
    // Brake only after touchdown, so compared runs arrive at the landing alike.
    for (const event of stepSkier(skier, surfaces, { trick, jump, brake: brake && landedAt !== null }, dt)) {
      events.push(event);
      if (event.type === 'takeoff' && takeoffTime === null) takeoffTime = time;
      if (event.type === 'touchdown' && landedAt === null) landedAt = time;
    }
    time += dt;
    if (landedAt !== null && time - landedAt >= extraSeconds) break;
  }
  const landing = events.find((event) => event.type === 'touchdown');
  return { skier, events, airtime: landing ? landing.airSeconds : null };
}

const onBigJump = (options) => ride({ surfaces: bigJump, start: { x: -39, y: 38.7 }, ...options });
const onGentle = (options) => ride({ surfaces: gentle, start: { x: 0, y: 0.05 }, speed: 8, pop: true, ...options });
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

test('one tap of Spin keeps the skier turning until the landing', () => {
  const tapped = onBigJump({ tapAt: 0.05 });
  const held = onBigJump({ hold: Infinity });
  const tappedTrick = tapped.events.find((event) => event.type === 'trick');
  assert.ok(tappedTrick, tapped.events.map((event) => event.kind || event.type).join(','));
  assert.equal(tapped.skier.crashed, false);
  assert.equal(tappedTrick.degrees, held.events.find((event) => event.type === 'trick').degrees, 'a tap spins as far as holding does');
  // Big air lands forward, so the spin is the most whole turns that fit.
  const turnsThatFit = Math.floor(((bigAir - 0.05 - PHYSICS.landingSpareSeconds) * tucked) / (2 * Math.PI));
  assert.ok(turnsThatFit >= 1, `the big jump fits a 360 (${bigAir.toFixed(2)} s of air)`);
  assert.equal(tappedTrick.degrees, 360 * turnsThatFit, 'as many turns as the air allows');
});

test('holding Spin right through a jump still lands: the rider lines up in time', () => {
  for (const attempt of [onBigJump({ hold: Infinity }), onGentle({ hold: Infinity })]) {
    assert.equal(attempt.skier.crashed, false, attempt.events.map((event) => event.kind || event.type).join(','));
  }
});

test('a tap at any moment of the flight lands, on the big jump and the hop', () => {
  for (let tapAt = 0; tapAt < 1.4; tapAt += 0.05) {
    for (const attempt of [onBigJump({ tapAt }), onGentle({ tapAt })]) {
      assert.equal(attempt.skier.crashed, false, `tap at ${tapAt.toFixed(2)} s crashed: ${attempt.events.map((event) => event.kind || event.type).join(',')}`);
    }
  }
});

test('a later tap turns less: there is less air left to spin in', () => {
  const early = onBigJump({ tapAt: 0.05 }).events.find((event) => event.type === 'trick').degrees;
  const late = onBigJump({ tapAt: bigAir - 0.55 }).events.find((event) => event.type === 'trick');
  assert.ok(!late || late.degrees < early, `early ${early}, late ${late && late.degrees}`);
});

test('the spin stops at the landing: the next jump starts square', () => {
  const skier = createSkier({ x: 0, y: 0.05 });
  placeOnSurface(skier, gentle, 8, 1);
  stepSkier(skier, gentle, { jump: true, trick: true }, dt);
  for (let step = 0; step < 480 && skier.mode === 'air'; step += 1) stepSkier(skier, gentle, {}, dt);
  assert.equal(skier.mode, 'ground');
  assert.equal(skier.spinRate, 0);
  stepSkier(skier, gentle, { jump: true }, dt);
  for (let step = 0; step < 60; step += 1) stepSkier(skier, gentle, {}, dt);
  assert.equal(skier.spin, 0, 'a plain pop after a spin does not turn');
});

test('forward is forgiving, backwards is tight, sideways crashes', () => {
  const between = (PHYSICS.switchSafeAngle + PHYSICS.forwardSafeAngle) / 2;
  assert.deepEqual(landingOutcome(between, 0.5), { stance: 'forward', clean: false });
  assert.deepEqual(landingOutcome(Math.PI + between, 0.5), { crash: 'sideways' });
  assert.deepEqual(landingOutcome(Math.PI / 2, 0.5), { crash: 'sideways' });
  assert.deepEqual(landingOutcome(PHYSICS.forwardCleanAngle / 2, 0.5), { stance: 'forward', clean: true });
  assert.deepEqual(landingOutcome(Math.PI, 0.5), { stance: 'switch', clean: true });
  assert.deepEqual(landingOutcome(Math.PI, PHYSICS.switchMaxAirSeconds + 0.1), { crash: 'switch-big-air' });
});

test('touching down still facing back on a small hop rides away switch', () => {
  const skier = createSkier({ x: 10, y: -2 + 0.4 });
  skier.vx = 8;
  skier.vy = 0;
  skier.spin = Math.PI;
  const events = [];
  for (let step = 0; step < 240 && !events.some((event) => event.type === 'touchdown'); step += 1) {
    events.push(...stepSkier(skier, gentle, { trick: false }, dt));
  }
  assert.equal(skier.crashed, false);
  assert.equal(skier.switchStance, true);
  assert.ok(events.some((event) => event.type === 'switch'));
});

test('riding switch there are no brakes', () => {
  const run = (brake, switchStance) => {
    const skier = createSkier({ x: 0, y: 0.05 });
    placeOnSurface(skier, gentle, 8, 1);
    skier.switchStance = switchStance;
    for (let step = 0; step < 480; step += 1) stepSkier(skier, gentle, { brake }, dt);
    return Math.abs(skier.speed);
  };
  assert.ok(Math.abs(run(true, true) - run(false, true)) < 1e-9, 'braking does nothing switch');
  assert.ok(run(true, false) < run(false, false) * 0.8, 'facing forward the brake works');
});

test('a switch rider who pops and spins lands safely', () => {
  const { skier } = onGentle({ switchStance: true, tapAt: 0 });
  assert.equal(skier.crashed, false);
});

test('pop chains with spin: one step both leaves the snow and starts turning', () => {
  const skier = createSkier({ x: 0, y: 0.05 });
  placeOnSurface(skier, gentle, 8, 1);
  const events = stepSkier(skier, gentle, { jump: true, trick: true }, dt);
  assert.equal(events.find((event) => event.type === 'takeoff').reason, 'jump');
  stepSkier(skier, gentle, { trick: true }, dt);
  assert.ok(skier.spin > 0);
});

// ---------------------------------------------------------------- backflip

function flipRide(surfaces, start, speed, pop, tapAt, alsoSpin = false) {
  const skier = createSkier(start);
  placeOnSurface(skier, surfaces, speed, 1);
  const events = [];
  let takeoff = null;
  for (let time = 0; time < 20 && !events.some((event) => event.type === 'touchdown'); time += dt) {
    const airborne = takeoff !== null;
    const jump = pop && takeoff === null && skier.x > 5;
    const tap = (airborne && time - takeoff >= tapAt && time - takeoff < tapAt + dt) || (jump && tapAt === 0);
    for (const event of stepSkier(skier, surfaces, { jump, flip: tap, trick: alsoSpin && tap }, dt)) {
      events.push(event);
      if (event.type === 'takeoff' && takeoff === null) takeoff = time;
    }
  }
  return { skier, events, trick: events.find((event) => event.type === 'trick') };
}

test('one tap of Flip backflips until the landing, as many times as the air allows', () => {
  const big = flipRide(bigJump, { x: -39, y: 38.7 }, 0, false, 0.05);
  assert.equal(big.skier.crashed, false, big.events.map((event) => event.kind || event.type).join(','));
  assert.ok(big.trick && big.trick.flips >= 1, 'at least one backflip on the big jump');
  const hop = flipRide(gentle, { x: 0, y: 0.05 }, 8, true, 0);
  assert.equal(hop.skier.crashed, false);
});

test('a flip tapped at any moment lands upright', () => {
  for (let tapAt = 0; tapAt < 1.4; tapAt += 0.07) {
    const attempt = flipRide(bigJump, { x: -39, y: 38.7 }, 0, false, tapAt);
    assert.equal(attempt.skier.crashed, false, `tap at ${tapAt.toFixed(2)}: ${attempt.events.map((event) => event.kind || event.type).join(',')}`);
  }
});

test('flip and spin together: a corked combo lands and scores both', () => {
  const combo = flipRide(bigJump, { x: -39, y: 38.7 }, 0, false, 0.05, true);
  assert.equal(combo.skier.crashed, false);
  assert.ok(combo.trick.flips >= 1 && combo.trick.degrees >= 360, JSON.stringify(combo.trick));
});

test('landing a flip is judged on being upright', async () => {
  const { flipOutcome } = await import('../src/physics.js');
  assert.deepEqual(flipOutcome(0), { clean: true });
  assert.deepEqual(flipOutcome(2 * Math.PI + PHYSICS.flipCleanAngle / 2), { clean: true });
  assert.deepEqual(flipOutcome((PHYSICS.flipCleanAngle + PHYSICS.flipSafeAngle) / 2), { clean: false });
  assert.deepEqual(flipOutcome(Math.PI), { crash: 'flip' });
});

test('real riders stop a rotation a little off: some spins and fewer flips crash', () => {
  PHYSICS.spinSpotError = SPOT_ERROR;
  PHYSICS.flipSpotError = FLIP_SPOT_ERROR;
  setRandomSource(seededRandom(2026));
  try {
    let spinCrashes = 0;
    let flipCrashes = 0;
    let jumps = 0;
    // Each jump draws its own stop error from the seeded source.
    for (let speed = 0; speed < 12; speed += 0.2) {
      const spin = ride({ surfaces: bigJump, start: { x: -39, y: 38.7 }, speed, tapAt: 0.05 });
      const flip = flipRide(bigJump, { x: -39, y: 38.7 }, speed, false, 0.05);
      jumps += 1;
      if (spin.skier.crashed) spinCrashes += 1;
      if (flip.skier.crashed) flipCrashes += 1;
    }
    const spinRate = spinCrashes / jumps;
    // Enough to feel risky, never so many that tricks stop being worth trying.
    assert.ok(spinRate > 0.05 && spinRate < 0.4, `${spinCrashes} of ${jumps} spins crash`);
    assert.ok(flipCrashes / jumps > 0.03 && flipCrashes / jumps < 0.4, `${flipCrashes} of ${jumps} flips crash`);
  } finally {
    PHYSICS.spinSpotError = 0;
    PHYSICS.flipSpotError = 0;
    setRandomSource(null);
  }
});

// ------------------------------------------------------ arming a trick

test('Spin tapped on the snow is armed, and starts at the next takeoff', () => {
  const skier = createSkier({ x: -39, y: 38.7 });
  placeOnSurface(skier, bigJump, 0, 1);
  const events = [];
  stepSkier(skier, bigJump, { trick: true }, dt);
  assert.equal(skier.mode, 'ground', 'no hop is forced');
  assert.equal(skier.spinArmed, true);
  for (let step = 0; step < 240 * 20 && !events.some((event) => event.type === 'touchdown'); step += 1) events.push(...stepSkier(skier, bigJump, {}, dt));
  const trick = events.find((event) => event.type === 'trick');
  assert.ok(trick && trick.degrees >= 360, events.map((event) => event.type).join(','));
  assert.equal(skier.spinArmed, false, 'used up by the jump it was armed for');
});

test('Flip tapped with too little air left stays armed for the next jump', () => {
  // A pop hop is too short to finish a backflip.
  const skier = createSkier({ x: 0, y: 0.05 });
  placeOnSurface(skier, gentle, 8, 1);
  stepSkier(skier, gentle, { jump: true }, dt);
  // Tapped half way through the hop: a whole backflip no longer fits.
  for (let step = 0; step < 480 && skier.mode === 'air'; step += 1) stepSkier(skier, gentle, { flip: step === 96 }, dt);
  assert.equal(skier.mode, 'ground');
  assert.equal(skier.crashed, false);
  assert.equal(skier.flipArmed, true, 'still armed after the short hop');
});
