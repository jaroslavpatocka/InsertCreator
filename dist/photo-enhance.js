// Makes a photograph readable for auto-trace.js when tools do not stand out as dark objects on light paper.
// Only pixel values change, never their position, so contours and the calibrated scale stay valid.
const GRID_PIXELS = 1000000, MIN_TRAY = .1, MIN_BRIGHT = .02, MAX_BRIGHT = .7, MIN_CONTRAST = 40, BACKGROUND_HOLE = .8, RIM_CONTACT = .05, RAIL_BAND = .05, RAIL_LENGTH = .15;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lum = (r, g, b) => .2126 * r + .7152 * g + .0722 * b;

// Luminance on a grid of at most GRID_PIXELS cells; a cell keeps the top-left pixel of its block.
function grayGrid({ width, height, data }) {
  const step = Math.max(1, Math.ceil(Math.sqrt(width * height / GRID_PIXELS))), w = Math.ceil(width / step), h = Math.ceil(height / step), gray = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = (y * step * width + x * step) * 4, alpha = data[p + 3] / 255;
    gray[y * w + x] = lum(data[p], data[p + 1], data[p + 2]) * alpha + 255 * (1 - alpha);
  }
  return { gray, w, h, step };
}

/** Otsu threshold of the values selected by `mask` (all values without one). */
function otsu(gray, mask = null) {
  const histogram = new Float64Array(256); let total = 0, sum = 0;
  for (let i = 0; i < gray.length; i++) if (!mask || mask[i]) { const v = Math.round(clamp(gray[i], 0, 255)); histogram[v]++; total++; sum += v; }
  let best = 0, threshold = 128, below = 0, belowSum = 0;
  for (let v = 0; v < 256; v++) {
    below += histogram[v]; belowSum += v * histogram[v];
    if (!below || below === total) continue;
    const a = belowSum / below, b = (sum - belowSum) / (total - below), between = below * (total - below) * (a - b) ** 2;
    if (between > best) { best = between; threshold = v; }
  }
  return threshold;
}

/** 4-connected components: {labels, sizes}, where sizes[label] is the pixel count and label 0 is the background. */
function components(mask, w, h) {
  const labels = new Int32Array(w * h), stack = new Int32Array(w * h), sizes = [0];
  for (let start = 0; start < labels.length; start++) {
    if (!mask[start] || labels[start]) continue;
    const label = sizes.length; let top = 0, size = 0;
    labels[start] = label; stack[top++] = start;
    while (top) {
      const p = stack[--top], x = p % w; size++;
      if (x && mask[p - 1] && !labels[p - 1]) { labels[p - 1] = label; stack[top++] = p - 1; }
      if (x + 1 < w && mask[p + 1] && !labels[p + 1]) { labels[p + 1] = label; stack[top++] = p + 1; }
      if (p >= w && mask[p - w] && !labels[p - w]) { labels[p - w] = label; stack[top++] = p - w; }
      if (p + w < labels.length && mask[p + w] && !labels[p + w]) { labels[p + w] = label; stack[top++] = p + w; }
    }
    sizes.push(size);
  }
  return { labels, sizes };
}

function largest(mask, w, h) {
  const { labels, sizes } = components(mask, w, h); let best = 0;
  for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[best]) best = i;
  const result = new Uint8Array(mask.length);
  if (best) for (let i = 0; i < result.length; i++) result[i] = +(labels[i] === best);
  return { mask: result, size: sizes[best] };
}

// Everything the image border cannot reach without crossing the mask belongs to it.
function fillHoles(mask, w, h) {
  const outside = new Uint8Array(mask.length), stack = new Int32Array(mask.length); let top = 0;
  const push = p => { if (!mask[p] && !outside[p]) { outside[p] = 1; stack[top++] = p; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (top) { const p = stack[--top], x = p % w; if (x) push(p - 1); if (x + 1 < w) push(p + 1); if (p >= w) push(p - w); if (p + w < mask.length) push(p + w); }
  const result = new Uint8Array(mask.length);
  for (let i = 0; i < result.length; i++) result[i] = +!outside[i];
  return result;
}

// Holes showing the background are openings (a case handle, a white card in the lid, the eye of dark pliers), not objects lying on the surface.
function reopenBackground(filled, surface, gray, w, h) {
  const outside = []; for (let i = 0; i < gray.length; i++) if (!filled[i]) outside.push(gray[i]);
  if (!outside.length) return;
  const background = outside.sort((a, b) => a - b)[outside.length >> 1], hole = new Uint8Array(filled.length);
  for (let i = 0; i < hole.length; i++) hole[i] = +(filled[i] && !surface[i]);
  const { labels, sizes } = components(hole, w, h), same = new Float64Array(sizes.length);
  for (let i = 0; i < labels.length; i++) if (labels[i] && Math.abs(gray[i] - background) <= 10) same[labels[i]]++;
  for (let i = 0; i < labels.length; i++) if (labels[i] && same[labels[i]] / sizes[labels[i]] > BACKGROUND_HOLE) filled[i] = 0;
}

/** Chamfer distance of every mask pixel to the nearest pixel outside it; the image border counts as outside. */
function distanceInside(mask, w, h) {
  const d = new Float32Array(mask.length), D = 1.4142;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x; if (!mask[p]) continue;
    const up = y ? d[p - w] : 0, left = x ? d[p - 1] : 0, upLeft = x && y ? d[p - w - 1] : 0, upRight = y && x + 1 < w ? d[p - w + 1] : 0;
    d[p] = Math.min(up + 1, left + 1, upLeft + D, upRight + D);
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const p = y * w + x; if (!mask[p]) continue;
    const down = y + 1 < h ? d[p + w] : 0, right = x + 1 < w ? d[p + 1] : 0, downRight = x + 1 < w && y + 1 < h ? d[p + w + 1] : 0, downLeft = x && y + 1 < h ? d[p + w - 1] : 0;
    d[p] = Math.min(d[p], down + 1, right + 1, downRight + D, downLeft + D);
  }
  return d;
}
const invert = mask => { const result = new Uint8Array(mask.length); for (let i = 0; i < mask.length; i++) result[i] = +!mask[i]; return result; };
const erode = (mask, w, h, r) => { const d = distanceInside(mask, w, h), result = new Uint8Array(mask.length); for (let i = 0; i < d.length; i++) result[i] = +(d[i] > r); return result; };
const dilate = (mask, w, h, r) => invert(erode(invert(mask), w, h, r));

// Bright pieces along the tray edge are reflections or hardware of the case, not tools: they either hug the edge,
// or are long and stay within a narrow band beside it. A tool may touch the edge, but it reaches into the tray.
function dropRim(bright, inner, w, h, side) {
  const { labels, sizes } = components(bright, w, h), contact = new Float64Array(sizes.length), depth = new Float32Array(sizes.length), depthMap = distanceInside(inner, w, h);
  const x0 = new Float32Array(sizes.length).fill(w), x1 = new Float32Array(sizes.length), y0 = new Float32Array(sizes.length).fill(h), y1 = new Float32Array(sizes.length);
  for (let p = 0; p < bright.length; p++) {
    const label = labels[p]; if (!label) continue;
    const x = p % w, y = (p - x) / w;
    if (!x || x + 1 === w || p < w || p + w >= bright.length || !inner[p - 1] || !inner[p + 1] || !inner[p - w] || !inner[p + w]) contact[label]++;
    depth[label] = Math.max(depth[label], depthMap[p]);
    x0[label] = Math.min(x0[label], x); x1[label] = Math.max(x1[label], x); y0[label] = Math.min(y0[label], y); y1[label] = Math.max(y1[label], y);
  }
  const drop = sizes.map((size, label) => label && (contact[label] / size > RIM_CONTACT || (depth[label] < side * RAIL_BAND && Math.max(x1[label] - x0[label], y1[label] - y0[label]) > side * RAIL_LENGTH)));
  for (let p = 0; p < bright.length; p++) if (drop[labels[p]]) bright[p] = 0;
}

/**
 * Light tools on a dark case insert or a dark mat: the surface is found, everything else turns white, brightness inside is reversed.
 * Returns {image,name:'dark-tray'} with the source size, or null when the photograph shows no such surface.
 */
export function readableImage(image) {
  const { gray, w, h, step } = grayGrid(image), side = Math.min(w, h), darkLimit = clamp(otsu(gray) * .62, 45, 90);
  const surface = largest(Uint8Array.from(gray, v => +(v < darkLimit)), w, h);
  if (surface.size < gray.length * MIN_TRAY) return null;
  const filled = fillHoles(surface.mask, w, h);reopenBackground(filled, surface.mask, gray, w, h);
  // Erosion cuts what only hangs on the tray (case frame, hinges); growing back by the same amount keeps its shape. The margin leaves out the rim of the case.
  const opening = Math.max(3, side * .03), rim = Math.max(2, side * .012);
  const core = largest(erode(filled, w, h, opening), w, h).mask, inner = dilate(core, w, h, opening), margin = erode(filled, w, h, rim);
  for (let i = 0; i < inner.length; i++) inner[i] &= margin[i];
  const split = otsu(gray, inner), darkLevels = [], brightLevels = [];
  for (let i = 0; i < gray.length; i++) if (inner[i]) (gray[i] < split ? darkLevels : brightLevels).push(gray[i]);
  const area = darkLevels.length + brightLevels.length, middle = list => list.sort((a, b) => a - b)[list.length >> 1] ?? 0;
  const brightShare = area ? brightLevels.length / area : 0, foam = middle(darkLevels), metal = middle(brightLevels);
  if (brightShare < MIN_BRIGHT || brightShare > MAX_BRIGHT || metal - foam < MIN_CONTRAST) return null;
  const low = (foam + split) / 2, high = split + (split - low), bright = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) bright[i] = +(inner[i] && gray[i] >= low);
  // Opening cuts thin spurs, so hardware that only brushes a tool does not lengthen it.
  const spur = Math.max(1, side * .003), trimmed = dilate(erode(bright, w, h, spur), w, h, spur);
  for (let i = 0; i < bright.length; i++) bright[i] &= trimmed[i];
  dropRim(bright, inner, w, h, side);
  // Closing fills engraved markings that would otherwise notch the outline of a tool.
  const engraving = Math.max(1, side * .004), solid = erode(dilate(bright, w, h, engraving), w, h, engraving);
  const { width, height, data } = image, result = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const cell = Math.floor(y / step) * w + Math.floor(x / step), p = y * width + x, source = p * 4;
    const value = !solid[cell] ? 255 : bright[cell] ? 255 * (1 - clamp((lum(data[source], data[source + 1], data[source + 2]) - low) / (high - low), 0, 1)) : 0;
    result[source] = result[source + 1] = result[source + 2] = value; result[source + 3] = 255;
  }
  return { name: 'dark-tray', image: { width, height, data: result } };
}
