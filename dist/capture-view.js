// Mouse navigation of a photo canvas: the wheel zooms at the cursor, the left button pans.
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

export function bindCanvasView(canvas, { getView, setView, draw }) {
  const host = canvas.ownerDocument?.defaultView;
  let drag = null, pending = null, disposed = false;
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
  const wheel = event => {
    event.preventDefault();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? (canvas.getBoundingClientRect().height || canvas.height) : 1);
    if (!Number.isFinite(delta) || !delta) return;
    apply(zoomViewAt(getView(), Math.exp(-clamp(delta, -600, 600) * .0015), local(event), canvas.width, canvas.height));
  };
  const down = event => {
    // Touch keeps scrolling the dialog; a one-finger drag here would trap the page.
    if (event.button !== 0 || event.pointerType === 'touch' || event.isPrimary === false || drag || getView().zoom <= 1) return;
    event.preventDefault();
    drag = { id: event.pointerId, last: local(event) };
    canvas.classList.add('is-panning');
    try { canvas.setPointerCapture?.(event.pointerId); } catch {}
  };
  const move = event => {
    if (!drag || event.pointerId !== drag.id) return;
    if (!(event.buttons & 1)) { finish(event); return; }
    const point = local(event), view = getView();
    apply(clampView({ ...view, x: view.x + point.x - drag.last.x, y: view.y + point.y - drag.last.y }, canvas.width, canvas.height));
    drag.last = point;
  };
  const finish = event => {
    if (!drag || (event?.pointerId !== undefined && event.pointerId !== drag.id)) return;
    const id = drag.id; drag = null;
    canvas.classList.remove('is-panning');
    try { canvas.releasePointerCapture?.(id); } catch {}
  };
  canvas.addEventListener('wheel', wheel, { passive: false });
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);
  canvas.addEventListener('lostpointercapture', finish);
  canvas.classList.toggle('can-pan', getView().zoom > 1);
  return () => {
    disposed = true; finish();
    if (pending !== null) host?.cancelAnimationFrame?.(pending);
    canvas.removeEventListener('wheel', wheel);
    canvas.removeEventListener('pointerdown', down);
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', finish);
    canvas.removeEventListener('pointercancel', finish);
    canvas.removeEventListener('lostpointercapture', finish);
  };
}
