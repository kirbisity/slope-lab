import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSkier, stepSkier, speedOf, dragCoefficient, placeOnSurface } from '../src/physics.js';
import { buildSurfaces, createSketchPiece, createEquationPiece } from '../src/track.js';
import { PHYSICS } from '../src/config.js';

const g = PHYSICS.gravity;
const dt = PHYSICS.stepSeconds;
const noControls = { tuck: false, brake: false, jump: false };
const line = (points) => buildSurfaces([createSketchPiece(points, { raw: true })]);

function run(skier, surfaces, seconds, controls = noControls, onEvent = () => {}) {
  const steps = Math.round(seconds / dt);
  for (let step = 0; step < steps; step += 1) {
    for (const event of stepSkier(skier, surfaces, controls, dt)) onEvent(event, skier);
  }
}

// Swap in a frictionless, dragless world to compare against closed forms.
function withIdealWorld(body) {
  const saved = { ...PHYSICS };
  Object.assign(PHYSICS, { snowFriction: 0, dragAreaUpright: 0, dragAreaTuck: 0 });
  try { body(); } finally { Object.assign(PHYSICS, saved); }
}

test('free fall follows y = y0 - g t²/2 without drag', () => withIdealWorld(() => {
  const skier = createSkier({ x: 0, y: 100 });
  skier.vx = 0;
  run(skier, [], 2);
  assert.ok(Math.abs(skier.y - (100 - 0.5 * g * 4)) < 0.1, `y = ${skier.y}`);
}));

test('sliding down an incline accelerates at g(sinθ − μcosθ)', () => {
  const theta = Math.atan(0.5);
  const surfaces = line([{ x: 0, y: 0 }, { x: 400, y: -200 }]);
  const skier = createSkier({ x: 1, y: 0 });
  skier.vx = 0;
  run(skier, surfaces, 0.5);
  assert.equal(skier.mode, 'ground');
  const startSpeed = skier.speed;
  run(skier, surfaces, 1, { tuck: true, brake: false, jump: false });
  const expected = g * (Math.sin(theta) - PHYSICS.snowFriction * Math.cos(theta));
  // Tucked drag at these speeds is small; allow for it.
  const measured = skier.speed - startSpeed;
  assert.ok(measured < expected && measured > expected * 0.9, `${measured} vs ${expected}`);
});

test('energy is conserved on a smooth frictionless valley', () => withIdealWorld(() => {
  const surfaces = buildSurfaces([createEquationPiece('y = 0.05x^2', -20, 20)]);
  const skier = createSkier({ x: -19.5, y: 19.1 });
  skier.vx = 0;
  let lowestSpeed = 0;
  run(skier, surfaces, 3, noControls);
  run(skier, surfaces, 6, noControls, (event) => assert.notEqual(event.type, 'takeoff'));
  const samples = [];
  for (let step = 0; step < 2000; step += 1) {
    stepSkier(skier, surfaces, noControls, dt);
    samples.push(0.5 * skier.speed * skier.speed + g * skier.y);
    lowestSpeed = Math.max(lowestSpeed, Math.abs(skier.speed));
  }
  const energyAtStart = g * 0.05 * 19.5 * 19.5;
  assert.ok(lowestSpeed > Math.sqrt(2 * energyAtStart) * 0.97, `peak speed ${lowestSpeed}`);
  for (const energy of samples) assert.ok(energy > energyAtStart * 0.95, `energy ${energy}`);
}));

test('a crest launches the skier exactly when v²κ exceeds g·cosθ', () => withIdealWorld(() => {
  // y = -x²/(2R) has curvature 1/R at the top; skiing over it at speed v
  // leaves the snow when v² > gR.
  const radius = 10;
  const surfaces = buildSurfaces([createEquationPiece(`y = -x^2/${2 * radius}`, -6, 8)]);
  const critical = Math.sqrt(g * radius);
  const outcomes = [0.8, 1.2].map((factor) => {
    const skier = createSkier({ x: -0.5, y: 0.1 });
    assert.ok(placeOnSurface(skier, surfaces, critical * factor));
    let takeoffX = null;
    run(skier, surfaces, 0.8, noControls, (event) => {
      if (event.type === 'takeoff' && takeoffX === null) {
        assert.equal(event.reason, 'crest', 'a crest launch counts as a jump');
        takeoffX = event.x;
      }
    });
    return takeoffX;
  });
  assert.equal(outcomes[0], null, 'below v = √(gR) the skier stays on the crest');
  assert.ok(outcomes[1] !== null && outcomes[1] < 1, `above v = √(gR) it leaves at the top, got ${outcomes[1]}`);
}));

test('landing on a slope that matches the flight is soft; flat is a crash', () => {
  // A smooth in-run ending level at x = 2, 5 m up.
  const inRun = createEquationPiece('y = 0.02(x-2)^2 + 5', -30, 2);
  const trial = (landing) => {
    const surfaces = buildSurfaces([inRun, landing]);
    const skier = createSkier({ x: -29, y: 24.6 });
    skier.vx = 0;
    run(skier, surfaces, 0.4);
    const events = [];
    run(skier, surfaces, 10, noControls, (event) => events.push(event.type));
    return events;
  };
  // Leaving the lip level at ~18 m/s the flight is y ≈ 5 − 0.015(x−2)²;
  // a landing hill just under and just shallower than that meets it almost
  // parallel, the way a ski-jump landing profile does.
  const steepLanding = trial(createEquationPiece('y = 4.6 - 0.012(x-2)^2', 2, 60));
  const flatLanding = trial(createSketchPiece([{ x: 2, y: -15 }, { x: 80, y: -15 }], { raw: true }));
  assert.ok(steepLanding.includes('land') && !steepLanding.includes('crash'), steepLanding.join(','));
  assert.ok(flatLanding.includes('crash'), flatLanding.join(','));
});

test('tucking goes faster than skiing upright; braking slows down', () => {
  const surfaces = line([{ x: 0, y: 0 }, { x: 600, y: -300 }]);
  const speedAfter = (controls) => {
    const skier = createSkier({ x: 1, y: 0.1 });
    run(skier, surfaces, 12, controls);
    return skier.speed;
  };
  const upright = speedAfter(noControls);
  const tucked = speedAfter({ tuck: true, brake: false, jump: false });
  const braking = speedAfter({ tuck: false, brake: true, jump: false });
  assert.ok(tucked > upright * 1.15, `${tucked} vs ${upright}`);
  assert.ok(braking < upright * 0.7, `${braking} vs ${upright}`);
  assert.ok(dragCoefficient({ tuck: true }) < dragCoefficient({ tuck: false }));
});

test('friction brings a skier on the flat to a stop', () => {
  const surfaces = line([{ x: 0, y: 0 }, { x: 200, y: 0 }]);
  const skier = createSkier({ x: 1, y: 0.05 });
  skier.vx = 5;
  run(skier, surfaces, 20);
  assert.equal(skier.speed, 0);
  const expectedDistance = 25 / (2 * g * PHYSICS.snowFriction);
  assert.ok(skier.x < 1 + expectedDistance && skier.x > 1 + expectedDistance * 0.7, `stopped at ${skier.x}`);
});

test('the end of a track is a jump', () => {
  const surfaces = line([{ x: 0, y: 10 }, { x: 20, y: 0 }]);
  const skier = createSkier({ x: 1, y: 9.6 });
  const events = [];
  run(skier, surfaces, 5, noControls, (event) => events.push(event));
  const takeoff = events.find((event) => event.type === 'takeoff');
  assert.equal(takeoff.reason, 'end');
  assert.ok(Math.abs(takeoff.x - 20) < 0.1);
  assert.equal(skier.mode, 'air');
});

test('a sharp concave kink is an impact, a gentle valley is not', () => {
  const kink = line([{ x: 0, y: 20 }, { x: 20, y: 0 }, { x: 40, y: 20 }]);
  const valley = buildSurfaces([createEquationPiece('y = 0.05x^2', -20, 20)]);
  const impacts = (surfaces, start) => {
    const skier = createSkier(start);
    skier.vx = 0;
    const hits = [];
    run(skier, surfaces, 3, noControls, (event) => { if (event.type === 'hard' || event.type === 'crash') hits.push(event); });
    return hits;
  };
  assert.ok(impacts(kink, { x: 0.5, y: 19.7 }).length > 0);
  assert.equal(impacts(valley, { x: -19.5, y: 19.2 }).length, 0);
});

test('a skier landing on the underside of a track falls away', () => {
  const surfaces = line([{ x: -10, y: 5 }, { x: 10, y: 5 }]);
  const skier = createSkier({ x: 0, y: 3 });
  skier.vx = 0;
  skier.vy = 8;
  run(skier, surfaces, 1.5);
  assert.ok(skier.y < 3, `y = ${skier.y}`);
});

test('speed is reported consistently on the ground and in the air', () => {
  const surfaces = line([{ x: 0, y: 10 }, { x: 20, y: 0 }]);
  const skier = createSkier({ x: 1, y: 9.6 });
  run(skier, surfaces, 1);
  assert.ok(Math.abs(speedOf(skier) - Math.abs(skier.speed)) < 1e-9);
});
