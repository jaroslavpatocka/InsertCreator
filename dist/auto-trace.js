import { traceImage, polygonArea } from './trace.js';

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

function evaluateCandidate(name, binary, im, features, pxPerMm) {
  const rgba = new Uint8ClampedArray(binary.length * 4);
  for (let i = 0; i < binary.length; i++) { const value = binary[i] ? 0 : 255; rgba[i * 4] = value; rgba[i * 4 + 1] = value; rgba[i * 4 + 2] = value; rgba[i * 4 + 3] = 255; }
  const result = traceImage({ data: rgba, width: im.width, height: im.height }, { threshold: 127, smoothing: Math.max(.25, .15 * pxPerMm), minArea: Math.max(im.width * im.height * .00016, 4 * pxPerMm * pxPerMm) });
  const measured = result.contours.map(contour => ({ contour, ...boundaryEvidence(contour, features, im.width, im.height) }));
  const accepted = measured.filter(c => (c.coverage >= .28 || c.strength >= .37) && c.thickness >= Math.max(1.15, .35 * pxPerMm) && c.contour.width >= 1.5 * pxPerMm && c.contour.height >= 1.5 * pxPerMm);
  const mask = rasterize(accepted.map(c => c.contour), im.width, im.height);
  let count = 0, strong = 0, prior = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) { count++; strong += +(features.dark[i] >= 24 || features.color[i] >= 12 || features.bright[i] >= 18); if (im.prior) prior += im.prior[i]; }
  let perimeter = 0, coverage = 0, strength = 0;
  for (const c of accepted) { perimeter += c.perimeter; coverage += c.coverage * c.perimeter; strength += c.strength * c.perimeter; }
  coverage = perimeter ? coverage / perimeter : 0; strength = perimeter ? strength / perimeter : 0;
  let fragments = 0;
  for (let i = 0; i < accepted.length; i++) for (let j = i + 1; j < accepted.length; j++) {
    const a = accepted[i].bounds, b = accepted[j].bounds, dx = Math.max(0, a.x0 - b.x1, b.x0 - a.x1), dy = Math.max(0, a.y0 - b.y1, b.y0 - a.y1);
    const overlapX = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) / Math.max(1, Math.min(a.x1 - a.x0, b.x1 - b.x0));
    const overlapY = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)) / Math.max(1, Math.min(a.y1 - a.y0, b.y1 - b.y0));
    const collinearGap = (dx === 0 && dy > 0 && dy < pxPerMm * 4 && overlapX > .65) || (dy === 0 && dx > 0 && dx < pxPerMm * 4 && overlapY > .65);
    if (Math.hypot(dx, dy) < Math.max(2, pxPerMm * 1.2) || collinearGap) fragments++;
  }
  const fill = count / mask.length, foregroundEvidence = count ? strong / count : 0, neuralAgreement = count && im.prior ? prior / count : null;
  const rawScore = .44 * coverage + .28 * strength + .16 * foregroundEvidence + .12 - Math.min(.25, fragments * .075) - Math.max(0, fill - .65) * 1.5 - Math.max(0, accepted.length - 15) * .012;
  const score = clamp(rawScore + (neuralAgreement === null ? 0 : (neuralAgreement - .55) * .18));
  return { name, contours: accepted.map(c => c.contour), mask, score, coverage, strength, foregroundEvidence, fragments, fill, rejected: measured.length - accepted.length, rawContours: measured.length, weakestCoverage: accepted.length ? Math.min(...accepted.map(c => c.coverage)) : 0, neuralAgreement, agreement: 0 };
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
    const definition = definitions[i]; candidates.push(evaluateCandidate(definition.name, definition.mask, im, features, scale)); definition.mask = null;
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
    if (best.fragments > 0 || best.contours.length > 15) { status = 'review'; reasons.push('Některé části mohou patřit ke stejnému nástroji. Ponechte mezi nástroji větší mezery a omezte odlesky.'); }
    if (kind === 'paper' && clippedForeground > Math.max(16, (im.width + im.height) * .02)) { status = 'review'; reasons.push('Nástroj nebo tmavé pozadí zasahuje k okraji papíru. Celý nástroj musí být uvnitř a všechny rohy papíru viditelné.'); }
    if (best.fill > .72) { status = 'review'; reasons.push('Nástroje zabírají téměř celou plochu. Nechte kolem nich více čistého papíru.'); }
    if (model.fitResidual > 10 || model.inlierFraction < .48) { status = 'review'; reasons.push('Pozadí se nepodobá rovnoměrně osvětlenému čistému papíru.'); }
    if (best.neuralAgreement !== null && best.neuralAgreement < .43) { status = 'review'; reasons.push('Obrazová hrana a rozpoznaný nástroj se neshodují. Zkuste fotografii bez stínů a dotýkajících se předmětů.'); }
    if (score < .43 || best.coverage < .32 || best.fill > .9) { status = 'retake'; reasons.push('Z této fotografie nelze získat dostatečně podloženou konturu pro výrobu.'); }
    if (status === 'ready' && score < .72) { status = 'review'; reasons.push('Obrys je předběžný; některé jeho části mají slabou obrazovou oporu.'); }
  }
  if (kind !== 'paper' && status === 'ready' && model.fitResidual > 5) { status = 'review'; reasons.push('U složitého pozadí pomůže fotografie nástroje na celém listu A4.'); }
  if (status === 'ready') reasons.push('Obrys má souvislou obrazovou hranu a automatické metody se na něm shodují.');
  const restored = restore(best, imageData, im);
  progress('complete', 1, status === 'ready' ? 'Kontury jsou připravené.' : 'Fotografie potřebuje ověření.');
  return { ...restored, threshold: strictDark, method: best.name, quality: { status, score0to1: score, reasons, methods }, diagnostics: { elapsedMs: performance.now() - started, processingWidth: im.width, processingHeight: im.height, noise: features.noise, backgroundResidual: model.fitResidual, illuminationRange: features.illuminationRange, boundaryCoverage: best.coverage, candidateAgreement: best.agreement, clippedForeground, candidates: candidates.map(c => ({ method: c.name, score: c.score, agreement: c.agreement, contours: c.contours.length, boundaryCoverage: c.coverage, areaFraction: c.fill, rejected: c.rejected, neuralAgreement: c.neuralAgreement })) } };
}
