// Draws the 2.5D scene. Everything is procedural: no images to load.
import { VIEW, COLORS, PHYSICS } from './config.js';
import { project } from './camera.js';
import { groundBelow } from './track.js';
import { createBackdropView, buildBackdrop, backdropDrift, cacheShift } from './backdrop.js';
import { BACKDROP, BODY } from './config.js';
import { posedJoints, placeJoints, ragdollJoints, buildSkierMesh, faceNormal, isFrontFacing, MODEL_PALETTE, GHOST_MODEL_PALETTE } from './model.js';
import { sweepSurfaces, dragCoefficient } from './physics.js';

const SNOW_LIT = [250, 252, 255];
const SNOW_SHADE = [150, 176, 214];
const LIGHT = normalise(-0.45, 0.89);

function normalise(x, y) {
  const length = Math.hypot(x, y);
  return { x: x / length, y: y / length };
}

function mix(a, b, t) {
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
}

function hash(value) {
  const s = Math.sin(value * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// ---------------------------------------------------------------- backdrop

// A brighter, "HDR" sky: a saturated zenith falling to an overexposed,
// almost white horizon, and a sun that blooms past its disc.
const SKY = {
  zenith: '#1d63c9',
  upper: '#4f97e6',
  lower: '#a9d4f7',
  horizon: '#f6fbff',
  sunX: 0.8,
  sunY: 0.17,
};

function drawSky(ctx, camera, view) {
  const { width, height } = camera;
  const horizon = Math.min(height, Math.max(0, view.horizonY));
  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, SKY.zenith);
  sky.addColorStop(0.45, SKY.upper);
  sky.addColorStop(0.82, SKY.lower);
  sky.addColorStop(1, SKY.horizon);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, horizon + 1);
  // Below the horizon: a snowy valley in soft blue shade, so the sunlit
  // course lanes stay the brightest thing on screen.
  const valley = ctx.createLinearGradient(0, horizon, 0, height);
  valley.addColorStop(0, '#d7e7f6');
  valley.addColorStop(1, '#9db8d9');
  ctx.fillStyle = valley;
  ctx.fillRect(0, horizon, width, height - horizon);

  const sunX = width * SKY.sunX;
  const sunY = height * SKY.sunY;
  const reach = Math.max(width, height);
  const bloom = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, reach * 0.6);
  bloom.addColorStop(0, 'rgba(255,253,240,1)');
  bloom.addColorStop(0.03, 'rgba(255,250,230,0.95)');
  bloom.addColorStop(0.09, 'rgba(255,244,214,0.55)');
  bloom.addColorStop(0.3, 'rgba(255,240,215,0.16)');
  bloom.addColorStop(1, 'rgba(255,240,215,0)');
  ctx.fillStyle = bloom;
  ctx.fillRect(0, 0, width, height);
}

function drawBackdrop(ctx, camera, view) {
  const { triangles } = buildBackdrop(view);
  ctx.save();
  ctx.lineJoin = 'round';
  // Consecutive triangles of one colour share a path; the matching stroke
  // closes the anti-aliased hairlines between neighbours.
  let current = null;
  const flush = () => {
    if (current === null) return;
    ctx.fill();
    ctx.stroke();
  };
  for (const triangle of triangles) {
    if (triangle.fill !== current) {
      flush();
      current = triangle.fill;
      ctx.fillStyle = current;
      ctx.strokeStyle = current;
      ctx.lineWidth = 0.9;
      ctx.beginPath();
    }
    const [a, b, c] = triangle.points;
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.closePath();
  }
  flush();

  // Air between us and the range: low haze over the valley floor, and the
  // sun's glare washing over the peaks nearest it.
  const horizon = view.horizonY;
  const hazeTop = horizon - camera.height * 0.1;
  const haze = ctx.createLinearGradient(0, hazeTop, 0, camera.height);
  haze.addColorStop(0, 'rgba(232,243,253,0)');
  haze.addColorStop(0.3, 'rgba(232,243,253,0.4)');
  haze.addColorStop(1, 'rgba(170,196,226,0.55)');
  ctx.fillStyle = haze;
  ctx.fillRect(0, hazeTop, camera.width, camera.height - hazeTop);
  ctx.globalCompositeOperation = 'lighter';
  const sunX = camera.width * SKY.sunX;
  const sunY = camera.height * SKY.sunY;
  const glare = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, Math.max(camera.width, camera.height) * 0.45);
  glare.addColorStop(0, 'rgba(90,80,50,0.35)');
  glare.addColorStop(1, 'rgba(90,80,50,0)');
  ctx.fillStyle = glare;
  ctx.fillRect(0, 0, camera.width, camera.height);
  ctx.restore();
}

function niceStep(pixelsPerMeter) {
  const target = 70 / pixelsPerMeter;
  const power = Math.pow(10, Math.floor(Math.log10(target)));
  for (const multiple of [1, 2, 5, 10]) if (multiple * power >= target) return multiple * power;
  return 10 * power;
}

function drawGrid(ctx, camera, editing) {
  const step = niceStep(camera.pixelsPerMeter);
  const topLeft = { x: camera.x - camera.width / 2 / camera.pixelsPerMeter, y: camera.y + camera.height / 2 / camera.pixelsPerMeter };
  const bottomRight = { x: camera.x + camera.width / 2 / camera.pixelsPerMeter, y: camera.y - camera.height / 2 / camera.pixelsPerMeter };
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = editing ? 'rgba(20,40,70,0.13)' : 'rgba(20,40,70,0.05)';
  ctx.beginPath();
  for (let x = Math.ceil(topLeft.x / step) * step; x <= bottomRight.x; x += step) {
    const screen = project(camera, x, 0);
    ctx.moveTo(Math.round(screen.x) + 0.5, 0);
    ctx.lineTo(Math.round(screen.x) + 0.5, camera.height);
  }
  for (let y = Math.floor(topLeft.y / step) * step; y >= bottomRight.y; y -= step) {
    const screen = project(camera, 0, y);
    ctx.moveTo(0, Math.round(screen.y) + 0.5);
    ctx.lineTo(camera.width, Math.round(screen.y) + 0.5);
  }
  ctx.stroke();
  const origin = project(camera, 0, 0);
  ctx.strokeStyle = editing ? 'rgba(20,40,70,0.42)' : 'rgba(20,40,70,0.12)';
  ctx.beginPath();
  ctx.moveTo(origin.x, 0); ctx.lineTo(origin.x, camera.height);
  ctx.moveTo(0, origin.y); ctx.lineTo(camera.width, origin.y);
  ctx.stroke();
  if (editing) {
    ctx.fillStyle = 'rgba(20,40,70,0.62)';
    ctx.font = '11px "IBM Plex Mono", ui-monospace, monospace';
    const decimals = step < 1 ? 1 : 0;
    const labelY = Math.min(camera.height - 6, Math.max(18, origin.y - 4));
    for (let x = Math.ceil(topLeft.x / step) * step; x <= bottomRight.x; x += step) {
      if (Math.abs(x) < step / 2) continue;
      ctx.fillText(x.toFixed(decimals), project(camera, x, 0).x + 3, labelY);
    }
    const labelX = Math.min(camera.width - 36, Math.max(4, origin.x + 4));
    for (let y = Math.floor(topLeft.y / step) * step; y >= bottomRight.y; y -= step) {
      if (Math.abs(y) < step / 2) continue;
      ctx.fillText(y.toFixed(decimals), labelX, project(camera, 0, y).y - 3);
    }
  }
  ctx.restore();
}

// The sky and the range change little from frame to frame, so they are
// painted into an offscreen canvas (with a margin to slide into) and reused
// until parallax would put a ridge a few pixels out of place.
let sceneryCache = null;

function drawScenery(ctx, camera) {
  const view = createBackdropView(camera);
  const margin = BACKDROP.cacheMarginPixels;
  if (!sceneryCache || backdropDrift(sceneryCache.view, view) > BACKDROP.redrawDriftPixels) {
    const width = Math.ceil(camera.width + 2 * margin);
    const height = Math.ceil(camera.height + 2 * margin);
    // Match the screen's pixel density so the range stays crisp on retina.
    const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
    const pixelWidth = Math.round(width * ratio);
    const pixelHeight = Math.round(height * ratio);
    const canvas = sceneryCache && sceneryCache.canvas.width === pixelWidth && sceneryCache.canvas.height === pixelHeight
      ? sceneryCache.canvas
      : Object.assign(document.createElement('canvas'), { width: pixelWidth, height: pixelHeight });
    const cacheContext = canvas.getContext('2d');
    cacheContext.setTransform(ratio, 0, 0, ratio, 0, 0);
    const paddedCamera = { ...camera, width, height };
    const paddedView = { ...view, width, height, horizonY: view.horizonY + margin };
    cacheContext.clearRect(0, 0, width, height);
    drawSky(cacheContext, paddedCamera, paddedView);
    drawBackdrop(cacheContext, paddedCamera, paddedView);
    sceneryCache = { canvas, view, width, height };
  }
  const shift = cacheShift(sceneryCache.view, view);
  ctx.drawImage(sceneryCache.canvas, -margin + shift.x, -margin + shift.y, sceneryCache.width, sceneryCache.height);
}

// ------------------------------------------------------------------ tracks

function segmentVisible(camera, a, b) {
  const margin = 60;
  return !((a.x < -margin && b.x < -margin) || (a.x > camera.width + margin && b.x > camera.width + margin)
    || (a.y < -margin * 3 && b.y < -margin * 3) || (a.y > camera.height + margin * 3 && b.y > camera.height + margin * 3));
}

function drawTrees(ctx, camera, points, seed) {
  const w = VIEW.laneHalfWidth;
  let travelled = 0;
  let nextTree = VIEW.treeSpacing * (0.5 + hash(seed));
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    travelled += length;
    while (travelled >= nextTree) {
      const t = 1 - (travelled - nextTree) / length;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      const slope = Math.abs((b.y - a.y) / (b.x - a.x || 1e-6));
      const variety = hash(x * 3.1 + seed);
      nextTree += VIEW.treeSpacing * (0.6 + hash(x + seed) * 0.9);
      if (slope > 1.2 || variety < 0.2) continue;
      const z = w + 0.5 + variety * 1.1;
      const base = project(camera, x, y - 0.1, z);
      if (base.x < -40 || base.x > camera.width + 40 || base.y < -80 || base.y > camera.height + 80) continue;
      drawPine(ctx, base, (2.4 + variety * 2.2) * base.scale);
    }
  }
}

function drawPine(ctx, base, height) {
  const width = height * 0.42;
  ctx.fillStyle = '#5a3d2b';
  ctx.fillRect(base.x - width * 0.06, base.y - height * 0.16, width * 0.12, height * 0.16);
  for (let tier = 0; tier < 3; tier += 1) {
    const top = base.y - height * (0.45 + tier * 0.22) - height * 0.12;
    const bottom = base.y - height * (0.12 + tier * 0.22);
    const half = width * (0.5 - tier * 0.12);
    ctx.fillStyle = tier % 2 ? '#1f5a45' : '#236b50';
    ctx.beginPath();
    ctx.moveTo(base.x, top);
    ctx.lineTo(base.x + half, bottom);
    ctx.lineTo(base.x - half, bottom);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.moveTo(base.x, top);
    ctx.lineTo(base.x + half * 0.45, top + (bottom - top) * 0.45);
    ctx.lineTo(base.x - half * 0.3, top + (bottom - top) * 0.4);
    ctx.closePath();
    ctx.fill();
  }
}

function drawPistePoles(ctx, camera, points) {
  let travelled = 0;
  let next = 4;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    travelled += length;
    while (travelled >= next) {
      const t = 1 - (travelled - next) / length;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      next += 10;
      const foot = project(camera, x, y, VIEW.laneHalfWidth + 0.15);
      const top = project(camera, x, y + 1.3, VIEW.laneHalfWidth + 0.15);
      if (foot.x < -20 || foot.x > camera.width + 20) continue;
      ctx.lineWidth = Math.max(1.5, 0.07 * foot.scale);
      ctx.strokeStyle = '#e8702a';
      ctx.beginPath(); ctx.moveTo(foot.x, foot.y); ctx.lineTo(top.x, top.y); ctx.stroke();
      ctx.strokeStyle = '#1b2433';
      const band = { x: top.x + (foot.x - top.x) * 0.25, y: top.y + (foot.y - top.y) * 0.25 };
      ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(band.x, band.y); ctx.stroke();
    }
  }
}

function drawLane(ctx, camera, points, style) {
  const w = VIEW.laneHalfWidth;
  const far = points.map((point) => project(camera, point.x, point.y, w));
  const near = points.map((point) => project(camera, point.x, point.y, -w));
  const thickness = VIEW.slabThickness;

  // Front face of the snow slab.
  ctx.fillStyle = style.face;
  for (let index = 1; index < points.length; index += 1) {
    const a = near[index - 1];
    const b = near[index];
    if (!segmentVisible(camera, a, b)) continue;
    const aBottom = project(camera, points[index - 1].x, points[index - 1].y - thickness, -w);
    const bBottom = project(camera, points[index].x, points[index].y - thickness, -w);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(bBottom.x, bBottom.y); ctx.lineTo(aBottom.x, aBottom.y);
    ctx.closePath();
    ctx.fill();
  }

  // Top surface, shaded by how squarely each segment faces the sun.
  // Consecutive segments with the same shade share one path.
  let currentShade = -1;
  let open = false;
  const flush = () => { if (open) { ctx.fill(); open = false; } };
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    if (!segmentVisible(camera, near[index - 1], near[index]) && !segmentVisible(camera, far[index - 1], far[index])) { flush(); currentShade = -1; continue; }
    const normal = normalise(-(b.y - a.y), b.x - a.x);
    const facing = normal.y >= 0 ? normal : { x: -normal.x, y: -normal.y };
    const light = Math.max(0, facing.x * LIGHT.x + facing.y * LIGHT.y);
    const shade = Math.round(light * 14);
    if (shade !== currentShade) {
      flush();
      currentShade = shade;
      ctx.fillStyle = mix(SNOW_SHADE, style.lit, 0.25 + 0.75 * (shade / 14));
    }
    if (!open) { ctx.beginPath(); open = true; }
    ctx.moveTo(far[index - 1].x, far[index - 1].y);
    ctx.lineTo(far[index].x, far[index].y);
    ctx.lineTo(near[index].x, near[index].y);
    ctx.lineTo(near[index - 1].x, near[index - 1].y);
    ctx.closePath();
  }
  flush();

  // Rims: a soft far edge and a crisp, coloured near edge.
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(120,150,190,0.55)';
  ctx.lineWidth = 1;
  strokePolyline(ctx, far);
  if (style.glow) {
    ctx.strokeStyle = style.glow;
    ctx.lineWidth = 7;
    strokePolyline(ctx, near);
  }
  ctx.strokeStyle = style.edge;
  ctx.lineWidth = style.edgeWidth;
  strokePolyline(ctx, near);
}

function strokePolyline(ctx, screenPoints) {
  ctx.beginPath();
  let started = false;
  for (let index = 0; index < screenPoints.length; index += 1) {
    const point = screenPoints[index];
    if (!started) { ctx.moveTo(point.x, point.y); started = true; } else ctx.lineTo(point.x, point.y);
  }
  ctx.stroke();
}

function pieceStyle(piece, colorIndex, selected) {
  if (piece.locked) {
    return { face: '#7f97b8', lit: [238, 243, 250], edge: COLORS.locked, edgeWidth: 2, glow: selected ? 'rgba(226,85,45,0.35)' : null };
  }
  const color = COLORS.pieces[colorIndex % COLORS.pieces.length];
  return { face: '#95afd0', lit: SNOW_LIT, edge: color, edgeWidth: 2.5, glow: selected ? `${color}55` : null };
}

// --------------------------------------------------------- course markers

function drawStartFlag(ctx, camera, start, editable) {
  const foot = project(camera, start.x, start.y, 0);
  const top = project(camera, start.x, start.y + 2.4, 0);
  ctx.lineWidth = Math.max(2, 0.06 * foot.scale);
  ctx.strokeStyle = '#1b2433';
  ctx.beginPath(); ctx.moveTo(foot.x, foot.y); ctx.lineTo(top.x, top.y); ctx.stroke();
  const flagWidth = 1.1 * foot.scale;
  const flagHeight = 0.7 * foot.scale;
  ctx.fillStyle = '#20a36b';
  ctx.beginPath();
  ctx.moveTo(top.x, top.y);
  ctx.lineTo(top.x + flagWidth, top.y + flagHeight * 0.45);
  ctx.lineTo(top.x, top.y + flagHeight);
  ctx.closePath();
  ctx.fill();
  if (editable) {
    ctx.fillStyle = 'rgba(27,36,51,0.75)';
    ctx.font = '600 11px "Barlow Condensed", system-ui, sans-serif';
    ctx.fillText('START', top.x + 4, top.y - 6);
  }
}

function drawFinish(ctx, camera, finish) {
  const w = VIEW.laneHalfWidth;
  // The gate line itself, painted across the snow.
  const near = project(camera, finish.x, finish.yMin + 0.02, -w);
  const far = project(camera, finish.x, finish.yMin + 0.02, w);
  ctx.strokeStyle = '#d63a2a';
  ctx.lineWidth = Math.max(2, 0.12 * near.scale);
  ctx.beginPath(); ctx.moveTo(near.x, near.y); ctx.lineTo(far.x, far.y); ctx.stroke();

  // A checkered arch behind the lane, facing the camera.
  const z = w + 0.4;
  const halfSpan = 2.2;
  const top = finish.yMax + 0.6;
  const bannerHeight = 1.1;
  const left = { foot: project(camera, finish.x - halfSpan, finish.yMin, z), top: project(camera, finish.x - halfSpan, top, z) };
  const right = { foot: project(camera, finish.x + halfSpan, finish.yMin, z), top: project(camera, finish.x + halfSpan, top, z) };
  ctx.strokeStyle = '#1b2433';
  ctx.lineWidth = Math.max(2, 0.14 * left.foot.scale);
  for (const pole of [left, right]) {
    ctx.beginPath(); ctx.moveTo(pole.foot.x, pole.foot.y); ctx.lineTo(pole.top.x, pole.top.y); ctx.stroke();
  }
  const columns = 10;
  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < 2; row += 1) {
      const x0 = finish.x - halfSpan + (2 * halfSpan * column) / columns;
      const x1 = finish.x - halfSpan + (2 * halfSpan * (column + 1)) / columns;
      const y0 = top - (bannerHeight * row) / 2;
      const y1 = top - (bannerHeight * (row + 1)) / 2;
      const a = project(camera, x0, y0, z);
      const b = project(camera, x1, y1, z);
      ctx.fillStyle = (column + row) % 2 ? '#1b2433' : '#ffffff';
      ctx.fillRect(a.x, a.y, b.x - a.x + 0.5, b.y - a.y + 0.5);
    }
  }
}

function drawSnowflake(ctx, centre, radius, angle, alpha) {
  ctx.save();
  ctx.translate(centre.x, centre.y);
  ctx.rotate(angle);
  ctx.globalAlpha = alpha;
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, radius * 1.6);
  glow.addColorStop(0, 'rgba(120,200,255,0.55)');
  glow.addColorStop(1, 'rgba(120,200,255,0)');
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(0, 0, radius * 1.6, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#1f6fd1';
  ctx.lineWidth = Math.max(1.5, radius * 0.16);
  ctx.lineCap = 'round';
  for (let arm = 0; arm < 6; arm += 1) {
    ctx.rotate(Math.PI / 3);
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(0, -radius);
    ctx.moveTo(0, -radius * 0.55); ctx.lineTo(radius * 0.28, -radius * 0.78);
    ctx.moveTo(0, -radius * 0.55); ctx.lineTo(-radius * 0.28, -radius * 0.78);
    ctx.stroke();
  }
  ctx.restore();
}

// ------------------------------------------------------------------ skier

function lerpPoint(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

// Joint positions in metres, skier-local: +x forward, +y up, feet at origin.
const POSES = {
  upright: { knee: [0.2, 0.52], hip: [-0.02, 0.95], shoulder: [0.14, 1.46], head: [0.2, 1.66], hand: [0.5, 1.0], poleTip: [-0.4, 0.03] },
  tuck: { knee: [0.4, 0.4], hip: [-0.1, 0.6], shoulder: [0.42, 0.98], head: [0.62, 1.1], hand: [0.72, 0.72], poleTip: [-0.55, 0.95] },
  brake: { knee: [0.26, 0.5], hip: [-0.14, 0.88], shoulder: [-0.02, 1.4], head: [0.04, 1.6], hand: [0.36, 1.02], poleTip: [-0.3, 0.03] },
  air: { knee: [0.3, 0.55], hip: [-0.02, 0.9], shoulder: [0.24, 1.38], head: [0.32, 1.57], hand: [0.62, 1.22], poleTip: [-0.25, 0.6] },
  // Knees and hips taking a heavy load: what a hard compression looks like.
  compressed: { knee: [0.5, 0.3], hip: [-0.26, 0.42], shoulder: [0.2, 0.86], head: [0.28, 1.04], hand: [0.52, 0.58], poleTip: [-0.5, 0.05] },
};

function rotateAbout(point, centre, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = point[0] - centre[0];
  const dy = point[1] - centre[1];
  return [centre[0] + dx * cos - dy * sin, centre[1] + dx * sin + dy * cos];
}

/**
 * The skier's joints in skier-local metres (+x forward, +y up, feet at the
 * origin): the stance for the moment, bent by the body's springs.
 */
export function skierPose(skier, look) {
  const base = skier.mode === 'air' ? POSES.air : POSES.upright;
  const target = look.brake ? POSES.brake : base;
  const pose = {};
  for (const joint of Object.keys(POSES.upright)) pose[joint] = lerpPoint(target[joint], POSES.tuck[joint], look.tuck);
  const body = look.body;
  if (!body) return pose;
  // Knees give under load: toward the compressed stance, or a little past
  // the stance the other way when unweighted.
  const give = Math.max(-0.3, Math.min(1, (body.crouch - BODY.standingCrouch) / (1 - BODY.standingCrouch)));
  for (const joint of Object.keys(pose)) pose[joint] = lerpPoint(pose[joint], POSES.compressed[joint], give);
  // The torso leans about the hips; forward is clockwise in these axes.
  for (const joint of ['shoulder', 'head', 'hand', 'poleTip']) pose[joint] = rotateAbout(pose[joint], pose.hip, -body.lean);
  // Arms swing about the shoulder and the head nods about the neck.
  for (const joint of ['hand', 'poleTip']) pose[joint] = rotateAbout(pose[joint], pose.shoulder, -body.armSwing);
  pose.head = rotateAbout(pose.head, pose.shoulder, -body.headLag * 0.5);
  return pose;
}

// Heading about the vertical: the spin, plus a half turn when facing left.
function headingOf(skier, look) {
  return (look.yaw || 0) + (skier.facing < 0 ? Math.PI : 0);
}

function placedSkeleton(skier, look) {
  return placeJoints(posedJoints(skierPose(skier, look)), { x: skier.x, y: skier.y, pitch: look.pitch, heading: headingOf(skier, look) });
}

/** The skeleton in the course plane, as a crash ragdoll starts from it. */
export function skierJointsInWorld(skier, look) {
  const placed = placedSkeleton(skier, look);
  const flat = (point) => ({ x: point.x, y: point.y });
  const middle = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const joints = { hip: middle(placed.hipL, placed.hipR), shoulder: middle(placed.shoulderL, placed.shoulderR), head: flat(placed.head) };
  for (const name of ['footL', 'footR', 'kneeL', 'kneeR', 'elbowL', 'elbowR', 'handL', 'handR']) joints[name] = flat(placed[name]);
  return joints;
}


// The model is lit by the same sun as the mountains.
const MODEL_SUN = (() => { const x = 0.62; const y = 0.68; const z = -0.4; const l = Math.hypot(x, y, z); return { x: x / l, y: y / l, z: z / l }; })();
const MODEL_AMBIENT = 0.45;

/** Project, cull, light and paint a model's faces, far to near. */
function renderModel(ctx, camera, faces, palette, alpha) {
  const visible = [];
  for (const face of faces) {
    const screen = face.points.map((point) => project(camera, point.x, point.y, point.z));
    if (!isFrontFacing(screen)) continue;
    let depth = 0;
    for (const point of face.points) depth += point.z - point.y * 0.2;
    visible.push({ face, screen, depth: depth / face.points.length });
  }
  visible.sort((a, b) => b.depth - a.depth);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineJoin = 'round';
  ctx.lineWidth = 0.6;
  for (const { face, screen } of visible) {
    const normal = faceNormal(face.points);
    const light = MODEL_AMBIENT + (1 - MODEL_AMBIENT) * Math.max(0, normal.x * MODEL_SUN.x + normal.y * MODEL_SUN.y + normal.z * MODEL_SUN.z);
    const base = palette[face.material];
    const colour = `rgb(${Math.round(base[0] * light)},${Math.round(base[1] * light)},${Math.round(base[2] * light)})`;
    ctx.fillStyle = colour;
    ctx.strokeStyle = colour;
    ctx.beginPath();
    ctx.moveTo(screen[0].x, screen[0].y);
    for (let index = 1; index < screen.length; index += 1) ctx.lineTo(screen[index].x, screen[index].y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawSkier(ctx, camera, skier, look, palette = MODEL_PALETTE, alpha = 1) {
  const faces = buildSkierMesh(placedSkeleton(skier, look), { gear: !look.lostGear });
  renderModel(ctx, camera, faces, palette, alpha);
}

// The same model, driven by the ragdoll's joints: bare-headed, no gear.
function drawRagdoll(ctx, camera, ragdoll) {
  renderModel(ctx, camera, buildSkierMesh(ragdollJoints(ragdoll), { gear: false }), MODEL_PALETTE, 1);
}

function drawGear(ctx, camera, items) {
  for (const item of items) {
    const centre = project(camera, item.x, item.y, item.z || 0);
    const scale = centre.scale;
    ctx.save();
    ctx.translate(centre.x, centre.y);
    ctx.rotate(-item.angle);
    ctx.scale(scale, -scale);
    ctx.lineCap = 'round';
    if (item.kind === 'ski') {
      const half = item.length / 2;
      ctx.strokeStyle = COLORS.jacket;
      ctx.lineWidth = 0.07;
      ctx.beginPath();
      ctx.moveTo(-half, 0);
      ctx.lineTo(half - 0.2, 0);
      ctx.quadraticCurveTo(half, 0, half + 0.03, 0.12);
      ctx.stroke();
      ctx.fillStyle = '#1b2433';
      ctx.fillRect(-0.12, 0, 0.24, 0.06);
    } else if (item.kind === 'pole') {
      const half = item.length / 2;
      ctx.strokeStyle = '#6a7383';
      ctx.lineWidth = 0.03;
      ctx.beginPath(); ctx.moveTo(-half, 0); ctx.lineTo(half, 0); ctx.stroke();
      ctx.strokeStyle = '#1b2433';
      ctx.lineWidth = 0.02;
      ctx.beginPath(); ctx.moveTo(-half + 0.1, -0.07); ctx.lineTo(-half + 0.1, 0.07); ctx.stroke();
    } else {
      ctx.fillStyle = '#f4f6fa';
      ctx.beginPath(); ctx.arc(0, 0, 0.15, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#c8d2e0';
      ctx.lineWidth = 0.02;
      ctx.stroke();
      ctx.fillStyle = '#e8a33a';
      ctx.beginPath(); ctx.ellipse(0.08, -0.01, 0.07, 0.045, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
}

function drawShadow(ctx, camera, surfaces, skier) {
  const ground = groundBelow(surfaces, skier.x, skier.y + 0.05);
  if (!ground) return;
  const height = Math.max(0, skier.y - ground.y);
  const centre = project(camera, skier.x, ground.y, 0);
  const spread = 1 + height * 0.05;
  const alpha = 0.32 * Math.exp(-height / 10);
  ctx.save();
  ctx.fillStyle = `rgba(40,60,100,${alpha.toFixed(3)})`;
  ctx.translate(centre.x, centre.y);
  ctx.rotate(-ground.slope);
  ctx.beginPath();
  ctx.ellipse(0, 0, 0.95 * spread * centre.scale, 0.32 * spread * centre.scale * VIEW.depthLift * 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawGrooves(ctx, camera, grooves) {
  if (grooves.length < 2) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(110,140,185,0.5)';
  ctx.lineWidth = 1.4;
  for (const z of [-0.14, 0.14]) {
    ctx.beginPath();
    let pen = false;
    for (const point of grooves) {
      if (!point) { pen = false; continue; }
      const screen = project(camera, point.x, point.y + 0.02, z);
      if (!pen) { ctx.moveTo(screen.x, screen.y); pen = true; } else ctx.lineTo(screen.x, screen.y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawTrace(ctx, camera, trace) {
  if (!trace || trace.length < 2) return;
  ctx.save();
  ctx.setLineDash([4, 6]);
  ctx.strokeStyle = 'rgba(27,36,51,0.45)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  trace.forEach((point, index) => {
    const screen = project(camera, point.x, point.y + 0.9, 0);
    if (index === 0) ctx.moveTo(screen.x, screen.y); else ctx.lineTo(screen.x, screen.y);
  });
  ctx.stroke();
  ctx.restore();
}

/**
 * Predict the flight from the skier's current state: the same drag and
 * gravity as the simulation, stepped coarsely. Returns the path and, if it
 * meets the snow, the landing point and impact speed.
 */
export function predictFlight(skier, surfaces, controls, seconds = 4) {
  const path = [{ x: skier.x, y: skier.y }];
  let x = skier.x; let y = skier.y; let vx = skier.vx; let vy = skier.vy;
  const dt = 1 / 30;
  const drag = dragCoefficient(controls);
  for (let time = 0; time < seconds; time += dt) {
    const speed = Math.hypot(vx, vy);
    vx -= drag * speed * vx * dt;
    vy += (-PHYSICS.gravity - drag * speed * vy) * dt;
    const next = { x: x + vx * dt, y: y + vy * dt };
    const hit = sweepSurfaces(surfaces, { x, y }, next);
    if (hit) {
      const a = hit.surface.points[hit.segment];
      const b = hit.surface.points[hit.segment + 1];
      const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      let nx = -(b.y - a.y) / length; let ny = (b.x - a.x) / length;
      if (nx * (x - a.x) + ny * (y - a.y) < 0) { nx = -nx; ny = -ny; }
      const landing = { x: x + (next.x - x) * hit.along, y: y + (next.y - y) * hit.along };
      path.push(landing);
      return { path, landing, impact: Math.max(0, -(vx * nx + vy * ny)) };
    }
    x = next.x; y = next.y;
    path.push({ x, y });
  }
  return { path, landing: null, impact: 0 };
}

function drawPrediction(ctx, camera, prediction) {
  const { path, landing, impact } = prediction;
  if (path.length < 2) return;
  const colour = !landing ? 'rgba(27,36,51,0.5)' : impact > PHYSICS.crashLandingSpeed ? '#d63a2a' : impact > PHYSICS.softLandingSpeed ? '#e39a1c' : '#1f9d63';
  ctx.save();
  ctx.setLineDash([6, 5]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = colour;
  ctx.beginPath();
  path.forEach((point, index) => {
    const screen = project(camera, point.x, point.y + 0.9, 0);
    if (index === 0) ctx.moveTo(screen.x, screen.y); else ctx.lineTo(screen.x, screen.y);
  });
  ctx.stroke();
  ctx.setLineDash([]);
  if (landing) {
    const spot = project(camera, landing.x, landing.y, 0);
    ctx.lineWidth = 2.5;
    const r = 7;
    ctx.beginPath();
    ctx.moveTo(spot.x - r, spot.y - r); ctx.lineTo(spot.x + r, spot.y + r);
    ctx.moveTo(spot.x + r, spot.y - r); ctx.lineTo(spot.x - r, spot.y + r);
    ctx.stroke();
  }
  ctx.restore();
}

function drawParticles(ctx, camera, particles) {
  ctx.save();
  for (const particle of particles) {
    const screen = project(camera, particle.x, particle.y, particle.z);
    const life = particle.life / particle.maxLife;
    ctx.globalAlpha = Math.max(0, Math.min(1, life * 1.4));
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, Math.max(1, particle.size * screen.scale), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawPreview(ctx, camera, polylines, colour) {
  ctx.save();
  ctx.setLineDash([7, 6]);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = colour;
  for (const points of polylines) {
    strokePolyline(ctx, points.map((point) => project(camera, point.x, point.y, 0)));
  }
  ctx.restore();
}

// ------------------------------------------------------------------- scene

/** Draw one frame. `scene` is a plain snapshot assembled by the game. */
export function renderScene(ctx, camera, scene) {
  const editing = scene.mode === 'edit';
  drawScenery(ctx, camera);
  drawGrid(ctx, camera, editing && scene.showGrid);

  // Lower tracks first, so higher ones sit in front of what is behind them.
  const ordered = scene.pieces.map((piece, index) => ({ piece, index }))
    .sort((a, b) => averageY(a.piece) - averageY(b.piece));
  let playerColour = 0;
  const colourOf = new Map();
  for (const piece of scene.pieces) if (!piece.locked) colourOf.set(piece.id, playerColour++);
  for (const { piece } of ordered) {
    const style = pieceStyle(piece, colourOf.get(piece.id) || 0, piece.id === scene.selectedPieceId);
    piece.polylines.forEach((points, polylineIndex) => {
      drawTrees(ctx, camera, points, piece.id * 7.3 + polylineIndex);
      drawLane(ctx, camera, points, style);
      if (piece.locked) drawPistePoles(ctx, camera, points);
    });
  }

  if (scene.previewPolylines) drawPreview(ctx, camera, scene.previewPolylines, scene.previewColour || '#e2552d');
  if (scene.sketch && scene.sketch.length > 1) drawPreview(ctx, camera, [scene.sketch], '#1b2433');
  if (editing && scene.lastTrace) drawTrace(ctx, camera, scene.lastTrace);

  if (scene.course.finish) drawFinish(ctx, camera, scene.course.finish);
  (scene.course.tokens || []).forEach((token, index) => {
    if (scene.collected && scene.collected.has(index)) return;
    const centre = project(camera, token.x, token.y, 0);
    drawSnowflake(ctx, centre, 0.55 * centre.scale, scene.time * 0.8 + index, 1);
  });
  if (editing || !scene.run) drawStartFlag(ctx, camera, scene.course.start, editing);

  if (scene.run) {
    drawGrooves(ctx, camera, scene.run.grooves);
    // After a crash the shadow belongs under the tumbling body.
    const shadowCaster = scene.ragdoll ? { x: scene.ragdoll.points.hip.x, y: scene.ragdoll.points.hip.y } : scene.run.skier;
    drawShadow(ctx, camera, scene.run.surfaces, shadowCaster);
    if (scene.prediction) drawPrediction(ctx, camera, scene.prediction);
    if (scene.ghost) {
      const ghostSkier = { ...scene.ghost, mode: 'air', crashed: false };
      drawSkier(ctx, camera, ghostSkier, { tuck: 0.4, pitch: scene.ghost.pitch, tumble: 0, brake: false }, GHOST_MODEL_PALETTE, 0.5);
      const tag = project(camera, scene.ghost.x, scene.ghost.y + 1.9, 0);
      ctx.save();
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = '#1d4f8f';
      ctx.font = '700 11px "Barlow Condensed", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('BEST', tag.x, tag.y);
      ctx.restore();
    }
    if (scene.ragdoll) drawRagdoll(ctx, camera, scene.ragdoll);
    else drawSkier(ctx, camera, scene.run.skier, scene.look);
  }
  if (scene.gear && scene.gear.length) drawGear(ctx, camera, scene.gear);
  drawParticles(ctx, camera, scene.particles);
  if (scene.eraser) {
    ctx.save();
    ctx.strokeStyle = '#d63a2a';
    ctx.fillStyle = 'rgba(214,58,42,0.15)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(scene.eraser.x, scene.eraser.y, scene.eraser.radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
}

function averageY(piece) {
  let sum = 0; let count = 0;
  for (const points of piece.polylines) for (const point of points) { sum += point.y; count += 1; }
  return count ? sum / count : 0;
}

