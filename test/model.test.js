import { test } from 'node:test';
import assert from 'node:assert/strict';
import { posedJoints, placeJoints, ragdollJoints, buildSkierMesh, faceNormal, isFrontFacing } from '../src/model.js';
import { project } from '../src/camera.js';
import { createRagdoll, stepRagdoll } from '../src/ragdoll.js';
import { buildSurfaces, createEquationPiece } from '../src/track.js';

const pose = { knee: [0.2, 0.52], hip: [-0.02, 0.95], shoulder: [0.14, 1.46], head: [0.2, 1.66], hand: [0.5, 1.0], poleTip: [-0.4, 0.03] };
const camera = { x: 0, y: 1, pixelsPerMeter: 120, width: 800, height: 600 };
const JOINTS = ['footL', 'footR', 'kneeL', 'kneeR', 'hipL', 'hipR', 'shoulderL', 'shoulderR', 'head', 'elbowL', 'elbowR', 'handL', 'handR'];

test('the posed skeleton has both sides, mirrored across the body', () => {
  const joints = posedJoints(pose);
  for (const name of JOINTS) assert.ok(joints[name], name);
  assert.ok(Math.abs(joints.kneeL.z + joints.kneeR.z) < 1e-9 && joints.kneeL.z > 0);
  assert.ok(joints.kneeL.x > joints.hipL.x, 'knees ahead of the hips, as in the profile pose');
  assert.ok(joints.shoulderL.z - joints.shoulderR.z > joints.hipL.z - joints.hipR.z, 'shoulders wider than hips');
});

test('placing the body: a half turn of heading mirrors it through the feet', () => {
  const forward = placeJoints(posedJoints(pose), { x: 10, y: 2, pitch: 0, heading: 0 });
  const back = placeJoints(posedJoints(pose), { x: 10, y: 2, pitch: 0, heading: Math.PI });
  assert.ok(Math.abs((forward.head.x - 10) + (back.head.x - 10)) < 1e-9);
  assert.ok(Math.abs(forward.kneeL.z + back.kneeL.z) < 1e-9);
  const quarter = placeJoints(posedJoints(pose), { x: 0, y: 0, pitch: 0, heading: Math.PI / 2 });
  assert.ok(quarter.skiDirection.z > 0.99, 'a quarter turn points the skis into the depth');
});

test('riding switch on a slope: the skis still lie along the slope', () => {
  const slope = -0.3;
  const along = { x: Math.cos(slope), y: Math.sin(slope) };
  for (const [heading, facing] of [[0, 1], [Math.PI, 1], [0, -1], [Math.PI, -1]]) {
    const ski = placeJoints(posedJoints(pose), { x: 0, y: 0, pitch: slope, heading, facing }).skiDirection;
    // Leftwards travel mirrors the slope too.
    const across = Math.abs(ski.x * along.y * facing - ski.y * along.x);
    assert.ok(across < 1e-9, `heading ${heading.toFixed(2)}, facing ${facing}: skis off the slope by ${across}`);
  }
});

test('every face of the model faces outward from its own part', () => {
  const placed = placeJoints(posedJoints(pose), { x: 0, y: 0, pitch: -0.3, heading: 0.4 });
  const faces = buildSkierMesh(placed, { gear: true });
  assert.ok(faces.length > 80 && faces.length < 400, `${faces.length} faces`);
  for (const face of faces) {
    const normal = faceNormal(face.points);
    const centroid = face.points.reduce((sum, point) => ({ x: sum.x + point.x / face.points.length, y: sum.y + point.y / face.points.length, z: sum.z + point.z / face.points.length }), { x: 0, y: 0, z: 0 });
    const outward = normal.x * (centroid.x - face.centre.x) + normal.y * (centroid.y - face.centre.y) + normal.z * (centroid.z - face.centre.z);
    assert.ok(outward > -1e-9, `${face.part} face points inward`);
  }
});

test('from the camera about half of a round part is hidden, and the near side shows', () => {
  const placed = placeJoints(posedJoints(pose), { x: 0, y: 0, pitch: 0, heading: 0 });
  const head = buildSkierMesh(placed, { gear: false }).filter((face) => face.part === 'head');
  const screen = (face) => face.points.map((point) => project(camera, point.x, point.y, point.z));
  const shown = head.filter((face) => isFrontFacing(screen(face)));
  assert.ok(shown.length > head.length * 0.35 && shown.length < head.length * 0.7, `${shown.length} of ${head.length}`);
  const nearest = head.reduce((best, face) => (Math.min(...face.points.map((p) => p.z)) < Math.min(...best.points.map((p) => p.z)) ? face : best));
  assert.ok(isFrontFacing(screen(nearest)), 'the face nearest the camera is drawn');
});

test('gear comes and goes: no skis, poles or helmet once lost', () => {
  const placed = placeJoints(posedJoints(pose), { x: 0, y: 0, pitch: 0, heading: 0 });
  const parts = (gear) => new Set(buildSkierMesh(placed, { gear }).map((face) => face.part));
  for (const part of ['ski', 'pole', 'helmet']) {
    assert.ok(parts(true).has(part));
    assert.ok(!parts(false).has(part));
  }
});

test('the same model is built from a tumbling ragdoll', () => {
  const slope = buildSurfaces([createEquationPiece('y = -0.8x', -10, 200)]);
  const placed = placeJoints(posedJoints(pose), { x: 0, y: 0.05, pitch: -0.6, heading: 0 });
  const flat = {};
  for (const name of ['footL', 'footR', 'kneeL', 'kneeR', 'head', 'elbowL', 'elbowR', 'handL', 'handR']) flat[name] = { x: placed[name].x, y: placed[name].y };
  flat.hip = { x: (placed.hipL.x + placed.hipR.x) / 2, y: (placed.hipL.y + placed.hipR.y) / 2 };
  flat.shoulder = { x: (placed.shoulderL.x + placed.shoulderR.x) / 2, y: (placed.shoulderL.y + placed.shoulderR.y) / 2 };
  const ragdoll = createRagdoll(flat, { vx: 10, vy: -8, spin: -6 });
  for (let frame = 0; frame < 90; frame += 1) stepRagdoll(ragdoll, slope, 1 / 60);
  const faces = buildSkierMesh(ragdollJoints(ragdoll), { gear: false });
  assert.ok(faces.length > 60);
  for (const face of faces) for (const point of face.points) assert.ok(Number.isFinite(point.x + point.y + point.z));
});

test('a backflip turns the body about the belly: half way round, the head is below the feet', () => {
  const upright = placeJoints(posedJoints(pose), { x: 0, y: 0, pitch: 0, heading: 0, flip: 0 });
  const inverted = placeJoints(posedJoints(pose), { x: 0, y: 0, pitch: 0, heading: 0, flip: Math.PI });
  assert.ok(inverted.head.y < inverted.footL.y, 'upside down');
  const belly = (joints) => (joints.hipL.y + joints.shoulderL.y) / 2;
  assert.ok(Math.abs(belly(inverted) - belly(upright)) < 0.35, 'turns about the middle of the body, not the feet');
  const quarter = placeJoints(posedJoints(pose), { x: 0, y: 0, pitch: 0, heading: 0, flip: Math.PI / 2 });
  assert.ok(quarter.head.x < quarter.footL.x, 'a backflip goes over backwards: head leads backwards first');
});
