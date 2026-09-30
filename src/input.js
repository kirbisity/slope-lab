// Pointer gestures on the canvas: one pointer drives the current tool,
// two pointers pinch-zoom and pan in any mode, the wheel zooms at the cursor.
// Mouse, pen and touch all arrive as pointer events.

const TAP_SLOP = 6;

// Capture keeps a drag alive when it leaves the element; it can fail for a
// pointer the browser has already released, which must not end the gesture.
export function capture(element, pointerId) {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    // The drag still works while the pointer stays over the element.
  }
}

/**
 * Attach gesture handling. `handlers` receives:
 * begin(point), move(point, previous), end(point, wasTap), cancel(),
 * pinch(factor, centre, panX, panY), wheel(factor, point), hover(point).
 */
export function attachGestures(canvas, handlers) {
  const pointers = new Map();
  let single = null;
  let pinch = null;

  const pointOf = (event) => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const pinchState = () => {
    const [a, b] = [...pointers.values()];
    return { distance: Math.hypot(a.x - b.x, a.y - b.y) || 1, centre: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  };

  canvas.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0 && event.button !== 1) return;
    capture(canvas, event.pointerId);
    const point = pointOf(event);
    pointers.set(event.pointerId, point);
    if (pointers.size === 1) {
      single = { id: event.pointerId, start: point, last: point, moved: false, panOnly: event.button === 1 };
      handlers.begin(point, single.panOnly);
    } else if (pointers.size === 2) {
      if (single) handlers.cancel();
      single = null;
      pinch = pinchState();
    }
    event.preventDefault();
  });

  canvas.addEventListener('pointermove', (event) => {
    const point = pointOf(event);
    if (!pointers.has(event.pointerId)) {
      if (event.pointerType === 'mouse') handlers.hover(point);
      return;
    }
    pointers.set(event.pointerId, point);
    if (pinch && pointers.size === 2) {
      const next = pinchState();
      handlers.pinch(next.distance / pinch.distance, next.centre, next.centre.x - pinch.centre.x, next.centre.y - pinch.centre.y);
      pinch = next;
    } else if (single && single.id === event.pointerId) {
      if (!single.moved && Math.hypot(point.x - single.start.x, point.y - single.start.y) > TAP_SLOP) single.moved = true;
      handlers.move(point, single.last, single.panOnly);
      single.last = point;
    }
    if (event.pointerType === 'mouse') handlers.hover(point);
  });

  const release = (event) => {
    if (!pointers.has(event.pointerId)) return;
    const point = pointOf(event);
    pointers.delete(event.pointerId);
    if (single && single.id === event.pointerId) {
      handlers.end(point, !single.moved, single.panOnly);
      single = null;
    }
    if (pointers.size < 2) pinch = null;
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', (event) => {
    if (single && single.id === event.pointerId) handlers.cancel();
    single = null;
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = null;
  });
  canvas.addEventListener('pointerleave', (event) => {
    if (event.pointerType === 'mouse' && !pointers.has(event.pointerId)) handlers.hover(null);
  });

  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    // Trackpads send many small deltas, mouse wheels a few large ones.
    const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015));
    handlers.wheel(factor, pointOf(event));
  }, { passive: false });

  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
}
