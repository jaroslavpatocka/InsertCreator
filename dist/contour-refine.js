// Re-measures recognised tool outlines on the ORIGINAL photograph. Earlier stages decide which tools
// exist; their thresholded masks are too coarse for a pocket. Here every outline is taken from the
// photo's own edges: a seeded watershed on the colour gradient, in log brightness so that black rubber
// against a black recess is as visible as chrome against foam. Nothing is inferred from a tool template.
import { simple } from './contour-smoothing.js';

const MAX_PIXELS = 4000000, LOG_KNEE = 6, LEVELS = 1024, GRADIENT_SCALE = 170;
const BLUR = [.0545, .2442, .4026, .2442, .0545];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function sampled({ width, height, data }) {
  const step = Math.max(1, Math.ceil(Math.sqrt(width * height / MAX_PIXELS))), w = Math.ceil(width / step), h = Math.ceil(height / step);
  const channels = [new Float32Array(w * h), new Float32Array(w * h), new Float32Array(w * h)];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let yy = y * step; yy < Math.min(height, (y + 1) * step); yy++) for (let xx = x * step; xx < Math.min(width, (x + 1) * step); xx++) {
      const p = (yy * width + xx) * 4, a = data[p + 3] / 255;
      r += data[p] * a + 255 * (1 - a); g += data[p + 1] * a + 255 * (1 - a); b += data[p + 2] * a + 255 * (1 - a); n++;
    }
    const cell = y * w + x; channels[0][cell] = r / n; channels[1][cell] = g / n; channels[2][cell] = b / n;
  }
  return { channels, w, h, step };
}

function blurred(values, w, h) {
  const middle = new Float32Array(values.length), result = new Float32Array(values.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let sum = 0; for (let k = -2; k <= 2; k++) sum += BLUR[k + 2] * values[y * w + clamp(x + k, 0, w - 1)];
    middle[y * w + x] = sum;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let sum = 0; for (let k = -2; k <= 2; k++) sum += BLUR[k + 2] * middle[clamp(y + k, 0, h - 1) * w + x];
    result[y * w + x] = sum;
  }
  return result;
}

// Same fill rule as auto-trace rasterize(): pixel centres inside the polygon.
function fill(points, label, labels, w, h, scale) {
  const ys = points.map(p => p.y / scale), y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(h - 1, Math.ceil(Math.max(...ys)));
  for (let y = y0; y <= y1; y++) {
    const scan = y + .5, crossings = [];
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const ax = points[i].x / scale, ay = points[i].y / scale, bx = points[j].x / scale, by = points[j].y / scale;
      if ((ay > scan) !== (by > scan)) crossings.push(ax + (scan - ay) * (bx - ax) / (by - ay));
    }
    crossings.sort((a, b) => a - b);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const from = Math.max(0, Math.ceil(crossings[i] - .5)), to = Math.min(w - 1, Math.floor(crossings[i + 1] - .5));
      for (let x = from; x <= to; x++) if (!labels[y * w + x]) labels[y * w + x] = label;
    }
  }
}

/**
 * Chamfer distance from each selected pixel to the nearest unselected pixel. The grid exterior counts as
 * unselected, which is right for erosion; `open` removes it, for a distance to an object inside the grid.
 */
function distance(selected, w, h, open = false) {
  const d = new Float32Array(w * h), far = 1e6, D = 1.4142, E = open ? far : 1, F = open ? far : D;
  for (let i = 0; i < d.length; i++) d[i] = selected(i) ? far : 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x; if (!d[p]) continue;
    d[p] = Math.min(d[p], y ? d[p - w] + 1 : E, x ? d[p - 1] + 1 : E, x && y ? d[p - w - 1] + D : F, y && x + 1 < w ? d[p - w + 1] + D : F);
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const p = y * w + x; if (!d[p]) continue;
    d[p] = Math.min(d[p], y + 1 < h ? d[p + w] + 1 : E, x + 1 < w ? d[p + 1] + 1 : E, x + 1 < w && y + 1 < h ? d[p + w + 1] + D : F, x && y + 1 < h ? d[p + w - 1] + D : F);
  }
  return d;
}

function regions(mask, w, h) {
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

// The level separating a recess from dark tool material, measured beside the tools. Otsu in log
// brightness, because both populations sit within a few percent of the full brightness range.
function darkLevel(luminance, inBand) {
  const histogram = new Float64Array(256), top = Math.log1p(255 / LOG_KNEE); let total = 0, sum = 0;
  for (let i = 0; i < luminance.length; i++) if (inBand(i)) { const v = Math.round(255 * Math.log1p(luminance[i] / LOG_KNEE) / top); histogram[v]++; total++; sum += v; }
  if (!total) return 0;
  let best = 0, split = 0, below = 0, belowSum = 0;
  for (let v = 0; v < 256; v++) {
    below += histogram[v]; belowSum += v * histogram[v];
    if (!below || below === total) continue;
    const a = belowSum / below, b = (sum - belowSum) / (total - below), between = below * (total - below) * (a - b) ** 2;
    if (between > best) { best = between; split = v; }
  }
  return LOG_KNEE * Math.expm1(split / 255 * top);
}

function flood(marks, gradient, w, h) {
  const buckets = Array.from({ length: LEVELS }, () => []); let level = LEVELS;
  const enqueue = (n, label) => { marks[n] = -label; buckets[gradient[n]].push(n); if (gradient[n] < level) level = gradient[n]; };
  const neighbours = (p, visit) => { const x = p % w; if (x) visit(p - 1); if (x + 1 < w) visit(p + 1); if (p >= w) visit(p - w); if (p + w < marks.length) visit(p + w); };
  for (let p = 0; p < marks.length; p++) if (marks[p] > 0) neighbours(p, n => { if (!marks[n]) enqueue(n, marks[p]); });
  while (level < LEVELS) {
    const bucket = buckets[level];
    if (!bucket.length) { level++; continue; }
    const p = bucket.pop(), label = -marks[p]; marks[p] = label;
    neighbours(p, n => { if (!marks[n]) enqueue(n, label); });
  }
}

/** Largest loop of the level set through a smoothed mask, in sub-pixel coordinates of the grid. */
function levelLoop(field, w, h, x0, y0) {
  const at = (x, y) => field[y * w + x], edges = new Map();
  const cross = (ax, ay, bx, by) => { const a = at(ax, ay), b = at(bx, by), f = (.5 - a) / (b - a); return { x: x0 + ax + .5 + (bx - ax) * f, y: y0 + ay + .5 + (by - ay) * f }; };
  // Edge ids: horizontal grid edge 2*(y*w+x), vertical grid edge 2*(y*w+x)+1.
  const top = (x, y) => 2 * (y * w + x), left = (x, y) => 2 * (y * w + x) + 1;
  const link = (from, to) => { edges.set(from, to); };
  for (let y = 0; y + 1 < h; y++) for (let x = 0; x + 1 < w; x++) {
    const a = at(x, y) >= .5, b = at(x + 1, y) >= .5, c = at(x + 1, y + 1) >= .5, d = at(x, y + 1) >= .5, code = a | b << 1 | c << 2 | d << 3;
    if (!code || code === 15) continue;
    const T = top(x, y), R = left(x + 1, y), B = top(x, y + 1), L = left(x, y);
    // Inside stays on the same side of every directed segment.
    switch (code) {
      case 1: link(L, T); break; case 2: link(T, R); break; case 3: link(L, R); break;
      case 4: link(R, B); break; case 5: link(L, B); link(R, T); break; case 6: link(T, B); break;
      case 7: link(L, B); break; case 8: link(B, L); break; case 9: link(B, T); break;
      case 10: link(T, L); link(B, R); break; case 11: link(B, R); break; case 12: link(R, L); break;
      case 13: link(R, T); break; case 14: link(T, L); break;
    }
  }
  const position = id => { const cell = id >> 1, x = cell % w, y = (cell - x) / w; return id & 1 ? cross(x, y, x, y + 1) : cross(x, y, x + 1, y); };
  let best = [], bestArea = 0; const seen = new Set();
  for (const start of edges.keys()) {
    if (seen.has(start)) continue;
    const loop = []; let id = start;
    while (id !== undefined && !seen.has(id)) { seen.add(id); loop.push(position(id)); id = edges.get(id); }
    if (id !== start || loop.length < 3) continue;
    let area = 0; for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) area += loop[j].x * loop[i].y - loop[i].x * loop[j].y;
    if (Math.abs(area) > bestArea) { bestArea = Math.abs(area); best = loop; }
  }
  return best;
}

// A slit narrower than the closing radius cannot exist as a printed foam web, so a deep one belongs
// to the pocket. Corner slivers of the same closing stay out: they would round real shoulders.
function closeSlits(mask, foreign, w, h, radius) {
  const reach = distance(i => !mask[i], w, h, true), grown = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) grown[i] = +(reach[i] <= radius);
  const back = distance(i => grown[i], w, h, true), added = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) added[i] = +(back[i] > radius && !mask[i] && !foreign[i]);
  const { labels, sizes } = regions(added, w, h), deepest = new Float32Array(sizes.length);
  for (let i = 0; i < labels.length; i++) if (labels[i]) deepest[labels[i]] = Math.max(deepest[labels[i]], reach[i]);
  for (let i = 0; i < labels.length; i++) if (labels[i] && deepest[labels[i]] >= radius * .7) mask[i] = 1;
}

function outline(labelMap, label, box, w, h, opening, slit) {
  const pad = Math.ceil(slit * 2) + 4, x0 = Math.max(0, box.x0 - pad), y0 = Math.max(0, box.y0 - pad), x1 = Math.min(w - 1, box.x1 + pad), y1 = Math.min(h - 1, box.y1 + pad), bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const mask = new Uint8Array(bw * bh), foreign = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { const owner = labelMap[(y + y0) * w + x + x0]; mask[y * bw + x] = +(owner === label); foreign[y * bw + x] = +(owner > 1 && owner !== label); }
  // Holes (a socket bore, a screw) are not part of the outer outline.
  const outside = new Uint8Array(mask.length), stack = [];
  const reach = p => { if (!mask[p] && !outside[p]) { outside[p] = 1; stack.push(p); } };
  for (let x = 0; x < bw; x++) { reach(x); reach((bh - 1) * bw + x); }
  for (let y = 0; y < bh; y++) { reach(y * bw); reach(y * bw + bw - 1); }
  while (stack.length) { const p = stack.pop(), x = p % bw; if (x) reach(p - 1); if (x + 1 < bw) reach(p + 1); if (p >= bw) reach(p - bw); if (p + bw < mask.length) reach(p + bw); }
  for (let i = 0; i < mask.length; i++) mask[i] = +!outside[i];
  closeSlits(mask, foreign, bw, bh, slit);
  // Opening removes a leak through a narrow gap in the surrounding barrier, never the tool body.
  const inner = distance(i => mask[i], bw, bh), core = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) core[i] = +(inner[i] > opening);
  const { labels, sizes } = regions(core, bw, bh); let largest = 0;
  for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[largest]) largest = i;
  if (largest) {
    const body = distance(i => labels[i] !== largest, bw, bh, true);
    for (let i = 0; i < mask.length; i++) mask[i] &= +(body[i] <= opening + 1);
  }
  const field = blurred(Float32Array.from(mask), bw, bh);
  // A tool cut by the photo edge still needs a closed loop.
  for (let x = 0; x < bw; x++) field[x] = field[(bh - 1) * bw + x] = 0;
  for (let y = 0; y < bh; y++) field[y * bw] = field[y * bw + bw - 1] = 0;
  return levelLoop(field, bw, bh, x0, y0);
}

function resampled(points, spacing) {
  const lengths = [0]; for (let i = 0; i < points.length; i++) { const a = points[i], b = points[(i + 1) % points.length]; lengths.push(lengths[i] + Math.hypot(b.x - a.x, b.y - a.y)); }
  const total = lengths.at(-1), count = Math.max(8, Math.round(total / spacing)), result = []; let k = 0;
  for (let i = 0; i < count; i++) {
    const s = total * i / count; while (lengths[k + 1] < s) k++;
    const a = points[k], b = points[(k + 1) % points.length], f = (s - lengths[k]) / Math.max(1e-9, lengths[k + 1] - lengths[k]);
    result.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
  }
  return result;
}

function smoothedLoop(points, sigma) {
  const radius = Math.ceil(sigma * 2.5), weights = []; let total = 0;
  for (let k = -radius; k <= radius; k++) { const v = Math.exp(-k * k / (2 * sigma * sigma)); weights.push(v); total += v; }
  const n = points.length;
  return points.map((_, i) => { let x = 0, y = 0; for (let k = -radius; k <= radius; k++) { const p = points[((i + k) % n + n) % n], v = weights[k + radius]; x += p.x * v; y += p.y * v; } return { x: x / total, y: y / total }; });
}

/**
 * Moves an outline onto the measured edge. Every sample may shift along its normal; the chosen path
 * maximises gradient while its second difference stays small, so the line follows the real edge instead
 * of the texture or noise beside it. The bend cost is truncated, which keeps genuine corners sharp.
 */
function snapToEdge(loop, strength, w, h, spacing) {
  const STATES = 21, RANGE = 2.5 * spacing, BEND = .35, BEND_LIMIT = .5, WRAP = 24;
  const base = smoothedLoop(resampled(loop, spacing), 1.5), n = base.length;
  if (n < 12) return loop;
  let signed = 0; for (let i = 0, j = n - 1; i < n; j = i++) signed += base[j].x * base[i].y - base[i].x * base[j].y;
  const orientation = signed >= 0 ? 1 : -1, sample = (x, y) => {
    x -= .5; y -= .5; if (x < 0 || y < 0 || x >= w - 1 || y >= h - 1) return 0;
    const ix = Math.floor(x), iy = Math.floor(y), dx = x - ix, dy = y - iy, p = iy * w + ix;
    return (strength[p] * (1 - dx) + strength[p + 1] * dx) * (1 - dy) + (strength[p + w] * (1 - dx) + strength[p + w + 1] * dx) * dy;
  };
  const normals = base.map((_, i) => { const a = base[(i + n - 2) % n], b = base[(i + 2) % n], x = b.x - a.x, y = b.y - a.y, l = Math.hypot(x, y) || 1; return { x: orientation * y / l, y: -orientation * x / l }; });
  const offset = k => (k / (STATES - 1) - .5) * 2 * RANGE, length = n + 2 * WRAP, unary = new Float32Array(length * STATES);
  for (let i = 0; i < length; i++) {
    const c = ((i - WRAP) % n + n) % n, p = base[c], v = normals[c];
    for (let k = 0; k < STATES; k++) { const o = offset(k); unary[i * STATES + k] = -sample(p.x + v.x * o, p.y + v.y * o) + .02 * (o / spacing) ** 2; }
  }
  // State = (previous offset, current offset). Offsets change by at most MAX steps between samples.
  const pairs = STATES * STATES, previous = new Int16Array(length * pairs); let cost = new Float32Array(pairs).fill(Infinity), next = new Float32Array(pairs);
  for (let a = 0; a < STATES; a++) for (let b = 0; b < STATES; b++) cost[a * STATES + b] = unary[a] + unary[STATES + b];
  for (let i = 2; i < length; i++) {
    next.fill(Infinity);
    for (let a = 0; a < STATES; a++) for (let b = 0; b < STATES; b++) {
      const here = cost[a * STATES + b]; if (here === Infinity) continue;
      const lo = Math.max(0, b - 8), hi = Math.min(STATES - 1, b + 8);
      for (let c = lo; c <= hi; c++) {
        const bend = Math.abs(offset(a) - 2 * offset(b) + offset(c)) / spacing, total = here + Math.min(BEND * bend * bend, BEND_LIMIT) + unary[i * STATES + c], slot = b * STATES + c;
        if (total < next[slot]) { next[slot] = total; previous[i * pairs + slot] = a; }
      }
    }
    [cost, next] = [next, cost];
  }
  let best = 0; for (let i = 1; i < pairs; i++) if (cost[i] < cost[best]) best = i;
  const chosen = new Int16Array(length); let a = Math.floor(best / STATES), b = best % STATES;
  chosen[length - 1] = b; chosen[length - 2] = a;
  for (let i = length - 1; i >= 2; i--) { const before = previous[i * pairs + a * STATES + b]; chosen[i - 2] = before; b = a; a = before; }
  const result = [];
  for (let i = 0; i < n; i++) { const o = offset(chosen[i + WRAP]), p = base[i], v = normals[i]; result.push({ x: p.x + v.x * o, y: p.y + v.y * o }); }
  // Follow a strong edge exactly. A weak one (ribs fading into a black recess) has no detail to keep,
  // and only its course is measurable, so it is drawn as the running mean of that course.
  const support = smoothedLoop(result.map(p => ({ x: sample(p.x, p.y), y: 0 })), 3), course = smoothedLoop(result, 6);
  const blended = result.map((p, i) => { const trust = clamp((support[i].x - .3) / .4, 0, 1); return { x: p.x * trust + course[i].x * (1 - trust), y: p.y * trust + course[i].y * (1 - trust) }; });
  return smoothedLoop(blended, .6);
}

/**
 * Same-order contours measured on `image`. Each result keeps the identity of its seed; `refined` tells
 * whether the photograph supported a new outline, otherwise the seed is returned unchanged. `search` is
 * how far an outline may move, as a share of the shorter photo side.
 */
export function refineContours(image, contours, { search = .012 } = {}) {
  if (!contours.length) return [];
  const { channels, w, h, step } = sampled(image), size = w * h, reach = Math.max(3, Math.min(w, h) * search);
  const seeds = new Int32Array(size); contours.forEach((c, i) => fill(c.points, i + 1, seeds, w, h, step));
  const inner = distance(i => seeds[i] > 0, w, h), outer = distance(i => !seeds[i], w, h, true);
  const logs = channels.map(c => { const l = new Float32Array(size); for (let i = 0; i < size; i++) l[i] = Math.log1p(c[i] / LOG_KNEE); return blurred(l, w, h); });
  const gradient = new Uint16Array(size);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const p = y * w + x; let sum = 0;
    for (const l of logs) { const gx = l[p + 1] - l[p - 1], gy = l[p + w] - l[p - w]; sum += gx * gx + gy * gy; }
    gradient[p] = Math.min(LEVELS - 1, Math.sqrt(sum) * GRADIENT_SCALE);
  }
  const luminance = new Float32Array(size), saturation = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const r = channels[0][i], g = channels[1][i], b = channels[2][i], v = Math.max(r, g, b);
    luminance[i] = .2126 * r + .7152 * g + .0722 * b; saturation[i] = v > 8 ? (v - Math.min(r, g, b)) / v : 0;
  }
  // Twice: the first split separates lit foam from everything dark, the second finds the recess inside the dark part.
  const band = i => !seeds[i] && outer[i] <= reach, lit = darkLevel(luminance, i => band(i) && luminance[i] < 96);
  // Edge strength for the final position. A log gradient peaks on the dark side of a strong edge and would
  // widen every bright tool; a linear one peaks inside a shaded edge and would cut it, so that the tool no
  // longer fits. Square-root contrast lies between them; log alone still serves the dark edges.
  const linear = blurred(Float32Array.from(luminance, v => Math.sqrt(v) * 16), w, h), edge = new Float32Array(size);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const p = y * w + x, contrast = Math.hypot(linear[p + 1] - linear[p - 1], linear[p + w] - linear[p - w]);
    edge[p] = Math.min(.6, gradient[p] / GRADIENT_SCALE * .5) + Math.min(1.5, contrast / 48);
  }
  // One uniform dark population has no second split; the gap is then everything close to its own level.
  const shade = []; for (let i = 0; i < size; i++) if (band(i) && luminance[i] < lit) shade.push(luminance[i]);
  const sorted = Float32Array.from(shade).sort(), level = share => sorted[Math.floor((sorted.length - 1) * share)] ?? 0;
  const uniform = level(.9) < level(.1) * 2.5 + 2, dark = clamp(uniform ? level(.5) * 1.6 + 1 : darkLevel(luminance, i => band(i) && luminance[i] < lit), 4, 24);
  // A dark gap is background only when it is a real gap, not a screw head bitten out of a seed.
  const gap = new Uint8Array(size); for (let i = 0; i < size; i++) gap[i] = +(luminance[i] < dark);
  const pieces = regions(gap, w, h), minimumGap = Math.max(12, reach * reach * .5), outside = new Uint32Array(pieces.sizes.length);
  // A loose seed can swallow a gap, even most of it, but the gap then lies along the seed's edge. A dark
  // area reaching the middle of a seed is tool material instead (a black grip on a mat).
  const depth = new Float32Array(pieces.sizes.length), owner = new Int32Array(pieces.sizes.length), middle = new Float32Array(contours.length + 1);
  for (let i = 0; i < size; i++) {
    if (seeds[i]) middle[seeds[i]] = Math.max(middle[seeds[i]], inner[i]);
    const piece = pieces.labels[i]; if (!piece) continue;
    if (!seeds[i] || inner[i] <= reach * .6) outside[piece]++;
    if (seeds[i] && inner[i] > depth[piece]) { depth[piece] = inner[i]; owner[piece] = seeds[i]; }
  }
  const isGap = piece => outside[piece] >= minimumGap && depth[piece] < middle[owner[piece]] * .6;
  const marks = new Int32Array(size), BACKGROUND = 1;
  for (let i = 0; i < size; i++) {
    const barrier = gap[i] && (seeds[i] ? isGap(pieces.labels[i]) : outside[pieces.labels[i]] >= minimumGap);
    if (barrier || (!seeds[i] && outer[i] > reach)) marks[i] = BACKGROUND;
    else if (seeds[i] && inner[i] > 2.5) marks[i] = seeds[i] + 1;
  }
  const present = new Uint8Array(contours.length + 2); for (let i = 0; i < size; i++) present[marks[i]] = 1;
  // A very thin tool has no eroded core; its seed centre line is still known to be inside.
  for (let i = 0; i < size; i++) if (seeds[i] && !present[seeds[i] + 1] && !marks[i] && inner[i] > 1) marks[i] = seeds[i] + 1;

  // A loose seed can also swallow a thin lit rim of the recess, joined to the tool only at its ends.
  // Opening removes such a strip; a tool too thin for the opening keeps its full mark.
  const before = new Uint32Array(contours.length + 2), after = new Uint32Array(contours.length + 2);
  const body = distance(i => marks[i] > 1, w, h), kept = distance(i => body[i] <= 2.5, w, h, true), opened = new Uint8Array(size);
  for (let i = 0; i < size; i++) if (marks[i] > 1) { before[marks[i]]++; if (kept[i] <= 3.5) { opened[i] = 1; after[marks[i]]++; } }
  for (let i = 0; i < size; i++) if (marks[i] > 1 && !opened[i] && after[marks[i]] >= before[marks[i]] * .3) marks[i] = 0;

  // Pieces of a loose seed that lie behind a barrier are foam rims, not the tool. They lose their mark
  // and the watershed decides from the edges; a genuine part stays reachable through the tool.
  const marked = regions(Uint8Array.from(marks, m => +(m > 1)), w, h), largestPiece = new Uint32Array(contours.length + 2);
  for (let i = 0; i < size; i++) if (marks[i] > 1) largestPiece[marks[i]] = Math.max(largestPiece[marks[i]], marked.sizes[marked.labels[i]]);
  for (let i = 0; i < size; i++) if (marks[i] > 1 && marked.sizes[marked.labels[i]] < largestPiece[marks[i]] * .1) marks[i] = 0;

  // Dark tool material: grow it up to the gap around it. Its rounded edges fade too slowly for the
  // gradient alone, while its brightness stays above the recess. Bright tools have no such surface.
  const material = new Uint8Array(size), limit = dark * 8;
  for (let i = 0; i < size; i++) material[i] = +(marks[i] > 1 && luminance[i] >= dark && luminance[i] <= limit && saturation[i] < .3 && inner[i] > 3.5);
  const bodies = regions(material, w, h), queue = [], minimumBody = reach * reach * 1.5;
  for (let i = 0; i < size; i++) if (bodies.labels[i] && bodies.sizes[bodies.labels[i]] >= minimumBody) queue.push(i);
  while (queue.length) {
    const p = queue.pop(), x = p % w, label = marks[p];
    for (const n of [x ? p - 1 : p, x + 1 < w ? p + 1 : p, p >= w ? p - w : p, p + w < size ? p + w : p]) {
      if (marks[n] || gap[n] || outer[n] > reach || luminance[n] < dark || luminance[n] > limit || saturation[n] >= .3 || (seeds[n] && seeds[n] + 1 !== label)) continue;
      marks[n] = label; queue.push(n);
    }
  }
  // A pixel reachable from its tool only by a detour lies behind a barrier: a lit rim of the recess
  // that would otherwise be entered around the end of the tool and enclose the gap as a false hole.
  const walked = new Float32Array(size).fill(Infinity), ring = [], straight = distance(i => marks[i] < 2, w, h, true);
  for (let i = 0; i < size; i++) if (marks[i] > 1) { walked[i] = 0; ring.push(i); }
  for (let head = 0; head < ring.length; head++) {
    const p = ring[head], x = p % w, cost = walked[p] + 1;
    for (const n of [x ? p - 1 : p, x + 1 < w ? p + 1 : p, p >= w ? p - w : p, p + w < size ? p + w : p]) if (marks[n] === 0 && cost < walked[n]) { walked[n] = cost; ring.push(n); }
  }
  for (let i = 0; i < size; i++) if (!marks[i] && walked[i] > straight[i] * 2 + 4) marks[i] = BACKGROUND;
  flood(marks, gradient, w, h);

  const boxes = contours.map(() => ({ x0: w, y0: h, x1: 0, y1: 0, area: 0 }));
  for (let p = 0; p < size; p++) if (marks[p] > 1) {
    const b = boxes[marks[p] - 2], x = p % w, y = (p - x) / w; b.area++;
    b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x); b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y);
  }
  return contours.map((contour, i) => {
    const traced = boxes[i].area ? outline(marks, i + 2, boxes[i], w, h, 1.5, Math.max(2, reach * .5)) : [];
    // A small part has no long edge to average along, and a fold at a very tight neck cannot be drawn:
    // both keep the watershed line, which cannot cross itself.
    const tiny = traced.length < 64 * Math.max(1, Math.min(w, h) / 800);
    let loop = traced.length >= 3 && !tiny ? snapToEdge(traced, edge, w, h, Math.max(1, Math.min(w, h) / 800)) : traced;
    if (loop.length >= 3 && !simple(loop)) loop = traced;
    if (loop.length < 3) return { ...contour, refined: false };
    const points = loop.map(p => ({ x: p.x * step, y: p.y * step }));
    let area = 0; for (let k = 0, j = points.length - 1; k < points.length; j = k++) area += points[j].x * points[k].y - points[k].x * points[j].y;
    area = Math.abs(area) / 2;
    if (!(area > contour.area * .6 && area < contour.area * 1.6)) return { ...contour, refined: false };
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    return { ...contour, points, area, width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys), refined: true };
  });
}
