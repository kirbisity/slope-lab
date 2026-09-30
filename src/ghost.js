// The ghost: a compact recording of a run that can be replayed alongside a
// later attempt. Samples are [time, x, y, pitch, facing] at a fixed cadence
// and replayed by linear interpolation.

export const GHOST_SAMPLE_SECONDS = 0.05;
// 180 s at 20 Hz, the longest run allowed.
export const GHOST_MAX_SAMPLES = 3600;

export function createRecorder() {
  return { samples: [], clock: GHOST_SAMPLE_SECONDS };
}

const round = (value, places) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

/** Record the skier if a sample is due. */
export function recordSample(recorder, time, skier, dt) {
  recorder.clock += dt;
  if (recorder.clock < GHOST_SAMPLE_SECONDS || recorder.samples.length >= GHOST_MAX_SAMPLES) return;
  recorder.clock = 0;
  recorder.samples.push([round(time, 3), round(skier.x, 3), round(skier.y, 3), round(skier.pitch, 3), skier.facing]);
}

/** Interpolated pose at a time, or null outside the recording. */
export function ghostPose(ghost, time) {
  const samples = ghost && ghost.samples;
  if (!samples || samples.length === 0 || time < samples[0][0] || time > samples[samples.length - 1][0]) return null;
  let low = 0;
  let high = samples.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (samples[middle][0] <= time) low = middle; else high = middle;
  }
  const a = samples[low];
  const b = samples[high];
  const span = b[0] - a[0] || 1;
  const t = Math.min(1, Math.max(0, (time - a[0]) / span));
  const pitchStep = Math.atan2(Math.sin(b[3] - a[3]), Math.cos(b[3] - a[3]));
  return { x: a[1] + (b[1] - a[1]) * t, y: a[2] + (b[2] - a[2]) * t, pitch: a[3] + pitchStep * t, facing: t < 0.5 ? a[4] : b[4] };
}

/** A finished run beats the stored ghost when it is faster. */
export function beatsGhost(run, ghost) {
  if (run.status !== 'finished') return false;
  return !ghost || run.time < ghost.time;
}

export function ghostFromRun(run, recorder) {
  return { time: round(run.time, 3), samples: recorder.samples };
}

export function isGhost(value) {
  return Boolean(value) && Number.isFinite(value.time) && Array.isArray(value.samples) && value.samples.every((sample) => Array.isArray(sample) && sample.length === 5);
}
