// The mountain range behind the course, built the way Greatwall builds its
// landscape: a height field, sampled on a grid anchored to world
// coordinates, lit per triangle by the sun, banded into forest, rock and
// snow, hazed by distance, and painted far to near.
import { BACKDROP } from './config.js';

export const BACKDROP_ROWS = BACKDROP.rowCount;

// Light from the upper right, a little toward the camera: faces turned to
// the right and up are sunlit, left-facing slopes fall into blue shadow.
const SUN = normalise(0.62, 0.68, -0.4);
const AMBIENT = 0.26;

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

/**
 * Ridged noise with its creases rounded: where the noise crosses its middle
 * it makes a ridgeline, but |x| is blended into a smooth curve there so the
 * crest is a rounded shoulder rather than a knife edge. Each octave adds
 * less than the last, so fine detail leans on the broad shape.
 */
function ridged(x, y) {
  let total = 0;
  let amplitude = 1;
  let frequency = 1;
  let norm = 0;
  for (let octave = 0; octave < BACKDROP.noiseOctaves; octave += 1) {
    const centred = 2 * valueNoise(x * frequency, y * frequency) - 1;
    // Rescaled so a rounded crest still reaches 1.
    const ridge = Math.max(0, (1 - Math.sqrt(centred * centred + BACKDROP.ridgeRounding)) / (1 - Math.sqrt(BACKDROP.ridgeRounding)));
    total += ridge ** BACKDROP.ridgePower * amplitude;
    norm += amplitude;
    amplitude *= BACKDROP.octaveDecay;
    frequency *= 2.1;
  }
  return total / norm;
}

/** Ground height (m) of the range at world x and depth behind the course. */
export function heightAt(x, depth) {
  const span = BACKDROP.farDepth - BACKDROP.nearDepth;
  const back = Math.min(1, Math.max(0, (depth - BACKDROP.nearDepth) / span));
  const envelope = BACKDROP.foothillShare + (1 - BACKDROP.foothillShare) * smooth(Math.min(1, back * 1.6));
  const shape = ridged(x / BACKDROP.featureSize, depth / BACKDROP.featureSize);
  // In front of the main range the land flattens toward the camera.
  const foreground = Math.min(1, depth / BACKDROP.nearDepth) ** 2;
  return Math.max(0, BACKDROP.peakHeight * envelope * (shape * BACKDROP.shapeGain - BACKDROP.shapeLift)) * foreground;
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

function ramp(value, from, to) {
  return smooth(Math.min(1, Math.max(0, (value - from) / (to - from))));
}

/**
 * How much of each material covers ground at this height and steepness.
 * The bands blend into one another over materialBlendMetres, so snow fades
 * into rock and rock into forest instead of changing colour triangle by
 * triangle, which drew the boundary as a sawtooth.
 */
function materialMix(height, slope) {
  const blend = BACKDROP.materialBlendMetres;
  const steep = 1 - ramp(slope, BACKDROP.snowMaxSlope * 0.7, BACKDROP.snowMaxSlope * 1.3);
  const snow = ramp(height, BACKDROP.snowLine - blend, BACKDROP.snowLine + blend) * steep;
  const forest = (1 - ramp(height, BACKDROP.treeLine - blend / 2, BACKDROP.treeLine + blend / 2)) * (1 - snow);
  return { snow, forest, rock: Math.max(0, 1 - snow - forest) };
}

function dominant(weights) {
  return Object.keys(weights).reduce((best, name) => (weights[name] > weights[best] ? name : best), 'rock');
}

/**
 * The colour of the ground at one grid vertex, from its own height, the
 * normal of the land around it (from neighbouring heights, so adjacent
 * facets agree on a shared vertex) and its depth. Colour changes across a
 * triangle by interpolating between its three vertices (Gouraud), so the
 * lighting and the snow, rock and forest bands change gradually rather than
 * facet by facet.
 */
function shadeVertex(height, slopeX, slopeZ, depth) {
  const normal = normalise(-slopeX * BACKDROP.shadingRelief, 1, -slopeZ * BACKDROP.shadingRelief);
  const lambert = Math.max(0, normal.x * SUN.x + normal.y * SUN.y + normal.z * SUN.z);
  const light = AMBIENT + (1 - AMBIENT) * lambert;
  // Whether snow stays is about the real slope, not the exaggerated one.
  const steepness = Math.hypot(slopeX, slopeZ);
  const weights = materialMix(height, steepness);
  let base = [0, 0, 0];
  for (const name of Object.keys(weights)) {
    const colour = mix(MATERIALS[name].shadow, MATERIALS[name].lit, Math.min(1, light));
    base = [base[0] + colour[0] * weights[name], base[1] + colour[1] * weights[name], base[2] + colour[2] * weights[name]];
  }
  const back = Math.max(0, (depth - BACKDROP.nearDepth) / (BACKDROP.farDepth - BACKDROP.nearDepth));
  const haze = BACKDROP.nearHaze + (BACKDROP.farHaze - BACKDROP.nearHaze) * back;
  return { colour: mix(base, HAZE, haze), weights, haze };
}

/** A triangle's summary from its three vertices: the mean colour for a flat fill, and its dominant material. */
function summarise(a, b, c) {
  const average = (pick) => (pick(a) + pick(b) + pick(c)) / 3;
  const weights = { snow: average((v) => v.weights.snow), forest: average((v) => v.weights.forest), rock: average((v) => v.weights.rock) };
  const colour = [average((v) => v.colour[0]), average((v) => v.colour[1]), average((v) => v.colour[2])];
  return { fill: toRgb(colour), colours: [a.colour, b.colour, c.colour], material: dominant(weights), haze: average((v) => v.haze), height: average((v) => v.height) };
}

// The grid is anchored to the world, so a vertex's height and a facet's
// colour never change: remember them, and a redraw only projects.
const heightCache = new Map();
const vertexCache = new Map();
const DEPTHS = rowDepths();

function cachedHeight(column, row) {
  const key = column * 64 + row;
  let height = heightCache.get(key);
  if (height === undefined) {
    height = heightAt(column * BACKDROP.columnSpacing, DEPTHS[row]);
    heightCache.set(key, height);
  }
  return height;
}

// Height, slope and colour of one vertex, with slopes taken across the
// neighbouring vertices so two facets meeting here agree about its shading.
function cachedVertex(column, row) {
  const key = column * 64 + row;
  let vertex = vertexCache.get(key);
  if (vertex === undefined) {
    const spacing = BACKDROP.columnSpacing;
    const before = Math.max(0, row - 1);
    const after = Math.min(DEPTHS.length - 1, row + 1);
    const slopeX = (cachedHeight(column + 1, row) - cachedHeight(column - 1, row)) / (2 * spacing);
    const slopeZ = (cachedHeight(column, after) - cachedHeight(column, before)) / (DEPTHS[after] - DEPTHS[before]);
    const height = cachedHeight(column, row);
    vertex = { height, ...shadeVertex(height, slopeX, slopeZ, DEPTHS[row]) };
    vertexCache.set(key, vertex);
  }
  return vertex;
}

/**
 * Sample the range for this view: rows from far to near, columns on a
 * world-anchored grid wide enough for each row's view. Returns the rows (for
 * coverage), the vertices, and the triangles in paint order.
 */
export function buildBackdrop(view) {
  const depths = DEPTHS;
  const spacing = BACKDROP.columnSpacing;
  // The farthest row sees the widest slice of world; every row shares its columns.
  const halfSpan = (view.width / 2 + 2) * (BACKDROP.farDepth / view.focal) + spacing;
  const firstColumn = Math.floor((view.eyeX - halfSpan) / spacing);
  const lastColumn = Math.ceil((view.eyeX + halfSpan) / spacing);
  const grid = depths.map((depth, rowIndex) => {
    const row = [];
    for (let column = firstColumn; column <= lastColumn; column += 1) {
      const worldX = column * spacing;
      const { height, colour, weights, haze } = cachedVertex(column, rowIndex);
      const screen = projectBackdrop(view, worldX, height, depth);
      row.push({ worldX, height, depth, x: screen.x, y: screen.y, column, colour, weights, haze });
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
        triangles.push({ points: [a, b, c], depth, ...summarise(a, b, c) });
      });
    }
  }
  triangles.push(...skirtBelow(grid[0], view));
  return { rows, vertices: grid.flat(), triangles };
}

/**
 * The hillside continuing down from the nearest row to past the bottom of
 * the screen, in the colours of the facets just above it, so the course
 * never floats over an empty valley. Painted last: it is the nearest land.
 */
function skirtBelow(front, view) {
  const skirt = [];
  const bottomY = view.height + BACKDROP.skirtPixelsBelow;
  for (let column = 0; column < front.length - 1; column += 1) {
    const left = front[column];
    const right = front[column + 1];
    const foot = (point) => {
      if (point.y >= bottomY) return { ...point };
      const worldHeight = view.eyeHeight - (bottomY - view.horizonY) * (point.depth / view.focal);
      return { ...point, height: worldHeight, y: bottomY };
    };
    const leftFoot = foot(left);
    const rightFoot = foot(right);
    skirt.push({ points: [left, right, rightFoot], depth: left.depth, ...summarise(left, right, rightFoot) });
    skirt.push({ points: [left, rightFoot, leftFoot], depth: left.depth, ...summarise(left, rightFoot, leftFoot) });
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

/**
 * Paint triangles with colour running smoothly between their vertex colours
 * (Gouraud shading) into an RGBA pixel buffer, far to near. `scale` maps the
 * view's pixels onto the buffer's. Canvas paths can only fill flat, and a
 * gradient per triangle costs far more than this.
 */
export function rasteriseGouraud(image, width, height, scale, triangles) {
  const epsilon = 1e-4;
  for (const { points, colours } of triangles) {
    const [a, b, c] = points;
    const x0 = a.x * scale; const y0 = a.y * scale;
    const x1 = b.x * scale; const y1 = b.y * scale;
    const x2 = c.x * scale; const y2 = c.y * scale;
    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
    const maxX = Math.min(width - 1, Math.ceil(Math.max(x0, x1, x2)));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
    const maxY = Math.min(height - 1, Math.ceil(Math.max(y0, y1, y2)));
    if (minX > maxX || minY > maxY) continue;
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(area) < 1e-9) continue;
    const inverse = 1 / area;
    const dBdX = (y2 - y0) * inverse;
    const dCdX = -(y1 - y0) * inverse;
    const [ca, cb, cc] = colours;
    for (let y = minY; y <= maxY; y += 1) {
      const py = y + 0.5 - y0;
      const px = minX + 0.5 - x0;
      let weightB = (px * (y2 - y0) - py * (x2 - x0)) * inverse;
      let weightC = ((x1 - x0) * py - (y1 - y0) * px) * inverse;
      let offset = (y * width + minX) * 4;
      for (let x = minX; x <= maxX; x += 1) {
        const weightA = 1 - weightB - weightC;
        if (weightA >= -epsilon && weightB >= -epsilon && weightC >= -epsilon) {
          image[offset] = weightA * ca[0] + weightB * cb[0] + weightC * cc[0];
          image[offset + 1] = weightA * ca[1] + weightB * cb[1] + weightC * cc[1];
          image[offset + 2] = weightA * ca[2] + weightB * cb[2] + weightC * cc[2];
          image[offset + 3] = 255;
        }
        weightB += dBdX;
        weightC += dCdX;
        offset += 4;
      }
    }
  }
}
