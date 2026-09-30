import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSkier, stepSkier, placeOnSurface, landingOutcome } from '../src/physics.js';
import { buildSurfaces, createEquationPiece } from '../src/track.js';
import { PHYSICS } from '../src/config.js';

const dt = PHYSICS.stepSeconds;
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
 * Ride until the first touchdown after takeoff, holding Spin for `hold`
 * seconds from takeoff (Infinity: through the landing). `pop` pops at x = 5.
 */
function ride({ surfaces, start, speed = 0, hold = 0, pop = false, brake = false, extraSeconds = 0, switchStance = false }) {
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
    const trick = (airborne && time - takeoffTime < hold) || (jump && hold > 0);
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

test('letting go past halfway completes the turn: a clean 360', () => {
  const { events, skier } = onBigJump({ hold: degrees(200) / tucked });
  const trick = events.find((event) => event.type === 'trick');
  assert.ok(trick, events.map((event) => event.type).join(','));
  assert.equal(trick.degrees, 360);
  assert.equal(trick.clean, true);
  assert.equal(skier.crashed, false);
});

test('letting go early lines up with the nearest safe heading', () => {
  // A big jump is too much air to land backwards, so an early let-go unwinds.
  const big = onBigJump({ hold: degrees(120) / tucked });
  assert.equal(big.skier.crashed, false);
  assert.ok(!big.events.some((event) => event.type === 'trick'));
  assert.equal(big.skier.switchStance, false);
  // On a hop, straight back is a safe landing too, and it may be the nearer one.
  const hop = onGentle({ hold: degrees(100) / tucked });
  assert.equal(hop.skier.crashed, false);
});

test('holding Spin right through a jump still lands: the rider lines up in time', () => {
  for (const attempt of [onBigJump({ hold: Infinity }), onGentle({ hold: Infinity })]) {
    assert.equal(attempt.skier.crashed, false, attempt.events.map((event) => event.kind || event.type).join(','));
  }
  const big = onBigJump({ hold: Infinity });
  // Holding keeps the full turn rate until the last heading the air allows,
  // so a long hold on a big jump lands more than a single turn.
  assert.ok(big.events.find((event) => event.type === 'trick').degrees >= 720, 'a long hold on a big jump lands several turns');
});

test('any hold, released or not, lands on the big jump and the hop', () => {
  for (let hold = 0.02; hold < 2; hold += 0.06) {
    for (const attempt of [onBigJump({ hold }), onGentle({ hold })]) {
      assert.equal(attempt.skier.crashed, false, `hold ${hold.toFixed(2)} s crashed: ${attempt.events.map((event) => event.kind || event.type).join(',')}`);
    }
  }
});

test('spinning is forgiving: most releases made in the air land', () => {
  let crashes = 0;
  const attempts = 60;
  for (let index = 0; index < attempts; index += 1) {
    if (onBigJump({ hold: ((index + 0.5) / attempts) * bigAir }).skier.crashed) crashes += 1;
  }
  assert.ok(crashes / attempts < 0.35, `${crashes} of ${attempts} crash`);
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

test('a switch rider who pops and turns half way round faces forward again', () => {
  const { skier } = onGentle({ switchStance: true, hold: degrees(160) / tucked });
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

test('letting go slows the turn to the open rate', () => {
  const skier = createSkier({ x: 0, y: 100 });
  stepSkier(skier, [], { trick: true }, dt);
  stepSkier(skier, [], { trick: true }, dt);
  assert.equal(skier.spinRate, tucked);
  stepSkier(skier, [], { trick: false }, dt);
  assert.ok(Math.abs(skier.spinRate - tucked * PHYSICS.openSpinFactor) < 1e-9);
});
