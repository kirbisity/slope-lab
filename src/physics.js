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
    spinning: false,
    flip: 0,
    flipRate: 0,
    flipping: false,
    switchStance: false,
    flightLeft: Infinity,
    lookAheadClock: 0,
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
  skier.lookAheadClock = 0;
  skier.flightLeft = Infinity;
  skier.spinning = false;
  skier.flipping = false;
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
    rotateInAir(skier, surfaces, controls, dt);
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
/**
 * How a touchdown at this heading (radians, 0 = facing down the hill) and
 * airtime turns out: { stance: 'forward' | 'switch', clean } or
 * { crash: 'sideways' | 'switch-big-air' }.
 */
export function landingOutcome(heading, airSeconds) {
  const offForward = Math.abs(wrapAngle(heading));
  const offBackward = Math.PI - offForward;
  if (offForward <= PHYSICS.forwardSafeAngle) return { stance: 'forward', clean: offForward <= PHYSICS.forwardCleanAngle };
  if (offBackward <= PHYSICS.switchSafeAngle) {
    if (airSeconds > PHYSICS.switchMaxAirSeconds) return { crash: 'switch-big-air' };
    return { stance: 'switch', clean: offBackward <= PHYSICS.switchCleanAngle };
  }
  return { crash: 'sideways' };
}

/**
 * How a touchdown this far round a backflip (radians, 0 = upright) turns
 * out: { clean } or { crash: 'flip' }.
 */
export function flipOutcome(angle) {
  const off = Math.abs(wrapAngle(angle));
  if (off > PHYSICS.flipSafeAngle) return { crash: 'flip' };
  return { clean: off <= PHYSICS.flipCleanAngle };
}

function judgeLanding(skier, airSeconds, events) {
  const spin = skier.spin;
  const flip = skier.flip;
  skier.spin = 0;
  skier.spinRate = 0;
  skier.spinning = false;
  skier.flip = 0;
  skier.flipRate = 0;
  skier.flipping = false;
  if (skier.crashed) return;
  const flipped = flipOutcome(flip);
  if (flipped.crash) {
    skier.crashed = true;
    events.push({ type: 'crash', impact: 0, kind: 'flip', x: skier.x, y: skier.y });
    return;
  }
  const outcome = landingOutcome((skier.switchStance ? Math.PI : 0) + spin, airSeconds);
  if (outcome.crash) {
    skier.crashed = true;
    events.push({ type: 'crash', impact: 0, kind: outcome.crash, x: skier.x, y: skier.y });
    return;
  }
  const wasSwitch = skier.switchStance;
  skier.switchStance = outcome.stance === 'switch';
  if (skier.switchStance && !wasSwitch) events.push({ type: 'switch', x: skier.x, y: skier.y });
  const clean = outcome.clean && flipped.clean;
  if (!clean) events.push({ type: 'hard', impact: PHYSICS.softLandingSpeed + 2, kind: 'sketchy', x: skier.x, y: skier.y });
  const halfTurns = Math.round(Math.abs(spin) / Math.PI);
  const flips = Math.round(Math.abs(flip) / (2 * Math.PI));
  if (halfTurns >= 1 || flips >= 1) events.push({ type: 'trick', degrees: halfTurns * 180, flips, clean, x: skier.x, y: skier.y });
}

/**
 * Seconds of flight left: the same gravity and drag as the flight itself,
 * stepped ahead until the path meets the snow. Infinity past maxSeconds.
 */
export function flightSecondsLeft(skier, surfaces, controls = {}, maxSeconds = 3) {
  const step = 1 / 60;
  const drag = dragCoefficient(controls);
  let x = skier.x; let y = skier.y; let vx = skier.vx; let vy = skier.vy;
  for (let time = 0; time < maxSeconds; time += step) {
    const speed = Math.hypot(vx, vy);
    vx -= drag * speed * vx * step;
    vy += (-PHYSICS.gravity - drag * speed * vy) * step;
    const next = { x: x + vx * step, y: y + vy * step };
    const hit = sweepSurfaces(surfaces, { x, y }, next);
    if (hit) return time + step * hit.along;
    x = next.x; y = next.y;
  }
  return Infinity;
}

// The heading the rider spots: straight down the hill, or straight back if
// the whole flight is short enough to land switch. Nearest wins, whichever
// way round, so an early let-go unwinds instead of forcing a full turn.
function spottedHeading(heading, totalAir) {
  const forward = Math.round(heading / (2 * Math.PI)) * 2 * Math.PI;
  if (totalAir > PHYSICS.switchMaxAirSeconds) return forward;
  const backward = (Math.round((heading - Math.PI) / (2 * Math.PI)) * 2 + 1) * Math.PI;
  return Math.abs(backward - heading) < Math.abs(forward - heading) ? backward : forward;
}

// A rotation the rider has set going: a spin about the vertical, or a flip
// about the belly. One press starts it and the body's own momentum keeps it
// turning (no holding needed) at the tucked rate while the next landing
// angle can still be reached before touchdown; then the rider opens up and
// lines up with the nearest landing angle at the open rate, and holds it.
function rotate(skier, axis, pressed, dt) {
  if (pressed) skier[axis.active] = true;
  const openRate = axis.tuckedRate * PHYSICS.openSpinFactor;
  const angle = axis.base + skier[axis.angle];
  const target = axis.target(angle);
  const remaining = target - angle;
  if (skier[axis.active]) {
    const step = axis.step;
    const next = Math.floor(angle / step + 1e-9) * step + step;
    if ((next - angle) / axis.tuckedRate + PHYSICS.landingSpareSeconds <= skier.flightLeft) {
      skier[axis.rate] = axis.tuckedRate;
      skier[axis.angle] += axis.tuckedRate * dt;
      return;
    }
    skier[axis.active] = false;
    skier[axis.rate] = openRate;
  }
  if (skier[axis.rate] === 0) return;
  const turn = Math.sign(remaining) * Math.min(Math.abs(remaining), openRate * dt);
  skier[axis.angle] += turn;
  skier[axis.rate] = Math.abs(remaining) <= openRate * dt ? 0 : openRate;
}

function rotateInAir(skier, surfaces, controls, dt) {
  if (skier.crashed) return;
  skier.lookAheadClock -= dt;
  if (skier.lookAheadClock <= 0) {
    skier.lookAheadClock = PHYSICS.landingLookAheadSeconds;
    skier.flightLeft = flightSecondsLeft(skier, surfaces, controls);
  } else {
    skier.flightLeft -= dt;
  }
  const totalAir = skier.airSeconds + skier.flightLeft;
  const shortFlight = totalAir <= PHYSICS.switchMaxAirSeconds;
  rotate(skier, {
    angle: 'spin', rate: 'spinRate', active: 'spinning',
    base: skier.switchStance ? Math.PI : 0,
    tuckedRate: PHYSICS.spinRateTucked,
    // Straight back is a landing heading only on a flight short enough to land switch.
    step: shortFlight ? Math.PI : 2 * Math.PI,
    target: (heading) => spottedHeading(heading, totalAir),
  }, controls.trick, dt);
  rotate(skier, {
    angle: 'flip', rate: 'flipRate', active: 'flipping',
    base: 0,
    tuckedRate: PHYSICS.flipRateTucked,
    step: 2 * Math.PI,
    target: (pitch) => Math.round(pitch / (2 * Math.PI)) * 2 * Math.PI,
  }, controls.flip, dt);
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
