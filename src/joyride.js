// Joyride: a new slope every time, built from features that are themselves
// equations, so the player can open the panel and read the maths of what
// they just rode. Every slope is ridden hands-off before it is offered and
// rejected unless that ride finishes without a hard landing.
import { PHYSICS } from './config.js';
import { createEquationPiece, buildSurfaces } from './track.js';
import { compileEquation } from './expression.js';
import { createRun, stepRun, simulateRun } from './run.js';
import { createSkier, placeOnSurface, stepSkier } from './physics.js';

export const JOYRIDE_ID = 'joyride';
// Bump when the generator changes: the same seed then makes a different
// slope, and ghosts recorded on the old one must not race on the new.
export const JOYRIDE_VERSION = 3;
const MAX_ATTEMPTS = 24;

/** Deterministic random numbers from a seed (mulberry32). */
export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const fixed = (value) => Number(value.toFixed(3));
// Curvatures are small numbers; four decimals keep them accurate over 30 m.
const precise = (value) => Number(value.toFixed(4));
const signed = (value) => (value < 0 ? `- ${precise(-value)}` : `+ ${precise(value)}`);

// Convex features (drop lips, roller crests) must not throw a skier going
// at the estimated speed off the snow onto their own steep face: keep
// v²κ under this share of g.
const CREST_SHARE_OF_G = 0.7;
// Energy left after friction and drag, as a share of the height lost.
const ENERGY_KEPT = 0.7;
// How far the landing hill starts below the lip. Deeper means a longer
// flight before the hill rises to meet it, still touching down nearly
// parallel because the hill is only slightly shallower than the flight.
const LANDING_DROP = 0.8;
const shifted = (x0) => (fixed(x0) === 0 ? 'x' : x0 < 0 ? `(x+${fixed(-x0)})` : `(x-${fixed(x0)})`);

/**
 * A slope under construction: pieces so far and where the snow ends
 * (x, y) with the downhill gradient `slope` (positive means descending).
 */
function builder(random) {
  return { random, pieces: [], x: 0, y: 0, slope: 0, topY: 0 };
}

// The next feature starts exactly where this equation, as written and
// rounded, ends: rounding coefficients can otherwise open a gap at the join.
function push(course, equation, fromX, toX) {
  const from = fixed(fromX);
  const to = fixed(toX);
  course.pieces.push({ equation, fromX: from, toX: to });
  const fn = compileEquation(equation);
  course.x = to;
  course.y = fn(to);
  course.slope = -(fn(to) - fn(to - 0.001)) / 0.001;
}

// "- 0.4(x-3)", or nothing at all when the gradient rounds to zero.
function slopeTerm(slope, x) {
  return fixed(slope) === 0 ? '' : ` - ${fixed(slope)}${shifted(x)}`;
}

/** Estimated speed squared at the current point, from the height lost. */
function speedSquared(course) {
  return Math.max(9, 2 * PHYSICS.gravity * ENERGY_KEPT * (course.topY - course.y));
}

// Straight run at the current gradient.
function cruise(course, length) {
  const { x, y, slope } = course;
  push(course, `y = ${fixed(y)}${slopeTerm(slope, x)}`, x, x + length);
}

// Change gradient smoothly: a parabola whose slope moves from the current
// value to the new one over the length, with no kink at either end.
function bend(course, newSlope, length) {
  const { x, y, slope } = course;
  const curvature = (slope - newSlope) / (2 * length);
  push(course, `y = ${fixed(y)}${slopeTerm(slope, x)} ${signed(curvature)}${shifted(x)}^2`, x, x + length);
}

// A rounded roller: the cosine hump adds nothing to the slope at its ends,
// so it joins the snow either side without a kink.
// The crest curvature is (h/2)k², capped so the crest stays rideable.
function roller(course, length, height) {
  const { x, y, slope } = course;
  const k = (2 * Math.PI) / length;
  const safeHeight = Math.min(height, (2 * CREST_SHARE_OF_G * PHYSICS.gravity) / (speedSquared(course) * k * k));
  push(course, `y = ${fixed(y)}${slopeTerm(slope, x)} + ${precise(safeHeight / 2)}(1 - cos(${precise(k)}${shifted(x)}))`, x, x + length);
}

// A step down: the same trick with half a cosine, so the drop is smooth.
// The lip of a drop curves away at (d/2)k²; capped the same way.
function drop(course, length, depth) {
  const { x, y, slope } = course;
  const k = Math.PI / length;
  const safeDepth = Math.min(depth, (2 * CREST_SHARE_OF_G * PHYSICS.gravity) / (speedSquared(course) * k * k));
  push(course, `y = ${fixed(y)}${slopeTerm(slope, x)} - ${precise(safeDepth / 2)}(1 - cos(${precise(k)}${shifted(x)}))`, x, x + length);
}

// Moguls reward speed control: crests are sized so a rider who has slowed
// to this speed holds the snow over them (v²κ just under g·cosθ). Faster
// riders are thrown off the crests, and where they land decides whether
// they ride on or hit the face of the next bump.
const MOGUL_CONTROLLED_SPEED = 10;
const MOGUL_CREST_SHARE_OF_G = 0.95;
// A mogul field is test-ridden hands-off as it is built; each try that
// lands hard shrinks the bumps by this share, up to MOGUL_TRIES times.
const MOGUL_SHRINK = 0.75;
const MOGUL_TRIES = 6;

/**
 * Ride what is built so far hands-off from the start to `endX`. Returns
 * true if the skier gets there without a hard landing or a crash.
 */
function ridesCleanTo(course, start, endX) {
  const pieces = course.pieces.map((spec) => createEquationPiece(spec.equation, spec.fromX, spec.toX, { locked: true }));
  const run = createRun({ start, finish: null }, pieces, buildSurfaces(pieces));
  // Clean means back on the snow past the end, not still flying over it.
  const arrived = () => run.skier.x >= endX && run.skier.mode === 'ground';
  while (run.status === 'running' && run.time < 120 && !arrived()) {
    for (const event of stepRun(run, {})) {
      if (event.type === 'hard' || event.type === 'crash') return false;
    }
  }
  return run.status === 'running' && arrived();
}

/** Hands-off speed on arriving at `x`, riding what is built so far. */
function speedArriving(course, start, x) {
  const pieces = course.pieces.map((spec) => createEquationPiece(spec.equation, spec.fromX, spec.toX, { locked: true }));
  const run = createRun({ start, finish: null }, pieces, buildSurfaces(pieces));
  while (run.status === 'running' && run.time < 90 && run.skier.x < x - 0.5) stepRun(run, {});
  return run.status === 'running' ? Math.hypot(run.skier.vx, run.skier.vy) : null;
}

/**
 * Ride just these pieces hands-off from their start at `speed` to `endX`.
 * Returns true if the skier gets there without a hard landing or a crash.
 */
function ridesCleanFrom(specs, speed, endX) {
  const pieces = specs.map((spec) => createEquationPiece(spec.equation, spec.fromX, spec.toX, { locked: true }));
  const surfaces = buildSurfaces(pieces);
  const first = compileEquation(specs[0].equation);
  const skier = createSkier({ x: specs[0].fromX + 0.05, y: first(specs[0].fromX + 0.05) + 0.02 });
  if (!placeOnSurface(skier, surfaces, speed, 1)) return false;
  const arrived = () => skier.x >= endX && skier.mode === 'ground';
  for (let step = 0; step < 90 / PHYSICS.stepSeconds && !arrived(); step += 1) {
    for (const event of stepSkier(skier, surfaces, {})) {
      if (event.type === 'hard' || event.type === 'crash') return false;
    }
    if (skier.mode === 'air' && skier.x > specs[specs.length - 1].toX) return false;
  }
  return arrived();
}

// Moguls: a train of 1 − cos bumps, closer set and taller than rollers.
// A hands-off rider hops them and is made to land clean (each try is
// test-ridden, with a short run-out after the field so the ride can land);
// arrive faster or at another speed and a hop can end on the face of the
// next bump, hard enough to crash. Braking down to a controlled speed
// first rides them on the snow.
function moguls(course, start, count, wavelength, height) {
  const { x, y, slope } = course;
  const speed = speedArriving(course, start, x);
  if (speed === null) return false;
  const k = (2 * Math.PI) / wavelength;
  const endX = x + count * wavelength;
  const cosine = 1 / Math.hypot(1, slope);
  const onTheEdge = (2 * MOGUL_CREST_SHARE_OF_G * PHYSICS.gravity * cosine) / (MOGUL_CONTROLLED_SPEED ** 2 * k * k);
  let bumpHeight = Math.min(height, onTheEdge);
  for (let attempt = 0; attempt < MOGUL_TRIES; attempt += 1) {
    const equation = `y = ${fixed(y)}${slopeTerm(slope, x)} + ${precise(bumpHeight / 2)}(1 - cos(${precise(k)}${shifted(x)}))`;
    const runOutY = compileEquation(equation)(endX);
    const runOut = { equation: `y = ${fixed(runOutY)}${slopeTerm(slope, endX)}`, fromX: fixed(endX), toX: fixed(endX + 14) };
    // Quick check from the arrival speed first; then the real ride from the
    // top, which also catches arriving in the air or at another speed.
    if (ridesCleanFrom([{ equation, fromX: fixed(x), toX: fixed(endX) }, runOut], speed, endX + 10)) {
      push(course, equation, x, endX);
      cruise(course, 14);
      const clean = ridesCleanTo(course, start, endX + 10);
      course.pieces.splice(-2, 2);
      Object.assign(course, { x, y, slope });
      if (clean) {
        push(course, equation, x, endX);
        return true;
      }
    }
    bumpHeight *= MOGUL_SHRINK;
  }
  roller(course, count * wavelength, height);
  return true;
}

/** Ride what is built so far until the skier leaves the lip. */
function takeoffFrom(course, start, lipX) {
  const pieces = course.pieces.map((spec) => createEquationPiece(spec.equation, spec.fromX, spec.toX, { locked: true }));
  const run = createRun({ start, finish: null }, pieces, buildSurfaces(pieces));
  while (run.status === 'running' && run.time < 150) {
    for (const event of stepRun(run, {})) {
      if (event.type === 'takeoff' && Math.abs(event.x - lipX) < 0.5) return { vx: run.skier.vx, vy: run.skier.vy };
    }
  }
  return null;
}

// A kicker: the slope curves up into a lip, and the landing hill below
// follows the flight parabola measured from a real hands-off takeoff,
// a little under it and a little shallower, so the skier touches down
// almost parallel. It ends by bending back to the cruising gradient.
function kicker(course, start, lipLength, lipSlope, landingSeconds) {
  bend(course, -lipSlope, lipLength);
  const lipX = course.x;
  const lipY = course.y;
  const takeoff = takeoffFrom(course, start, lipX);
  if (!takeoff || takeoff.vx < 6) return false;
  const gradient = takeoff.vy / takeoff.vx;
  // Drag bends the real flight a little more than g/2vx²; stay under it.
  const curvature = (PHYSICS.gravity / (2 * takeoff.vx * takeoff.vx)) * 0.9;
  const landingStart = lipX + 0.6;
  const landingEnd = lipX + takeoff.vx * landingSeconds;
  const equation = `y = ${fixed(lipY - LANDING_DROP)} ${signed(gradient)}${shifted(lipX)} - ${precise(curvature)}${shifted(lipX)}^2`;
  push(course, equation, landingStart, landingEnd);
  return true;
}

/** Build one candidate slope from a seed. Returns a course or null. */
function buildCandidate(seed) {
  const random = seededRandom(seed);
  const pick = (low, high) => low + (high - low) * random();
  const course = builder(random);
  course.x = -12;
  // A long run needs the height to lose: start high enough to stay above
  // the finish however many features follow.
  course.y = 140 + Math.round(pick(0, 50));
  course.topY = course.y;
  course.slope = 0.25;
  const start = { x: -10, y: course.y - 0.25 * 2 + 0.3 };
  cruise(course, 12);
  bend(course, pick(0.35, 0.55), pick(14, 22));

  // At least two kickers: at speed the crest limit keeps rollers and drops
  // gentle, so the jumps are what makes each slope feel different.
  // Long runs: twelve to fifteen features between the opening and closing kickers.
  const middle = Array.from({ length: 12 + Math.floor(random() * 4) }, () => ['roller', 'drop', 'kicker', 'cruise', 'moguls'][Math.floor(random() * 5)]);
  // Every slope has at least one mogul field, somewhere in the middle.
  middle.splice(Math.floor(random() * middle.length), 0, 'moguls');
  const features = ['kicker', ...middle, 'kicker'];
  if (random() < 0.5) features.unshift(random() < 0.5 ? 'roller' : 'drop');
  for (const feature of features) {
    if (feature === 'roller') roller(course, pick(20, 32), pick(0.8, 2.2));
    if (feature === 'drop') drop(course, pick(18, 30), pick(3, 7));
    if (feature === 'cruise') cruise(course, pick(14, 26));
    if (feature === 'moguls' && !moguls(course, start, 3 + Math.floor(random() * 3), pick(12, 20), pick(1.4, 2.6))) return null;
    if (feature === 'kicker') {
      if (!kicker(course, start, pick(8, 12), pick(0.1, 0.35), pick(1.6, 2.2))) return null;
      bend(course, pick(0.3, 0.45), pick(22, 32));
    }
  }
  bend(course, 0.05, pick(22, 30));
  const finishX = course.x + 14;
  cruise(course, 34);
  const finishY = course.y + 0.05 * 20;
  return {
    id: JOYRIDE_ID,
    name: 'Joyride',
    difficulty: 'joyride',
    seed,
    brief: 'A fresh slope every time. Just ride: tuck for speed, press Spin to pop and turn, and let go in time to land facing forward.',
    lesson: 'Every slope here is made of equations: rollers and moguls are 1 − cos humps, drops are half cosines, and each landing hill is the flight parabola y ≈ y₀ + (vy/vx)d − (g/2vx²)d², measured from a real takeoff.',
    start,
    pieces: course.pieces,
    finish: { x: finishX, yMin: finishY - 3, yMax: finishY + 5 },
    ink: 0,
    stars: [{ type: 'finish' }, { type: 'minRotation', value: 360 }, { type: 'maxOuch', value: 0 }],
  };
}

/** Accept a slope only if a hands-off ride finishes it cleanly. */
export function validateJoyride(course) {
  const pieces = course.pieces.map((spec) => createEquationPiece(spec.equation, spec.fromX, spec.toX, { locked: true }));
  const { run } = simulateRun(course, pieces, buildSurfaces(pieces), {}, 170);
  // A second of air is enough for a 360: ~0.7 s wrapped up plus the open turn.
  return run.status === 'finished' && run.ouch === 0 && run.stats.longestAir >= 1 ? run : null;
}

/** A rideable random slope for this seed (the same seed gives the same slope). */
export function generateJoyride(seed) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const candidate = buildCandidate((seed + attempt * 7919) >>> 0);
    if (candidate && validateJoyride(candidate)) return { ...candidate, seed };
  }
  return null;
}

export const joyrideBuilders = { builder, cruise, bend, roller, drop, kicker, moguls };

export function randomSeed() {
  return Math.floor(Math.random() * 1e9);
}
