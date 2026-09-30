// The 2.5D projection. The course lives in the z = 0 plane; each track is
// extruded into a lane of snow from z = -w (near) to z = +w (far). Points
// further away shrink toward the screen centre and rise by depthLift, so the
// camera reads as standing a little in front of and above the slope.
import { VIEW } from './config.js';

export function createCamera() {
  return { x: 20, y: 0, pixelsPerMeter: VIEW.pixelsPerMeter, width: 800, height: 600 };
}

export function focusDistance(camera) {
  return Math.max(VIEW.focusDistance, (camera.width / camera.pixelsPerMeter) * VIEW.focusPerViewWidth);
}

export function depthScale(camera, z) {
  const focus = focusDistance(camera);
  return focus / (focus + z);
}

/** World (x, y, z) to screen pixels. */
export function project(camera, x, y, z = 0) {
  const scale = depthScale(camera, z) * camera.pixelsPerMeter;
  return {
    x: camera.width / 2 + (x - camera.x) * scale,
    y: camera.height / 2 - (y - camera.y + z * VIEW.depthLift) * scale,
    scale,
  };
}

/** Screen pixels to the world point on the z = 0 plane. */
export function unproject(camera, screenX, screenY) {
  return {
    x: camera.x + (screenX - camera.width / 2) / camera.pixelsPerMeter,
    y: camera.y - (screenY - camera.height / 2) / camera.pixelsPerMeter,
  };
}

export function clampZoom(pixelsPerMeter) {
  return Math.min(VIEW.maxPixelsPerMeter, Math.max(VIEW.minPixelsPerMeter, pixelsPerMeter));
}

/** Zoom by a factor while keeping the world point under the cursor fixed. */
export function zoomAt(camera, factor, screenX, screenY) {
  const anchor = unproject(camera, screenX, screenY);
  camera.pixelsPerMeter = clampZoom(camera.pixelsPerMeter * factor);
  const moved = unproject(camera, screenX, screenY);
  camera.x += anchor.x - moved.x;
  camera.y += anchor.y - moved.y;
}

/** Frame a world box inside the screen, leaving room for the interface. */
export function frameBounds(camera, bounds, insets = { top: 70, right: 20, bottom: 90, left: 20 }) {
  const usableWidth = Math.max(80, camera.width - insets.left - insets.right);
  const usableHeight = Math.max(80, camera.height - insets.top - insets.bottom);
  const width = Math.max(10, bounds.maxX - bounds.minX);
  const height = Math.max(6, bounds.maxY - bounds.minY);
  camera.pixelsPerMeter = clampZoom(Math.min(usableWidth / (width * 1.08), usableHeight / (height * 1.2)));
  const centreX = (bounds.minX + bounds.maxX) / 2;
  const centreY = (bounds.minY + bounds.maxY) / 2;
  // Shift so the box centres in the usable area, not the whole canvas.
  camera.x = centreX - (insets.left - insets.right) / 2 / camera.pixelsPerMeter;
  camera.y = centreY + (insets.top - insets.bottom) / 2 / camera.pixelsPerMeter;
}
