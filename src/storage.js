// Course files and per-browser progress. Files are versioned; the original
// Skateboarding save format still loads.
import { createEquationPiece, createSketchPiece } from './track.js';

export const SAVE_VERSION = 2;

export function serialiseCourse(courseId, start, pieces) {
  return JSON.stringify({
    format: 'slope-lab',
    version: SAVE_VERSION,
    course: courseId,
    start,
    pieces: pieces.filter((piece) => !piece.locked).map((piece) => (piece.kind === 'equation'
      ? { kind: 'equation', equation: piece.equation, fromX: piece.fromX, toX: piece.toX }
      : { kind: 'sketch', points: piece.polylines[0].map((point) => [round(point.x), round(point.y)]) })),
  }, null, 1);
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

/**
 * Read a saved course. Accepts Slope Lab files and original Skateboarding
 * saves ({ trails, graphs, gpinfo, home }). Returns { courseId, start, pieces }.
 */
export function parseCourseFile(text) {
  const data = JSON.parse(text);
  if (data && data.format === 'slope-lab') return parseCurrent(data);
  if (data && Array.isArray(data.trails) && Array.isArray(data.graphs)) return parseSkateboarding(data);
  throw new Error('This file is not a Slope Lab course');
}

function parseCurrent(data) {
  const pieces = [];
  for (const spec of data.pieces || []) {
    if (spec.kind === 'equation') pieces.push(createEquationPiece(spec.equation, spec.fromX, spec.toX));
    else if (spec.kind === 'sketch' && Array.isArray(spec.points)) {
      const piece = createSketchPiece(spec.points.map(([x, y]) => ({ x, y })), { raw: true });
      if (piece) pieces.push(piece);
    }
  }
  return { courseId: data.course || 'sandbox', start: validPoint(data.start), pieces };
}

function parseSkateboarding(data) {
  const pieces = [];
  for (let index = 0; index < data.trails.length; index += 1) {
    const equation = data.graphs[index];
    const range = (data.gpinfo || [])[index];
    if (equation && range) {
      try {
        pieces.push(createEquationPiece(equation, parseFloat(range[0]), parseFloat(range[1])));
        continue;
      } catch {
        // Fall back to the stored points when the old equation no longer parses.
      }
    }
    const points = (data.trails[index] || []).map((point) => ({ x: parseFloat(point.x), y: parseFloat(point.y) }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    const piece = createSketchPiece(points, { raw: true });
    if (piece) pieces.push(piece);
  }
  const home = data.home || {};
  return { courseId: 'sandbox', start: validPoint({ x: parseFloat(home.x), y: parseFloat(home.y) }), pieces };
}

function validPoint(point) {
  if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) return { x: point.x, y: point.y };
  return null;
}

// Browser storage can be missing or throw (private mode, blocked site data);
// every access degrades to "nothing stored".
function safeStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

export function loadPreference(key, fallback) {
  try {
    const raw = safeStorage()?.getItem(`slopelab.${key}`);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function savePreference(key, value) {
  try {
    safeStorage()?.setItem(`slopelab.${key}`, JSON.stringify(value));
  } catch {
    // Storage full or blocked: progress simply is not remembered.
  }
}

/** Merge newly met stars into the stored best for a course. */
export function recordStars(courseId, metFlags) {
  const progress = loadPreference('stars', {});
  const previous = progress[courseId] || [];
  progress[courseId] = metFlags.map((met, index) => Boolean(met || previous[index]));
  savePreference('stars', progress);
  return progress[courseId];
}
