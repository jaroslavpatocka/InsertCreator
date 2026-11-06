// Makes a photograph readable for auto-trace.js when tools do not stand out as dark objects on light paper.
// Only pixel values change, never their position, so contours and the calibrated scale stay valid.
import { lightBackgroundImage, plainBackgroundImage } from './photo-light.js';
import { darkMetalBackgroundImage } from './photo-metal-background.js';
const GRID_PIXELS = 1000000, MIN_TRAY = .1, MIN_BRIGHT = .02, MAX_BRIGHT = .7, MIN_CONTRAST = 40, BACKGROUND_HOLE = .8, RIM_CONTACT = .05, RAIL_BAND = .05, RAIL_LENGTH = .15;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lum = (r, g, b) => .2126 * r + .7152 * g + .0722 * b;

// Luminance on a grid of at most GRID_PIXELS cells; a cell keeps the top-left pixel of its block.
function grayGrid({ width, height, data }) {
  const step = Math.max(1, Math.ceil(Math.sqrt(width * height / GRID_PIXELS))), w = Math.ceil(width / step), h = Math.ceil(height / step), gray = new Float32Array(w * h);
  const red = new Uint8Array(w * h), green = new Uint8Array(w * h), blue = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = (y * step * width + x * step) * 4, alpha = data[p + 3] / 255;
    const cell = y * w + x;
    red[cell] = data[p] * alpha + 255 * (1 - alpha); green[cell] = data[p + 1] * alpha + 255 * (1 - alpha); blue[cell] = data[p + 2] * alpha + 255 * (1 - alpha);
    gray[cell] = lum(red[cell], green[cell], blue[cell]);
  }
  return { gray, red, green, blue, w, h, step };
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

function componentBounds(labels, sizes, w, h) {
  const boxes = sizes.map(() => ({ x0: w, y0: h, x1: 0, y1: 0 }));
  for (let p = 0; p < labels.length; p++) {
    if (!labels[p]) continue;
    const b = boxes[labels[p]], x = p % w, y = (p - x) / w;
    b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x); b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y);
  }
  return boxes;
}

// Learn a recess colour from connected material between independent tool bodies.
// Repeated coloured grips with neutral insets must remain foreground objects.
function colouredRecess(grid, inner, foam, low) {
  const { gray, red, green, blue, w, h } = grid, bins = new Uint32Array(36);
  const hue = p => {
    const r = red[p], g = green[p], b = blue[p], v = Math.max(r, g, b), d = v - Math.min(r, g, b);
    if (!v || d / v <= .35) return -1;
    return ((v === r ? (g - b) / d : v === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60 + 360) % 360;
  };
  for (let p = 0; p < gray.length; p++) if (inner[p] && gray[p] > foam + 10) {
    const angle = hue(p); if (angle >= 0) bins[Math.floor(angle / 10)]++;
  }
  let mode = 0; for (let i = 1; i < bins.length; i++) if (bins[i] > bins[mode]) mode = i;
  const minimum = gray.length * .005;
  if (bins[mode] < minimum) return null;
  const histograms = Array.from({ length: 3 }, () => new Uint32Array(256)); let samples = 0;
  for (let p = 0; p < gray.length; p++) if (inner[p] && gray[p] > foam + 10) {
    const angle = hue(p), delta = Math.abs(angle - (mode * 10 + 5));
    if (angle < 0 || Math.min(delta, 360 - delta) >= 6) continue;
    const v = Math.max(red[p], green[p], blue[p]); samples++;
    histograms[0][Math.round(red[p] * 255 / v)]++; histograms[1][Math.round(green[p] * 255 / v)]++; histograms[2][Math.round(blue[p] * 255 / v)]++;
  }
  if (samples < minimum) return null;
  const colour = histograms.map(histogram => {
    let count = 0; for (let i = 0; i < histogram.length; i++) { count += histogram[i]; if (count >= samples / 2) return i / 255; }
    return 0;
  });
  const background = new Uint8Array(gray.length), neutral = new Uint8Array(gray.length);
  for (let p = 0; p < gray.length; p++) if (inner[p]) {
    const v = Math.max(red[p], green[p], blue[p]), saturation = v ? (v - Math.min(red[p], green[p], blue[p])) / v : 0;
    neutral[p] = +(gray[p] >= low && saturation < .25);
    background[p] = +(saturation > .35 && Math.max(Math.abs(red[p] / v - colour[0]), Math.abs(green[p] / v - colour[1]), Math.abs(blue[p] / v - colour[2])) < .075);
  }
  const { labels, sizes } = components(neutral, w, h);
  if (sizes.length > 4096) return null;
  const boxes = componentBounds(labels, sizes, w, h);
  const recesses = components(background, w, h);
  if (recesses.sizes.length > 4096) return null;
  const anchors = Array.from({ length: recesses.sizes.length }, () => []), links = anchors.map(() => new Set()), strips = [];
  const moments = new Float64Array(sizes.length * 5);
  const minimumPiece = Math.max(25, gray.length * .00006), pixels = sizes.map(size => size >= minimumPiece ? [] : null);
  for (let p = 0; p < labels.length; p++) if (labels[p] && pixels[labels[p]]) {
    const i = labels[p] * 5, x = p % w, y = (p - x) / w; pixels[labels[p]].push(p);
    moments[i] += x; moments[i + 1] += y; moments[i + 2] += x * x; moments[i + 3] += x * y; moments[i + 4] += y * y;
  }
  const supported = (x0, y0, x1, y1) => {
    let area = 0; const counts = new Map();
    for (let y = Math.max(0, y0); y <= Math.min(h - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(w - 1, x1); x++) {
      area++; const label = recesses.labels[y * w + x]; if (label) counts.set(label, (counts.get(label) || 0) + 1);
    }
    // A narrow web can touch only a small part of a wide socket body.
    return new Set([...counts].filter(([, count]) => count >= Math.max(3, area * .03)).map(([label]) => label));
  };
  let values = 0; const levels = new Uint32Array(256);
  const measure = (owner, x0, y0, x1, y1) => {
    for (let y = Math.max(0, y0); y <= Math.min(h - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(w - 1, x1); x++) {
      const p = y * w + x; if (recesses.labels[p] === owner) { levels[Math.max(red[p], green[p], blue[p])]++; values++; }
    }
  };
  for (let label = 1; label < boxes.length; label++) {
    if (!pixels[label]) continue;
    const n = sizes[label], i = label * 5, x = moments[i] / n, y = moments[i + 1] / n;
    const xx = moments[i + 2] / n - x * x, xy = moments[i + 3] / n - x * y, yy = moments[i + 4] / n - y * y;
    const spread = Math.hypot(xx - yy, 2 * xy), major = (xx + yy + spread) / 2, minor = Math.max(0, (xx + yy - spread) / 2);
    if (major < Math.max(1, minor * 3)) continue;
    const angle = .5 * Math.atan2(2 * xy, xx - yy), frame = { x, y, ax: Math.cos(angle), ay: Math.sin(angle), width: Math.max(2, Math.sqrt(12 * minor)) };
    const margin = Math.max(2, Math.ceil(Math.min(Math.min(w, h) * .03, frame.width)));
    // A few connected print/texture pixels must not move the sampling band away
    // from the body. These robust limits affect background learning only.
    const columns = new Uint32Array(w), rows = new Uint32Array(h);
    for (const p of pixels[label]) { columns[p % w]++; rows[Math.floor(p / w)]++; }
    const extent = (histogram, fraction) => { let count = 0; for (let i = 0; i < histogram.length; i++) { count += histogram[i]; if (count >= n * fraction) return i; } return histogram.length - 1; };
    const x0 = extent(columns, .025), x1 = extent(columns, .975), y0 = extent(rows, .025), y1 = extent(rows, .975);
    const sides = [[x0, y0 - margin, x1, y0 - 1], [x0, y1 + 1, x1, y1 + margin], [x0 - margin, y0, x0 - 1, y1], [x1 + 1, y0, x1 + margin, y1]];
    const owners = new Set(), sideOwners = sides.map(side => supported(...side));
    for (let side = 0; side < sides.length; side++) for (const owner of sideOwners[side]) { owners.add(owner); strips.push([owner, ...sides[side]]); }
    // Shadows can split one recess at a tool. Connect the material across the
    // long sides only; a coloured grip touching a metal end is not background.
    const pair = Math.abs(frame.ax) >= Math.abs(frame.ay) ? [0, 1] : [2, 3];
    for (const a of sideOwners[pair[0]]) for (const b of sideOwners[pair[1]]) if (a !== b) { links[a].add(b); links[b].add(a); }
    for (const owner of owners) anchors[owner].push(frame);
  }
  const proven = anchors.map(parts => {
    if (parts.length > 512) return false;
    for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
      const a = parts[i], b = parts[j], dx = b.x - a.x, dy = b.y - a.y, distance = Math.hypot(dx, dy);
      // A grip between aligned metal ends belongs to one tool. A recess web
      // between parallel tools runs across their axes instead.
      if (distance > Math.max(a.width, b.width) * 1.2 && Math.abs(a.ax * b.ax + a.ay * b.ay) > .8
        && Math.abs(dx * a.ay - dy * a.ax) > distance * .75 && Math.abs(dx * b.ay - dy * b.ax) > distance * .75) return true;
    }
    return false;
  });
  if (!proven.some(Boolean)) return null;
  const connected = proven.flatMap((yes, i) => yes ? [i] : []);
  while (connected.length) for (const other of links[connected.pop()]) if (!proven[other]) { proven[other] = true; connected.push(other); }
  for (const strip of strips) if (proven[strip[0]]) measure(...strip);
  const enclosed = fillHoles(background, w, h), filledRegions = components(enclosed, w, h), holes = new Uint32Array(filledRegions.sizes.length);
  const colourBoxes = componentBounds(recesses.labels, recesses.sizes, w, h), protect = new Uint8Array(recesses.sizes.length);
  for (let p = 0; p < enclosed.length; p++) if (enclosed[p] && !background[p]) holes[filledRegions.labels[p]]++;
  const enclosedArea = new Uint32Array(recesses.sizes.length);
  for (let p = 0; p < background.length; p++) if (background[p]) enclosedArea[recesses.labels[p]] = holes[filledRegions.labels[p]];
  const endAnchor = (b, horizontal) => {
    const reach = Math.max(2, Math.ceil(Math.min(w, h) * .01)), cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    const ends = horizontal
      ? [[b.x0 - reach, b.y0, b.x0 + reach, b.y1], [b.x1 - reach, b.y0, b.x1 + reach, b.y1]]
      : [[b.x0, b.y0 - reach, b.x1, b.y0 + reach], [b.x0, b.y1 - reach, b.x1, b.y1 + reach]];
    for (const [x0, y0, x1, y1] of ends) for (let y = Math.max(0, y0); y <= Math.min(h - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(w - 1, x1); x++) {
      const label = labels[y * w + x]; if (!label || !pixels[label]) continue;
      const nx = moments[label * 5] / sizes[label], ny = moments[label * 5 + 1] / sizes[label];
      if (horizontal ? ((nx < b.x0 || nx > b.x1) && Math.abs(ny - cy) <= (b.y1 - b.y0 + 1) * .6)
        : ((ny < b.y0 || ny > b.y1) && Math.abs(nx - cx) <= (b.x1 - b.x0 + 1) * .6)) return true;
    }
    return false;
  };
  for (let label = 1; label < colourBoxes.length; label++) {
    const b = colourBoxes[label], width = b.x1 - b.x0 + 1, height = b.y1 - b.y0 + 1, area = width * height;
    if (proven[label] || recesses.sizes[label] <= area * .6) continue;
    // Dense coloured bodies with an inset or a metal end remain plausible tools
    // even when a confirmed recess elsewhere has exactly the same colour.
    if (enclosedArea[label] >= Math.max(9, area * .1)
      || (width > height * 2 && endAnchor(b, true)) || (height > width * 2 && endAnchor(b, false))) protect[label] = 1;
  }
  const quantile = fraction => { let count = 0; for (let i = 0; i < levels.length; i++) { count += levels[i]; if (count >= values * fraction) return i; } return 255; };
  const minimumLevel = quantile(.05) - 12, maximumLevel = quantile(.95) + 12;
  // The same hue can belong to a brighter or darker tool. Only the measured
  // background brightness band is removable, not every pixel of that colour.
  for (let p = 0; p < background.length; p++) if (background[p]) {
    const value = Math.max(red[p], green[p], blue[p]);
    if (protect[recesses.labels[p]] || value < minimumLevel || value > maximumLevel) background[p] = 0;
  }
  return background;
}

// Small aligned glyphs, and joined words with repeated vertical strokes, are
// printed markings. Do this before closing can join their strokes into a blob.
function removePrintedWords(mask, w, h, side) {
  const { labels, sizes } = components(mask, w, h);
  if (sizes.length > 4096) return;
  const boxes = componentBounds(labels, sizes, w, h);
  const maxHeight = Math.min(12, Math.max(6, side * .025)), glyphs = [], drop = new Uint8Array(sizes.length);
  for (let label = 1; label < boxes.length; label++) {
    const b = boxes[label], width = b.x1 - b.x0 + 1, height = b.y1 - b.y0 + 1;
    if (height < 3 || height > maxHeight || sizes[label] < 3) continue;
    // Dense small parts are not glyphs merely because they form a row. This
    // protects both recovered socket disks and narrow solid pieces.
    if (width <= height * 2 && sizes[label] / (width * height) > .65) continue;
    if (width <= height * 2) { glyphs.push({ ...b, label, height }); continue; }
    let repeated = 0;
    for (let y = b.y0; y <= b.y1; y++) {
      let runs = 0, previous = false;
      for (let x = b.x0; x <= b.x1; x++) { const here = labels[y * w + x] === label; if (here && !previous) runs++; previous = here; }
      if (runs >= 3) repeated++;
    }
    if (repeated >= 2) drop[label] = 1;
  }
  if (glyphs.length <= 512) {
    glyphs.sort((a, b) => a.x0 - b.x0);
    const parents = glyphs.map((_, i) => i), find = i => parents[i] === i ? i : (parents[i] = find(parents[i]));
    for (let i = 0; i < glyphs.length; i++) for (let j = i + 1; j < glyphs.length; j++) {
      const a = glyphs[i], b = glyphs[j], height = Math.max(a.height, b.height);
      if (b.x0 - a.x1 > maxHeight) break;
      const gap = b.x0 - a.x1 - 1, overlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) + 1;
      if (gap >= 0 && gap <= height * .8 && overlap >= Math.min(a.height, b.height) * .6 && Math.min(a.height, b.height) >= height * .5) parents[find(j)] = find(i);
    }
    const groups = new Map();
    for (let i = 0; i < glyphs.length; i++) { const root = find(i); if (!groups.has(root)) groups.set(root, []); groups.get(root).push(glyphs[i]); }
    for (const group of groups.values()) {
      const width = Math.max(...group.map(g => g.x1)) - Math.min(...group.map(g => g.x0)) + 1;
      const height = Math.max(...group.map(g => g.y1)) - Math.min(...group.map(g => g.y0)) + 1;
      if (group.length >= 3 || (group.length >= 2 && width >= height * 3)) for (const g of group) drop[g.label] = 1;
    }
  }
  let removed = false;
  for (let p = 0; p < labels.length; p++) if (drop[labels[p]]) { removed ||= !!mask[p]; mask[p] = 0; }
  return removed;
}

// A thin socket rim can disappear, or open into an arc, when spurs are removed.
// Recover its enclosed interior and observed rim, without adding the outer pixels
// of closing: those pixels could join a nearby label or another tool.
function preserveHollowTools(source, cleaned, w, h, side) {
  const closed = erode(dilate(source, w, h, 1.5), w, h, 1.5);
  const filled = fillHoles(closed, w, h), cleanedFill = fillHoles(cleaned, w, h);
  const { labels, sizes } = components(filled, w, h);
  const holes = new Uint32Array(sizes.length), covered = new Uint32Array(sizes.length);
  const observed = new Uint32Array(sizes.length), retained = new Uint32Array(sizes.length);
  const x0 = new Uint32Array(sizes.length).fill(w), y0 = new Uint32Array(sizes.length).fill(h);
  const x1 = new Uint32Array(sizes.length), y1 = new Uint32Array(sizes.length);
  for (let p = 0; p < labels.length; p++) {
    const label = labels[p]; if (!label) continue;
    const x = p % w, y = (p - x) / w;
    holes[label] += +!closed[p]; covered[label] += +(!closed[p] && cleanedFill[p]);
    observed[label] += source[p]; retained[label] += cleaned[p];
    x0[label] = Math.min(x0[label], x); x1[label] = Math.max(x1[label], x);
    y0[label] = Math.min(y0[label], y); y1[label] = Math.max(y1[label], y);
  }
  const recover = sizes.map((area, label) => {
    const width = x1[label] - x0[label] + 1, height = y1[label] - y0[label] + 1;
    // Require a substantial opening inside a compact silhouette. Long case
    // hardware, joined tools and tiny printed loops do not qualify.
    return holes[label] >= Math.max(9, area * .12)
      && Math.min(width, height) >= Math.max(5, side * .012)
      && Math.max(width, height) <= Math.min(width, height) * 1.5
      && (covered[label] < holes[label] * .5 || retained[label] < observed[label] * .8);
  });
  for (let p = 0; p < cleaned.length; p++) {
    if (recover[labels[p]] && (source[p] || !closed[p])) cleaned[p] = 1;
  }
}

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
  const drop = sizes.map((size, label) => {
    const width = x1[label] - x0[label] + 1, height = y1[label] - y0[label] + 1;
    // Proximity to an edge alone does not make a tool part of the frame.
    const rail = Math.max(width, height) > Math.min(width, height) * 12
      && depth[label] < side * RAIL_BAND && Math.max(width, height) > side * RAIL_LENGTH;
    return label && (contact[label] / size > RIM_CONTACT || rail);
  });
  for (let p = 0; p < bright.length; p++) if (drop[labels[p]]) bright[p] = 0;
}

/**
 * Light tools on a dark case insert or a dark mat: the surface is found, everything else turns white, brightness inside is reversed.
 * Also prepares reflective tools on a plain light background without moving pixels.
 * Returns {image,name:'dark-tray'|'light-background'|'plain-background'} or null.
 */
export function readableImage(image) {
  const light = lightBackgroundImage(image); if (light) return light;
  const plain = plainBackgroundImage(image) || darkMetalBackgroundImage(image);
  if (plain) {
    // Isolated size labels remain printing on a flat mat. Reuse the same
    // density-aware classifier as trays; dense small real parts stay intact.
    const { width, height, data } = plain.image;
    const mask = Uint8Array.from({ length: width * height }, (_, p) => +(data[p * 4] < 128));
    plain.ambiguousPrinting = !!removePrintedWords(mask, width, height, Math.min(width, height));
    for (let p = 0; p < mask.length; p++) if (!mask[p]) data[p * 4] = data[p * 4 + 1] = data[p * 4 + 2] = 255;
    return plain;
  }
  const grid = grayGrid(image), { gray, w, h, step } = grid, side = Math.min(w, h), darkLimit = clamp(otsu(gray) * .62, 45, 90);
  const surface = largest(Uint8Array.from(gray, v => +(v < darkLimit)), w, h);
  if (surface.size < gray.length * MIN_TRAY) return null;
  const filled = fillHoles(surface.mask, w, h);reopenBackground(filled, surface.mask, gray, w, h);
  // Opening removes narrow attached case hardware. Do not erode an extra rim:
  // real tools can reach that band, and cutting it would shorten their ends.
  // dropRim classifies complete bright pieces after segmentation instead.
  const opening = Math.max(3, side * .03);
  const core = largest(erode(filled, w, h, opening), w, h).mask, inner = dilate(core, w, h, opening);
  for (let i = 0; i < inner.length; i++) inner[i] &= filled[i];
  const split = otsu(gray, inner), darkLevels = [], brightLevels = [];
  for (let i = 0; i < gray.length; i++) if (inner[i]) (gray[i] < split ? darkLevels : brightLevels).push(gray[i]);
  const area = darkLevels.length + brightLevels.length, middle = list => list.sort((a, b) => a - b)[list.length >> 1] ?? 0;
  const brightShare = area ? brightLevels.length / area : 0, foam = middle(darkLevels), metal = middle(brightLevels);
  if (brightShare < MIN_BRIGHT || brightShare > MAX_BRIGHT || metal - foam < MIN_CONTRAST) return null;
  const low = (foam + split) / 2, bright = new Uint8Array(gray.length);
  const recess = colouredRecess(grid, inner, foam, low);
  for (let i = 0; i < gray.length; i++) bright[i] = +(inner[i] && gray[i] >= low && !recess?.[i]);
  // Opening cuts thin spurs, so hardware that only brushes a tool does not lengthen it.
  const spur = Math.max(1, side * .003), trimmed = dilate(erode(bright, w, h, spur), w, h, spur);
  const sourceBright = bright.slice();
  for (let i = 0; i < bright.length; i++) bright[i] &= trimmed[i];
  preserveHollowTools(sourceBright, bright, w, h, side);
  removePrintedWords(bright, w, h, side);
  dropRim(bright, inner, w, h, side);
  // Closing fills engraved markings that would otherwise notch the outline of a tool.
  const engraving = Math.max(1, side * .004), solid = erode(dilate(bright, w, h, engraving), w, h, engraving);
  const { width, height, data } = image, result = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const cell = Math.floor(y / step) * w + Math.floor(x / step), p = y * width + x, source = p * 4;
    // Keep every accepted foreground colour visibly separated from the paper
    // representation, including darker coloured grips just above the split.
    const value = !solid[cell] ? 255 : sourceBright[cell] ? 255 * (1 - clamp((lum(data[source], data[source + 1], data[source + 2]) - foam) / Math.max(1, split - foam), 0, 1)) : 0;
    result[source] = result[source + 1] = result[source + 2] = value; result[source + 3] = 255;
  }
  return { name: 'dark-tray', image: { width, height, data: result } };
}
