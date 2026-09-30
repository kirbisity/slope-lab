// A course is a list of pieces; each piece is one or more polylines the
// skier can ride. Equation pieces are regenerated from their text so a save
// file stays small and editable.
import { compileEquation } from './expression.js';
import { TRACKS } from './config.js';

let nextPieceId = 1;

export function newPieceId() {
  const id = nextPieceId;
  nextPieceId += 1;
  return id;
}

function reservePieceId(id) {
  if (id >= nextPieceId) nextPieceId = id + 1;
}

/**
 * Sample y = f(x) over [fromX, toX] at roughly even arc length.
 * Returns an array of polylines: non-finite values and sudden jumps split it.
 */
export function sampleFunction(fn, fromX, toX, spacing = TRACKS.sampleSpacing) {
  const start = Math.min(fromX, toX);
  const end = Math.max(fromX, toX);
  const polylines = [];
  let current = [];
  let x = start;
  let points = 0;
  const finish = () => {
    if (current.length >= 2) polylines.push(current);
    current = [];
  };
  while (points < TRACKS.maxPoints) {
    const clampedX = Math.min(x, end);
    const y = fn(clampedX);
    const previous = current[current.length - 1];
    if (!Number.isFinite(y) || Math.abs(y) > 1e5) {
      finish();
    } else {
      if (previous && Math.abs(y - previous.y) > TRACKS.maxStepRise) finish();
      current.push({ x: clampedX, y });
      points += 1;
    }
    if (clampedX >= end) break;
    // Step so the arc length, not just x, advances by about one spacing.
    const probe = Math.min(end, clampedX + spacing * 0.25);
    const yProbe = fn(probe);
    let slope = Number.isFinite(y) && Number.isFinite(yProbe) ? (yProbe - y) / (probe - clampedX || 1) : 0;
    if (!Number.isFinite(slope)) slope = 0;
    x = clampedX + Math.max(spacing / 40, spacing / Math.sqrt(1 + slope * slope));
  }
  finish();
  return polylines;
}

/** Build a piece from an equation. Throws ExpressionError on bad input. */
export function createEquationPiece(equation, fromX, toX, options = {}) {
  const from = Number(fromX);
  const to = Number(toX);
  if (!Number.isFinite(from) || !Number.isFinite(to)) throw new RangeError('Enter numbers for the x range');
  if (from === to) throw new RangeError('The x range needs two different ends');
  if (Math.abs(to - from) > TRACKS.maxRangeWidth) throw new RangeError(`Keep the x range under ${TRACKS.maxRangeWidth} m`);
  const fn = compileEquation(equation);
  const polylines = sampleFunction(fn, from, to);
  if (polylines.length === 0) throw new RangeError('That equation has no real values in this x range');
  const id = options.id ?? newPieceId();
  reservePieceId(id);
  return {
    id,
    kind: 'equation',
    equation: equation.trim(),
    fromX: Math.min(from, to),
    toX: Math.max(from, to),
    locked: Boolean(options.locked),
    polylines,
  };
}

/** Smooth a hand-drawn stroke and resample it at even spacing. */
export function smoothStroke(points, passes = TRACKS.sketchSmoothingPasses, spacing = TRACKS.sketchSpacing) {
  let stroke = resample(points, spacing);
  // A [1 2 1] binomial pass keeps the ends fixed and damps a wiggle of
  // wavelength L by cos²(π·spacing/L): hand jitter under a metre all but
  // vanishes, while a 4 m hump keeps most of its height after six passes.
  for (let pass = 0; pass < passes && stroke.length > 2; pass += 1) {
    const filtered = [stroke[0]];
    for (let index = 1; index < stroke.length - 1; index += 1) {
      const a = stroke[index - 1];
      const b = stroke[index];
      const c = stroke[index + 1];
      filtered.push({ x: (a.x + 2 * b.x + c.x) / 4, y: (a.y + 2 * b.y + c.y) / 4 });
    }
    filtered.push(stroke[stroke.length - 1]);
    stroke = filtered;
  }
  return resample(stroke, spacing);
}

export function resample(points, spacing) {
  if (points.length < 2) return points.slice();
  const output = [{ ...points[0] }];
  let carried = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    let along = spacing - carried;
    while (along <= length) {
      const t = along / length;
      output.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      along += spacing;
    }
    carried = length - (along - spacing);
  }
  const last = points[points.length - 1];
  const tail = output[output.length - 1];
  if (Math.hypot(last.x - tail.x, last.y - tail.y) > spacing * 0.3) output.push({ ...last });
  else output[output.length - 1] = { ...last };
  return output;
}

export function createSketchPiece(points, options = {}) {
  const smoothed = options.raw ? points.map((p) => ({ x: p.x, y: p.y })) : smoothStroke(points);
  if (smoothed.length < 2) return null;
  const id = options.id ?? newPieceId();
  reservePieceId(id);
  return { id, kind: 'sketch', equation: '', locked: Boolean(options.locked), polylines: [smoothed] };
}

export function polylineLength(points) {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
  }
  return total;
}

export function pieceLength(piece) {
  return piece.polylines.reduce((sum, polyline) => sum + polylineLength(polyline), 0);
}

/** Flatten a course into rideable polylines with bounding boxes for pruning. */
export function buildSurfaces(pieces) {
  const surfaces = [];
  for (const piece of pieces) {
    for (const points of piece.polylines) {
      let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
      for (const point of points) {
        minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
        minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
      }
      surfaces.push({ pieceId: piece.id, locked: piece.locked, points, minX, maxX, minY, maxY });
    }
  }
  return surfaces;
}

/** Shortest distance from a point to any segment of a piece. */
export function distanceToPiece(piece, point) {
  let best = Infinity;
  for (const points of piece.polylines) {
    for (let index = 1; index < points.length; index += 1) {
      best = Math.min(best, distanceToSegment(point, points[index - 1], points[index]));
    }
  }
  return best;
}

export function distanceToSegment(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy || 1e-12;
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
}

/** Highest surface point directly below (x, y), or null. Used for shadows. */
export function groundBelow(surfaces, x, y) {
  let best = null;
  for (const surface of surfaces) {
    if (x < surface.minX || x > surface.maxX || surface.minY > y) continue;
    const points = surface.points;
    for (let index = 1; index < points.length; index += 1) {
      const a = points[index - 1];
      const b = points[index];
      if ((x < a.x && x < b.x) || (x > a.x && x > b.x) || a.x === b.x) continue;
      const t = (x - a.x) / (b.x - a.x);
      const groundY = a.y + (b.y - a.y) * t;
      if (groundY <= y + 0.05 && (!best || groundY > best.y)) {
        best = { x, y: groundY, slope: Math.atan2(b.y - a.y, b.x - a.x) };
      }
    }
  }
  return best;
}

export function courseBounds(pieces) {
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  for (const piece of pieces) {
    for (const points of piece.polylines) {
      for (const point of points) {
        minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
        minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
      }
    }
  }
  if (!Number.isFinite(minX)) return { minX: -10, maxX: 10, minY: -5, maxY: 5 };
  return { minX, maxX, minY, maxY };
}
