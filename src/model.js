// The skier as a 3D model, built the way Greatwall builds its structures:
// primitives (tapered prisms, boxes, faceted spheres) whose faces are wound
// outward, lit by their normals, culled when they face away and painted
// far to near. One skeleton drives it, so the same model rides (joints from
// the posed body) and tumbles (joints from the ragdoll).

// Half-widths across the body (m): feet sit on skis a hip-width apart,
// shoulders are broader than hips, hands hold poles out to the side.
const SIDE = { foot: 0.11, knee: 0.12, hip: 0.13, shoulder: 0.2, elbow: 0.26, hand: 0.3 };

// Limb thickness (radius, m) at each end, and the look of each part.
const LIMBS = [
  { from: 'hip', to: 'knee', radii: [0.1, 0.075], material: 'pants' },
  { from: 'knee', to: 'foot', radii: [0.075, 0.06], material: 'pants' },
  { from: 'shoulder', to: 'elbow', radii: [0.07, 0.06], material: 'sleeve' },
  { from: 'elbow', to: 'hand', radii: [0.06, 0.045], material: 'sleeve' },
];
const PRISM_SIDES = 6;

export const MODEL_PALETTE = {
  jacket: [226, 85, 45], sleeve: [201, 70, 31], pants: [35, 50, 74], boot: [27, 36, 51],
  ski: [226, 85, 45], pole: [106, 115, 131], helmet: [244, 246, 250], goggles: [232, 163, 58], skin: [241, 199, 163], glove: [27, 36, 51],
};
export const GHOST_MODEL_PALETTE = {
  jacket: [47, 125, 209], sleeve: [42, 108, 182], pants: [29, 79, 143], boot: [29, 79, 143],
  ski: [42, 108, 182], pole: [74, 109, 150], helmet: [232, 241, 251], goggles: [156, 196, 240], skin: [210, 226, 245], glove: [29, 79, 143],
};

// ----------------------------------------------------------------- vectors

const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scale = (a, k) => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const length = (a) => Math.hypot(a.x, a.y, a.z);
const unit = (a) => { const l = length(a) || 1; return scale(a, 1 / l); };
const mid = (a, b) => scale(add(a, b), 0.5);

export function faceNormal(points) {
  return unit(cross(sub(points[1], points[0]), sub(points[2], points[0])));
}

/** A face on screen (y down) turns toward the viewer when wound this way. */
export function isFrontFacing(screenPoints) {
  let twiceArea = 0;
  for (let index = 0; index < screenPoints.length; index += 1) {
    const a = screenPoints[index];
    const b = screenPoints[(index + 1) % screenPoints.length];
    twiceArea += a.x * b.y - b.x * a.y;
  }
  return twiceArea > 0;
}

// ---------------------------------------------------------------- skeleton

/**
 * The profile pose (skier-local metres: +x forward, +y up) lifted into 3D
 * with both sides of the body. Axes: x forward, y up, z to the skier's left.
 */
export function posedJoints(pose) {
  const at = ([x, y], z) => ({ x, y, z });
  const elbow = [(pose.shoulder[0] + pose.hand[0]) / 2, (pose.shoulder[1] + pose.hand[1]) / 2 - 0.08];
  const joints = { head: at(pose.head, 0) };
  for (const [side, sign] of [['L', 1], ['R', -1]]) {
    joints[`foot${side}`] = at([0, 0.08], sign * SIDE.foot);
    joints[`knee${side}`] = at(pose.knee, sign * SIDE.knee);
    joints[`hip${side}`] = at(pose.hip, sign * SIDE.hip);
    joints[`shoulder${side}`] = at(pose.shoulder, sign * SIDE.shoulder);
    joints[`elbow${side}`] = at(elbow, sign * SIDE.elbow);
    joints[`hand${side}`] = at(pose.hand, sign * SIDE.hand);
    joints[`poleTip${side}`] = at(pose.poleTip, sign * (SIDE.hand + 0.05));
  }
  joints.skiDirection = { x: 1, y: 0, z: 0 };
  return joints;
}

// A backflip turns the body about its belly, not its feet.
const BELLY_HEIGHT = 1.05;

/**
 * Put a body-frame skeleton into the world: roll it backwards by `flip`
 * about the belly, turn it by `heading` about the vertical (a spin; π rides
 * switch), tip it by `pitch` to the slope along the way of travel, and face
 * it the way of travel (`facing` -1 is leftwards), standing at (x, y).
 * The slope tip comes after the turn so a switch rider's skis lie on the
 * slope rather than mirrored across it.
 */
export function placeJoints(joints, { x, y, pitch, heading, flip = 0, facing = 1 }) {
  const cosFlip = Math.cos(flip);
  const sinFlip = Math.sin(flip);
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  const cosHeading = Math.cos(heading);
  const sinHeading = Math.sin(heading);
  const place = (point, isDirection) => {
    // Backwards is anticlockwise in body axes (+x forward, +y up).
    const bellyY = isDirection ? 0 : BELLY_HEIGHT;
    const fx = point.x * cosFlip - (point.y - bellyY) * sinFlip;
    const fy = point.x * sinFlip + (point.y - bellyY) * cosFlip + bellyY;
    const turnedX = fx * cosHeading - point.z * sinHeading;
    const turnedZ = fx * sinHeading + point.z * cosHeading;
    const tippedX = turnedX * cosPitch - fy * sinPitch;
    const py = turnedX * sinPitch + fy * cosPitch;
    const px = tippedX * facing;
    const pz = turnedZ * facing;
    return isDirection ? { x: px, y: py, z: pz } : { x: x + px, y: y + py, z: pz };
  };
  const placed = {};
  for (const [name, point] of Object.entries(joints)) placed[name] = place(point, name === 'skiDirection');
  return placed;
}

/** The 3D skeleton of a ragdoll: its 2D joints, each side at its own depth. */
export function ragdollJoints(ragdoll) {
  const points = ragdoll.points;
  const at = (point, z) => ({ x: point.x, y: point.y, z });
  const joints = { head: at(points.head, 0) };
  for (const [side, sign] of [['L', 1], ['R', -1]]) {
    joints[`foot${side}`] = at(points[`foot${side}`], sign * SIDE.foot);
    joints[`knee${side}`] = at(points[`knee${side}`], sign * SIDE.knee);
    joints[`hip${side}`] = at(points.hip, sign * SIDE.hip);
    joints[`shoulder${side}`] = at(points.shoulder, sign * SIDE.shoulder);
    joints[`elbow${side}`] = at(points[`elbow${side}`], sign * SIDE.elbow);
    joints[`hand${side}`] = at(points[`hand${side}`], sign * SIDE.hand);
  }
  return joints;
}

// -------------------------------------------------------------- primitives

// Wind each face so its normal points away from the part's centre.
function outward(points, centre) {
  const normal = faceNormal(points);
  const centroid = points.reduce((sum, point) => add(sum, scale(point, 1 / points.length)), { x: 0, y: 0, z: 0 });
  return dot(normal, sub(centroid, centre)) >= 0 ? points : [...points].reverse();
}

function face(points, centre, material, part) {
  return { points: outward(points, centre), centre, material, part };
}

// Any two unit vectors square to the axis, for building rings around it.
function frame(axis) {
  const helper = Math.abs(axis.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const u = unit(cross(axis, helper));
  const v = cross(axis, u);
  return { u, v };
}

function prism(a, b, radiusA, radiusB, material, part, faces, sides = PRISM_SIDES) {
  const axis = sub(b, a);
  if (length(axis) < 1e-6) return;
  const { u, v } = frame(unit(axis));
  const ring = (centre, radius) => Array.from({ length: sides }, (_, index) => {
    const angle = (index / sides) * Math.PI * 2;
    return add(centre, add(scale(u, Math.cos(angle) * radius), scale(v, Math.sin(angle) * radius)));
  });
  const ringA = ring(a, radiusA);
  const ringB = ring(b, radiusB);
  const centre = mid(a, b);
  for (let index = 0; index < sides; index += 1) {
    const next = (index + 1) % sides;
    faces.push(face([ringA[index], ringA[next], ringB[next], ringB[index]], centre, material, part));
  }
  faces.push(face(ringB, centre, material, part));
}

// A box from its centre and three half-axes.
function box(centre, halfX, halfY, halfZ, material, part, faces) {
  const corner = (sx, sy, sz) => add(centre, add(scale(halfX, sx), add(scale(halfY, sy), scale(halfZ, sz))));
  const sides = [
    [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]],
    [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]],
    [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]],
    [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]],
    [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]],
    [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]],
  ];
  for (const side of sides) faces.push(face(side.map(([sx, sy, sz]) => corner(sx, sy, sz)), centre, material, part));
}

// A faceted sphere; `topOnly` keeps the upper half (a helmet shell).
function sphere(centre, radius, material, part, faces, topOnly = false, up = { x: 0, y: 1, z: 0 }) {
  const rings = 5;
  const segments = 8;
  const { u, v } = frame(up);
  const point = (ring, segment) => {
    const polar = (ring / rings) * Math.PI;
    const azimuth = (segment / segments) * Math.PI * 2;
    return add(centre, add(scale(up, Math.cos(polar) * radius), add(scale(u, Math.sin(polar) * Math.cos(azimuth) * radius), scale(v, Math.sin(polar) * Math.sin(azimuth) * radius))));
  };
  const lastRing = topOnly ? Math.ceil(rings / 2) : rings;
  for (let ring = 0; ring < lastRing; ring += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const quad = [point(ring, segment), point(ring, segment + 1), point(ring + 1, segment + 1), point(ring + 1, segment)];
      // The pole rings collapse to triangles.
      const points = ring === 0 ? [quad[0], quad[2], quad[3]] : ring === rings - 1 ? [quad[0], quad[1], quad[2]] : quad;
      faces.push(face(points, centre, material, part));
    }
  }
}

// ------------------------------------------------------------------ model

/**
 * The faces of the skier for a placed skeleton. `gear` adds skis, boots,
 * poles, helmet and goggles; without it the body is bare-headed.
 */
export function buildSkierMesh(joints, { gear }) {
  const faces = [];
  const hip = mid(joints.hipL, joints.hipR);
  const shoulder = mid(joints.shoulderL, joints.shoulderR);
  const bodyLeft = unit(sub(joints.shoulderL, joints.shoulderR));
  const spine = sub(shoulder, hip);
  const bodyUp = unit(spine);
  const bodyForward = unit(cross(bodyUp, bodyLeft));

  // Torso: a tapered prism from the hips to a broader chest, running a
  // little past the shoulder joints so the arms hang from its top.
  const chest = add(shoulder, scale(bodyUp, 0.06));
  prism(hip, chest, 0.16, 0.2, 'jacket', 'torso', faces, 8);

  for (const side of ['L', 'R']) {
    const joint = (name) => joints[`${name}${side}`];
    for (const limb of LIMBS) prism(joint(limb.from), joint(limb.to), limb.radii[0], limb.radii[1], limb.material, 'limb', faces);
    sphere(joint('hand'), 0.055, 'glove', 'hand', faces);
    if (gear) {
      box(add(joint('foot'), { x: 0, y: -0.02, z: 0 }), scale(joints.skiDirection || bodyForward, 0.14), { x: 0, y: 0.07, z: 0 }, scale(bodyLeft, 0.06), 'boot', 'boot', faces);
      const direction = joints.skiDirection || bodyForward;
      const across = unit(cross({ x: 0, y: 1, z: 0 }, direction));
      const skiCentre = add(add(joint('foot'), scale(direction, 0.08)), { x: 0, y: -0.07, z: 0 });
      box(skiCentre, scale(direction, 0.82), { x: 0, y: 0.015, z: 0 }, scale(across, 0.045), 'ski', 'ski', faces);
      const tipBase = add(skiCentre, scale(direction, 0.82));
      const tipEnd = add(add(tipBase, scale(direction, 0.14)), { x: 0, y: 0.1, z: 0 });
      box(mid(tipBase, tipEnd), scale(sub(tipEnd, tipBase), 0.5), { x: 0, y: 0.015, z: 0 }, scale(across, 0.045), 'ski', 'ski', faces);
      if (joint('poleTip')) prism(joint('hand'), joint('poleTip'), 0.018, 0.012, 'pole', 'pole', faces);
    }
  }

  const head = joints.head;
  sphere(head, 0.12, gear ? 'skin' : 'skin', 'head', faces);
  if (gear) {
    sphere(add(head, scale(bodyUp, 0.015)), 0.145, 'helmet', 'helmet', faces, true, bodyUp);
    box(add(head, scale(bodyForward, 0.1)), scale(bodyForward, 0.03), scale(bodyUp, 0.035), scale(bodyLeft, 0.09), 'goggles', 'goggles', faces);
  }
  return faces;
}
