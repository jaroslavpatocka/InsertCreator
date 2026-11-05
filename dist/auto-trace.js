import { traceMask, polygonArea } from './trace.js';
import { regularizeContour, CONTOUR_SMOOTHING_MM } from './contour-smoothing.js';

// These are measured image-evidence scores, not a probability of dimensional accuracy.
// A single photograph cannot recover an edge with the same appearance as its background.
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const pause = () => new Promise(resolve => setTimeout(resolve, 0));
const lum = (r, g, b) => .2126 * r + .7152 * g + .0722 * b;
const median = values => { if (!values.length) return 0; values.sort((a, b) => a - b); return values[Math.floor(values.length / 2)]; };
const basis = (x, y) => [1, x, y, x * x, x * y, y * y];
const evaluate = (c, x, y) => c[0] + c[1] * x + c[2] * y + c[3] * x * x + c[4] * x * y + c[5] * y * y;

function solve(matrix, rhs) {
  const a = matrix.map((row, i) => [...row, rhs[i]]), size = rhs.length;
  for (let j = 0; j < size; j++) {
    let pivot = j;
    for (let i = j + 1; i < size; i++) if (Math.abs(a[i][j]) > Math.abs(a[pivot][j])) pivot = i;
    [a[pivot], a[j]] = [a[j], a[pivot]];
    if (Math.abs(a[j][j]) < 1e-9) return [median(rhs), 0, 0, 0, 0, 0];
    const denominator = a[j][j];
    for (let k = j; k <= size; k++) a[j][k] /= denominator;
    for (let i = 0; i < size; i++) if (i !== j) { const f = a[i][j]; for (let k = j; k <= size; k++) a[i][k] -= f * a[j][k]; }
  }
  return a.map(row => row[size]);
}

function fit(samples, weights, channel) {
  const matrix = Array.from({ length: 6 }, () => Array(6).fill(0)), rhs = Array(6).fill(0);
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i], b = basis(s.x, s.y), weight = weights[i];
    for (let j = 0; j < 6; j++) { rhs[j] += b[j] * s[channel] * weight; for (let k = 0; k < 6; k++) matrix[j][k] += b[j] * b[k] * weight; }
  }
  for (let i = 0; i < 6; i++) matrix[i][i] += .00001;
  return solve(matrix, rhs);
}

function prepare(image, probability) {
  if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 16 || image.height < 16 || image.width * image.height > 16000000 || image.data?.length !== image.width * image.height * 4) throw new Error('Fotografie nemá platná obrazová data nebo je příliš velká.');
  if (probability && probability.length !== image.width * image.height) throw new Error('Maska automatického modelu má jiný rozměr než fotografie.');
  const scale = Math.min(1, Math.sqrt(1000000 / (image.width * image.height)));
  const width = Math.max(16, Math.round(image.width * scale)), height = Math.max(16, Math.round(image.height * scale)), data = new Uint8ClampedArray(width * height * 4), gray = new Float32Array(width * height), prior = probability ? new Float32Array(width * height) : null;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sx = Math.min(image.width - 1, Math.floor((x + .5) * image.width / width)), sy = Math.min(image.height - 1, Math.floor((y + .5) * image.height / height));
    const source = (sy * image.width + sx) * 4, target = (y * width + x) * 4, alpha = image.data[source + 3] / 255;
    for (let k = 0; k < 3; k++) data[target + k] = image.data[source + k] * alpha + 255 * (1 - alpha);
    data[target + 3] = 255; gray[y * width + x] = lum(data[target], data[target + 1], data[target + 2]);
    if (prior) prior[y * width + x] = clamp(Number(probability[sy * image.width + sx]) || 0);
  }
  return { width, height, data, gray, prior, scaleX: image.width / width, scaleY: image.height / height };
}

function paperModel(im) {
  const { width, height, data, gray } = im, nx = clamp(Math.round(width / 85), 4, 12), ny = clamp(Math.round(height / 85), 4, 14), samples = [];
  for (let gy = 0; gy < ny; gy++) for (let gx = 0; gx < nx; gx++) {
    const x0 = Math.floor(gx * width / nx), x1 = Math.floor((gx + 1) * width / nx), y0 = Math.floor(gy * height / ny), y1 = Math.floor((gy + 1) * height / ny), histogram = new Uint32Array(256);
    let count = 0;
    for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) { histogram[Math.round(gray[y * width + x])]++; count++; }
    const quantile = q => { let sum = 0; for (let i = 0; i < 256; i++) if ((sum += histogram[i]) >= count * q) return i; return 255; };
    const lo = quantile(.78), hi = quantile(.97); let r = 0, g = 0, b = 0, xx = 0, yy = 0, selected = 0;
    for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) { const p = y * width + x, value = gray[p]; if (value < lo - .5 || value > hi + .5) continue; r += data[p * 4]; g += data[p * 4 + 1]; b += data[p * 4 + 2]; xx += x; yy += y; selected++; }
    if (selected) samples.push({ x: xx / selected / width * 2 - 1, y: yy / selected / height * 2 - 1, r: r / selected, g: g / selected, b: b / selected, l: lum(r / selected, g / selected, b / selected) });
  }
  let weights = samples.map(() => 1), coefficients;
  for (let iteration = 0; iteration < 5; iteration++) {
    coefficients = ['r', 'g', 'b'].map(channel => fit(samples, weights, channel));
    const errors = samples.map(s => s.l - lum(...coefficients.map(c => evaluate(c, s.x, s.y))));
    const robustScale = Math.max(2, median(errors.map(Math.abs)) * 1.4826);
    weights = errors.map(e => e < -Math.max(9, robustScale * 1.6) ? .025 : e > Math.max(13, robustScale * 2) ? .1 : 1);
  }
  const residuals = samples.filter((_, i) => weights[i] > .5).map(s => Math.abs(s.l - lum(...coefficients.map(c => evaluate(c, s.x, s.y)))));
  return { coefficients, fitResidual: median(residuals), paperLevel: median(samples.filter((_, i) => weights[i] > .5).map(s => s.l)), inlierFraction: weights.filter(w => w > .5).length / samples.length };
}

function boxBlur(values, width, height) {
  const result = new Float32Array(values.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let sum = 0, count = 0;
    for (let yy = Math.max(0, y - 1); yy <= Math.min(height - 1, y + 1); yy++) for (let xx = Math.max(0, x - 1); xx <= Math.min(width - 1, x + 1); xx++) { sum += values[yy * width + xx]; count++; }
    result[y * width + x] = sum / count;
  }
  return result;
}

function imageFeatures(im, model) {
  const { width, height, data, gray } = im, dark = new Float32Array(gray.length), color = new Float32Array(gray.length), bright = new Float32Array(gray.length), edge = new Float32Array(gray.length), direction = new Uint8Array(gray.length);
  const rawNoise = [], paperValues = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = y * width + x, xn = x / width * 2 - 1, yn = y / height * 2 - 1;
    const br = clamp(evaluate(model.coefficients[0], xn, yn), 55, 255), bg = clamp(evaluate(model.coefficients[1], xn, yn), 55, 255), bb = clamp(evaluate(model.coefficients[2], xn, yn), 55, 255);
    const background = lum(br, bg, bb), r = data[p * 4], g = data[p * 4 + 1], b = data[p * 4 + 2], factor = (r * br + g * bg + b * bb) / (br * br + bg * bg + bb * bb), normalize = 255 / Math.max(80, background);
    dark[p] = Math.max(0, background - gray[p]) * normalize; bright[p] = Math.max(0, gray[p] - background) * normalize;
    color[p] = Math.sqrt(((r - factor * br) ** 2 + (g - factor * bg) ** 2 + (b - factor * bb) ** 2) / 3) * normalize;
    if (x > 1 && x % 7 === 0 && y > 1 && y % 7 === 0 && dark[p] < 7 && bright[p] < 7 && color[p] < 5) { rawNoise.push(Math.abs(gray[p] - gray[p - 1])); paperValues.push(background); }
  }
  const smooth = boxBlur(gray, width, height), smoothColor = boxBlur(color, width, height);
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const p = y * width + x;
    let dx = smooth[p + 1] - smooth[p - 1], dy = smooth[p + width] - smooth[p - width];
    const cx = smoothColor[p + 1] - smoothColor[p - 1], cy = smoothColor[p + width] - smoothColor[p - width];
    if (cx * cx + cy * cy > dx * dx + dy * dy) { dx = cx; dy = cy; }
    edge[p] = Math.hypot(dx, dy) / 2;
    direction[p] = Math.abs(dy) <= Math.abs(dx) * .4142 ? 0 : Math.abs(dx) <= Math.abs(dy) * .4142 ? 2 : dx * dy > 0 ? 1 : 3;
  }
  const noise = Math.max(.35, median(rawNoise) / .954), gradientThreshold = Math.max(3.2, noise * 2.8);
  return { dark, color, bright, edge, direction, noise, gradientThreshold, illuminationRange: paperValues.length ? Math.max(...paperValues) - Math.min(...paperValues) : 0 };
}

function morph(mask, width, height, dilate) {
  const result = new Uint8Array(mask.length);
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const p = y * width + x;
    if (dilate) result[p] = +(mask[p - width - 1] || mask[p - width] || mask[p - width + 1] || mask[p - 1] || mask[p] || mask[p + 1] || mask[p + width - 1] || mask[p + width] || mask[p + width + 1]);
    else result[p] = +(mask[p - width - 1] && mask[p - width] && mask[p - width + 1] && mask[p - 1] && mask[p] && mask[p + 1] && mask[p + width - 1] && mask[p + width] && mask[p + width + 1]);
  }
  return result;
}

function close(mask, width, height) { return morph(morph(mask, width, height, true), width, height, false); }

function enclosedEdges(im, features, probability = null) {
  const { width, height } = im, barrier = new Uint8Array(width * height);
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const i = y * width + x, gradient = features.edge[i], direction = features.direction[i];
    const offset = direction === 0 ? 1 : direction === 2 ? width : direction === 1 ? width + 1 : width - 1;
    // Nonmaximum suppression locates a gradient ridge rather than tracing the
    // outside of the entire blur band, which would enlarge every dark object.
    barrier[i] = +(gradient >= features.gradientThreshold && gradient > features.edge[i - offset] && gradient >= features.edge[i + offset] && (!probability || probability[i] > .025));
  }
  const walls = close(barrier, width, height), outside = new Uint8Array(walls.length), queue = new Int32Array(walls.length); let head = 0, tail = 0;
  const push = p => { if (!walls[p] && !outside[p]) { outside[p] = 1; queue[tail++] = p; } };
  for (let x = 0; x < width; x++) { push(x); push((height - 1) * width + x); }
  for (let y = 1; y < height - 1; y++) { push(y * width); push(y * width + width - 1); }
  // A model's high-certainty background is another flood-fill source. The model
  // restricts object identity; actual pixel gradients still determine the boundary.
  if (probability) for (let i = 0; i < probability.length; i++) if (probability[i] < .025 && i % 3 === 0) push(i);
  while (head < tail) {
    const p = queue[head++], x = p % width;
    if (x) push(p - 1); if (x + 1 < width) push(p + 1); if (p >= width) push(p - width); if (p + width < walls.length) push(p + width);
  }
  const mask = new Uint8Array(walls.length);
  for (let i = 0; i < mask.length; i++) mask[i] = +(walls[i] || !outside[i]);
  return mask;
}

function rasterize(contours, width, height) {
  const mask = new Uint8Array(width * height);
  for (const contour of contours) {
    const points = contour.points, ymin = Math.max(0, Math.floor(Math.min(...points.map(p => p.y)))), ymax = Math.min(height - 1, Math.ceil(Math.max(...points.map(p => p.y))));
    for (let y = ymin; y <= ymax; y++) {
      const scan = y + .5, intersections = [];
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) { const a = points[i], b = points[j]; if ((a.y > scan) !== (b.y > scan)) intersections.push(a.x + (scan - a.y) * (b.x - a.x) / (b.y - a.y)); }
      intersections.sort((a, b) => a - b);
      for (let i = 0; i + 1 < intersections.length; i += 2) {
        const from = Math.max(0, Math.ceil(intersections[i] - .5)), to = Math.min(width - 1, Math.floor(intersections[i + 1] - .5));
        mask.fill(1, y * width + from, y * width + to + 1);
      }
    }
  }
  return mask;
}

function boundaryEvidence(contour, features, width, height) {
  let supported = 0, strength = 0, perimeter = 0, count = 0;
  for (let i = 0; i < contour.points.length; i++) {
    const a = contour.points[i], b = contour.points[(i + 1) % contour.points.length], length = Math.hypot(b.x - a.x, b.y - a.y), steps = Math.max(1, Math.ceil(length / 2)); perimeter += length;
    for (let j = 0; j < steps; j++) {
      const x = Math.round(a.x + (b.x - a.x) * j / steps), y = Math.round(a.y + (b.y - a.y) * j / steps); let gradient = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (x + dx >= 0 && y + dy >= 0 && x + dx < width && y + dy < height) gradient = Math.max(gradient, features.edge[(y + dy) * width + x + dx]);
      supported += +(gradient >= features.gradientThreshold * 1.12); strength += clamp(gradient / (features.gradientThreshold * 3)); count++;
    }
  }
  const xs = contour.points.map(p => p.x), ys = contour.points.map(p => p.y);
  return { coverage: count ? supported / count : 0, strength: count ? strength / count : 0, perimeter, thickness: perimeter ? 2 * Math.abs(polygonArea(contour.points)) / perimeter : 0, bounds: { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) } };
}

function overlap(a, b) {
  let intersection = 0, union = 0;
  for (let i = 0; i < a.length; i++) { intersection += +(a[i] && b[i]); union += +(a[i] || b[i]); }
  return union ? intersection / union : 0;
}

function contourAxis(points) {
  // Area moments avoid bias from unevenly spaced vertices on simplified contours.
  let weight = 0, cx = 0, cy = 0, xx = 0, yy = 0, xy = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i], q = points[(i + 1) % points.length], cross = p.x * q.y - q.x * p.y;
    weight += cross; cx += (p.x + q.x) * cross; cy += (p.y + q.y) * cross;
    xx += (p.x * p.x + p.x * q.x + q.x * q.x) * cross;
    yy += (p.y * p.y + p.y * q.y + q.y * q.y) * cross;
    xy += (2 * p.x * p.y + p.x * q.y + q.x * p.y + 2 * q.x * q.y) * cross;
  }
  cx /= 3 * weight; cy /= 3 * weight;
  const angle = .5 * Math.atan2(2 * (xy / (12 * weight) - cx * cy), xx / (6 * weight) - cx * cx - yy / (6 * weight) + cy * cy);
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

function projection(points, axis) {
  let lo = Infinity, hi = -Infinity;
  for (const p of points) { const v = p.x * axis.x + p.y * axis.y; lo = Math.min(lo, v); hi = Math.max(hi, v); }
  return { lo, hi, length: hi - lo };
}

function pointSegmentDistance(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
  const t = length ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / length) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

function hasWidthTransition(points, axis) {
  const along = projection(points, axis), normal = { x: -axis.y, y: axis.x }, widths = [];
  for (let sample = 1; sample < 20; sample++) {
    const s = along.lo + along.length * sample / 20, crossings = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length], sa = a.x * axis.x + a.y * axis.y, sb = b.x * axis.x + b.y * axis.y;
      if ((sa > s) !== (sb > s)) { const t = (s - sa) / (sb - sa); crossings.push((a.x + (b.x - a.x) * t) * normal.x + (a.y + (b.y - a.y) * t) * normal.y); }
    }
    if (crossings.length >= 2) widths.push(Math.max(...crossings) - Math.min(...crossings));
  }
  widths.sort((a, b) => a - b);
  // Sustained narrow and broad sections distinguish two whole variable-width
  // outlines from the uniform shaft and separate handle of one broken outline.
  return widths.length >= 12 && widths[Math.floor(widths.length * .8)] > widths[Math.floor(widths.length * .2)] * 1.7;
}

function possibleFragments(a, b, pxPerMm) {
  const aa = contourAxis(a.contour.points), ba = contourAxis(b.contour.points);
  const alignment = aa.x * ba.x + aa.y * ba.y;
  if (Math.abs(alignment) < .94) return false;
  const sign = alignment < 0 ? -1 : 1, length = Math.hypot(aa.x + sign * ba.x, aa.y + sign * ba.y);
  const axis = { x: (aa.x + sign * ba.x) / length, y: (aa.y + sign * ba.y) / length }, normal = { x: -axis.y, y: axis.x };
  const al = projection(a.contour.points, axis), bl = projection(b.contour.points, axis);
  const aw = projection(a.contour.points, normal), bw = projection(b.contour.points, normal);
  const gap = Math.max(al.lo - bl.hi, bl.lo - al.hi);
  const limit = Math.max(2, pxPerMm * 4);
  // Side-by-side tools have overlapping longitudinal intervals. Only aligned
  // end-to-end pieces can be a shaft separated from its handle by a reflection.
  if (gap <= 0 || gap >= limit || Math.min(al.length / Math.max(1, aw.length), bl.length / Math.max(1, bw.length)) < 1.5) return false;
  if (Math.min(aw.hi, bw.hi) - Math.max(aw.lo, bw.lo) < Math.min(aw.length, bw.length) * .65) return false;
  if (hasWidthTransition(a.contour.points, axis) && hasWidthTransition(b.contour.points, axis)) return false;
  const ap = a.contour.points, bp = b.contour.points;
  for (let i = 0; i < ap.length; i++) for (let j = 0; j < bp.length; j++) {
    if (pointSegmentDistance(ap[i], bp[j], bp[(j + 1) % bp.length]) < limit || pointSegmentDistance(bp[j], ap[i], ap[(i + 1) % ap.length]) < limit) return true;
  }
  return false;
}

function independentStems(pieces, axis, labels, binary, im, features, pxPerMm) {
  const normal = { x: -axis.y, y: axis.x }, step = .5;
  const spans = pieces.map(piece => ({ id: piece.componentId, along: projection(piece.points, axis), across: projection(piece.points, normal) })).sort((a, b) => a.across.lo + a.across.hi - b.across.lo - b.across.hi);
  for (let i = 1; i < spans.length; i++) {
    const a = spans[i - 1], b = spans[i], lo = Math.max(a.along.lo, b.along.lo), hi = Math.min(a.along.hi, b.along.hi);
    let supported = 0;
    for (let sample = 1; sample < 48; sample++) {
      const s = lo + (hi - lo) * sample / 48; let seenA = false, gap = 0;
      for (let t = a.across.lo; t <= b.across.hi; t += step) {
        const x = Math.floor(axis.x * s + normal.x * t), y = Math.floor(axis.y * s + normal.y * t);
        if (x < 0 || y < 0 || x >= im.width || y >= im.height) { seenA = false; gap = 0; continue; }
        const p = y * im.width + x;
        if (labels[p] === a.id) { seenA = true; gap = 0; }
        else if (labels[p] === b.id) {
          if (seenA && gap >= Math.max(1, pxPerMm * .25)) { supported++; break; }
          seenA = false; gap = 0;
        } else if (seenA && !binary[p] && features.dark[p] < Math.max(8, features.noise * 3.5) && features.color[p] < Math.max(6, features.noise * 3) && features.bright[p] < Math.max(8, features.noise * 3.5)) gap += step;
        // An antialiased rim can sit between a labelled region and clean paper.
        // Keep which object we left, but count only pixels supported as paper.
        else gap = 0;
      }
    }
    // A paint seam alone is not evidence of two objects. Require a visible run
    // of paper between two independently exposed parts outside their contact.
    if (supported < 3) return false;
  }
  return true;
}

function separateTouching(binary, result, im, features, pxPerMm, options) {
  const { width, height, data } = im, axes = new Map(), barriers = new Uint8Array(binary.length);
  for (const contour of result.contours) {
    const axis = contourAxis(contour.points), along = projection(contour.points, axis), across = projection(contour.points, { x: -axis.y, y: axis.x });
    if (along.length > across.length * 2.5) axes.set(contour.componentId, { axis, along, contour });
  }
  if (!axes.size) return result.contours;
  const threshold = Math.max(26, features.noise * 8); let edges = 0;
  const boundary = (p, q, vertical, axis) => {
    let delta = 0, gx = 0, gy = 0, strongest = 0;
    for (let c = 0; c < 3; c++) {
      const difference = data[q * 4 + c] - data[p * 4 + c]; delta += difference * difference;
      const dx = vertical ? (data[(p + 1) * 4 + c] + data[(q + 1) * 4 + c] - data[(p - 1) * 4 + c] - data[(q - 1) * 4 + c]) / 4 : difference;
      const dy = vertical ? difference : (data[(p + width) * 4 + c] + data[(q + width) * 4 + c] - data[(p - width) * 4 + c] - data[(q - width) * 4 + c]) / 4;
      const strength = dx * dx + dy * dy;
      if (strength > strongest) { strongest = strength; gx = dx; gy = dy; }
    }
    if (delta < threshold * threshold || !strongest) return false;
    const alongNormal = Math.abs(gx * axis.x + gy * axis.y) / Math.sqrt(strongest);
    const exterior = !binary[p - width] || !binary[p + width] || !binary[p - 1] || !binary[p + 1] || !binary[q - width] || !binary[q + width] || !binary[q - 1] || !binary[q + 1];
    // A shaft-to-handle transition is transverse. A separating contact edge runs
    // along the tools, from the visible gap between their shafts to the outside.
    return alongNormal < (exterior ? .85 : .55);
  };
  for (let y = 1; y < height - 2; y++) for (let x = 1; x < width - 2; x++) {
    const p = y * width + x, parent = result.labels[p], entry = axes.get(parent);
    if (!binary[p] || !entry) continue;
    if (binary[p + 1] && result.labels[p + 1] === parent && boundary(p, p + 1, false, entry.axis)) { barriers[p] |= 1; edges++; }
    if (binary[p + width] && result.labels[p + width] === parent && boundary(p, p + width, true, entry.axis)) { barriers[p] |= 2; edges++; }
  }
  if (!edges) return result.contours;
  const separated = traceMask(binary, width, height, { ...options, barriers, includeLabels: true }), groups = new Map();
  for (const contour of separated.contours) {
    const parent = result.labels[contour.seed];
    if (!groups.has(parent)) groups.set(parent, []);
    groups.get(parent).push(contour);
  }
  return result.contours.flatMap(original => {
    const entry = axes.get(original.componentId), pieces = groups.get(original.componentId);
    if (!entry || !pieces || pieces.length < 2) return [original];
    const complete = pieces.filter(piece => {
      const axis = contourAxis(piece.points), along = projection(piece.points, entry.axis), own = projection(piece.points, axis), across = projection(piece.points, { x: -axis.y, y: axis.x });
      return piece.area > original.area * .08 && along.length > entry.along.length * .72 && own.length > Math.max(across.length * 2.5, pxPerMm * 10) && Math.abs(axis.x * entry.axis.x + axis.y * entry.axis.y) > .92;
    });
    // Short paint patches, enclosed highlights and detached handles cannot stand
    // in for complete tools. Keep the original silhouette unless two long pieces
    // account for essentially all its measured foreground.
    if (complete.length < 2 || complete.reduce((sum, piece) => sum + piece.area, 0) < original.area * .92 || !independentStems(complete, entry.axis, separated.labels, binary, im, features, pxPerMm)) return [original];
    return complete;
  });
}

function evaluateCandidate(name, binary, im, features, pxPerMm, separated = false) {
  const options = { smoothing: Math.max(.25, .15 * pxPerMm), minArea: Math.max(im.width * im.height * .00016, 4 * pxPerMm * pxPerMm) };
  const result = traceMask(binary, im.width, im.height, { ...options, includeLabels: true });
  const contours = separateTouching(binary, result, im, features, pxPerMm, options);
  const measured = contours.map(contour => ({ contour, ...boundaryEvidence(contour, features, im.width, im.height) }));
  const accepted = measured.filter(c => (c.coverage >= .28 || c.strength >= .37) && c.thickness >= Math.max(1.15, .35 * pxPerMm) && c.contour.width >= 1.5 * pxPerMm && c.contour.height >= 1.5 * pxPerMm);
  const mask = rasterize(accepted.map(c => c.contour), im.width, im.height);
  let count = 0, strong = 0, prior = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) { count++; strong += +(features.dark[i] >= 24 || features.color[i] >= 12 || features.bright[i] >= 18); if (im.prior) prior += im.prior[i]; }
  let perimeter = 0, coverage = 0, strength = 0;
  for (const c of accepted) { perimeter += c.perimeter; coverage += c.coverage * c.perimeter; strength += c.strength * c.perimeter; }
  coverage = perimeter ? coverage / perimeter : 0; strength = perimeter ? strength / perimeter : 0;
  let fragments = 0;
  for (let i = 0; i < accepted.length; i++) for (let j = i + 1; j < accepted.length; j++) {
    if (possibleFragments(accepted[i], accepted[j], pxPerMm)) fragments++;
  }
  const fill = count / mask.length, foregroundEvidence = count ? strong / count : 0, neuralAgreement = count && im.prior ? prior / count : null;
  const rawScore = .44 * coverage + .28 * strength + .16 * foregroundEvidence + .12 - (separated ? 0 : Math.min(.25, fragments * .075) + Math.max(0, accepted.length - 15) * .012) - Math.max(0, fill - .65) * 1.5;
  const score = clamp(rawScore + (neuralAgreement === null ? 0 : (neuralAgreement - .55) * .18));
  return { name, contours: accepted.map(c => c.contour), mask, score, coverage, strength, foregroundEvidence, fragments, fill, rejected: measured.length - accepted.length, rawContours: measured.length, weakestCoverage: accepted.length ? Math.min(...accepted.map(c => c.coverage)) : 0, neuralAgreement, agreement: 0 };
}

function contoursTouch(a, b) {
  const cross = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const on = (p, q, r) => Math.abs(cross(p, q, r)) < 1e-8 && r.x >= Math.min(p.x, q.x) - 1e-8 && r.x <= Math.max(p.x, q.x) + 1e-8 && r.y >= Math.min(p.y, q.y) - 1e-8 && r.y <= Math.max(p.y, q.y) + 1e-8;
  const inside = (p, polygon) => {
    let result = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const p1 = polygon[i], p2 = polygon[j];
      if ((p1.y > p.y) !== (p2.y > p.y) && p.x < (p2.x - p1.x) * (p.y - p1.y) / (p2.y - p1.y) + p1.x) result = !result;
    }
    return result;
  };
  const box = points => points.reduce((b, p) => ({ x0: Math.min(b.x0, p.x), y0: Math.min(b.y0, p.y), x1: Math.max(b.x1, p.x), y1: Math.max(b.y1, p.y) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
  const aa = box(a), bb = box(b);
  if (aa.x1 < bb.x0 || bb.x1 < aa.x0 || aa.y1 < bb.y0 || bb.y1 < aa.y0) return false;
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) {
    const p = a[i], q = a[(i + 1) % a.length], r = b[j], s = b[(j + 1) % b.length];
    if ((cross(p, q, r) * cross(p, q, s) < 0 && cross(r, s, p) * cross(r, s, q) < 0) || on(p, q, r) || on(p, q, s) || on(r, s, p) || on(r, s, q)) return true;
  }
  return inside(a[0], b) || inside(b[0], a);
}

function regularizeCandidate(candidate, im, pxPerMm) {
  // Quality still describes the measured image edges. Only the chosen final
  // outlines are denoised, with the same physical budget at every photo scale.
  const points = candidate.contours.map(c => regularizeContour(c.points, CONTOUR_SMOOTHING_MM * pxPerMm));
  const blocked = new Set();
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
    // Check both possible fallbacks as well: smoothing must never join tools or
    // invade a measured neighbour, even when that neighbour cannot be smoothed.
    if (contoursTouch(points[i], points[j]) || contoursTouch(points[i], candidate.contours[j].points) || contoursTouch(candidate.contours[i].points, points[j])) { blocked.add(i); blocked.add(j); }
  }
  const contours = candidate.contours.map((c, i) => {
    if (blocked.has(i)) return c;
    const p = points[i], xs = p.map(p => p.x), ys = p.map(p => p.y);
    return { ...c, points: p, area: Math.abs(polygonArea(p)), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  });
  return { contours, mask: rasterize(contours, im.width, im.height) };
}

function restore(candidate, original, im) {
  const contours = candidate.contours.map(c => ({ ...c, points: c.points.map(p => ({ x: p.x * im.scaleX, y: p.y * im.scaleY })), area: c.area * im.scaleX * im.scaleY, width: c.width * im.scaleX, height: c.height * im.scaleY }));
  if (im.width === original.width && im.height === original.height) return { contours, mask: candidate.mask, width: original.width, height: original.height };
  const mask = new Uint8Array(original.width * original.height);
  for (let y = 0; y < original.height; y++) for (let x = 0; x < original.width; x++) mask[y * original.width + x] = candidate.mask[Math.min(im.height - 1, Math.floor(y / im.scaleY)) * im.width + Math.min(im.width - 1, Math.floor(x / im.scaleX))];
  return { contours, mask, width: original.width, height: original.height };
}

/**
 * Automatic foreground for calibrated, light plain paper. Processing is entirely local.
 * probability is an optional source-sized Float32Array (0..1) from a segmentation model.
 * onProgress receives {stage,progress,message}. score0to1 is a heuristic evidence score.
 */
export async function autoTraceImage(imageData, { pxPerMm = 1, kind = 'paper', probability = null, onProgress } = {}) {
  const started = performance.now(), progress = (stage, value, message) => { try { onProgress?.({ stage, progress: value, message }); } catch {} };
  progress('background', .03, 'Měřím barvu papíru a vyrovnávám osvětlení…'); await pause();
  const im = prepare(imageData, probability), scale = Number.isFinite(pxPerMm) && pxPerMm > 0 ? pxPerMm / im.scaleX : 1;
  const model = paperModel(im), features = imageFeatures(im, model);
  progress('foreground', .25, 'Odděluji nástroje od stínů a odlesků…'); await pause();
  const strict = new Uint8Array(im.width * im.height), sensitive = new Uint8Array(strict.length);
  const noise = features.noise, strictDark = Math.max(24, noise * 6), softDark = Math.max(7, noise * 3.5), strictColor = Math.max(12, noise * 4), softColor = Math.max(5, noise * 2.5), strictBright = Math.max(18, noise * 6), softBright = Math.max(6, noise * 3.5);
  for (let i = 0; i < strict.length; i++) { strict[i] = +(features.dark[i] >= strictDark || features.color[i] >= strictColor || features.bright[i] >= strictBright); sensitive[i] = +(features.dark[i] >= softDark || features.color[i] >= softColor || features.bright[i] >= softBright); }
  let clippedForeground = 0;
  for (let x = 0; x < im.width; x++) clippedForeground += strict[x] + strict[im.width + x] + strict[(im.height - 1) * im.width + x] + strict[(im.height - 2) * im.width + x];
  for (let y = 2; y < im.height - 2; y++) clippedForeground += strict[y * im.width] + strict[y * im.width + 1] + strict[y * im.width + im.width - 1] + strict[y * im.width + im.width - 2];
  const definitions = [{ name: 'paper-color', mask: strict }, { name: 'local-contrast', mask: sensitive }, { name: 'edge-flood', mask: enclosedEdges(im, features) }];
  if (im.prior) {
    // High-resolution color/edge candidates remain present; coarse neural contours
    // cannot override a better measured image boundary merely by being confident.
    const guided = enclosedEdges(im, features, im.prior), neural = new Uint8Array(im.prior.length);
    for (let i = 0; i < neural.length; i++) {
      neural[i] = +(im.prior[i] >= .5);
      guided[i] = +(im.prior[i] > .08 && (guided[i] || (im.prior[i] > .65 && sensitive[i])));
    }
    definitions.push({ name: 'neural-edge', mask: guided }, { name: 'neural-prior', mask: neural });
  }
  const candidates = [];
  for (let i = 0; i < definitions.length; i++) {
    progress('contours', .38 + i / definitions.length * .42, `Porovnávám automatické obrysy (${i + 1}/${definitions.length})…`); await pause();
    const definition = definitions[i]; candidates.push(evaluateCandidate(definition.name, definition.mask, im, features, scale, kind === 'tray')); definition.mask = null;
  }
  progress('quality', .9, 'Ověřuji souvislost hran a shodu metod…'); await pause();
  for (let i = 0; i < candidates.length; i++) for (let j = i + 1; j < candidates.length; j++) { const agreement = overlap(candidates[i].mask, candidates[j].mask); candidates[i].agreement = Math.max(candidates[i].agreement, agreement); candidates[j].agreement = Math.max(candidates[j].agreement, agreement); }
  for (const c of candidates) c.rank = c.score + c.agreement * .065 + (c.name === 'neural-prior' ? -.035 : 0);
  candidates.sort((a, b) => b.rank - a.rank);
  const best = candidates[0], reasons = [], methods = [...new Set(candidates.filter(c => c.contours.length && overlap(c.mask, best.mask) > .68).map(c => c.name))];
  let score = clamp(best.score * .88 + best.agreement * .12), status = 'ready';
  if (!best.contours.length) { status = 'retake'; score = 0; reasons.push('Není vidět dostatečně souvislý obrys nástroje. Vyfoťte jej na čistém světlém papíru v rozptýleném světle.'); }
  else {
    if (best.coverage < .74 || best.weakestCoverage < .58 || best.strength < .5) { status = 'review'; reasons.push('Část hrany je málo kontrastní nebo splývá se stínem. Přesnost této části nelze z fotografie spolehlivě ověřit.'); }
    if (best.agreement < .68 && !(best.coverage > .94 && best.strength > .78)) { status = 'review'; reasons.push('Nezávislé metody se neshodují na celém obrysu; fotografie obsahuje nejednoznačné odlesky či stíny.'); }
    // Tools in a case insert are many and deliberately kept apart, so neighbours are not fragments of one tool.
    if (kind !== 'tray' && (best.fragments > 0 || best.contours.length > 15)) { status = 'review'; reasons.push('Některé části mohou patřit ke stejnému nástroji. Ponechte mezi nástroji větší mezery a omezte odlesky.'); }
    if (kind === 'paper' && clippedForeground > Math.max(16, (im.width + im.height) * .02)) { status = 'review'; reasons.push('Nástroj nebo tmavé pozadí zasahuje k okraji papíru. Celý nástroj musí být uvnitř a všechny rohy papíru viditelné.'); }
    if (best.fill > .72) { status = 'review'; reasons.push('Nástroje zabírají téměř celou plochu. Nechte kolem nich více čistého papíru.'); }
    if (model.fitResidual > 10 || model.inlierFraction < .48) { status = 'review'; reasons.push('Pozadí se nepodobá rovnoměrně osvětlenému čistému papíru.'); }
    if (best.neuralAgreement !== null && best.neuralAgreement < .43) { status = 'review'; reasons.push('Obrazová hrana a rozpoznaný nástroj se neshodují. Zkuste fotografii bez stínů a dotýkajících se předmětů.'); }
    if (score < .43 || best.coverage < .32 || best.fill > .9) { status = 'retake'; reasons.push('Z této fotografie nelze získat dostatečně podloženou konturu pro výrobu.'); }
    if (status === 'ready' && score < .72) { status = 'review'; reasons.push('Obrys je předběžný; některé jeho části mají slabou obrazovou oporu.'); }
  }
  if (kind !== 'paper' && status === 'ready' && model.fitResidual > 5) { status = 'review'; reasons.push('U složitého pozadí pomůže fotografie nástroje na celém listu A4.'); }
  if (status === 'ready') reasons.push('Obrys má souvislou obrazovou hranu a automatické metody se na něm shodují.');
  const restored = restore(regularizeCandidate(best, im, scale), imageData, im);
  progress('complete', 1, status === 'ready' ? 'Kontury jsou připravené.' : 'Fotografie potřebuje ověření.');
  return { ...restored, threshold: strictDark, method: best.name, quality: { status, score0to1: score, reasons, methods }, diagnostics: { elapsedMs: performance.now() - started, processingWidth: im.width, processingHeight: im.height, noise: features.noise, backgroundResidual: model.fitResidual, illuminationRange: features.illuminationRange, boundaryCoverage: best.coverage, candidateAgreement: best.agreement, clippedForeground, candidates: candidates.map(c => ({ method: c.name, score: c.score, agreement: c.agreement, contours: c.contours.length, boundaryCoverage: c.coverage, areaFraction: c.fill, rejected: c.rejected, fragments: c.fragments, neuralAgreement: c.neuralAgreement })) } };
}
