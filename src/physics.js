// Skier dynamics on a course of polylines.
//
// On the snow the skier is a bead on a wire: gravity along the tangent,
// kinetic friction proportional to the normal force, and quadratic air drag.
// Curvature lives at the polyline vertices, so each vertex is where the
// maths happens: bending away (a crest) the skier leaves the snow once
// v²κ > g·cosθ; bending toward (a valley or kink) the velocity component
// into the new segment is an impact, judged exactly like a landing.
// In the air the skier is a projectile with drag.
import { PHYSICS } from './config.js';

export function createSkier(start) {
  return {
    mode: 'air',
    x: start.x,
    y: start.y,
    vx: PHYSICS.startSpeed,
    vy: 0,
    surface: null,
    segment: 0,
    along: 0,
    speed: 0,
    side: 1,
    curveAccel: 0,
    normalAccel: 0,
    facing: 1,
    pitch: 0,
    crashed: false,
    spin: 0,
    spinRate: 0,
    switchStance: false,
    airSeconds: 0,
    groundedSeconds: 0,
  };
}

export function dragCoefficient(controls) {
  const area = controls.tuck ? PHYSICS.dragAreaTuck : PHYSICS.dragAreaUpright;
  return (0.5 * PHYSICS.airDensity * area) / PHYSICS.massKg;
}

function frictionCoefficient(skier, controls) {
  if (skier.crashed) return PHYSICS.crashFriction;
  // A snowplough needs the ski tips together in front: riding switch there
  // is no way to brake.
  return controls.brake && !skier.switchStance ? PHYSICS.brakeFriction : PHYSICS.snowFriction;
}

function segmentGeometry(surface, index) {
  const a = surface.points[index];
  const b = surface.points[index + 1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1e-9;
  return { a, b, length, tx: dx / length, ty: dy / length };
}

export function speedOf(skier) {
  return Math.hypot(skier.vx, skier.vy);
}

/** Signed turn from segment index to index+1 (radians, + is counter-clockwise). */
function turnAngle(surface, index) {
  const first = segmentGeometry(surface, index);
  const second = segmentGeometry(surface, index + 1);
  const cross = first.tx * second.ty - first.ty * second.tx;
  const dot = first.tx * second.tx + first.ty * second.ty;
  return { angle: Math.atan2(cross, dot), first, second };
}

function syncGroundState(skier) {
  const segment = segmentGeometry(skier.surface, skier.segment);
  skier.x = segment.a.x + segment.tx * skier.along;
  skier.y = segment.a.y + segment.ty * skier.along;
  skier.vx = segment.tx * skier.speed;
  skier.vy = segment.ty * skier.speed;
  if (Math.abs(skier.speed) > 0.05) skier.facing = skier.speed * segment.tx >= 0 ? 1 : -1;
  const forwardX = segment.tx * Math.sign(skier.speed || skier.facing * segment.tx || 1);
  const forwardY = segment.ty * Math.sign(skier.speed || skier.facing * segment.tx || 1);
  skier.pitch = Math.atan2(forwardY, forwardX * skier.facing);
}

function launch(skier, segment, events, reason) {
  const nx = -segment.ty * skier.side;
  const ny = segment.tx * skier.side;
  skier.mode = 'air';
  skier.vx = segment.tx * skier.speed;
  skier.vy = segment.ty * skier.speed;
  // Lift clear of the surface just left so the next sweep cannot re-hit it.
  skier.x += nx * 0.02;
  skier.y += ny * 0.02;
  skier.surface = null;
  skier.curveAccel = 0;
  skier.airSeconds = 0;
  events.push({ type: 'takeoff', reason, speed: Math.abs(skier.speed), x: skier.x, y: skier.y });
}

function judgeImpact(skier, impactSpeed, events, kind) {
  if (impactSpeed > PHYSICS.crashLandingSpeed && !skier.crashed) {
    skier.crashed = true;
    events.push({ type: 'crash', impact: impactSpeed, kind, x: skier.x, y: skier.y });
  } else if (impactSpeed > PHYSICS.softLandingSpeed) {
    events.push({ type: 'hard', impact: impactSpeed, kind, x: skier.x, y: skier.y });
  } else if (kind === 'landing') {
    events.push({ type: 'land', impact: impactSpeed, x: skier.x, y: skier.y });
  }
}

/** Find another track starting (or ending) where this one ends. */
function findJoint(surfaces, current, endPoint, motionX, motionY) {
  let best = null;
  for (const surface of surfaces) {
    if (surface === current) continue;
    const points = surface.points;
    const candidates = [
      { point: points[0], segment: 0, direction: 1 },
      { point: points[points.length - 1], segment: points.length - 2, direction: -1 },
    ];
    for (const candidate of candidates) {
      const gap = Math.hypot(candidate.point.x - endPoint.x, candidate.point.y - endPoint.y);
      if (gap > PHYSICS.joinTolerance) continue;
      const geometry = segmentGeometry(surface, candidate.segment);
      const newMotionX = geometry.tx * candidate.direction;
      const newMotionY = geometry.ty * candidate.direction;
      // Only continue onto a track heading onward, not one doubling back.
      if (newMotionX * motionX + newMotionY * motionY < 0.5) continue;
      if (!best || gap < best.gap) best = { surface, ...candidate, geometry, gap, newMotionX, newMotionY };
    }
  }
  return best;
}

/**
 * Apply the vertex rules for a turn from one motion direction to the next:
 * bending away can launch the skier, bending in hard is an impact.
 * Returns false when the skier left the snow.
 */
function negotiateTurn(skier, turn, meanLength, enteringNormalY, leaving, events) {
  const concavity = turn;
  const curveAccel = (skier.speed * skier.speed * concavity) / meanLength;
  if (concavity < 0 && PHYSICS.gravity * enteringNormalY + curveAccel < 0) {
    launch(skier, leaving, events, 'crest');
    return false;
  }
  if (concavity > 0 && Math.abs(turn) > PHYSICS.kinkAngle) {
    const impact = Math.abs(skier.speed) * Math.sin(Math.min(Math.PI / 2, Math.abs(turn)));
    judgeImpact(skier, impact, events, 'kink');
    skier.speed *= Math.cos(Math.min(Math.PI / 2, Math.abs(turn)));
  }
  skier.curveAccel = curveAccel;
  return true;
}

function crossJoint(skier, surfaces, direction, leaving, events) {
  const motionX = leaving.tx * direction;
  const motionY = leaving.ty * direction;
  const endPoint = { x: skier.x, y: skier.y };
  const joint = findJoint(surfaces, skier.surface, endPoint, motionX, motionY);
  if (!joint) {
    launch(skier, leaving, events, 'end');
    return false;
  }
  // Keep the skier on the same physical side: the new normal should agree
  // with the old one.
  const oldNormalX = -leaving.ty * skier.side;
  const oldNormalY = leaving.tx * skier.side;
  const newSide = (-joint.geometry.ty * oldNormalX + joint.geometry.tx * oldNormalY) >= 0 ? 1 : -1;
  const cross = motionX * joint.newMotionY - motionY * joint.newMotionX;
  const dot = motionX * joint.newMotionX + motionY * joint.newMotionY;
  const turn = Math.atan2(cross, dot) * skier.side * direction;
  const enteringNormalY = joint.geometry.tx * newSide;
  const meanLength = (leaving.length + joint.geometry.length) / 2;
  // Step onto the next piece first, so a launch at a slightly higher join
  // starts above that piece rather than tunnelling under it.
  skier.x = joint.point.x;
  skier.y = joint.point.y;
  if (!negotiateTurn(skier, turn, meanLength, enteringNormalY, leaving, events)) return false;
  skier.surface = joint.surface;
  skier.segment = joint.segment;
  skier.along = joint.direction > 0 ? 0 : joint.geometry.length;
  skier.side = newSide;
  skier.speed = Math.abs(skier.speed) * joint.direction;
  return true;
}

/**
 * Carry the skier across the vertex at the end (direction +1) or start
 * (direction -1) of the current segment. Returns false when it left the snow.
 */
function crossVertex(skier, surfaces, direction, events) {
  const surface = skier.surface;
  const lastSegment = surface.points.length - 2;
  const leaving = segmentGeometry(surface, skier.segment);
  if ((direction > 0 && skier.segment >= lastSegment) || (direction < 0 && skier.segment <= 0)) {
    return crossJoint(skier, surfaces, direction, leaving, events);
  }
  const vertexIndex = direction > 0 ? skier.segment : skier.segment - 1;
  const { angle, first, second } = turnAngle(surface, vertexIndex);
  const entering = direction > 0 ? second : first;
  const meanLength = (first.length + second.length) / 2;
  if (!negotiateTurn(skier, angle * skier.side, meanLength, entering.tx * skier.side, leaving, events)) return false;
  skier.segment += direction;
  skier.along = direction > 0 ? 0 : segmentGeometry(surface, skier.segment).length;
  return true;
}

function stepGround(skier, surfaces, controls, dt, events) {
  let segment = segmentGeometry(skier.surface, skier.segment);
  const normalY = segment.tx * skier.side;
  const g = PHYSICS.gravity;
  const normalAccel = g * normalY + skier.curveAccel;
  if (normalAccel < 0) {
    skier.speed = skier.speed || 0;
    launch(skier, segment, events, 'overhang');
    return;
  }
  skier.normalAccel = normalAccel;

  if (controls.jump && !skier.crashed) {
    skier.speed = skier.speed || 0;
    launch(skier, segment, events, 'jump');
    skier.vx += -segment.ty * skier.side * PHYSICS.jumpImpulse;
    skier.vy += segment.tx * skier.side * PHYSICS.jumpImpulse;
    return;
  }

  const gravityAlong = -g * segment.ty;
  let speed = skier.speed + gravityAlong * dt;
  const resistance = (frictionCoefficient(skier, controls) * normalAccel + dragCoefficient(controls) * speed * speed) * dt;
  // Friction and drag oppose motion but never reverse it on their own.
  speed = Math.abs(speed) <= resistance ? 0 : speed - Math.sign(speed) * resistance;
  skier.speed = speed;

  let remaining = speed * dt;
  let guard = 0;
  while (remaining !== 0 && guard < 64) {
    guard += 1;
    segment = segmentGeometry(skier.surface, skier.segment);
    if (remaining > 0) {
      const room = segment.length - skier.along;
      if (remaining <= room) { skier.along += remaining; remaining = 0; break; }
      remaining -= room;
      skier.along = segment.length;
      syncGroundState(skier);
      if (!crossVertex(skier, surfaces, 1, events)) return;
    } else {
      const room = skier.along;
      if (-remaining <= room) { skier.along += remaining; remaining = 0; break; }
      remaining += room;
      skier.along = 0;
      syncGroundState(skier);
      if (!crossVertex(skier, surfaces, -1, events)) return;
    }
    // Speed can change at a kink; keep the leftover distance consistent.
    remaining = Math.sign(remaining) * Math.min(Math.abs(remaining), Math.abs(skier.speed) * dt);
  }
  syncGroundState(skier);
  skier.groundedSeconds += dt;
}

/** First crossing of the path p→q with any surface segment, or null. */
export function sweepSurfaces(surfaces, p, q) {
  const minX = Math.min(p.x, q.x) - 1e-6;
  const maxX = Math.max(p.x, q.x) + 1e-6;
  const minY = Math.min(p.y, q.y) - 1e-6;
  const maxY = Math.max(p.y, q.y) + 1e-6;
  const rx = q.x - p.x;
  const ry = q.y - p.y;
  let best = null;
  for (const surface of surfaces) {
    if (surface.maxX < minX || surface.minX > maxX || surface.maxY < minY || surface.minY > maxY) continue;
    const points = surface.points;
    for (let index = 0; index < points.length - 1; index += 1) {
      const a = points[index];
      const b = points[index + 1];
      if (Math.max(a.x, b.x) < minX || Math.min(a.x, b.x) > maxX || Math.max(a.y, b.y) < minY || Math.min(a.y, b.y) > maxY) continue;
      const sx = b.x - a.x;
      const sy = b.y - a.y;
      const denominator = rx * sy - ry * sx;
      if (Math.abs(denominator) < 1e-12) continue;
      const wx = a.x - p.x;
      const wy = a.y - p.y;
      const along = (wx * sy - wy * sx) / denominator;
      const onSegment = (wx * ry - wy * rx) / denominator;
      if (along < 0 || along > 1 || onSegment < -1e-9 || onSegment > 1 + 1e-9) continue;
      if (!best || along < best.along) best = { surface, segment: index, along, fraction: Math.min(1, Math.max(0, onSegment)) };
    }
  }
  return best;
}

function stepAir(skier, surfaces, controls, dt, events) {
  const g = PHYSICS.gravity;
  const drag = dragCoefficient(controls);
  const speed = speedOf(skier);
  skier.vx -= drag * speed * skier.vx * dt;
  skier.vy += (-g - drag * speed * skier.vy) * dt;
  const next = { x: skier.x + skier.vx * dt, y: skier.y + skier.vy * dt };
  const hit = sweepSurfaces(surfaces, skier, next);
  if (!hit) {
    skier.x = next.x;
    skier.y = next.y;
    skier.airSeconds += dt;
    skier.normalAccel = 0;
    alignInAir(skier, dt);
    spinInAir(skier, controls, dt);
    return;
  }
  const segment = segmentGeometry(hit.surface, hit.segment);
  const cross = segment.tx * (skier.y - segment.a.y) - segment.ty * (skier.x - segment.a.x);
  skier.side = cross >= 0 ? 1 : -1;
  const nx = -segment.ty * skier.side;
  const ny = segment.tx * skier.side;
  const impact = -(skier.vx * nx + skier.vy * ny);
  const airSeconds = skier.airSeconds;
  skier.mode = 'ground';
  skier.surface = hit.surface;
  skier.segment = hit.segment;
  skier.along = hit.fraction * segment.length;
  skier.speed = skier.vx * segment.tx + skier.vy * segment.ty;
  skier.curveAccel = 0;
  syncGroundState(skier);
  judgeLanding(skier, airSeconds, events);
  judgeImpact(skier, Math.max(0, impact), events, 'landing');
  events.push({ type: 'touchdown', impact: Math.max(0, impact), airSeconds, x: skier.x, y: skier.y });
  skier.airSeconds = 0;
}

const wrapAngle = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));

/**
 * Judge a touchdown by heading: the body's turn about the vertical axis
 * against the direction of travel. Forward is forgiving, backwards (switch)
 * is narrow, sideways is a crash. Whole half turns count as rotation.
 */
function judgeLanding(skier, airSeconds, events) {
  const spin = skier.spin;
  skier.spin = 0;
  skier.spinRate = 0;
  if (skier.crashed) return;
  const heading = wrapAngle((skier.switchStance ? Math.PI : 0) + spin);
  const offForward = Math.abs(heading);
  const offBackward = Math.PI - offForward;
  let clean;
  if (offForward <= PHYSICS.forwardSafeAngle) {
    skier.switchStance = false;
    clean = offForward <= PHYSICS.forwardCleanAngle;
  } else if (offBackward <= PHYSICS.switchSafeAngle) {
    if (airSeconds > PHYSICS.switchMaxAirSeconds) {
      skier.crashed = true;
      events.push({ type: 'crash', impact: 0, kind: 'switch-big-air', x: skier.x, y: skier.y });
      return;
    }
    const wasSwitch = skier.switchStance;
    skier.switchStance = true;
    clean = offBackward <= PHYSICS.switchCleanAngle;
    if (!wasSwitch) events.push({ type: 'switch', x: skier.x, y: skier.y });
  } else {
    skier.crashed = true;
    events.push({ type: 'crash', impact: 0, kind: 'sideways', x: skier.x, y: skier.y });
    return;
  }
  if (!clean) events.push({ type: 'hard', impact: PHYSICS.softLandingSpeed + 2, kind: 'sketchy', x: skier.x, y: skier.y });
  const halfTurns = Math.round(Math.abs(spin) / Math.PI);
  if (halfTurns >= 1) events.push({ type: 'trick', degrees: halfTurns * 180, clean, x: skier.x, y: skier.y });
}

function spinInAir(skier, controls, dt) {
  if (skier.crashed) return;
  if (controls.trick) skier.spinRate = PHYSICS.spinRateTucked;
  else if (skier.spinRate > PHYSICS.spinRateTucked * PHYSICS.openSpinFactor) skier.spinRate = PHYSICS.spinRateTucked * PHYSICS.openSpinFactor;
  skier.spin += skier.spinRate * dt;
}

function alignInAir(skier, dt) {
  if (Math.abs(skier.vx) > 0.05) skier.facing = skier.vx >= 0 ? 1 : -1;
  const target = Math.atan2(skier.vy, skier.vx * skier.facing);
  const difference = Math.atan2(Math.sin(target - skier.pitch), Math.cos(target - skier.pitch));
  const maxTurn = PHYSICS.airAlignRate * dt;
  skier.pitch += Math.max(-maxTurn, Math.min(maxTurn, difference));
}

/**
 * Advance the skier by dt seconds. Returns the events that happened:
 * takeoff, touchdown, land, hard, crash.
 */
export function stepSkier(skier, surfaces, controls, dt = PHYSICS.stepSeconds) {
  const events = [];
  if (skier.mode === 'ground') stepGround(skier, surfaces, controls, dt, events);
  else stepAir(skier, surfaces, controls, dt, events);
  return events;
}

/**
 * Put the skier on the highest surface directly below (within maxDrop),
 * moving along it at the given signed speed. Returns false if none is there.
 */
export function placeOnSurface(skier, surfaces, speed = 0, maxDrop = 0.6) {
  let best = null;
  for (const surface of surfaces) {
    if (skier.x < surface.minX || skier.x > surface.maxX) continue;
    const points = surface.points;
    for (let index = 0; index < points.length - 1; index += 1) {
      const a = points[index];
      const b = points[index + 1];
      if (a.x === b.x || skier.x < Math.min(a.x, b.x) || skier.x > Math.max(a.x, b.x)) continue;
      const fraction = (skier.x - a.x) / (b.x - a.x);
      const groundY = a.y + (b.y - a.y) * fraction;
      if (groundY > skier.y + 0.5 || skier.y - groundY > maxDrop) continue;
      if (!best || groundY > best.groundY) best = { surface, index, fraction, groundY };
    }
  }
  if (!best) return false;
  const segment = segmentGeometry(best.surface, best.index);
  skier.mode = 'ground';
  skier.surface = best.surface;
  skier.segment = best.index;
  skier.along = best.fraction * segment.length;
  skier.side = segment.tx >= 0 ? 1 : -1;
  skier.speed = speed * Math.sign(segment.tx || 1);
  skier.curveAccel = 0;
  syncGroundState(skier);
  return true;
}
