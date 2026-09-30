// The skier's body. While skiing, the pose answers loads through damped
// springs: knees give under g-force and landings, the torso leans against
// acceleration, arms and head lag behind. In a crash the body becomes a
// Verlet ragdoll: jointed points with their own momentum that fold, tumble
// and roll over the snow.
import { PHYSICS, BODY, RAGDOLL } from './config.js';
import { sweepSurfaces } from './physics.js';

const clamp = (value) => Math.max(-BODY.limit, Math.min(BODY.limit, value));

export function createBodyDynamics() {
  return {
    crouch: BODY.standingCrouch, crouchVelocity: 0,
    lean: 0, leanVelocity: 0,
    armSwing: 0, armVelocity: 0,
    headLag: 0, headVelocity: 0,
  };
}

// One damped spring step toward a target, with an extra forcing term.
function spring(value, velocity, target, frequency, damping, forcing, dt) {
  const acceleration = frequency * frequency * (target - value) - 2 * damping * frequency * velocity + forcing;
  const nextVelocity = Math.max(-40, Math.min(40, velocity + acceleration * dt));
  return { value: clamp(value + nextVelocity * dt), velocity: nextVelocity, acceleration };
}

/**
 * Advance the body by dt under this frame's loads:
 * gForce (normal load in g), tangentialAccel (m/s² along travel),
 * airborne, and an optional landing impact (m/s into the snow).
 */
export function updateBodyDynamics(body, loads, dt) {
  if (loads.impact) body.crouchVelocity += loads.impact * BODY.impactKick * BODY.crouchFrequency;
  const crouchTarget = loads.airborne
    ? BODY.airCrouch
    : Math.min(1, Math.max(0, BODY.standingCrouch + BODY.crouchPerG * (loads.gForce - 1)));
  const crouch = spring(body.crouch, body.crouchVelocity, crouchTarget, BODY.crouchFrequency, BODY.crouchDamping, 0, dt);
  body.crouch = crouch.value;
  body.crouchVelocity = crouch.velocity;

  const leanTarget = Math.max(-0.6, Math.min(0.8, (-loads.tangentialAccel / PHYSICS.gravity) * BODY.leanPerG));
  const lean = spring(body.lean, body.leanVelocity, leanTarget, BODY.leanFrequency, BODY.leanDamping, 0, dt);
  body.lean = lean.value;
  body.leanVelocity = lean.velocity;

  // Arms and head are pendulums on the torso: its angular acceleration,
  // and the knees' bounce for the head, push them the other way.
  const arm = spring(body.armSwing, body.armVelocity, 0, BODY.armFrequency, BODY.armDamping, -BODY.armCoupling * lean.acceleration, dt);
  body.armSwing = arm.value;
  body.armVelocity = arm.velocity;
  const head = spring(body.headLag, body.headVelocity, 0, BODY.headFrequency, BODY.headDamping, -BODY.headCoupling * (lean.acceleration + crouch.acceleration * 0.5), dt);
  body.headLag = head.value;
  body.headVelocity = head.velocity;
  return body;
}

/**
 * The acceleration a skier feels along the direction of travel (m/s²).
 * Gravity pulls every part of the body alike, so it is not felt; only the
 * snow's friction, air drag and braking are. That is the change in speed
 * minus gravity's share along the way.
 */
export function feltAcceleration(skier, previousSpeed, dt) {
  const speed = Math.hypot(skier.vx, skier.vy);
  const gravityAlong = speed > 0.1 ? -PHYSICS.gravity * (skier.vy / speed) : 0;
  return (speed - previousSpeed) / dt - gravityAlong;
}

// ------------------------------------------------------------- the ragdoll

export const SKELETON_BONES = [
  ['foot', 'knee'], ['knee', 'hip'], ['hip', 'shoulder'],
  ['shoulder', 'head'], ['shoulder', 'elbow'], ['elbow', 'hand'],
];

// Joints may fold but not pass through the body: these pairs keep at least
// this share of their starting distance.
const MINIMUM_SPANS = [['knee', 'shoulder', 0.45], ['hip', 'head', 0.7], ['foot', 'hip', 0.35], ['hand', 'hip', 0.2]];

/**
 * Build a ragdoll from world joint positions ({foot, knee, hip, shoulder,
 * head, hand, optional elbow}) moving at (vx, vy) and turning at `spin`
 * rad/s about the hips.
 */
export function createRagdoll(joints, motion, dt = 1 / 60) {
  const all = { ...joints };
  if (!all.elbow) all.elbow = { x: (all.shoulder.x + all.hand.x) / 2, y: (all.shoulder.y + all.hand.y) / 2 - 0.05 };
  const hip = all.hip;
  const points = {};
  for (const [name, joint] of Object.entries(all)) {
    const rx = joint.x - hip.x;
    const ry = joint.y - hip.y;
    const vx = motion.vx - motion.spin * ry;
    const vy = motion.vy + motion.spin * rx;
    points[name] = { x: joint.x, y: joint.y, previousX: joint.x - vx * dt, previousY: joint.y - vy * dt, touching: 0 };
  }
  const distance = (a, b) => Math.hypot(points[a].x - points[b].x, points[a].y - points[b].y);
  return {
    points,
    stepSeconds: dt,
    bones: SKELETON_BONES.map(([a, b]) => ({ a, b, length: distance(a, b) })),
    spans: MINIMUM_SPANS.map(([a, b, share]) => ({ a, b, minimum: distance(a, b) * share })),
    stillSeconds: 0,
    asleep: false,
  };
}

function satisfy(ragdoll) {
  const { points } = ragdoll;
  const pull = (a, b, length, onlyIfShorter) => {
    const pa = points[a];
    const pb = points[b];
    const dx = pb.x - pa.x;
    const dy = pb.y - pa.y;
    const current = Math.hypot(dx, dy) || 1e-6;
    if (onlyIfShorter && current >= length) return;
    const push = ((current - length) / current) * 0.5;
    pa.x += dx * push; pa.y += dy * push;
    pb.x -= dx * push; pb.y -= dy * push;
  };
  for (let pass = 0; pass < RAGDOLL.constraintPasses; pass += 1) {
    for (const bone of ragdoll.bones) pull(bone.a, bone.b, bone.length, false);
    for (const span of ragdoll.spans) pull(span.a, span.b, span.minimum, true);
  }
}

// If a joint crossed the snow during this substep, put it back on the
// surface, stop its motion into the snow and let friction take some of the
// slide: contact is where tumbling torque comes from.
function collide(point, start, surfaces) {
  const hit = sweepSurfaces(surfaces, start, point);
  if (!hit) return false;
  const a = hit.surface.points[hit.segment];
  const b = hit.surface.points[hit.segment + 1];
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const tx = (b.x - a.x) / length;
  const ty = (b.y - a.y) / length;
  let nx = -ty;
  let ny = tx;
  if (nx * (start.x - a.x) + ny * (start.y - a.y) < 0) { nx = -nx; ny = -ny; }
  const contactX = start.x + (point.x - start.x) * hit.along + nx * RAGDOLL.contactLift;
  const contactY = start.y + (point.y - start.y) * hit.along + ny * RAGDOLL.contactLift;
  const vx = point.x - point.previousX;
  const vy = point.y - point.previousY;
  const slide = (vx * tx + vy * ty) * (1 - RAGDOLL.contactFriction);
  const lift = Math.max(0, vx * nx + vy * ny);
  point.x = contactX;
  point.y = contactY;
  point.previousX = contactX - (tx * slide + nx * lift);
  point.previousY = contactY - (ty * slide + ny * lift);
  return true;
}

/** Advance the ragdoll by dt seconds over the given surfaces. */
export function stepRagdoll(ragdoll, surfaces, dt) {
  if (ragdoll.asleep) return;
  const substeps = RAGDOLL.substeps;
  const h = dt / substeps;
  const gravityStep = -PHYSICS.gravity * h * h;
  for (let step = 0; step < substeps; step += 1) {
    const scale = h / ragdoll.stepSeconds;
    const starts = {};
    for (const [name, point] of Object.entries(ragdoll.points)) {
      starts[name] = { x: point.x, y: point.y };
      // Velocity is stored as the last step's displacement; rescale it when
      // the step length changes (slow motion, first step).
      const drag = point.touching > 0 ? RAGDOLL.snowDrag : RAGDOLL.airDamping;
      const vx = (point.x - point.previousX) * scale * drag;
      const vy = (point.y - point.previousY) * scale * drag;
      point.previousX = point.x;
      point.previousY = point.y;
      point.x += vx;
      point.y += vy + gravityStep;
    }
    ragdoll.stepSeconds = h;
    satisfy(ragdoll);
    for (const [name, point] of Object.entries(ragdoll.points)) {
      point.touching = collide(point, starts[name], surfaces) ? RAGDOLL.snowDragSubsteps : Math.max(0, point.touching - 1);
    }
  }
  // Judge stillness by the body's mean joint speed: contact nudges keep a
  // toe or a hand twitching long after the body has stopped moving.
  let total = 0;
  const joints = Object.values(ragdoll.points);
  for (const point of joints) total += Math.hypot(point.x - point.previousX, point.y - point.previousY) / h;
  ragdoll.stillSeconds = total / joints.length < RAGDOLL.sleepSpeed ? ragdoll.stillSeconds + dt : 0;
  if (ragdoll.stillSeconds >= RAGDOLL.sleepSeconds) {
    ragdoll.asleep = true;
    for (const point of Object.values(ragdoll.points)) {
      point.previousX = point.x;
      point.previousY = point.y;
    }
  }
}

/** Centre of the ragdoll's hips, for the camera to follow. */
export function ragdollCentre(ragdoll) {
  return { x: ragdoll.points.hip.x, y: ragdoll.points.hip.y };
}
