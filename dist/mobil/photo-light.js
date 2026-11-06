// Local contrast preparation for silver tools on a clean, light background.
// This is a tracing image, not a generated product photo: no pixel is moved.
import { plainBackgroundModel } from './photo-background-model.js';
const MAX_CELLS = 1000000;
const luminance = (r, g, b) => .2126 * r + .7152 * g + .0722 * b;

function background(image) {
  const { width, height, data } = image, histograms = Array.from({ length: 3 }, () => new Uint32Array(256));
  const pixels = [], stride = Math.max(1, Math.floor(Math.max(width, height) / 600));
  const add = (x, y) => {
    const p = (y * width + x) * 4, alpha = data[p + 3] / 255;
    const rgb = [0, 1, 2].map(c => Math.round(data[p + c] * alpha + 255 * (1 - alpha)));
    pixels.push(rgb); rgb.forEach((value, c) => histograms[c][value]++);
  };
  for (let x = 0; x < width; x += stride) { add(x, 0); add(x, height - 1); }
  for (let y = 0; y < height; y += stride) { add(0, y); add(width - 1, y); }
  const rgb = histograms.map(histogram => {
    let sum = 0; for (let v = 0; v < 256; v++) if ((sum += histogram[v]) >= pixels.length / 2) return v;
    return 255;
  });
  if (Math.min(...rgb) < 230 || Math.max(...rgb) - Math.min(...rgb) > 16) return null;
  const deviations = pixels.map(pixel => Math.max(...pixel.map((v, c) => Math.abs(v - rgb[c])))).sort((a, b) => a - b);
  // A photographic paper gradient belongs to the existing spatial paper model.
  // Do not flatten textured surfaces, shadows at the border or a cropped tool.
  const noise = deviations[Math.floor(deviations.length * .9)];
  if (noise > 6) return null;
  return { rgb, threshold: Math.max(12, noise * 3 + 4) };
}

// Only completely enclosed, narrow highlights are suppressed. Open jaws and
// gaps remain reachable from the border; broad ring openings stay background.
function suppressGlare(mask, w, h) {
  const seen = new Uint8Array(mask.length), outside = new Uint8Array(mask.length), queue = new Int32Array(mask.length);
  const distance = new Float32Array(mask.length), D = Math.SQRT2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x; if (mask[p]) continue;
    distance[p] = Math.min(y ? distance[p - w] + 1 : 1, x ? distance[p - 1] + 1 : 1,
      x && y ? distance[p - w - 1] + D : D, y && x + 1 < w ? distance[p - w + 1] + D : D);
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const p = y * w + x; if (mask[p]) continue;
    distance[p] = Math.min(distance[p], y + 1 < h ? distance[p + w] + 1 : 1, x + 1 < w ? distance[p + 1] + 1 : 1,
      x + 1 < w && y + 1 < h ? distance[p + w + 1] + D : D, x && y + 1 < h ? distance[p + w - 1] + D : D);
  }
  for (let start = 0; start < mask.length; start++) {
    if (mask[start] || seen[start]) continue;
    let head = 0, tail = 1, border = false, depth = 0;
    seen[start] = 1; queue[0] = start;
    while (head < tail) {
      const p = queue[head++], x = p % w;
      border ||= !x || x + 1 === w || p < w || p + w >= mask.length;
      depth = Math.max(depth, distance[p]);
      const push = n => { if (!mask[n] && !seen[n]) { seen[n] = 1; queue[tail++] = n; } };
      if (x) push(p - 1); if (x + 1 < w) push(p + 1);
      if (p >= w) push(p - w); if (p + w < mask.length) push(p + w);
    }
    if (border) for (let i = 0; i < tail; i++) outside[queue[i]] = 1;
    else if (depth <= 4) for (let i = 0; i < tail; i++) mask[queue[i]] = 2;
  }
  return outside;
}

// Hardening a threshold must not turn a soft cast shadow into a convincing
// manufactured edge. Require strong ORIGINAL contrast around each object's
// exterior; engraving and enclosed glare cannot count towards that support.
function supportedBoundaries(mask, outside, delta, w, h, minimumContrast = 24) {
  const seen = new Uint8Array(mask.length), queue = new Int32Array(mask.length);
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let head = 0, tail = 1, boundary = 0, supported = 0; queue[0] = start; seen[start] = 1;
    while (head < tail) {
      const p = queue[head++], x = p % w, y = Math.floor(p / w);
      if (!x || x + 1 === w || !y || y + 1 === h || outside[p - 1] || outside[p + 1] || outside[p - w] || outside[p + w]) {
        boundary++; let low = 255, high = 0;
        for (let yy = Math.max(0, y - 2); yy <= Math.min(h - 1, y + 2); yy++) for (let xx = Math.max(0, x - 2); xx <= Math.min(w - 1, x + 2); xx++) {
          low = Math.min(low, delta[yy * w + xx]); high = Math.max(high, delta[yy * w + xx]);
        }
        supported += +(high - low >= minimumContrast);
      }
      const push = n => { if (mask[n] && !seen[n]) { seen[n] = 1; queue[tail++] = n; } };
      if (x) push(p - 1); if (x + 1 < w) push(p + 1);
      if (p >= w) push(p - w); if (p + w < mask.length) push(p + w);
    }
    if (tail >= Math.max(32, mask.length * .00005) && (!boundary || supported < boundary * .8)) return false;
  }
  return true;
}

// Sampling must not close a one-pixel channel from a jaw to the exterior.
// A candidate is filled only if its complete full-resolution white component
// stays inside the proposed glare region. Any escape vetoes the whole fill.
function fullResolutionGlare(image, mask, w, h) {
  const { width, height, data } = image, seen = new Uint8Array(width * height);
  const candidate = p => mask[Math.min(h - 1, Math.floor(Math.floor(p / width) * h / height)) * w
    + Math.min(w - 1, Math.floor((p % width) * w / width))] === 2;
  for (let start = 0; start < seen.length; start++) {
    if (seen[start] || data[start * 4] !== 255 || !candidate(start)) continue;
    const queue = [start]; let escaped = false; seen[start] = 1;
    for (let head = 0; head < queue.length; head++) {
      const p = queue[head], x = p % width;
      if (!x || x + 1 === width || p < width || p + width >= seen.length) escaped = true;
      const push = n => {
        if (data[n * 4] !== 255) return;
        if (!candidate(n)) { escaped = true; return; }
        if (!seen[n]) { seen[n] = 1; queue.push(n); }
      };
      if (x) push(p - 1); if (x + 1 < width) push(p + 1);
      if (p >= width) push(p - width); if (p + width < seen.length) push(p + width);
      // An unusually large uncertain region can keep its original highlights.
      if (queue.length > 100000) return;
    }
    if (!escaped) for (const p of queue) data[p * 4] = data[p * 4 + 1] = data[p * 4 + 2] = 24;
  }
}

/** Returns a high-contrast image for tracing, or null for the normal pipeline. */
function preparedImage(image, plain = false) {
  if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 16 || image.height < 16
    || image.width * image.height > 16000000 || image.data?.length !== image.width * image.height * 4) return null;
  const model = plain ? plainBackgroundModel(image) : background(image); if (!model) return null;
  const { width, height, data } = image, scale = Math.min(1, Math.sqrt(MAX_CELLS / (width * height)));
  const w = Math.round(width * scale), h = Math.round(height * scale), mask = new Uint8Array(w * h), delta = new Float32Array(w * h);
  let count = 0, silver = 0;
  const contrast = p => {
    const alpha = data[p + 3] / 255;
    const rgb = model.at ? model.at(p / 4 % width, Math.floor(p / 4 / width)) : model.rgb;
    const r = data[p] * alpha + 255 * (1 - alpha), g = data[p + 1] * alpha + 255 * (1 - alpha), b = data[p + 2] * alpha + 255 * (1 - alpha);
    return { delta: Math.max(Math.abs(r - rgb[0]), Math.abs(g - rgb[1]), Math.abs(b - rgb[2])), light: luminance(r, g, b) };
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.min(width - 1, Math.floor((x + .5) * width / w)), sy = Math.min(height - 1, Math.floor((y + .5) * height / h));
    const value = contrast((sy * width + sx) * 4);
    delta[y * w + x] = value.delta;
    if (value.delta >= model.threshold) { mask[y * w + x] = 1; count++; silver += +(value.light >= 155); }
  }
  // Ordinary dark tools retain the established paper/neural recognition path.
  if (count < Math.max(32, mask.length * .0002) || count > mask.length * .65 || (!plain && silver < count * .65)) return null;
  const outside = suppressGlare(mask, w, h);
  if (!supportedBoundaries(mask, outside, delta, w, h, plain ? 18 : 24)) return null;
  const result = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = (y * width + x) * 4;
    const value = contrast(p).delta >= model.threshold ? 24 : 255;
    result[p] = result[p + 1] = result[p + 2] = value; result[p + 3] = 255;
  }
  fullResolutionGlare({ width, height, data: result }, mask, w, h);
  return { name: plain ? 'plain-background' : 'light-background', image: { width, height, data: result } };
}

/** Silver tools on clean white paper; ordinary dark tools keep the paper path. */
export function lightBackgroundImage(image) { return preparedImage(image); }

/** Any tool colors on a plain colored/gray surface with measured border lighting. */
export function plainBackgroundImage(image) { return preparedImage(image, true); }
