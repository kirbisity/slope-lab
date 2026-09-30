// Gear thrown off in a crash. Each piece is a point body with its own
// velocity, spin and bounce, colliding with the same surfaces as the skier.
import { PHYSICS, DEBRIS } from './config.js';
import { sweepSurfaces } from './physics.js';

const GEAR = [
  { kind: 'ski', length: 1.7 },
  { kind: 'ski', length: 1.7 },
  { kind: 'pole', length: 1.2 },
  { kind: 'pole', length: 1.2 },
  { kind: 'helmet', length: 0.3 },
];

function between([low, high], random) {
  return low + (high - low) * random();
}

/** Throw the skier's gear clear, carrying the skier's own velocity. */
export function throwGear(skier, random = Math.random) {
  return GEAR.map((gear, index) => ({
    kind: gear.kind,
    length: gear.length,
    x: skier.x + (random() - 0.5) * 0.4,
    y: skier.y + (gear.kind === 'helmet' ? 1.6 : 0.3 + random() * 0.4),
    vx: skier.vx * (0.5 + random() * 0.5) + (random() - 0.5) * 2 * DEBRIS.launchSideways,
    vy: Math.max(0, skier.vy * 0.3) + between(DEBRIS.launchUp, random) * (gear.kind === 'helmet' ? 1.2 : 1),
    z: (index % 2 ? 1 : -1) * random() * 0.8,
    angle: skier.pitch + random() * Math.PI,
    spin: between(DEBRIS.spin, random) * (random() < 0.5 ? -1 : 1),
    resting: false,
  }));
}

/** Advance one piece by dt; it bounces off any surface it would cross. */
export function stepGear(item, surfaces, dt) {
  if (item.resting) return;
  const speed = Math.hypot(item.vx, item.vy);
  item.vx -= DEBRIS.airDrag * speed * item.vx * dt;
  item.vy += (-PHYSICS.gravity - DEBRIS.airDrag * speed * item.vy) * dt;
  item.angle += item.spin * dt;
  const next = { x: item.x + item.vx * dt, y: item.y + item.vy * dt };
  const hit = sweepSurfaces(surfaces, item, next);
  if (!hit) {
    item.x = next.x;
    item.y = next.y;
    return;
  }
  const a = hit.surface.points[hit.segment];
  const b = hit.surface.points[hit.segment + 1];
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const tx = (b.x - a.x) / length;
  const ty = (b.y - a.y) / length;
  let nx = -ty;
  let ny = tx;
  if (nx * (item.x - a.x) + ny * (item.y - a.y) < 0) { nx = -nx; ny = -ny; }
  const contactX = item.x + (next.x - item.x) * hit.along;
  const contactY = item.y + (next.y - item.y) * hit.along;
  const normalSpeed = item.vx * nx + item.vy * ny;
  const tangentSpeed = (item.vx * tx + item.vy * ty) * (1 - DEBRIS.slideFriction);
  const bounce = normalSpeed < 0 ? -normalSpeed * DEBRIS.restitution : normalSpeed;
  item.vx = tx * tangentSpeed + nx * bounce;
  item.vy = ty * tangentSpeed + ny * bounce;
  item.x = contactX + nx * 0.02;
  item.y = contactY + ny * 0.02;
  item.spin *= DEBRIS.spinKeptOnBounce;
  if (Math.hypot(item.vx, item.vy) < DEBRIS.restSpeed && ny > 0.5) {
    // Settle lying along the snow, the way a dropped ski ends up.
    item.resting = true;
    item.vx = 0;
    item.vy = 0;
    item.spin = 0;
    item.angle = Math.atan2(ty, tx);
  }
}

export function stepAllGear(items, surfaces, dt, lowestY) {
  const substeps = Math.max(1, Math.ceil(dt / (1 / 240)));
  for (const item of items) {
    for (let step = 0; step < substeps; step += 1) stepGear(item, surfaces, dt / substeps);
  }
  return items.filter((item) => item.y > lowestY);
}
