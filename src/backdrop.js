// The mountain range behind the course, built the way Greatwall builds its
// landscape: a height field, sampled on a grid anchored to world
// coordinates, lit per triangle by the sun, banded into forest, rock and
// snow, hazed by distance, and painted far to near.
import { BACKDROP } from './config.js';

export const BACKDROP_ROWS = BACKDROP.rowCount;

// Light from the upper right, a little toward the camera: faces turned to
// the right and up are sunlit, left-facing slopes fall into blue shadow.
const SUN = normalise(0.62, 0.68, -0.4);
const AMBIENT = 0.42;
const LIGHT_BANDS = 14;

// Colours as [r, g, b]. Shadows lean blue, as snow shadows do under a blue sky.
const MATERIALS = {
  snow: { lit: [250, 252, 255], shadow: [150, 176, 216] },
  rock: { lit: [148, 156, 172], shadow: [72, 84, 110] },
  forest: { lit: [58, 108, 86], shadow: [26, 58, 58] },
};
// Air seen through a long way is blue, not white: distant ridges step back
// in blue while their sunlit snow still reads bright.
const HAZE = [196, 220, 246];

function normalise(x, y, z) {
  const length = Math.hypot(x, y, z) || 1;
  return { x: x / length, y: y / length, z: z / length };
}

function hash(x, y) {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

function valueNoise(x, y) {
  const cellX = Math.floor(x);
  const cellY = Math.floor(y);
  const fx = smooth(x - cellX);
  const fy = smooth(y - cellY);
  const top = hash(cellX, cellY) + (hash(cellX + 1, cellY) - hash(cellX, cellY)) * fx;
  const bottom = hash(cellX, cellY + 1) + (hash(cellX + 1, cellY + 1) - hash(cellX, cellY + 1)) * fx;
  return top + (bottom - top) * fy;
}

/** Ridged noise: creases where the noise crosses its middle become ridgelines. */
function ridged(x, y) {
  let total = 0;
  let amplitude = 1;
  let frequency = 1;
  let norm = 0;
  for (let octave = 0; octave < BACKDROP.noiseOctaves; octave += 1) {
    const ridge = 1 - Math.abs(2 * valueNoise(x * frequency, y * frequency) - 1);
    total += ridge * ridge * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2.1;
  }
  return total / norm;
}

/** Ground height (m) of the range at world x and depth behind the course. */
export function heightAt(x, depth) {
  const span = BACKDROP.farDepth - BACKDROP.nearDepth;
  const back = Math.min(1, Math.max(0, (depth - BACKDROP.nearDepth) / span));
  const envelope = BACKDROP.foothillShare + (1 - BACKDROP.foothillShare) * smooth(Math.min(1, back * 1.6));
  const shape = ridged(x / 420, depth / 420);
  // In front of the main range the land flattens toward the camera.
  const foreground = Math.min(1, depth / BACKDROP.nearDepth) ** 2;
  return Math.max(0, BACKDROP.peakHeight * envelope * (shape * 1.35 - 0.2)) * foreground;
}

/** The backdrop camera for this frame, derived from the course camera. */
export function createBackdropView(camera) {
  return {
    eyeX: camera.x,
    eyeHeight: BACKDROP.eyeHeight + camera.y * BACKDROP.verticalParallax,
    focal: Math.max(camera.width, camera.height) * BACKDROP.focalShare,
    horizonY: camera.height * BACKDROP.horizonShare,
    width: camera.width,
    height: camera.height,
  };
}

/** Pinhole projection looking level into the range. */
export function projectBackdrop(view, x, height, depth) {
  const scale = view.focal / depth;
  return { x: view.width / 2 + (x - view.eyeX) * scale, y: view.horizonY - (height - view.eyeHeight) * scale };
}

function rowDepths() {
  const depths = [];
  for (let row = 0; row < BACKDROP.foregroundRows; row += 1) {
    const t = row / BACKDROP.foregroundRows;
    depths.push(BACKDROP.foregroundDepth + (BACKDROP.nearDepth - BACKDROP.foregroundDepth) * t);
  }
  for (let row = 0; row < BACKDROP.rowCount; row += 1) {
    const t = row / (BACKDROP.rowCount - 1);
    depths.push(BACKDROP.nearDepth + (BACKDROP.farDepth - BACKDROP.nearDepth) * t * t);
  }
  return depths;
}

function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function toRgb(colour) {
  return `rgb(${Math.round(colour[0])},${Math.round(colour[1])},${Math.round(colour[2])})`;
}

function materialFor(height, slope) {
  if (height > BACKDROP.snowLine && slope < BACKDROP.snowMaxSlope) return 'snow';
  if (height < BACKDROP.treeLine) return 'forest';
  return 'rock';
}

function shadeTriangle(a, b, c, depth) {
  const ux = b.worldX - a.worldX; const uy = b.height - a.height; const uz = b.depth - a.depth;
  const vx = c.worldX - a.worldX; const vy = c.height - a.height; const vz = c.depth - a.depth;
  let normal = normalise(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  if (normal.y < 0) normal = { x: -normal.x, y: -normal.y, z: -normal.z };
  const lambert = Math.max(0, normal.x * SUN.x + normal.y * SUN.y + normal.z * SUN.z);
  // Light in bands, as Greatwall does: neighbours share a colour, which lets
  // the renderer batch them into one path and hides grid seams.
  const light = Math.round((AMBIENT + (1 - AMBIENT) * lambert) * LIGHT_BANDS) / LIGHT_BANDS;
  const height = (a.height + b.height + c.height) / 3;
  const slope = Math.sqrt(1 - normal.y * normal.y) / Math.max(0.05, normal.y);
  const material = materialFor(height, slope);
  const base = mix(MATERIALS[material].shadow, MATERIALS[material].lit, Math.min(1, light));
  const back = Math.max(0, (depth - BACKDROP.nearDepth) / (BACKDROP.farDepth - BACKDROP.nearDepth));
  const haze = BACKDROP.nearHaze + (BACKDROP.farHaze - BACKDROP.nearHaze) * back;
  return { fill: toRgb(mix(base, HAZE, haze)), material, haze, height };
}

// The grid is anchored to the world, so a vertex's height and a facet's
// colour never change: remember them, and a redraw only projects.
const heightCache = new Map();
const shadeCache = new Map();

function cachedHeight(column, row, worldX, depth) {
  const key = column * 64 + row;
  let height = heightCache.get(key);
  if (height === undefined) {
    height = heightAt(worldX, depth);
    heightCache.set(key, height);
  }
  return height;
}

function cachedShade(column, row, half, a, b, c, depth) {
  const key = (column * 64 + row) * 2 + half;
  let shade = shadeCache.get(key);
  if (shade === undefined) {
    shade = shadeTriangle(a, b, c, depth);
    shadeCache.set(key, shade);
  }
  return shade;
}

/**
 * Sample the range for this view: rows from far to near, columns on a
 * world-anchored grid wide enough for each row's view. Returns the rows (for
 * coverage), the vertices, and the triangles in paint order.
 */
export function buildBackdrop(view) {
  const depths = rowDepths();
  const spacing = BACKDROP.columnSpacing;
  // The farthest row sees the widest slice of world; every row shares its columns.
  const halfSpan = (view.width / 2 + 2) * (BACKDROP.farDepth / view.focal) + spacing;
  const firstColumn = Math.floor((view.eyeX - halfSpan) / spacing);
  const lastColumn = Math.ceil((view.eyeX + halfSpan) / spacing);
  const grid = depths.map((depth, rowIndex) => {
    const row = [];
    for (let column = firstColumn; column <= lastColumn; column += 1) {
      const worldX = column * spacing;
      const height = cachedHeight(column, rowIndex, worldX, depth);
      const screen = projectBackdrop(view, worldX, height, depth);
      row.push({ worldX, height, depth, x: screen.x, y: screen.y, column });
    }
    return row;
  });

  const rows = grid.map((row) => ({ depth: row[0].depth, minScreenX: row[0].x, maxScreenX: row[row.length - 1].x }));
  const triangles = [];
  for (let rowIndex = grid.length - 1; rowIndex > 0; rowIndex -= 1) {
    const back = grid[rowIndex];
    const front = grid[rowIndex - 1];
    const depth = (back[0].depth + front[0].depth) / 2;
    for (let column = 0; column < back.length - 1; column += 1) {
      const quad = [back[column], back[column + 1], front[column + 1], front[column]];
      // Skip quads wholly off either side of the screen.
      if (Math.max(quad[0].x, quad[1].x, quad[2].x, quad[3].x) < -2 || Math.min(quad[0].x, quad[1].x, quad[2].x, quad[3].x) > view.width + 2) continue;
      [[quad[0], quad[1], quad[2]], [quad[0], quad[2], quad[3]]].forEach(([a, b, c], half) => {
        triangles.push({ points: [a, b, c], depth, ...cachedShade(back[column].column, rowIndex, half, a, b, c, depth) });
      });
    }
  }
  triangles.push(...skirtBelow(grid[0], grid[1], view));
  return { rows, vertices: grid.flat(), triangles };
}

/**
 * The hillside continuing down from the nearest row to past the bottom of
 * the screen, in the colours of the facets just above it, so the course
 * never floats over an empty valley. Painted last: it is the nearest land.
 */
function skirtBelow(front, behind, view) {
  const skirt = [];
  const bottomY = view.height + BACKDROP.skirtPixelsBelow;
  for (let column = 0; column < front.length - 1; column += 1) {
    const left = front[column];
    const right = front[column + 1];
    const { fill, material, haze, height } = cachedShade(left.column, 63, 0, left, right, behind[column], left.depth);
    const foot = (point) => {
      if (point.y >= bottomY) return { ...point };
      const worldHeight = view.eyeHeight - (bottomY - view.horizonY) * (point.depth / view.focal);
      return { worldX: point.worldX, height: worldHeight, depth: point.depth, x: point.x, y: bottomY };
    };
    const leftFoot = foot(left);
    const rightFoot = foot(right);
    skirt.push({ points: [left, right, rightFoot], depth: left.depth, fill, material, haze, height });
    skirt.push({ points: [left, rightFoot, leftFoot], depth: left.depth, fill, material, haze, height });
  }
  return skirt;
}

// The depth whose parallax a cached backdrop is slid by: between the rows,
// so near ridges lag and far ones lead by about the same few pixels.
const MIDDLE_DEPTH = 2 / (1 / BACKDROP.nearDepth + 1 / BACKDROP.farDepth);

/**
 * How many pixels near and far ridges would be out of place if a backdrop
 * drawn for `cached` were slid to stand in for `view`. Infinity when the
 * screen itself changed.
 */
export function backdropDrift(cached, view) {
  if (!cached || cached.width !== view.width || cached.height !== view.height || cached.focal !== view.focal) return Infinity;
  const spread = view.focal * (1 / BACKDROP.nearDepth - 1 / BACKDROP.farDepth);
  return Math.hypot(view.eyeX - cached.eyeX, view.eyeHeight - cached.eyeHeight) * spread;
}

/** The slide that moves a cached backdrop to `view`, at the middle depth. */
export function cacheShift(cached, view) {
  const scale = view.focal / MIDDLE_DEPTH;
  return { x: -(view.eyeX - cached.eyeX) * scale, y: (view.eyeHeight - cached.eyeHeight) * scale };
}
