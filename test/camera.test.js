import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCamera, project, unproject, zoomAt, frameBounds } from '../src/camera.js';

test('a point on the z = 0 plane projects and unprojects to itself', () => {
  const camera = { ...createCamera(), x: 12, y: -3, pixelsPerMeter: 30, width: 900, height: 500 };
  for (const point of [{ x: 0, y: 0 }, { x: 40, y: -20 }, { x: -7.5, y: 9 }]) {
    const screen = project(camera, point.x, point.y, 0);
    const back = unproject(camera, screen.x, screen.y);
    assert.ok(Math.hypot(back.x - point.x, back.y - point.y) < 1e-9);
  }
});

test('far points are smaller and higher on screen, which makes the depth', () => {
  const camera = { ...createCamera(), x: 0, y: 0, width: 800, height: 600 };
  const near = project(camera, 5, 0, -1.4);
  const far = project(camera, 5, 0, 1.4);
  assert.ok(far.scale < near.scale);
  assert.ok(far.y < near.y);
});

test('zooming keeps the point under the cursor fixed', () => {
  const camera = { ...createCamera(), x: 3, y: 4, width: 800, height: 600 };
  const before = unproject(camera, 610, 120);
  zoomAt(camera, 1.7, 610, 120);
  const after = unproject(camera, 610, 120);
  assert.ok(Math.hypot(before.x - after.x, before.y - after.y) < 1e-9);
});

test('framing a course puts all of it inside the usable screen', () => {
  const camera = { ...createCamera(), width: 390, height: 700 };
  const bounds = { minX: -10, maxX: 130, minY: -30, maxY: 27 };
  const insets = { top: 60, right: 10, bottom: 120, left: 10 };
  frameBounds(camera, bounds, insets);
  for (const corner of [[bounds.minX, bounds.minY], [bounds.maxX, bounds.maxY]]) {
    const screen = project(camera, corner[0], corner[1]);
    assert.ok(screen.x >= insets.left - 1 && screen.x <= camera.width - insets.right + 1, `x ${screen.x}`);
    assert.ok(screen.y >= insets.top - 1 && screen.y <= camera.height - insets.bottom + 1, `y ${screen.y}`);
  }
});
