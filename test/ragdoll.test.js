import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBodyDynamics, updateBodyDynamics, createRagdoll, stepRagdoll, SKELETON_BONES } from '../src/ragdoll.js';
import { buildSurfaces, createEquationPiece, groundBelow } from '../src/track.js';

const settle = (loads, seconds = 3) => {
  const body = createBodyDynamics();
  for (let time = 0; time < seconds; time += 1 / 60) updateBodyDynamics(body, loads, 1 / 60);
  return body;
};

test('more g-force means a deeper crouch at rest; the air stretches the legs', () => {
  const light = settle({ gForce: 1, tangentialAccel: 0, airborne: false });
  const heavy = settle({ gForce: 2.5, tangentialAccel: 0, airborne: false });
  const flying = settle({ gForce: 0, tangentialAccel: 0, airborne: true });
  assert.ok(heavy.crouch > light.crouch + 0.2, `${heavy.crouch} vs ${light.crouch}`);
  assert.ok(flying.crouch < light.crouch);
});

test('a hard landing compresses past rest, springs back, and settles', () => {
  const body = settle({ gForce: 1, tangentialAccel: 0, airborne: false });
  const rest = body.crouch;
  updateBodyDynamics(body, { gForce: 1, tangentialAccel: 0, airborne: false, impact: 6 }, 1 / 60);
  let deepest = rest;
  const trace = [];
  for (let frame = 0; frame < 180; frame += 1) {
    updateBodyDynamics(body, { gForce: 1, tangentialAccel: 0, airborne: false }, 1 / 60);
    deepest = Math.max(deepest, body.crouch);
    trace.push(body.crouch);
  }
  assert.ok(deepest > rest + 0.25, `absorbs: ${deepest} vs ${rest}`);
  assert.ok(Math.min(...trace.slice(10, 60)) < rest, 'rebounds past rest');
  assert.ok(Math.abs(trace[trace.length - 1] - rest) < 0.02, 'settles');
});

test('slowing down pitches the torso forward; speeding up sits it back', () => {
  const braking = settle({ gForce: 1, tangentialAccel: -6, airborne: false });
  const speeding = settle({ gForce: 1, tangentialAccel: 4, airborne: false });
  assert.ok(braking.lean > 0.1, `braking lean ${braking.lean}`);
  assert.ok(speeding.lean < 0, `speeding lean ${speeding.lean}`);
});

test('arms and head lag the torso: they swing after a change', () => {
  const body = settle({ gForce: 1, tangentialAccel: 0, airborne: false });
  updateBodyDynamics(body, { gForce: 1, tangentialAccel: -9, airborne: false }, 1 / 60);
  let peakSwing = 0;
  for (let frame = 0; frame < 40; frame += 1) {
    updateBodyDynamics(body, { gForce: 1, tangentialAccel: -9, airborne: false }, 1 / 60);
    peakSwing = Math.max(peakSwing, Math.abs(body.armSwing));
  }
  assert.ok(peakSwing > 0.1, `arm swing ${peakSwing}`);
});

test('extreme loads stay bounded', () => {
  const body = createBodyDynamics();
  for (let frame = 0; frame < 600; frame += 1) {
    updateBodyDynamics(body, { gForce: frame % 2 ? 9 : 0, tangentialAccel: frame % 3 ? 40 : -40, airborne: frame % 5 === 0, impact: frame % 50 === 0 ? 30 : 0 }, 1 / 60);
    for (const value of [body.crouch, body.lean, body.armSwing, body.headLag]) assert.ok(Number.isFinite(value) && Math.abs(value) <= 1.6);
  }
});

// A standing skeleton at x, on ground height y, moving at (vx, vy), with
// left and right limbs a little apart, as a skier's are.
function standing(x, y, vx = 0, vy = 0, spin = 0) {
  const joints = {
    footL: { x: x - 0.04, y }, footR: { x: x + 0.04, y },
    kneeL: { x: x + 0.18, y: y + 0.5 }, kneeR: { x: x + 0.22, y: y + 0.5 },
    hip: { x, y: y + 0.95 }, shoulder: { x: x + 0.14, y: y + 1.45 }, head: { x: x + 0.2, y: y + 1.66 },
    elbowL: { x: x + 0.3, y: y + 1.2 }, elbowR: { x: x + 0.34, y: y + 1.18 },
    handL: { x: x + 0.48, y: y + 1.02 }, handR: { x: x + 0.52, y: y + 0.98 },
  };
  return createRagdoll(joints, { vx, vy, spin });
}

const boneLengths = (ragdoll) => SKELETON_BONES.map(([a, b]) => Math.hypot(ragdoll.points[a].x - ragdoll.points[b].x, ragdoll.points[a].y - ragdoll.points[b].y));

test('the ragdoll keeps its bones and never ends up under the snow', () => {
  const slope = buildSurfaces([createEquationPiece('y = -0.6x', -20, 300)]);
  const ragdoll = standing(0, 0.05, 12, -6, 6);
  const rest = boneLengths(ragdoll);
  for (let frame = 0; frame < 60 * 6; frame += 1) {
    stepRagdoll(ragdoll, slope, 1 / 60);
    for (const point of Object.values(ragdoll.points)) {
      assert.ok(groundBelow(slope, point.x, point.y + 0.05), `under the snow at (${point.x.toFixed(2)}, ${point.y.toFixed(2)})`);
    }
  }
  boneLengths(ragdoll).forEach((length, index) => assert.ok(Math.abs(length - rest[index]) < rest[index] * 0.08, `bone ${index}: ${length} vs ${rest[index]}`));
});

test('on a steep slope it rolls: the torso turns over', () => {
  const slope = buildSurfaces([createEquationPiece('y = -0.9x', -20, 300)]);
  const ragdoll = standing(0, 0.05, 10, -9, 8);
  const torsoAngle = () => Math.atan2(ragdoll.points.shoulder.y - ragdoll.points.hip.y, ragdoll.points.shoulder.x - ragdoll.points.hip.x);
  let turned = 0;
  let previous = torsoAngle();
  for (let frame = 0; frame < 60 * 4; frame += 1) {
    stepRagdoll(ragdoll, slope, 1 / 60);
    const angle = torsoAngle();
    turned += Math.atan2(Math.sin(angle - previous), Math.cos(angle - previous));
    previous = angle;
  }
  assert.ok(Math.abs(turned) > Math.PI, `turned ${turned.toFixed(2)} rad`);
});

test('on the flat it folds up and comes to rest', () => {
  const flat = buildSurfaces([createEquationPiece('y = 0', -50, 150)]);
  const ragdoll = standing(0, 0.05, 8, 0, 3);
  for (let frame = 0; frame < 60 * 8; frame += 1) stepRagdoll(ragdoll, flat, 1 / 60);
  assert.ok(ragdoll.points.head.y < 0.6, 'lying down, not standing');
  let speed = 0;
  for (const point of Object.values(ragdoll.points)) speed = Math.max(speed, Math.hypot(point.x - point.previousX, point.y - point.previousY) / ragdoll.stepSeconds);
  assert.ok(speed < 0.3, `still moving at ${speed}`);
  assert.equal(ragdoll.asleep, true, 'a body at rest stops being simulated');
});

test('the drawn pose bends with the body: loaded knees lower the hips, a lean moves the shoulders', async () => {
  const { skierPose, skierJointsInWorld } = await import('../src/renderer.js');
  const skier = { x: 10, y: 5, mode: 'ground', facing: 1, pitch: 0 };
  const look = (body) => ({ tuck: 0, brake: false, pitch: 0, body });
  const relaxed = skierPose(skier, look(createBodyDynamics()));
  const loaded = skierPose(skier, look({ ...createBodyDynamics(), crouch: 0.9 }));
  const leaning = skierPose(skier, look({ ...createBodyDynamics(), lean: 0.5 }));
  assert.ok(loaded.hip[1] < relaxed.hip[1] - 0.2, 'hips drop under load');
  assert.ok(leaning.shoulder[0] > relaxed.shoulder[0] + 0.1, 'shoulders move forward in a lean');
  const facingRight = skierJointsInWorld(skier, look(createBodyDynamics()));
  const facingLeft = skierJointsInWorld({ ...skier, facing: -1 }, look(createBodyDynamics()));
  assert.ok(Math.abs((facingRight.head.x - 10) + (facingLeft.head.x - 10)) < 1e-9, 'mirrored when facing the other way');
  assert.ok(facingRight.head.y > facingRight.hip.y && facingRight.hip.y > facingRight.footL.y);
});

test('gravity is not felt: sliding freely feels like nothing, braking feels like slowing', async () => {
  const { feltAcceleration } = await import('../src/ragdoll.js');
  const { createSkier, stepSkier, placeOnSurface } = await import('../src/physics.js');
  const { PHYSICS } = await import('../src/config.js');
  const slope = buildSurfaces([createEquationPiece('y = -0.5x', -5, 300)]);
  const feel = (controls) => {
    const skier = createSkier({ x: 0, y: 0.05 });
    placeOnSurface(skier, slope, 10, 1);
    const dt = 1 / 60;
    let previous = Math.hypot(skier.vx, skier.vy);
    for (let step = 0; step < 4; step += 1) stepSkier(skier, slope, controls, PHYSICS.stepSeconds);
    const felt = feltAcceleration(skier, previous, 4 * PHYSICS.stepSeconds);
    return { felt, dt };
  };
  const free = feel({}).felt;
  const braking = feel({ brake: true }).felt;
  // Free sliding feels only friction and drag: a small drag backwards, well under 1 g.
  assert.ok(free < 0 && free > -2, `free slide feels ${free}`);
  // Braking feels strongly backwards: that is what pitches the torso forward.
  assert.ok(braking < -2, `braking feels ${braking}`);
});

test('left and right limbs fold independently in a tumble', () => {
  const slope = buildSurfaces([createEquationPiece('y = -0.9x', -20, 300)]);
  const ragdoll = standing(0, 0.05, 10, -9, 8);
  let widest = 0;
  for (let frame = 0; frame < 60 * 3; frame += 1) {
    stepRagdoll(ragdoll, slope, 1 / 60);
    const { footL, footR } = ragdoll.points;
    widest = Math.max(widest, Math.hypot(footL.x - footR.x, footL.y - footR.y));
  }
  assert.ok(widest > 0.3, `the feet drift ${widest.toFixed(2)} m apart at most`);
});

test('flipping leans the skier backwards and tucks the knees', async () => {
  const { skierPose } = await import('../src/renderer.js');
  const skier = { x: 0, y: 0, mode: 'air', facing: 1, pitch: 0 };
  const plain = skierPose(skier, { tuck: 0, brake: false, pitch: 0, body: createBodyDynamics(), flipping: 0 });
  const flipping = skierPose(skier, { tuck: 0, brake: false, pitch: 0, body: createBodyDynamics(), flipping: 1 });
  assert.ok(flipping.shoulder[0] < plain.shoulder[0] - 0.15, 'shoulders thrown back');
  assert.ok(flipping.knee[1] > plain.knee[1], 'knees pulled up');
});

test('the ragdoll reports where and how hard it hits the snow, and goes quiet at rest', () => {
  const flat = buildSurfaces([createEquationPiece('y = 0', -50, 150)]);
  const ragdoll = standing(0, 0.6, 9, -4, 4);
  let hardest = 0;
  let reports = 0;
  for (let frame = 0; frame < 60 * 2; frame += 1) {
    stepRagdoll(ragdoll, flat, 1 / 60);
    for (const impact of ragdoll.impacts) {
      reports += 1;
      hardest = Math.max(hardest, impact.speed);
      assert.ok(Math.abs(impact.y) < 0.1, 'impacts are on the snow');
    }
  }
  assert.ok(reports > 0 && hardest > 3, `hardest ${hardest.toFixed(1)} m/s over ${reports} contacts`);
  for (let frame = 0; frame < 60 * 10 && !ragdoll.asleep; frame += 1) stepRagdoll(ragdoll, flat, 1 / 60);
  stepRagdoll(ragdoll, flat, 1 / 60);
  assert.deepEqual(ragdoll.impacts, []);
});
