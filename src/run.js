// One attempt at a course: the skier, the clock, scoring, goals and how the
// attempt ends. Pure logic, so a whole run can be simulated headlessly.
import { PHYSICS, SCORING, VIEW } from './config.js';
import { createSkier, placeOnSurface, stepSkier, speedOf } from './physics.js';
import { courseBounds } from './track.js';

// Tight enough that a wrong amplitude or phase misses a snowflake.
export const TOKEN_RADIUS = 1.0;

export function createRun(course, pieces, surfaces) {
  const skier = createSkier(course.start);
  // A flag planted on the snow starts the skier gliding; one in the air drops it.
  placeOnSurface(skier, surfaces, PHYSICS.startSpeed, 0.8);
  const bounds = courseBounds(pieces);
  return {
    skier,
    surfaces,
    course,
    time: 0,
    status: 'running',
    joy: 0,
    ouch: 0,
    collected: new Set(),
    restSeconds: 0,
    crashSeconds: 0,
    lowestY: Math.min(bounds.minY, course.start.y) - PHYSICS.lostDepthBelowCourse,
    stats: { maxSpeed: 0, airSeconds: 0, longestAir: 0, maxG: 1, jumps: 0, hardLandings: 0, distance: 0, spins: 0, maxRotation: 0, flips: 0 },
    trace: [{ x: skier.x, y: skier.y }],
    traceClock: 0,
    grooves: [],
  };
}

export function scoreOf(run) {
  return Math.round((SCORING.scoreFactor * Math.floor(run.joy)) / (run.ouch + 1));
}

function recordEvent(run, event) {
  const stats = run.stats;
  if (event.type === 'takeoff') stats.jumps += event.reason === 'overhang' ? 0 : 1;
  if (event.type === 'touchdown') stats.longestAir = Math.max(stats.longestAir, event.airSeconds);
  if (event.type === 'hard') {
    stats.hardLandings += 1;
    run.ouch += 1 + Math.round(SCORING.ouchPerImpactSpeed * (event.impact - PHYSICS.softLandingSpeed));
  }
  if (event.type === 'crash') run.ouch += SCORING.crashOuch;
  if (event.type === 'trick') {
    if (event.degrees > 0) stats.spins += 1;
    stats.maxRotation = Math.max(stats.maxRotation, event.degrees);
    stats.flips += event.flips;
    run.joy += SCORING.joyPerHalfTurn * (event.degrees / 180) + SCORING.joyPerFlip * event.flips;
  }
}

function checkGoals(run, previous, events) {
  const { skier, course } = run;
  for (let index = 0; index < (course.tokens || []).length; index += 1) {
    if (run.collected.has(index)) continue;
    const token = course.tokens[index];
    if (Math.hypot(token.x - skier.x, token.y - (skier.y + 0.9)) < TOKEN_RADIUS) {
      run.collected.add(index);
      events.push({ type: 'token', index, x: token.x, y: token.y });
    }
  }
  const finish = course.finish;
  if (finish && !skier.crashed && previous.x < finish.x && skier.x >= finish.x) {
    const t = (finish.x - previous.x) / (skier.x - previous.x || 1);
    const crossingY = previous.y + (skier.y - previous.y) * t;
    if (crossingY >= finish.yMin && crossingY <= finish.yMax) {
      run.status = 'finished';
      events.push({ type: 'finish', x: finish.x, y: crossingY });
    }
  }
}

function checkEnding(run, dt, events) {
  const { skier } = run;
  const speed = speedOf(skier);
  if (skier.crashed) {
    run.crashSeconds += dt;
    if (run.crashSeconds > PHYSICS.crashSettleSeconds || (skier.mode === 'ground' && speed < PHYSICS.restSpeed && run.crashSeconds > 1)) {
      run.status = 'crashed';
    }
  } else if (skier.mode === 'ground' && speed < PHYSICS.restSpeed) {
    run.restSeconds += dt;
    if (run.restSeconds > PHYSICS.restSeconds) run.status = 'stopped';
  } else {
    run.restSeconds = 0;
  }
  if (skier.y < run.lowestY) run.status = 'lost';
  if (run.time > PHYSICS.maxRunSeconds) run.status = 'timeout';
  if (run.status !== 'running') events.push({ type: 'end', status: run.status });
}

/** Advance one physics step. Returns the events of that step. */
export function stepRun(run, controls, dt = PHYSICS.stepSeconds) {
  if (run.status !== 'running') return [];
  const { skier } = run;
  const previous = { x: skier.x, y: skier.y };
  const events = stepSkier(skier, run.surfaces, controls, dt);
  run.time += dt;
  for (const event of events) recordEvent(run, event);

  const speed = speedOf(skier);
  const airborne = skier.mode === 'air';
  if (!skier.crashed) {
    const joyRate = Math.max(0, speed - SCORING.joySpeedFloor) * (airborne ? SCORING.airJoyMultiplier : 1);
    run.joy += joyRate * dt;
  }
  const stats = run.stats;
  stats.maxSpeed = Math.max(stats.maxSpeed, speed);
  if (airborne) stats.airSeconds += dt;
  if (!airborne) stats.maxG = Math.max(stats.maxG, skier.normalAccel / PHYSICS.gravity);
  stats.distance += Math.hypot(skier.x - previous.x, skier.y - previous.y);

  run.traceClock += dt;
  if (run.traceClock >= 0.05) {
    run.traceClock = 0;
    run.trace.push({ x: skier.x, y: skier.y, air: airborne });
    if (!airborne) {
      run.grooves.push({ x: skier.x, y: skier.y });
      if (run.grooves.length > VIEW.trailMaxPoints) run.grooves.shift();
    } else if (run.grooves.length && run.grooves[run.grooves.length - 1] !== null) {
      run.grooves.push(null);
    }
  }
  checkGoals(run, previous, events);
  if (run.status === 'running') checkEnding(run, dt, events);
  else events.push({ type: 'end', status: run.status });
  return events;
}

/** Simulate a whole run with fixed controls; used by tests and tuning. */
export function simulateRun(course, pieces, surfaces, controls = {}, maxSeconds = PHYSICS.maxRunSeconds) {
  const run = createRun(course, pieces, surfaces);
  const log = [];
  const steps = Math.ceil(maxSeconds / PHYSICS.stepSeconds);
  for (let step = 0; step < steps && run.status === 'running'; step += 1) {
    for (const event of stepRun(run, controls)) log.push(event);
  }
  return { run, log };
}

/** Which star criteria this run met. */
export function evaluateStars(course, run) {
  return (course.stars || []).map((criterion) => ({ ...criterion, met: meetsCriterion(criterion, run) }));
}

function meetsCriterion(criterion, run) {
  const finished = run.status === 'finished';
  switch (criterion.type) {
    case 'finish': return finished;
    case 'maxOuch': return finished && run.ouch <= criterion.value;
    case 'maxTime': return finished && run.time <= criterion.value;
    case 'minAir': return finished && run.stats.longestAir >= criterion.value;
    case 'minSpeed': return finished && run.stats.maxSpeed >= criterion.value;
    case 'allTokens': return finished && run.collected.size === (run.course.tokens || []).length;
    case 'minScore': return finished && scoreOf(run) >= criterion.value;
    case 'minRotation': return finished && run.stats.maxRotation >= criterion.value;
    default: return false;
  }
}

export function describeCriterion(criterion) {
  switch (criterion.type) {
    case 'finish': return 'Reach the finish';
    case 'maxOuch': return criterion.value === 0 ? 'No hard landings' : `Ouch ${criterion.value} or less`;
    case 'maxTime': return `Finish within ${criterion.value} s`;
    case 'minAir': return `A single jump of ${criterion.value} s airtime`;
    case 'minSpeed': return `Top speed ${Math.round(criterion.value * 3.6)} km/h`;
    case 'allTokens': return 'Collect every snowflake';
    case 'minScore': return `Score ${criterion.value}`;
    case 'minRotation': return `Land a ${criterion.value}`;
    default: return '';
  }
}
