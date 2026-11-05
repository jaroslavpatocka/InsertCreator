// Photo navigation: mouse wheel/drag and touch pinch/pan share the same pixel mapping.
// The right button stays free for the tool menu. A view maps photo pixels to canvas pixels: p * zoom + x/y.
const MAX_ZOOM = 12;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const identityView = () => ({ zoom: 1, x: 0, y: 0 });

/** The photo always covers the whole canvas, so zoom 1 is the unchanged overview. */
export function clampView({ zoom, x, y }, width, height) {
  const scale = clamp(Number.isFinite(zoom) ? zoom : 1, 1, MAX_ZOOM);
  return { zoom: scale, x: clamp(Number.isFinite(x) ? x : 0, width * (1 - scale), 0), y: clamp(Number.isFinite(y) ? y : 0, height * (1 - scale), 0) };
}

export const viewToPhoto = (view, point) => ({ x: (point.x - view.x) / view.zoom, y: (point.y - view.y) / view.zoom });
export const photoToView = (view, point) => ({ x: point.x * view.zoom + view.x, y: point.y * view.zoom + view.y });

export function zoomViewAt(view, factor, anchor, width, height) {
  const zoom = clamp(view.zoom * factor, 1, MAX_ZOOM), ratio = zoom / view.zoom;
  return clampView({ zoom, x: anchor.x - (anchor.x - view.x) * ratio, y: anchor.y - (anchor.y - view.y) * ratio }, width, height);
}

/** Own only touch navigation; an unmoved finger remains available for selection/editing. */
export function bindTouchNavigation(surface, { canPan = () => true, onStart = () => {}, onMove, onEnd = () => {} } = {}) {
  const points = new Map(), captures = new Set(), host = surface.ownerDocument?.defaultView;
  let active = false, blocked = false, starting = false, suppressClick = false, origin = null, disposed = false;
  const valid = event => Number.isFinite(event.clientX) && Number.isFinite(event.clientY);
  const snapshot = () => [...points.values()].slice(0, 2).map(point => ({ ...point }));
  const stop = event => { event.preventDefault?.(); event.stopImmediatePropagation?.(); };
  const capture = id => { try { surface.setPointerCapture?.(id); captures.add(id); } catch {} };
  const release = id => { if (!captures.delete(id)) return; try { surface.releasePointerCapture?.(id); } catch {} };
  const begin = () => {
    starting = true; onStart(); starting = false;
    active = true; suppressClick = true;
    surface.classList.add('is-navigating');
    for (const id of points.keys()) capture(id);
  };
  const down = event => {
    if (disposed) return;
    if (event.pointerType !== 'touch') {
      // Some browsers omit the compatibility click after a prevented touch gesture.
      // A later primary mouse/pen interaction must not inherit that suppression.
      if (!points.size && event.button === 0 && event.isPrimary !== false) suppressClick = false;
      return;
    }
    if (!valid(event)) return;
    if (!points.size) { blocked = false; suppressClick = false; origin = { x: event.clientX, y: event.clientY }; }
    points.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (blocked) { stop(event); return; }
    if (points.size >= 2) { if (!active) begin(); stop(event); }
  };
  const move = event => {
    if (!points.has(event.pointerId) || !valid(event)) return;
    const before = snapshot();
    points.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (blocked) { stop(event); return; }
    if (!active) {
      if (points.size < 2 && (!canPan() || Math.hypot(event.clientX-origin.x,event.clientY-origin.y) < 4)) return;
      begin();
    }
    onMove?.(before, snapshot()); stop(event);
  };
  const finish = event => {
    if (!points.has(event.pointerId) || starting) return;
    // Moving implicit capture from a touched child to this surface also bubbles
    // lostpointercapture from the child; the surface still owns the gesture.
    if (event.type === 'lostpointercapture' && event.target !== surface) return;
    const owned = active || blocked;
    points.delete(event.pointerId);
    if (active) { active = false; blocked = points.size > 0; surface.classList.remove('is-navigating'); onEnd(); }
    release(event.pointerId);
    if (owned) stop(event);
    if (!points.size) { blocked = false; origin = null; }
  };
  const clear = () => {
    const ids = [...points.keys()], wasActive = active;
    points.clear(); active = false; blocked = false; origin = null;
    surface.classList.remove('is-navigating');
    ids.forEach(release); if (wasActive) onEnd();
  };
  const click = event => { if (suppressClick) { suppressClick = false; stop(event); } };
  surface.addEventListener('pointerdown', down, true);
  surface.addEventListener('pointermove', move, true);
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) surface.addEventListener(type, finish, true);
  surface.addEventListener('click', click, true);
  host?.addEventListener('blur', clear);
  const cleanup = () => {
    disposed = true; clear();
    surface.removeEventListener('pointerdown', down, true);
    surface.removeEventListener('pointermove', move, true);
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) surface.removeEventListener(type, finish, true);
    surface.removeEventListener('click', click, true); host?.removeEventListener('blur', clear);
  };
  cleanup.cancel = clear;
  return cleanup;
}

export function touchFrame(points) {
  const first = points[0], second = points[1] || first;
  return { x: (first.x+second.x)/2, y: (first.y+second.y)/2, distance: points.length > 1 ? Math.max(1, Math.hypot(second.x-first.x,second.y-first.y)) : 1 };
}

export function bindCanvasView(canvas, { getView, setView, draw, canTouchPan = () => getView().zoom > 1, onNavigationStart = () => {} }) {
  const host = canvas.ownerDocument?.defaultView;
  let drag = null, pending = null, disposed = false, suppressMouseClick = false;
  const local = event => {
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * canvas.width / (rect.width || canvas.width), y: (event.clientY - rect.top) * canvas.height / (rect.height || canvas.height) };
  };
  const paint = () => {
    canvas.classList.toggle('can-pan', getView().zoom > 1);
    if (pending !== null) return;
    if (typeof host?.requestAnimationFrame !== 'function') { draw(); return; }
    pending = host.requestAnimationFrame(() => { pending = null; if (!disposed) draw(); });
  };
  const apply = view => { setView(view); paint(); };
  const previousTouchAction = canvas.style?.touchAction;
  if (canvas.style) canvas.style.touchAction = 'none';
  const touchCleanup = bindTouchNavigation(canvas, {
    canPan: canTouchPan,
    onStart: () => { finish(); onNavigationStart(); },
    onMove: (before, after) => {
      const a = touchFrame(before), b = touchFrame(after), anchor = local({ clientX:a.x,clientY:a.y }), nextAnchor = local({ clientX:b.x,clientY:b.y });
      const zoomed = zoomViewAt(getView(), b.distance/a.distance, anchor, canvas.width, canvas.height);
      apply(clampView({ ...zoomed, x:zoomed.x+nextAnchor.x-anchor.x, y:zoomed.y+nextAnchor.y-anchor.y }, canvas.width, canvas.height));
    }
  });
  const wheel = event => {
    event.preventDefault();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? (canvas.getBoundingClientRect().height || canvas.height) : 1);
    if (!Number.isFinite(delta) || !delta) return;
    apply(zoomViewAt(getView(), Math.exp(-clamp(delta, -600, 600) * .0015), local(event), canvas.width, canvas.height));
  };
  const down = event => {
    if (event.button !== 0 || event.pointerType === 'touch' || event.isPrimary === false || drag || getView().zoom <= 1) return;
    suppressMouseClick = false;
    event.preventDefault();
    drag = { id: event.pointerId, last: local(event) };
    canvas.classList.add('is-panning');
    try { canvas.setPointerCapture?.(event.pointerId); } catch {}
  };
  const move = event => {
    if (!drag || event.pointerId !== drag.id) return;
    if (!(event.buttons & 1)) { finish(event); return; }
    const point = local(event), view = getView();
    if (Math.hypot(point.x-drag.last.x,point.y-drag.last.y) > 0) suppressMouseClick = true;
    apply(clampView({ ...view, x: view.x + point.x - drag.last.x, y: view.y + point.y - drag.last.y }, canvas.width, canvas.height));
    drag.last = point;
  };
  const finish = event => {
    if (!drag || (event?.pointerId !== undefined && event.pointerId !== drag.id)) return;
    const id = drag.id; drag = null;
    canvas.classList.remove('is-panning');
    try { canvas.releasePointerCapture?.(id); } catch {}
  };
  const click = event => { if (suppressMouseClick) { suppressMouseClick = false; event.preventDefault(); event.stopImmediatePropagation?.(); } };
  canvas.addEventListener('wheel', wheel, { passive: false });
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);
  canvas.addEventListener('lostpointercapture', finish);
  canvas.addEventListener('click', click, true);
  canvas.classList.toggle('can-pan', getView().zoom > 1);
  return () => {
    disposed = true; finish(); touchCleanup();
    if (canvas.style) canvas.style.touchAction = previousTouchAction || '';
    if (pending !== null) host?.cancelAnimationFrame?.(pending);
    canvas.removeEventListener('wheel', wheel);
    canvas.removeEventListener('pointerdown', down);
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', finish);
    canvas.removeEventListener('pointercancel', finish);
    canvas.removeEventListener('lostpointercapture', finish);
    canvas.removeEventListener('click', click, true);
  };
}
