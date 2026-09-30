import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heightAt, createBackdropView, projectBackdrop, buildBackdrop, BACKDROP_ROWS } from '../src/backdrop.js';
import { BACKDROP } from '../src/config.js';

const camera = (overrides = {}) => ({ x: 40, y: 0, pixelsPerMeter: 22, width: 1280, height: 720, ...overrides });

test('the range is a deterministic height field: low foothills in front, peaks behind', () => {
  assert.equal(heightAt(123.4, 900), heightAt(123.4, 900));
  const front = [];
  const back = [];
  for (let x = -2000; x <= 2000; x += 25) {
    front.push(heightAt(x, BACKDROP.nearDepth));
    back.push(heightAt(x, BACKDROP.farDepth * 0.8));
  }
  for (const height of [...front, ...back]) assert.ok(height >= 0);
  assert.ok(Math.max(...back) > BACKDROP.peakHeight * 0.6, 'real peaks behind');
  assert.ok(Math.max(...front) < Math.max(...back) * 0.6, 'foothills in front');
  assert.ok(Math.max(...back) - Math.min(...back) > BACKDROP.peakHeight * 0.4, 'the skyline varies');
});

test('the backdrop camera has a true horizon: far points converge on it', () => {
  const view = createBackdropView(camera());
  const far = projectBackdrop(view, 40, view.eyeHeight, 1e7);
  assert.ok(Math.abs(far.y - view.horizonY) < 0.5);
  const nearBase = projectBackdrop(view, 40, 0, BACKDROP.nearDepth);
  const farBase = projectBackdrop(view, 40, 0, BACKDROP.farDepth);
  assert.ok(nearBase.y > farBase.y && farBase.y > view.horizonY, 'ground below the eye rises toward the horizon');
});

test('moving the course camera moves near mountains more than far ones', () => {
  const before = createBackdropView(camera({ x: 0 }));
  const after = createBackdropView(camera({ x: 100 }));
  const shift = (depth) => projectBackdrop(before, 0, 0, depth).x - projectBackdrop(after, 0, 0, depth).x;
  assert.ok(shift(BACKDROP.nearDepth) > shift(BACKDROP.farDepth) * 2);
  assert.ok(shift(BACKDROP.farDepth) > 0);
});

test('the mesh is anchored to the world, so it does not swim as the camera moves', () => {
  const worldXs = (cameraX) => new Set(buildBackdrop(createBackdropView(camera({ x: cameraX }))).vertices.map((vertex) => vertex.worldX));
  const a = worldXs(40);
  const b = worldXs(40 + BACKDROP.columnSpacing * 0.37);
  const shared = [...a].filter((x) => b.has(x));
  assert.ok(shared.length > a.size * 0.8, `${shared.length} of ${a.size} columns stay put`);
  for (const x of a) assert.ok(Math.abs(x / BACKDROP.columnSpacing - Math.round(x / BACKDROP.columnSpacing)) < 1e-9);
});

test('triangles come far to near, so nearer ridges paint over farther ones', () => {
  const { triangles } = buildBackdrop(createBackdropView(camera()));
  assert.ok(triangles.length > 200);
  for (let index = 1; index < triangles.length; index += 1) {
    assert.ok(triangles[index].depth <= triangles[index - 1].depth + 1e-9);
  }
});

test('the range spans the whole screen width at every size and zoom', () => {
  const sizes = [[360, 640], [390, 844], [844, 390], [667, 375], [768, 1024], [1280, 720], [1440, 900], [2560, 1080]];
  for (const [width, height] of sizes) {
    for (const pixelsPerMeter of [1.5, 90]) {
      const view = createBackdropView(camera({ width, height, pixelsPerMeter }));
      const { rows } = buildBackdrop(view);
      for (const row of [rows[0], rows[rows.length - 1]]) {
        assert.ok(row.minScreenX <= 0 && row.maxScreenX >= width, `${width}x${height} @${pixelsPerMeter}: ${row.minScreenX}..${row.maxScreenX}`);
      }
    }
  }
  assert.ok(BACKDROP_ROWS >= 10);
});

test('distance hazes colour toward the sky, and snow caps the high gentle ground', () => {
  const { triangles } = buildBackdrop(createBackdropView(camera()));
  const nearest = triangles[triangles.length - 1];
  const farthest = triangles[0];
  assert.ok(farthest.haze > nearest.haze);
  const snowy = triangles.filter((triangle) => triangle.material === 'snow');
  const forest = triangles.filter((triangle) => triangle.material === 'forest');
  assert.ok(snowy.length > 0 && forest.length > 0);
  const meanHeight = (list) => list.reduce((sum, triangle) => sum + triangle.height, 0) / list.length;
  assert.ok(meanHeight(snowy) > meanHeight(forest));
});

test('a cached backdrop is reused until parallax would misplace a ridge', async () => {
  const { backdropDrift, cacheShift } = await import('../src/backdrop.js');
  const base = createBackdropView(camera({ x: 0 }));
  assert.equal(backdropDrift(base, base), 0);
  const nudged = createBackdropView(camera({ x: 0.5 }));
  assert.ok(backdropDrift(base, nudged) < BACKDROP.redrawDriftPixels);
  const travelled = createBackdropView(camera({ x: 5 }));
  assert.ok(backdropDrift(base, travelled) > BACKDROP.redrawDriftPixels);
  assert.equal(backdropDrift(base, createBackdropView(camera({ width: 1000 }))), Infinity);
  // The slide is the parallax of a middle depth: between the near and far rows.
  const shift = cacheShift(base, nudged).x;
  const near = projectBackdrop(nudged, 0, 0, BACKDROP.nearDepth).x - projectBackdrop(base, 0, 0, BACKDROP.nearDepth).x;
  const far = projectBackdrop(nudged, 0, 0, BACKDROP.farDepth).x - projectBackdrop(base, 0, 0, BACKDROP.farDepth).x;
  assert.ok(shift < Math.max(near, far) && shift > Math.min(near, far));
});
