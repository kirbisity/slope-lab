import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRecorder, recordSample, ghostPose, beatsGhost, ghostFromRun, isGhost, GHOST_SAMPLE_SECONDS, GHOST_MAX_SAMPLES } from '../src/ghost.js';
import { CHALLENGES } from '../src/courses.js';
import { createEquationPiece, buildSurfaces } from '../src/track.js';
import { createRun, stepRun } from '../src/run.js';
import { PHYSICS } from '../src/config.js';

function rideWithRecorder(course) {
  const pieces = [...course.pieces, ...course.solution].map((spec) => createEquationPiece(spec.equation, spec.fromX, spec.toX, { locked: true }));
  const run = createRun(course, pieces, buildSurfaces(pieces));
  const recorder = createRecorder();
  const truth = [];
  while (run.status === 'running' && run.time < 60) {
    stepRun(run, {});
    recordSample(recorder, run.time, run.skier, PHYSICS.stepSeconds);
    truth.push({ time: run.time, x: run.skier.x, y: run.skier.y });
  }
  return { run, recorder, truth };
}

test('a recorded ghost replays the run it recorded', () => {
  const { run, recorder, truth } = rideWithRecorder(CHALLENGES[1]);
  assert.equal(run.status, 'finished');
  const ghost = ghostFromRun(run, recorder);
  assert.ok(isGhost(ghost));
  let worst = 0;
  for (const point of truth.filter((_, index) => index % 7 === 0)) {
    const pose = ghostPose(ghost, point.time);
    if (!pose) continue;
    worst = Math.max(worst, Math.hypot(pose.x - point.x, pose.y - point.y));
  }
  // At 20 m/s a 0.05 s cadence spans a metre; interpolation stays well inside it.
  assert.ok(worst < 0.25, `ghost strays ${worst.toFixed(3)} m`);
});

test('samples arrive at the fixed cadence and stop at the cap', () => {
  const recorder = createRecorder();
  const skier = { x: 0, y: 0, pitch: 0, facing: 1 };
  for (let step = 0; step < 240; step += 1) recordSample(recorder, step / 240, skier, 1 / 240);
  assert.ok(Math.abs(recorder.samples.length - 1 / GHOST_SAMPLE_SECONDS) <= 1);
  const full = { samples: new Array(GHOST_MAX_SAMPLES).fill([0, 0, 0, 0, 1]), clock: 1 };
  recordSample(full, 1, skier, 1);
  assert.equal(full.samples.length, GHOST_MAX_SAMPLES);
});

test('only a faster finished run replaces the ghost', () => {
  assert.equal(beatsGhost({ status: 'crashed', time: 1 }, null), false);
  assert.equal(beatsGhost({ status: 'finished', time: 9 }, null), true);
  assert.equal(beatsGhost({ status: 'finished', time: 9 }, { time: 8 }), false);
  assert.equal(beatsGhost({ status: 'finished', time: 7 }, { time: 8 }), true);
});

test('outside the recording there is no ghost', () => {
  const ghost = { time: 1, samples: [[0, 0, 0, 0, 1], [1, 10, -5, 0, 1]] };
  assert.equal(ghostPose(ghost, -0.1), null);
  assert.equal(ghostPose(ghost, 1.1), null);
  assert.deepEqual(ghostPose(ghost, 0.5), { x: 5, y: -2.5, pitch: 0, facing: 1 });
  assert.equal(isGhost({ time: 1, samples: [[1, 2]] }), false);
});
