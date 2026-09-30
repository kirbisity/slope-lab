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

test('land covers the bottom of the screen at every camera height: no void under the course', () => {
  const sizes = [[390, 844], [844, 390], [1280, 720], [1440, 900]];
  for (const [width, height] of sizes) {
    for (const cameraY of [-80, 0, 60, 200]) {
      const view = createBackdropView(camera({ width, height, y: cameraY }));
      const { triangles } = buildBackdrop(view);
      // Every screen row from the horizon down is crossed by land.
      for (let y = Math.ceil(view.horizonY) + 40; y < height; y += 20) {
        const covered = triangles.some((triangle) => {
          const ys = triangle.points.map((point) => point.y);
          return Math.min(...ys) <= y && Math.max(...ys) >= y;
        });
        assert.ok(covered, `${width}x${height}, camera y ${cameraY}: bare at screen y ${y}`);
      }
      // And across its width at the very bottom.
      const bottom = triangles.filter((triangle) => triangle.points.some((point) => point.y >= height));
      const xs = bottom.flatMap((triangle) => triangle.points.map((point) => point.x));
      assert.ok(Math.min(...xs) <= 0 && Math.max(...xs) >= width, `${width}x${height}: the bottom edge is not fully covered`);
    }
  }
});

test('the range is a finely faceted mesh: well over the old 1,600 triangles', () => {
  const { triangles } = buildBackdrop(createBackdropView(camera()));
  assert.ok(triangles.length > 3000, `${triangles.length} triangles`);
});

test('the range is smooth: faces are not knife-edge steep and ridges are rounded', () => {
  const slopes = [];
  const creases = [];
  const step = BACKDROP.columnSpacing;
  for (let depth = BACKDROP.nearDepth; depth < BACKDROP.farDepth; depth += 90) {
    for (let x = -2000; x < 2000; x += step) {
      const a = heightAt(x, depth);
      const b = heightAt(x + step, depth);
      const c = heightAt(x + 2 * step, depth);
      slopes.push(Math.max(Math.abs(b - a) / step, Math.abs(heightAt(x, depth + 90) - a) / 90));
      creases.push(Math.abs(a - 2 * b + c));
    }
  }
  const percentile = (values, share) => [...values].sort((x, y) => x - y)[Math.floor(share * (values.length - 1))];
  // The knife-edged range measured p90 slope 1.21 and p90 crease 13.5 m.
  assert.ok(percentile(slopes, 0.9) < 0.9, `steep faces: ${percentile(slopes, 0.9).toFixed(2)}`);
  assert.ok(percentile(creases, 0.9) < 5, `creases: ${percentile(creases, 0.9).toFixed(1)} m`);
  // Still a real mountain range: high peaks remain.
  const skyline = [];
  for (let x = -2000; x <= 2000; x += 25) skyline.push(heightAt(x, BACKDROP.farDepth * 0.8));
  assert.ok(Math.max(...skyline) > BACKDROP.peakHeight * 0.6);
});

test('snow fades into rock and forest over a gradient, not at a hard line', async () => {
  const { buildBackdrop: build } = await import('../src/backdrop.js');
  const { triangles } = build(createBackdropView(camera()));
  const colours = (fill) => fill.match(/\d+/g).map(Number);
  // Neighbouring facets in a row differ in shade by light, but the colour
  // never jumps between material palettes: the change per step stays small.
  let jumps = 0;
  let pairs = 0;
  for (let index = 1; index < triangles.length; index += 1) {
    if (triangles[index].depth !== triangles[index - 1].depth) continue;
    const a = colours(triangles[index].fill);
    const b = colours(triangles[index - 1].fill);
    pairs += 1;
    if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) > 120) jumps += 1;
  }
  assert.ok(jumps / pairs < 0.02, `${jumps} of ${pairs} neighbouring facets jump in colour`);
});

test('colour runs smoothly across a triangle, vertex to vertex (Gouraud)', async () => {
  const { rasteriseGouraud } = await import('../src/backdrop.js');
  const width = 40;
  const height = 40;
  const image = new Uint8ClampedArray(width * height * 4);
  const red = [255, 0, 0];
  const green = [0, 255, 0];
  const blue = [0, 0, 255];
  rasteriseGouraud(image, width, height, 1, [{ points: [{ x: 2, y: 2 }, { x: 38, y: 2 }, { x: 2, y: 38 }], colours: [red, green, blue] }]);
  const at = (x, y) => Array.from(image.slice((y * width + x) * 4, (y * width + x) * 4 + 4));
  assert.ok(at(3, 3)[0] > 230 && at(3, 3)[1] < 25, 'near the red vertex it is red');
  assert.ok(at(36, 3)[1] > 220 && at(36, 3)[0] < 35, 'near the green vertex it is green');
  const centre = at(14, 14);
  assert.ok(centre.slice(0, 3).every((value) => value > 60 && value < 110), `the middle blends all three: ${centre}`);
  assert.equal(at(39, 39)[3], 0, 'outside the triangle stays clear');
  // Along the top edge from red to green, red only falls and green only rises.
  for (let x = 4; x < 36; x += 1) {
    assert.ok(at(x, 3)[0] >= at(x + 1, 3)[0] && at(x, 3)[1] <= at(x + 1, 3)[1]);
  }
});

test('neighbouring triangles agree on the colour at a shared vertex, so there are no facet steps', () => {
  const { triangles } = buildBackdrop(createBackdropView(camera()));
  const colourAt = new Map();
  let shared = 0;
  for (const { points, colours } of triangles) {
    points.forEach((point, index) => {
      if (point.y > 720) return;
      const key = `${point.column},${point.depth}`;
      const known = colourAt.get(key);
      if (known) {
        shared += 1;
        assert.deepEqual(known, colours[index]);
      } else colourAt.set(key, colours[index]);
    });
  }
  assert.ok(shared > 5000, `${shared} shared vertices compared`);
});
