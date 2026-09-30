// Slope Lab: wires the course, the physics run, the renderer and the page.
import { PHYSICS, VIEW, COLORS, SCORING } from './config.js';
import { SANDBOX, CHALLENGES, ALL_COURSES, findCourse, DIFFICULTY_LABELS, SAMPLE_EQUATIONS } from './courses.js';
import { createEquationPiece, createSketchPiece, buildSurfaces, pieceLength, distanceToPiece, courseBounds, sampleFunction } from './track.js';
import { compileEquation } from './expression.js';
import { createRun, stepRun, scoreOf, evaluateStars, describeCriterion } from './run.js';
import { speedOf } from './physics.js';
import { createCamera, project, unproject, zoomAt, frameBounds, clampZoom } from './camera.js';
import { renderScene, predictFlight } from './renderer.js';
import { attachGestures, capture } from './input.js';
import { serialiseCourse, parseCourseFile, loadPreference, savePreference, recordStars } from './storage.js';
import { createRecorder, recordSample, ghostPose, beatsGhost, ghostFromRun, isGhost } from './ghost.js';
import { createAudio, unlock, setMuted, updateAmbience, playLanding, playCrash, playChime } from './audio.js';
import { generateJoyride, randomSeed, JOYRIDE_ID, JOYRIDE_VERSION } from './joyride.js';
import { throwGear, stepAllGear } from './debris.js';

const $ = (id) => document.getElementById(id);
const canvas = $('scene');
const ctx = canvas.getContext('2d');

const SPEED_UNITS = [
  { label: 'km/h', factor: 3.6 },
  { label: 'm/s', factor: 1 },
  { label: 'mph', factor: 2.237 },
];

const NAVIGATION_HINT = window.matchMedia('(pointer: coarse)').matches ? 'drag to move · pinch to zoom' : 'drag to move · scroll to zoom';

const state = {
  course: SANDBOX,
  pieces: [],
  surfaces: [],
  start: { ...SANDBOX.start },
  selectedPieceId: null,
  tool: 'pan',
  mode: 'edit',
  paused: false,
  run: null,
  lastTrace: null,
  keys: { tuck: false, brake: false, trick: false },
  touch: { tuck: false, brake: false, trick: false },
  gear: [],
  slowMotionSeconds: 0,
  jumpBufferSeconds: 0,
  look: { tuck: 0, pitch: 0, tumble: 0, brake: false },
  particles: [],
  camera: createCamera(),
  rideZoom: 24,
  followPausedUntil: 0,
  units: loadPreference('units', 0) % SPEED_UNITS.length,
  preview: null,
  sketch: null,
  eraser: null,
  cursor: null,
  time: 0,
  accumulator: 0,
  gForce: 1,
  resultTimer: 0,
  recorder: null,
  ghost: null,
  shake: 0,
  audio: createAudio(),
  lastResultNote: '',
};
state.audio.muted = Boolean(loadPreference('muted', false));

// A crash plays out in slow motion for a moment: this much real time, at
// this share of normal speed.
const CRASH_SLOW_MOTION_SECONDS = 0.9;
const CRASH_SLOW_MOTION_RATE = 0.3;

// Camera shake per m/s of landing impact above the soft limit, in metres.
const SHAKE_PER_IMPACT = 0.05;
const SHAKE_DECAY_PER_SECOND = 7;

// ------------------------------------------------------------- the course

function playerPieces() {
  return state.pieces.filter((piece) => !piece.locked);
}

function inkUsed() {
  return playerPieces().reduce((sum, piece) => sum + pieceLength(piece), 0);
}

function lockedPiecesFor(course) {
  return course.pieces.map((spec) => createEquationPiece(spec.equation, spec.fromX, spec.toX, { locked: course.id !== 'sandbox' }));
}

/** The current Joyride slope: kept across reloads until a new one is asked for. */
function joyrideCourse(newSlope) {
  let seed = newSlope ? null : loadPreference('joyride.seed', null);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (!Number.isFinite(seed)) seed = randomSeed();
    const course = generateJoyride(seed);
    if (course) {
      savePreference('joyride.seed', seed);
      return course;
    }
    seed = null;
  }
  return findCourse('sandbox');
}

function isJoyride() {
  return state.course.id === JOYRIDE_ID;
}

function newJoyride() {
  loadCourse(JOYRIDE_ID, { newSlope: true });
  toast('A new slope', 'good');
}

function loadCourse(id, options = {}) {
  const course = id === JOYRIDE_ID ? joyrideCourse(options.newSlope) : findCourse(id);
  state.course = course;
  state.selectedPieceId = null;
  state.lastTrace = null;
  let pieces = lockedPiecesFor(course);
  let start = { ...course.start };
  const draft = options.file || (course.id === JOYRIDE_ID ? null : loadDraft(course.id));
  if (draft) {
    if (course.id === 'sandbox') pieces = [];
    pieces = pieces.concat(draft.pieces);
    if (course.editableStart && draft.start) start = draft.start;
  }
  state.pieces = pieces;
  state.start = start;
  savePreference('course', course.id);
  piecesChanged({ keepDraft: !options.file });
  backToEdit();
  renderCourseChrome();
  clearForm();
  fitView();
}

function loadDraft(courseId) {
  const text = loadPreference(`draft.${courseId}`, null);
  if (!text) return null;
  try {
    return parseCourseFile(text);
  } catch {
    return null;
  }
}

function saveDraft() {
  const course = state.course;
  if (course.id === JOYRIDE_ID) return;
  // The sandbox stores every piece; challenges only what the player added.
  const pieces = course.id === 'sandbox' ? state.pieces.map((piece) => ({ ...piece, locked: false })) : state.pieces;
  savePreference(`draft.${course.id}`, serialiseCourse(course.id, state.start, pieces));
}

function piecesChanged(options = {}) {
  state.surfaces = buildSurfaces(state.pieces);
  if (!options.keepDraft) saveDraft();
  renderPieceList();
  renderInk();
}

function addPiece(piece) {
  if (!piece) return false;
  if (state.course.ink === 0) {
    toast('Joyride slopes are generated. Build your own in the challenges.', 'warn');
    return false;
  }
  if (state.course.ink != null && inkUsed() + pieceLength(piece) > state.course.ink + 0.01) {
    toast(`Not enough ink: ${Math.round(pieceLength(piece))} m needed, ${Math.max(0, Math.round(state.course.ink - inkUsed()))} m left`, 'warn');
    return false;
  }
  state.pieces.push(piece);
  state.selectedPieceId = piece.id;
  piecesChanged();
  return true;
}

function replacePiece(id, piece) {
  const index = state.pieces.findIndex((candidate) => candidate.id === id);
  if (index < 0) return false;
  const others = inkUsed() - pieceLength(state.pieces[index]);
  if (state.course.ink != null && others + pieceLength(piece) > state.course.ink + 0.01) {
    toast('Not enough ink for that change', 'warn');
    return false;
  }
  state.pieces[index] = piece;
  piecesChanged();
  return true;
}

function removePiece(id) {
  const piece = state.pieces.find((candidate) => candidate.id === id);
  if (!piece || piece.locked) return;
  state.pieces = state.pieces.filter((candidate) => candidate.id !== id);
  if (state.selectedPieceId === id) {
    state.selectedPieceId = null;
    clearForm();
  }
  piecesChanged();
}

// ------------------------------------------------------------------ riding

function ghostKey(course) {
  return course.id === JOYRIDE_ID ? `ghost.joyride.v${JOYRIDE_VERSION}.${course.seed}` : `ghost.${course.id}`;
}

function loadGhost(course) {
  const stored = loadPreference(ghostKey(course), null);
  return isGhost(stored) ? stored : null;
}

function startRide() {
  closeOverlays();
  unlock(state.audio);
  state.recorder = createRecorder();
  state.ghost = loadGhost(state.course);
  state.shake = 0;
  state.gear = [];
  state.slowMotionSeconds = 0;
  state.run = createRun(state.course, state.pieces, state.surfaces);
  state.mode = 'ride';
  state.paused = false;
  state.particles = [];
  state.look = { tuck: 0, pitch: state.run.skier.pitch, tumble: 0, brake: false, yaw: 0, lostGear: false };
  state.accumulator = 0;
  state.gForce = 1;
  state.resultTimer = 0;
  state.jumpBufferSeconds = 0;
  state.rideZoom = clampZoom(Math.max(14, Math.min(40, Math.min(state.camera.width, state.camera.height) / 26)));
  state.followPausedUntil = 0;
  document.body.classList.add('riding');
  document.body.classList.remove('editing');
  $('ride-controls').hidden = false;
  updateRideButton();
}

function backToEdit() {
  if (state.run) state.lastTrace = state.run.trace;
  state.run = null;
  state.mode = 'edit';
  state.paused = false;
  state.particles = [];
  state.gear = [];
  state.slowMotionSeconds = 0;
  document.body.classList.remove('riding');
  document.body.classList.add('editing');
  $('ride-controls').hidden = true;
  $('result-overlay').hidden = true;
  updateRideButton();
  updateScores();
}

function togglePause() {
  if (state.mode !== 'ride' || !state.run || state.run.status !== 'running') return;
  state.paused = !state.paused;
  updateRideButton();
}

function rideButtonPressed() {
  if (state.mode === 'edit') startRide();
  else if (state.run && state.run.status !== 'running') startRide();
  else togglePause();
}

function updateRideButton() {
  const riding = state.mode === 'ride' && !state.paused && state.run && state.run.status === 'running';
  $('ride-label').textContent = state.mode === 'edit' ? 'Ride' : riding ? 'Pause' : state.run && state.run.status !== 'running' ? 'Again' : 'Go';
  $('ride-button').querySelector('use').setAttribute('href', riding ? '#i-pause' : '#i-play');
}

function currentControls() {
  const jump = state.jumpBufferSeconds > 0;
  return {
    tuck: state.keys.tuck || state.touch.tuck,
    brake: state.keys.brake || state.touch.brake,
    trick: state.keys.trick || state.touch.trick,
    jump,
  };
}

function physicsFrame(frameSeconds) {
  const run = state.run;
  state.accumulator = Math.min(state.accumulator + frameSeconds, 0.1);
  while (state.accumulator >= PHYSICS.stepSeconds && run.status === 'running') {
    state.accumulator -= PHYSICS.stepSeconds;
    const controls = currentControls();
    const wasGrounded = run.skier.mode === 'ground';
    const events = stepRun(run, controls);
    recordSample(state.recorder, run.time, run.skier, PHYSICS.stepSeconds);
    if (controls.jump && wasGrounded) state.jumpBufferSeconds = 0;
    state.jumpBufferSeconds = Math.max(0, state.jumpBufferSeconds - PHYSICS.stepSeconds);
    for (const event of events) handleRunEvent(event);
  }
}

const CRASH_MESSAGES = {
  sideways: 'Landed sideways! Finish the turn, or stop at 180',
  'switch-big-air': 'Too much air to land backwards',
};

function handleRunEvent(event) {
  const run = state.run;
  switch (event.type) {
    case 'touchdown':
      spray(event.x, event.y, Math.min(40, 6 + event.impact * 4), 2 + event.impact * 0.6);
      playLanding(state.audio, event.impact);
      state.shake = Math.max(state.shake, SHAKE_PER_IMPACT * Math.max(0, event.impact - PHYSICS.softLandingSpeed));
      if (event.airSeconds > 0.7 && event.impact <= PHYSICS.softLandingSpeed && !run.skier.crashed) {
        toast(`Clean landing · ${event.airSeconds.toFixed(1)} s air`, 'good');
      }
      break;
    case 'hard':
      toast(event.kind === 'sketchy' ? 'Sketchy landing: not quite round' : `${event.kind === 'kink' ? 'Sharp kink' : 'Hard landing'} · ${event.impact.toFixed(1)} m/s into the snow`, 'warn');
      spray(event.x, event.y, 30, 4);
      if (event.kind === 'kink') playLanding(state.audio, event.impact);
      state.shake = Math.max(state.shake, SHAKE_PER_IMPACT * (event.impact - PHYSICS.softLandingSpeed));
      break;
    case 'crash':
      toast(CRASH_MESSAGES[event.kind] || `Wipeout · ${event.impact.toFixed(1)} m/s into the snow`, 'bad');
      spray(event.x, event.y, 60, 6);
      state.gear = throwGear(run.skier);
      state.slowMotionSeconds = CRASH_SLOW_MOTION_SECONDS;
      playCrash(state.audio);
      state.shake = Math.max(state.shake, SHAKE_PER_IMPACT * event.impact);
      break;
    case 'trick':
      toast(`${run.skier.switchStance ? 'Switch ' : ''}${event.degrees}! +${(event.degrees / 180) * SCORING.joyPerHalfTurn} joy`, event.clean ? 'good' : 'warn');
      playChime(state.audio, [990, 1320, 1760].slice(0, Math.min(3, event.degrees / 180)));
      break;
    case 'switch':
      toast('Riding backwards: no brakes, and no big landings', 'warn');
      break;
    case 'token':
      toast(`Snowflake ${run.collected.size} of ${run.course.tokens.length}`, 'good');
      playChime(state.audio, [1320, 1760]);
      break;
    case 'finish':
      toast('Finish!', 'good');
      playChime(state.audio, [660, 880, 1320]);
      break;
    case 'end':
      updateRideButton();
      state.resultTimer = 0.9;
      break;
    default:
  }
}

// ---------------------------------------------------------------- particles

function spray(x, y, count, strength) {
  for (let index = 0; index < count && state.particles.length < VIEW.maxParticles; index += 1) {
    const angle = Math.PI * (0.15 + Math.random() * 0.7);
    const speed = strength * (0.4 + Math.random());
    state.particles.push({
      x, y: y + 0.05, z: (Math.random() - 0.5) * 2 * VIEW.laneHalfWidth,
      vx: Math.cos(angle) * speed * (Math.random() < 0.5 ? -1 : 1), vy: Math.sin(angle) * speed, vz: (Math.random() - 0.5) * 2,
      life: 0.6 + Math.random() * 0.6, maxLife: 1.2, size: 0.05 + Math.random() * 0.08,
    });
  }
}

function updateParticles(dt) {
  const run = state.run;
  if (run && run.status === 'running' && !state.paused && run.skier.mode === 'ground') {
    const skier = run.skier;
    const speed = Math.abs(skier.speed);
    const controls = currentControls();
    const rate = controls.brake ? speed * 6 : speed > 12 ? (speed - 12) * 1.2 : 0;
    const spawn = rate * dt + (Math.random() < (rate * dt) % 1 ? 1 : 0);
    for (let index = 0; index < spawn && state.particles.length < VIEW.maxParticles; index += 1) {
      state.particles.push({
        x: skier.x - skier.vx * 0.02, y: skier.y + 0.05, z: (Math.random() - 0.5) * 0.8,
        vx: -skier.vx * (0.1 + Math.random() * 0.25), vy: 1 + Math.random() * 2.5, vz: (Math.random() - 0.5) * 3,
        life: 0.35 + Math.random() * 0.4, maxLife: 0.75, size: 0.04 + Math.random() * 0.06,
      });
    }
  }
  for (const particle of state.particles) {
    particle.vy -= PHYSICS.gravity * 0.6 * dt;
    particle.vx *= 1 - 1.5 * dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.z += particle.vz * dt;
    particle.life -= dt;
  }
  state.particles = state.particles.filter((particle) => particle.life > 0);
}

// ------------------------------------------------------------------ camera

function layoutInsets() {
  const width = state.camera.width;
  const height = state.camera.height;
  const rectOf = (id) => {
    const element = $(id);
    if (!element || element.hidden || getComputedStyle(element).display === 'none') return null;
    return element.getBoundingClientRect();
  };
  const insets = { top: 12, right: 12, bottom: 12, left: 12 };
  insets.top = document.querySelector('.topbar').getBoundingClientRect().bottom + 12;
  const tools = rectOf('tools');
  if (tools) {
    if (tools.height > tools.width) insets.left = Math.max(insets.left, tools.right + 12);
    else insets.bottom = Math.max(insets.bottom, height - tools.top + 12);
  }
  const rideBar = document.querySelector('.ride-bar').getBoundingClientRect();
  insets.bottom = Math.max(insets.bottom, height - rideBar.top + 8);
  const panel = rectOf('tracks-panel');
  if (panel) {
    if (panel.height > height * 0.7 && panel.width < width * 0.6) insets.right = Math.max(insets.right, width - panel.left + 12);
    else insets.bottom = Math.max(insets.bottom, height - panel.top + 12);
  }
  const readout = rectOf('readout');
  if (readout && readout.top > height / 2) insets.bottom = Math.max(insets.bottom, height - readout.top + 8);
  return insets;
}

function fitView() {
  const bounds = courseBounds(state.pieces);
  const include = (x, y) => {
    bounds.minX = Math.min(bounds.minX, x); bounds.maxX = Math.max(bounds.maxX, x);
    bounds.minY = Math.min(bounds.minY, y); bounds.maxY = Math.max(bounds.maxY, y);
  };
  include(state.start.x, state.start.y + 2.5);
  if (state.course.finish) include(state.course.finish.x, state.course.finish.yMax);
  for (const token of state.course.tokens || []) include(token.x, token.y);
  frameBounds(state.camera, bounds, layoutInsets());
}

function followSkier(dt) {
  const skier = state.run.skier;
  if (performance.now() < state.followPausedUntil) return;
  const camera = state.camera;
  const speed = speedOf(skier);
  const targetZoom = state.rideZoom / (1 + speed / VIEW.speedZoomOut);
  const blend = 1 - Math.pow(1 - VIEW.followSmoothing, dt * 60);
  camera.pixelsPerMeter += (targetZoom - camera.pixelsPerMeter) * blend;
  const targetX = skier.x + skier.vx * VIEW.followLookAhead;
  const targetY = skier.y + 1 + skier.vy * VIEW.followLookAhead * 0.6;
  camera.x += (targetX - camera.x) * blend;
  camera.y += (targetY - camera.y) * blend;
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(rect.width * ratio);
  canvas.height = Math.round(rect.height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  const firstSize = state.camera.width === 800 && state.camera.height === 600;
  state.camera.width = rect.width;
  state.camera.height = rect.height;
  if (firstSize) fitView();
}

// -------------------------------------------------------------------- loop

let lastFrame = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  tick(dt);
  requestAnimationFrame(frame);
}

function tick(dt) {
  state.time += dt;
  if (state.run) {
    // A crash plays in slow motion; everything that moves shares the clock.
    let worldDt = dt;
    if (state.slowMotionSeconds > 0) {
      state.slowMotionSeconds -= dt;
      worldDt = dt * CRASH_SLOW_MOTION_RATE;
    }
    if (!state.paused) {
      physicsFrame(worldDt);
      if (state.gear.length) state.gear = stepAllGear(state.gear, state.run.surfaces, worldDt, state.run.lowestY);
    }
    updateLook(dt);
    followSkier(dt);
    if (state.resultTimer > 0) {
      state.resultTimer -= dt;
      if (state.resultTimer <= 0) showResult();
    }
  }
  if (!state.paused) updateParticles(dt);
  const riding = state.run && state.run.status === 'running' && !state.paused;
  const skier = state.run && state.run.skier;
  updateAmbience(state.audio, riding ? speedOf(skier) : 0, riding && skier.mode === 'ground', riding && currentControls().brake);
  state.shake *= Math.exp(-SHAKE_DECAY_PER_SECOND * dt);
  draw();
  updateReadout(dt);
}

// Steps the game without the browser's frame clock, which stops in hidden
// tabs; used to inspect a ride frame by frame.
function advance(seconds) {
  for (let elapsed = 0; elapsed < seconds; elapsed += 1 / 60) tick(1 / 60);
  return state.run ? { status: state.run.status, time: state.run.time, x: state.run.skier.x, y: state.run.skier.y } : null;
}

function updateLook(dt) {
  const run = state.run;
  const controls = currentControls();
  const look = state.look;
  look.tuck += ((controls.tuck || (controls.trick && run.skier.mode === 'air') ? 1 : 0) - look.tuck) * Math.min(1, dt * 10);
  // Heading about the vertical axis: half a turn when riding backwards.
  look.yaw = (run.skier.switchStance ? Math.PI : 0) + run.skier.spin;
  look.lostGear = run.skier.crashed;
  look.brake = controls.brake && run.skier.mode === 'ground' && !run.skier.switchStance;
  const difference = Math.atan2(Math.sin(run.skier.pitch - look.pitch), Math.cos(run.skier.pitch - look.pitch));
  look.pitch += difference * Math.min(1, dt * 18);
  if (run.skier.crashed) look.tumble += dt * Math.max(0, 9 - run.crashSeconds * 3);
}

function draw() {
  const run = state.run;
  let prediction = null;
  if (run && run.skier.mode === 'air' && run.status === 'running') {
    prediction = predictFlight(run.skier, run.surfaces, currentControls());
  }
  const camera = state.camera;
  const shakeX = (Math.random() - 0.5) * 2 * state.shake;
  const shakeY = (Math.random() - 0.5) * 2 * state.shake;
  camera.x += shakeX;
  camera.y += shakeY;
  const ghost = run && state.ghost ? ghostPose(state.ghost, run.time) : null;
  renderScene(ctx, state.camera, {
    mode: state.mode,
    showGrid: true,
    pieces: state.pieces,
    selectedPieceId: state.selectedPieceId,
    previewPolylines: state.preview,
    previewColour: COLORS.pieces[playerPieces().length % COLORS.pieces.length],
    sketch: state.sketch,
    lastTrace: state.lastTrace,
    course: { ...state.course, start: state.start },
    collected: run ? run.collected : null,
    run,
    look: state.look,
    prediction,
    ghost,
    gear: state.gear,
    particles: state.particles,
    eraser: state.eraser,
    time: state.time,
  });
  camera.x -= shakeX;
  camera.y -= shakeY;
}

// ---------------------------------------------------------------- readouts

const textCache = new Map();
function setText(id, text) {
  if (textCache.get(id) === text) return;
  textCache.set(id, text);
  $(id).textContent = text;
}

function updateScores() {
  const run = state.run;
  setText('joy', run ? String(Math.floor(run.joy)) : '0');
  setText('ouch', run ? String(run.ouch) : '0');
  setText('score', run ? String(scoreOf(run)) : '0');
}

function updateReadout(dt) {
  updateScores();
  if (state.mode === 'edit') {
    const point = state.cursor;
    setText('cursor-readout', point ? `x ${point.x.toFixed(1)}   y ${point.y.toFixed(1)}` : NAVIGATION_HINT);
    return;
  }
  const skier = state.run.skier;
  const unit = SPEED_UNITS[state.units];
  setText('speed-value', String(Math.round(speedOf(skier) * unit.factor)));
  setText('speed-unit', unit.label);
  setText('gauge-height', `${skier.y.toFixed(1)} m`);
  const angle = Math.atan2(skier.vy, Math.abs(skier.vx) || 1e-6) * 180 / Math.PI;
  setText('gauge-slope', skier.mode === 'ground' && Math.abs(skier.speed) < 0.05 ? '—' : `${angle >= 0 ? '+' : '−'}${Math.abs(angle).toFixed(0)}°`);
  const g = skier.mode === 'ground' ? skier.normalAccel / PHYSICS.gravity : 0;
  state.gForce += (g - state.gForce) * Math.min(1, dt * 8);
  setText('gauge-g', `${state.gForce.toFixed(1)} g`);
  const turned = skier.mode === 'air' && Math.abs(skier.spin) > 0.05 ? ` · ${Math.round((skier.spin * 180) / Math.PI)}°` : skier.switchStance ? ' · switch' : '';
  setText('gauge-air', `${(skier.mode === 'air' ? skier.airSeconds : 0).toFixed(1)} s${turned}`);
}

// ----------------------------------------------------------------- toasts

let toastTimer = 0;
function toast(message, tone = '') {
  const element = $('toast');
  element.textContent = message;
  element.className = `toast show ${tone}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { element.className = 'toast'; }, 2200);
}

// ------------------------------------------------------------- the canvas

function worldAt(point) {
  return unproject(state.camera, point.x, point.y);
}

function pieceAt(point, radiusPixels) {
  const world = worldAt(point);
  let best = null;
  for (const piece of state.pieces) {
    const distance = distanceToPiece(piece, world) * state.camera.pixelsPerMeter;
    if (distance < radiusPixels && (!best || distance < best.distance)) best = { piece, distance };
  }
  return best ? best.piece : null;
}

function eraseAt(point) {
  const radius = 20;
  state.eraser = { ...point, radius };
  const hit = pieceAt(point, radius);
  if (!hit) return;
  if (hit.locked) {
    toast('Course pieces are fixed', 'warn');
    return;
  }
  removePiece(hit.id);
}

function panBy(dx, dy) {
  state.camera.x -= dx / state.camera.pixelsPerMeter;
  state.camera.y += dy / state.camera.pixelsPerMeter;
  if (state.mode === 'ride') state.followPausedUntil = performance.now() + 2500;
}

attachGestures(canvas, {
  begin(point, panOnly) {
    if (state.mode === 'ride' || panOnly) return;
    if (state.tool === 'draw') state.sketch = [worldAt(point)];
    if (state.tool === 'erase') eraseAt(point);
    if (state.tool === 'flag') placeStart(point);
    if (state.tool === 'pan') canvas.classList.add('dragging');
  },
  move(point, previous, panOnly) {
    if (state.mode === 'ride' || panOnly || state.tool === 'pan') { panBy(point.x - previous.x, point.y - previous.y); return; }
    if (state.tool === 'draw' && state.sketch) {
      const world = worldAt(point);
      const last = state.sketch[state.sketch.length - 1];
      if (Math.hypot(world.x - last.x, world.y - last.y) > 0.1) state.sketch.push(world);
    }
    if (state.tool === 'erase') eraseAt(point);
    if (state.tool === 'flag') placeStart(point);
  },
  end(point, wasTap, panOnly) {
    canvas.classList.remove('dragging');
    state.eraser = null;
    if (state.mode === 'ride' || panOnly) return;
    if (state.tool === 'draw' && state.sketch) {
      const stroke = state.sketch;
      state.sketch = null;
      stroke.push(worldAt(point));
      if (stroke.length >= 2) {
        const piece = createSketchPiece(stroke);
        if (piece && pieceLength(piece) > 1 && addPiece(piece)) toast(`Sketched ${Math.round(pieceLength(piece))} m of track`);
      }
    }
    if (state.tool === 'pan' && wasTap) selectPiece(pieceAt(point, 16)?.id ?? null);
    if (state.tool === 'flag') saveDraft();
  },
  cancel() {
    state.sketch = null;
    state.eraser = null;
    canvas.classList.remove('dragging');
  },
  pinch(factor, centre, panX, panY) {
    zoomAt(state.camera, factor, centre.x, centre.y);
    panBy(panX, panY);
    if (state.mode === 'ride') state.rideZoom = clampZoom(state.rideZoom * factor);
  },
  wheel(factor, point) {
    zoomAt(state.camera, factor, point.x, point.y);
    if (state.mode === 'ride') {
      state.rideZoom = clampZoom(state.rideZoom * factor);
      state.followPausedUntil = 0;
    }
  },
  hover(point) {
    state.cursor = point ? worldAt(point) : null;
    if (state.tool === 'erase' && point && state.mode === 'edit') state.eraser = { ...point, radius: 20 };
    else if (!point || state.tool !== 'erase') state.eraser = null;
  },
});

function placeStart(point) {
  if (!state.course.editableStart) return;
  const world = worldAt(point);
  state.start = { x: world.x, y: world.y };
}

function setTool(tool) {
  if (tool === 'flag' && !state.course.editableStart) {
    toast('This slope has a fixed start', 'warn');
    return;
  }
  state.tool = tool;
  canvas.dataset.tool = tool;
  for (const button of document.querySelectorAll('.tool[data-tool]')) {
    button.setAttribute('aria-pressed', String(button.dataset.tool === tool));
  }
  state.eraser = null;
}

// ------------------------------------------------------- equations panel

function setPanelOpen(open) {
  $('tracks-panel').hidden = !open;
  document.body.classList.toggle('panel-open', open);
  $('tracks-toggle').setAttribute('aria-expanded', String(open));
  if (!open) state.preview = null;
  else updatePreview();
}

function selectPiece(id) {
  state.selectedPieceId = id;
  const piece = state.pieces.find((candidate) => candidate.id === id);
  if (piece && piece.kind === 'equation') {
    $('equation-input').value = piece.equation.replace(/^\s*y\s*=\s*/i, '');
    $('from-input').value = formatNumber(piece.fromX);
    $('to-input').value = formatNumber(piece.toX);
  }
  renderPieceList();
  renderFormState();
  updatePreview();
}

function formatNumber(value) {
  return String(Math.round(value * 1000) / 1000);
}

function clearForm() {
  state.selectedPieceId = null;
  $('equation-input').value = '';
  const bounds = courseBounds(state.pieces);
  $('from-input').value = formatNumber(Math.round(Math.max(bounds.minX, state.start.x)));
  $('to-input').value = formatNumber(Math.round(Math.max(bounds.minX, state.start.x) + 30));
  setFormMessage('');
  renderPieceList();
  renderFormState();
  updatePreview();
}

function selectedPiece() {
  return state.pieces.find((piece) => piece.id === state.selectedPieceId) || null;
}

function renderFormState() {
  const piece = selectedPiece();
  const editable = piece && !piece.locked;
  $('add-button').textContent = editable && piece.kind === 'equation' ? 'Update' : 'Add track';
  $('delete-button').hidden = !editable;
  $('new-button').hidden = !piece;
  const locked = piece && piece.locked;
  for (const id of ['equation-input', 'from-input', 'to-input']) $(id).readOnly = Boolean(locked);
  $('add-button').disabled = Boolean(locked);
  if (locked) setFormMessage('A fixed piece of this slope. Build around it.');
}

function setFormMessage(message, isError = false) {
  const element = $('form-message');
  element.textContent = message;
  element.classList.toggle('error', isError);
}

function readForm() {
  return { equation: $('equation-input').value, from: $('from-input').value, to: $('to-input').value };
}

function updatePreview() {
  state.preview = null;
  if ($('tracks-panel').hidden) return;
  const piece = selectedPiece();
  if (piece && piece.locked) return;
  const { equation, from, to } = readForm();
  if (!equation.trim()) {
    setFormMessage(state.course.id === 'sandbox' ? 'Type an equation in x, or pick a sample.' : '');
    return;
  }
  try {
    const fn = compileEquation(equation);
    const start = Number(from);
    const end = Number(to);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) {
      setFormMessage('Enter two different x values for the range', true);
      return;
    }
    state.preview = sampleFunction(fn, start, end);
    const length = state.preview.reduce((sum, points) => sum + points.slice(1).reduce((total, point, index) => total + Math.hypot(point.x - points[index].x, point.y - points[index].y), 0), 0);
    const y0 = fn(Math.min(start, end));
    const y1 = fn(Math.max(start, end));
    setFormMessage(`${Math.round(length)} m of track · y(${formatNumber(Math.min(start, end))}) = ${Number.isFinite(y0) ? y0.toFixed(2) : '—'}, y(${formatNumber(Math.max(start, end))}) = ${Number.isFinite(y1) ? y1.toFixed(2) : '—'}`);
  } catch (error) {
    setFormMessage(error.message, true);
  }
}

function submitForm(event) {
  event.preventDefault();
  const { equation, from, to } = readForm();
  const selected = selectedPiece();
  try {
    const text = /^\s*y\s*=/.test(equation) ? equation : `y = ${equation}`;
    if (selected && !selected.locked && selected.kind === 'equation') {
      const piece = createEquationPiece(text, from, to, { id: selected.id });
      if (replacePiece(selected.id, piece)) toast('Track updated');
    } else {
      const piece = createEquationPiece(text, from, to);
      if (addPiece(piece)) {
        toast(`Added ${Math.round(pieceLength(piece))} m of track`);
        clearForm();
      }
    }
    updatePreview();
  } catch (error) {
    setFormMessage(error.message, true);
  }
}

function renderPieceList() {
  const list = $('piece-list');
  list.replaceChildren();
  let colourIndex = 0;
  for (const piece of state.pieces) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-current', String(piece.id === state.selectedPieceId));
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = piece.locked ? COLORS.locked : COLORS.pieces[colourIndex++ % COLORS.pieces.length];
    const text = document.createElement('span');
    text.className = 'piece-text';
    text.textContent = piece.kind === 'equation' ? piece.equation : `Sketch · ${Math.round(pieceLength(piece))} m`;
    button.append(dot, text);
    if (piece.kind === 'equation') {
      const range = document.createElement('span');
      range.className = 'piece-range';
      range.textContent = `${formatNumber(piece.fromX)} … ${formatNumber(piece.toX)}`;
      button.append(range);
    }
    if (piece.locked) {
      const lock = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      lock.setAttribute('class', 'icon');
      lock.innerHTML = '<use href="#i-lock"/>';
      button.append(lock);
    }
    button.addEventListener('click', () => selectPiece(piece.id === state.selectedPieceId ? null : piece.id));
    item.append(button);
    list.append(item);
  }
}

function renderInk() {
  const course = state.course;
  const ink = $('ink');
  ink.hidden = course.ink == null;
  if (course.ink == null) return;
  const used = inkUsed();
  $('ink-fill').style.width = `${Math.min(100, (used / course.ink) * 100)}%`;
  $('ink-text').textContent = `${Math.round(used)} / ${course.ink} m`;
  ink.classList.toggle('full', used > course.ink * 0.95);
}

function insertAtCaret(text) {
  const input = $('equation-input');
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  input.value = input.value.slice(0, start) + text + input.value.slice(end);
  input.focus({ preventScroll: true });
  input.setSelectionRange(start + text.length, start + text.length);
  updatePreview();
}

// ---------------------------------------------------------- course chrome

function starString(flags, total) {
  let text = '';
  for (let index = 0; index < total; index += 1) text += flags[index] ? '★' : '☆';
  return text;
}

function renderCourseChrome() {
  const course = state.course;
  $('course-sign').dataset.difficulty = course.difficulty;
  $('course-sign').title = DIFFICULTY_LABELS[course.difficulty];
  const progress = loadPreference('stars', {})[course.id] || [];
  $('course-stars').textContent = course.stars.length ? starString(progress, course.stars.length) : '';
  $('course-brief').textContent = course.brief;
  $('hint-box').open = false;
  $('hint-summary').textContent = course.hint ? 'The maths · hint' : 'The maths';
  $('lesson-text').textContent = course.lesson;
  $('hint-text').textContent = course.hint || '';
  $('hint-text').hidden = !course.hint;
  $('flag-tool').disabled = !course.editableStart;
  if (!course.editableStart && state.tool === 'flag') setTool('pan');
  // Joyride slopes are generated: ride and read them, but nothing to build.
  const buildable = course.ink !== 0;
  for (const tool of document.querySelectorAll('.tool[data-tool="draw"], .tool[data-tool="erase"], .tool[data-tool="flag"]')) tool.hidden = !buildable;
  $('new-slope-button').hidden = buildable;
  $('equation-form').hidden = !buildable;
  if (!buildable && state.tool !== 'pan') setTool('pan');
  $('course-name').textContent = course.id === JOYRIDE_ID ? `Joyride #${course.seed % 10000}` : course.name;
}

function renderCourseGrid() {
  const grid = $('course-grid');
  grid.replaceChildren();
  const progress = loadPreference('stars', {});
  for (const course of ALL_COURSES) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'course-card';
    card.setAttribute('aria-current', String(course.id === state.course.id));
    if (course.id === JOYRIDE_ID && state.course.id === JOYRIDE_ID) card.title = 'Pick again for a new slope';
    const title = document.createElement('span');
    title.className = 'card-title';
    const sign = document.createElement('span');
    sign.className = 'sign';
    sign.dataset.difficulty = course.difficulty;
    title.append(sign, document.createTextNode(course.name));
    const meta = document.createElement('span');
    meta.className = 'card-meta';
    const label = document.createElement('span');
    label.textContent = DIFFICULTY_LABELS[course.difficulty];
    const stars = document.createElement('span');
    stars.className = 'card-stars';
    stars.textContent = course.stars.length ? starString(progress[course.id] || [], course.stars.length) : '';
    meta.append(label, stars);
    const brief = document.createElement('p');
    brief.className = 'card-brief';
    brief.textContent = course.brief;
    card.append(title, meta, brief);
    card.addEventListener('click', () => {
      closeOverlays();
      loadCourse(course.id, { newSlope: course.id === JOYRIDE_ID && state.course.id === JOYRIDE_ID });
      if (course.id !== 'sandbox' && course.id !== JOYRIDE_ID) setPanelOpen(true);
    });
    grid.append(card);
  }
}

// ---------------------------------------------------------------- overlays

function openOverlay(id) {
  closeOverlays();
  if (id === 'courses-overlay') renderCourseGrid();
  $(id).hidden = false;
  $(id).querySelector('button')?.focus({ preventScroll: true });
}

function closeOverlays() {
  for (const id of ['courses-overlay', 'help-overlay', 'result-overlay']) $(id).hidden = true;
}

let helpPage = 0;
function showHelpPage(index) {
  const pages = [...document.querySelectorAll('.help-page')];
  helpPage = Math.max(0, Math.min(pages.length - 1, index));
  pages.forEach((page, pageIndex) => { page.hidden = pageIndex !== helpPage; });
  $('help-dots').replaceChildren(...pages.map((_, pageIndex) => {
    const dot = document.createElement('span');
    if (pageIndex === helpPage) dot.className = 'on';
    return dot;
  }));
  $('help-prev').disabled = helpPage === 0;
  $('help-next').textContent = helpPage === pages.length - 1 ? 'Done' : 'Next';
}

const END_TITLES = {
  finished: ['Finished', 'Across the line.'],
  crashed: ['Wipeout', 'Too much speed into the snow. Match the landing to the flight.'],
  stopped: ['Came to a stop', 'Out of energy. Friction and drag won this one.'],
  lost: ['Off the map', 'The skier left every track. Something needs to catch them.'],
  timeout: ['Still going', 'Three minutes is the limit.'],
};

function showResult() {
  const run = state.run;
  if (!run) return;
  const course = state.course;
  const [title, line] = END_TITLES[run.status] || END_TITLES.stopped;
  $('result-title').textContent = title;
  let note = line;
  if (beatsGhost(run, state.ghost)) {
    const previous = state.ghost;
    state.ghost = ghostFromRun(run, state.recorder);
    savePreference(ghostKey(course), state.ghost);
    note = previous ? `New best: ${run.time.toFixed(2)} s, ${(previous.time - run.time).toFixed(2)} s faster. Your ghost will race you.` : `Your ghost will race you next time.`;
  } else if (state.ghost && run.status === 'finished') {
    note = `Best ${state.ghost.time.toFixed(2)} s · this run ${(run.time - state.ghost.time).toFixed(2)} s slower.`;
  }
  $('result-line').textContent = note;
  const sheet = document.querySelector('.result-sheet');
  sheet.classList.toggle('finished', run.status === 'finished');
  sheet.classList.toggle('crashed', run.status === 'crashed');
  const unit = SPEED_UNITS[state.units];
  const stats = [
    ['Time', `${run.time.toFixed(1)} s`],
    ['Top speed', `${Math.round(run.stats.maxSpeed * unit.factor)} ${unit.label}`],
    ['Longest air', `${run.stats.longestAir.toFixed(1)} s`],
    ['Joy', String(Math.floor(run.joy))],
    ['Ouch', String(run.ouch)],
    ['Score', String(scoreOf(run))],
  ];
  $('result-stats').replaceChildren(...stats.map(([label, value]) => {
    const wrapper = document.createElement('div');
    const term = document.createElement('dt');
    term.textContent = label;
    const detail = document.createElement('dd');
    detail.textContent = value;
    wrapper.append(term, detail);
    return wrapper;
  }));
  const stars = evaluateStars(course, run);
  const best = stars.length ? recordStars(course.id, stars.map((star) => star.met)) : [];
  $('star-list').replaceChildren(...stars.map((star, index) => {
    const item = document.createElement('li');
    item.textContent = describeCriterion(star) + (!star.met && best[index] ? ' (earned before)' : '');
    if (star.met) item.className = 'met';
    return item;
  }));
  const index = CHALLENGES.findIndex((challenge) => challenge.id === course.id);
  const joyride = course.id === JOYRIDE_ID;
  const next = course.id === 'sandbox' || joyride ? CHALLENGES[0] : CHALLENGES[index + 1];
  $('result-next').hidden = !(next && (run.status === 'finished' || course.id === 'sandbox'));
  $('result-next').textContent = joyride ? 'Build with maths' : course.id === 'sandbox' ? 'Try a challenge' : 'Next slope';
  $('result-next').onclick = () => { loadCourse(next.id); setPanelOpen(true); };
  $('result-new').hidden = !joyride;
  if (joyride && run.status === 'finished') {
    $('result-line').textContent = `${note} Next: design your own slopes with equations, starting at First Tracks. Joyride stays first in the slope list.`;
  }
  renderCourseChrome();
  $('result-overlay').hidden = false;
}

// ---------------------------------------------------------------- files

function saveToFile() {
  const text = serialiseCourse(state.course.id, state.start, state.course.id === 'sandbox' ? state.pieces.map((piece) => ({ ...piece, locked: false })) : state.pieces);
  const blob = new Blob([text], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `slope-lab-${state.course.id}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  // Downloads can be blocked (embedded viewers); the clipboard copy lets the
  // course be shared by pasting it anywhere in Slope Lab.
  const copied = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(text) : Promise.reject();
  copied.then(() => toast(`Saved ${link.download} · also copied, paste to share`), () => toast(`Saved ${link.download}`));
}

window.addEventListener('paste', (event) => {
  if (typingTarget(event.target)) return;
  const text = event.clipboardData && event.clipboardData.getData('text');
  if (!text || !text.trim().startsWith('{')) return;
  try {
    const loaded = parseCourseFile(text);
    event.preventDefault();
    loadCourse(loaded.courseId, { file: loaded });
    saveDraft();
    toast('Course pasted', 'good');
  } catch (error) {
    toast(error.message, 'bad');
  }
});

function loadFromFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const loaded = parseCourseFile(String(reader.result));
      loadCourse(loaded.courseId, { file: loaded });
      saveDraft();
      toast(`Opened ${file.name}`, 'good');
    } catch (error) {
      toast(error.message, 'bad');
    }
  };
  reader.readAsText(file);
}

// ------------------------------------------------------------- keyboard

const typingTarget = (target) => target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA');

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (![...document.querySelectorAll('.overlay')].every((overlay) => overlay.hidden)) closeOverlays();
    else if (typingTarget(event.target)) event.target.blur();
    else if (state.mode === 'ride') backToEdit();
    return;
  }
  if (typingTarget(event.target)) return;
  const key = event.key.toLowerCase();
  if (key === 'm') { toggleMute(); return; }
  if (state.mode === 'ride') {
    if (key === 'arrowdown' || key === 's') { state.keys.tuck = true; event.preventDefault(); }
    if (key === 'arrowleft' || key === 'a') { state.keys.brake = true; event.preventDefault(); }
    if ((key === ' ' || key === 'arrowup' || key === 'w') && !event.repeat) { state.jumpBufferSeconds = 0.15; event.preventDefault(); }
    if (key === 'arrowright' || key === 'd') {
      // Spin pressed on the snow pops first, so one press chains both.
      if (!event.repeat) state.jumpBufferSeconds = 0.15;
      state.keys.trick = true;
      event.preventDefault();
    }
    if (key === 'n' && isJoyride()) newJoyride();
    if (key === 'p') togglePause();
    if (key === 'r') backToEdit();
    if (key === 'enter') rideButtonPressed();
    return;
  }
  if (key === 'enter') { rideButtonPressed(); event.preventDefault(); }
  if (key === 'v') setTool('pan');
  if (key === 'd') setTool('draw');
  if (key === 'e') setTool('erase');
  if (key === 's') setTool('flag');
  if (key === 'f') fitView();
  if (key === 'n' && isJoyride()) newJoyride();
  if (key === 't') setPanelOpen($('tracks-panel').hidden);
  if (key === '?') openOverlay('help-overlay');
  if ((key === 'delete' || key === 'backspace') && selectedPiece() && !selectedPiece().locked) removePiece(state.selectedPieceId);
});

window.addEventListener('keyup', (event) => {
  const key = event.key.toLowerCase();
  if (key === 'arrowdown' || key === 's') state.keys.tuck = false;
  if (key === 'arrowleft' || key === 'a') state.keys.brake = false;
  if (key === 'arrowright' || key === 'd') state.keys.trick = false;
});

window.addEventListener('blur', () => {
  state.keys.tuck = false;
  state.keys.brake = false;
  state.touch.tuck = false;
  state.touch.brake = false;
  state.keys.trick = false;
  state.touch.trick = false;
});

// --------------------------------------------------------------- buttons

for (const button of document.querySelectorAll('.tool[data-tool]')) {
  button.addEventListener('click', () => setTool(button.dataset.tool));
}
$('tracks-toggle').addEventListener('click', () => setPanelOpen($('tracks-panel').hidden));
$('tracks-close').addEventListener('click', () => setPanelOpen(false));
$('fit-button').addEventListener('click', fitView);
$('save-button').addEventListener('click', saveToFile);
$('load-button').addEventListener('click', () => $('load-file').click());
$('load-file').addEventListener('change', (event) => {
  const file = event.target.files && event.target.files[0];
  if (file) loadFromFile(file);
  event.target.value = '';
});
$('ride-button').addEventListener('click', rideButtonPressed);
function renderMute() {
  $('mute-button').setAttribute('aria-pressed', String(state.audio.muted));
  $('mute-button').querySelector('use').setAttribute('href', state.audio.muted ? '#i-sound-off' : '#i-sound');
  $('mute-button').title = state.audio.muted ? 'Sound off (M)' : 'Sound on (M)';
}
function toggleMute() {
  unlock(state.audio);
  setMuted(state.audio, !state.audio.muted);
  savePreference('muted', state.audio.muted);
  renderMute();
}
$('mute-button').addEventListener('click', toggleMute);
renderMute();
$('reset-button').addEventListener('click', backToEdit);
$('speed-button').addEventListener('click', () => {
  state.units = (state.units + 1) % SPEED_UNITS.length;
  savePreference('units', state.units);
});
$('courses-button').addEventListener('click', () => openOverlay('courses-overlay'));
$('course-chip').addEventListener('click', () => openOverlay('courses-overlay'));
$('help-button').addEventListener('click', () => { showHelpPage(0); openOverlay('help-overlay'); });
$('help-prev').addEventListener('click', () => showHelpPage(helpPage - 1));
$('help-next').addEventListener('click', () => {
  if (helpPage === document.querySelectorAll('.help-page').length - 1) closeOverlays();
  else showHelpPage(helpPage + 1);
});
for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', closeOverlays);
for (const overlay of document.querySelectorAll('.overlay')) {
  overlay.addEventListener('click', (event) => { if (event.target === overlay && overlay.id !== 'result-overlay') closeOverlays(); });
}
$('result-edit').addEventListener('click', backToEdit);
$('result-new').addEventListener('click', () => { newJoyride(); startRide(); });
$('new-slope-button').addEventListener('click', newJoyride);
$('result-again').addEventListener('click', startRide);

$('equation-form').addEventListener('submit', submitForm);
for (const id of ['equation-input', 'from-input', 'to-input']) $(id).addEventListener('input', updatePreview);
$('delete-button').addEventListener('click', () => { if (state.selectedPieceId != null) removePiece(state.selectedPieceId); });
$('new-button').addEventListener('click', clearForm);
for (const button of document.querySelectorAll('#keypad button')) {
  button.addEventListener('pointerdown', (event) => event.preventDefault());
  button.addEventListener('click', () => insertAtCaret(button.dataset.insert));
}
const sampleSelect = $('sample-select');
for (const sample of SAMPLE_EQUATIONS) {
  const option = document.createElement('option');
  option.value = JSON.stringify(sample);
  option.textContent = sample.equation;
  sampleSelect.append(option);
}
sampleSelect.addEventListener('change', () => {
  if (!sampleSelect.value) return;
  const sample = JSON.parse(sampleSelect.value);
  state.selectedPieceId = null;
  renderPieceList();
  renderFormState();
  $('equation-input').value = sample.equation.replace(/^y\s*=\s*/, '');
  $('from-input').value = sample.fromX;
  $('to-input').value = sample.toX;
  sampleSelect.value = '';
  updatePreview();
});

// Hold buttons: pressed while a pointer is down on them.
for (const button of document.querySelectorAll('.hold')) {
  const control = button.dataset.control;
  const press = (event) => {
    event.preventDefault();
    capture(button, event.pointerId);
    button.classList.add('active');
    if (control === 'jump') state.jumpBufferSeconds = 0.15;
    else state.touch[control] = true;
    if (control === 'trick') state.jumpBufferSeconds = 0.15;
  };
  const releaseHold = () => {
    button.classList.remove('active');
    if (control !== 'jump') state.touch[control] = false;
  };
  button.addEventListener('pointerdown', press);
  button.addEventListener('pointerup', releaseHold);
  button.addEventListener('pointercancel', releaseHold);
  button.addEventListener('lostpointercapture', releaseHold);
  button.addEventListener('contextmenu', (event) => event.preventDefault());
}

new ResizeObserver(resizeCanvas).observe(canvas);

// ------------------------------------------------------------------ boot

document.body.classList.add('editing');
setTool('pan');
showHelpPage(0);
resizeCanvas();
loadCourse(loadPreference('course', JOYRIDE_ID));
if (!loadPreference('welcomed', false)) {
  savePreference('welcomed', true);
  setTimeout(() => toast('Press Ride. Spin pops and turns; let go to land facing forward.'), 400);
}
requestAnimationFrame(frame);
window.slopeLab = { state, startRide, backToEdit, loadCourse, fitView, advance };
