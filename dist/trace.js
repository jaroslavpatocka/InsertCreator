/** Local image-to-outline processing. No uploads, models, or network requests. */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function validateImage(image) {
  if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 2 || image.height < 2 || !image.data || image.data.length !== image.width * image.height * 4) {
    throw new Error('Obrázek nemá platná pixelová data.');
  }
  if (image.width * image.height > 16000000) throw new Error('Pro zpracování zmenšete fotografii na nejvýše 16 megapixelů.');
}

function luminance(image) {
  const gray = new Uint8Array(image.width * image.height);
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) {
    const j = i * 4, a = image.data[j + 3] / 255;
    const g = Math.round((image.data[j] * .2126 + image.data[j + 1] * .7152 + image.data[j + 2] * .0722) * a + 255 * (1 - a));
    gray[i] = g; hist[g]++;
  }
  return { gray, hist };
}

function percentile(hist, proportion, count) {
  let sum = 0;
  for (let i = 0; i < 256; i++) if ((sum += hist[i]) >= Math.max(1, count * proportion)) return i;
  return 255;
}

function otsu(hist, total) {
  let weighted = 0;
  for (let i = 0; i < 256; i++) weighted += i * hist[i];
  let left = 0, leftSum = 0, best = -1, first = 127, last = 127;
  for (let t = 0; t < 255; t++) {
    left += hist[t]; leftSum += t * hist[t];
    const right = total - left;
    if (!left || !right) continue;
    const difference = leftSum / left - (weighted - leftSum) / right;
    const score = left * right * difference * difference;
    if (score > best + 1e-6) { best = score; first = last = t; }
    else if (Math.abs(score - best) <= 1e-6) last = t;
  }
  return Math.round((first + last) / 2);
}

function blur(gray, width, height) {
  const result = new Uint8Array(gray.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let sum = 0, count = 0;
    for (let yy = Math.max(0, y - 1); yy <= Math.min(height - 1, y + 1); yy++) {
      for (let xx = Math.max(0, x - 1); xx <= Math.min(width - 1, x + 1); xx++) { sum += gray[yy * width + xx]; count++; }
    }
    result[y * width + x] = Math.round(sum / count);
  }
  return result;
}

function morphology(mask, width, height, dilate) {
  const result = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let value = dilate ? 0 : 1;
    outer: for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      const on = xx >= 0 && yy >= 0 && xx < width && yy < height ? mask[yy * width + xx] : 0;
      if (dilate ? on : !on) { value = dilate ? 1 : 0; break outer; }
    }
    result[y * width + x] = value;
  }
  return result;
}

function labelComponents(mask, width, height, barriers = null) {
  const labels = new Int32Array(mask.length), queue = new Int32Array(mask.length), components = [];
  let id = 0;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start]) continue;
    id++;
    let head = 0, tail = 1, minX = width, minY = height, maxX = 0, maxY = 0;
    queue[0] = start; labels[start] = id;
    while (head < tail) {
      const p = queue[head++], x = p % width, y = Math.floor(p / width);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      if (x > 0 && mask[p - 1] && !labels[p - 1] && !(barriers?.[p - 1] & 1)) { labels[p - 1] = id; queue[tail++] = p - 1; }
      if (x + 1 < width && mask[p + 1] && !labels[p + 1] && !(barriers?.[p] & 1)) { labels[p + 1] = id; queue[tail++] = p + 1; }
      if (y > 0 && mask[p - width] && !labels[p - width] && !(barriers?.[p - width] & 2)) { labels[p - width] = id; queue[tail++] = p - width; }
      if (y + 1 < height && mask[p + width] && !labels[p + width] && !(barriers?.[p] & 2)) { labels[p + width] = id; queue[tail++] = p + width; }
    }
    components.push({ id, start, area: tail, minX, minY, maxX, maxY });
  }
  return { labels, components };
}

export function polygonArea(points) {
  let sum = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) sum += points[j].x * points[i].y - points[i].x * points[j].y;
  return sum / 2;
}

function segmentDistanceSq(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = dx || dy ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy), 0, 1) : 0;
  return (p.x - a.x - t * dx) ** 2 + (p.y - a.y - t * dy) ** 2;
}

function simplifyOpen(points, epsilon) {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length), stack = [[0, points.length - 1]];
  keep[0] = keep[points.length - 1] = 1;
  while (stack.length) {
    const [a, b] = stack.pop(); let furthest = -1, distance = epsilon * epsilon;
    for (let i = a + 1; i < b; i++) { const d = segmentDistanceSq(points[i], points[a], points[b]); if (d > distance) { distance = d; furthest = i; } }
    if (furthest !== -1) { keep[furthest] = 1; stack.push([a, furthest], [furthest, b]); }
  }
  return points.filter((_, i) => keep[i]);
}

export function simplifyContour(points, epsilon = 1.3) {
  if (points.length < 5 || epsilon <= 0) return points.map(p => ({ ...p }));
  let far = 1, distance = 0;
  for (let i = 1; i < points.length; i++) { const d = (points[i].x - points[0].x) ** 2 + (points[i].y - points[0].y) ** 2; if (d > distance) { distance = d; far = i; } }
  const originalArea = Math.abs(polygonArea(points));
  for (let attempt = 0; attempt < 5; attempt++) {
    const tolerance = epsilon / 2 ** attempt;
    const a = simplifyOpen(points.slice(0, far + 1), tolerance), b = simplifyOpen([...points.slice(far), points[0]], tolerance);
    const result = [...a.slice(0, -1), ...b.slice(0, -1)];
    if (result.length >= 3 && Math.abs(Math.abs(polygonArea(result)) - originalArea) <= Math.max(2, originalArea * .02)) return result;
  }
  return points;
}

function exteriorContour(labels, component, width, height) {
  const edges = new Map(), stride = width + 1, { id, minX, minY, maxX, maxY } = component;
  const add = (x1, y1, x2, y2, direction) => {
    const key = y1 * stride + x1;
    if (!edges.has(key)) edges.set(key, []);
    edges.get(key).push({ end: y2 * stride + x2, direction });
  };
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const p = y * width + x;
    if (labels[p] !== id) continue;
    if (!y || labels[p - width] !== id) add(x, y, x + 1, y, 0);
    if (x + 1 === width || labels[p + 1] !== id) add(x + 1, y, x + 1, y + 1, 1);
    if (y + 1 === height || labels[p + width] !== id) add(x + 1, y + 1, x, y + 1, 2);
    if (!x || labels[p - 1] !== id) add(x, y + 1, x, y, 3);
  }
  let largest = [], largestArea = 0;
  while (edges.size) {
    const start = edges.keys().next().value, points = [];
    let key = start, previous = 0, guard = 0;
    do {
      const choices = edges.get(key);
      if (!choices?.length) break;
      points.push({ x: key % stride, y: Math.floor(key / stride) });
      // Prefer a right turn at a shared vertex, keeping foreground on the right.
      let index = 0, rank = -1;
      for (let i = 0; i < choices.length; i++) {
        const turn = (choices[i].direction - previous + 4) % 4;
        const score = turn === 1 ? 4 : turn === 0 ? 3 : turn === 3 ? 2 : 1;
        if (score > rank) { rank = score; index = i; }
      }
      const edge = choices.splice(index, 1)[0];
      if (!choices.length) edges.delete(key);
      key = edge.end; previous = edge.direction;
    } while (key !== start && ++guard <= (maxX - minX + 1) * (maxY - minY + 1) * 4 + 4);
    const area = Math.abs(polygonArea(points));
    if (key === start && area > largestArea) { largest = points; largestArea = area; }
  }
  return largest;
}

/**
 * Returns absolute image-pixel outlines. threshold is in normalized 0–255 space.
 * minArea below 1 means fraction of image area; otherwise it is pixels squared.
 * Tools touching the image edge are omitted; internal holes are deliberately filled.
 */
export function traceImage(imageData, { threshold = null, invert = false, minArea = .001, smoothing = 1.3 } = {}) {
  validateImage(imageData);
  const { width, height } = imageData, { gray, hist } = luminance(imageData), count = gray.length;
  let low = percentile(hist, .001, count), high = percentile(hist, .999, count);
  // A thin tool can occupy less than the clipping percentile. Retain real contrast
  // in that case; component area filtering still removes isolated sensor pixels.
  if (high - low < 4) { low = percentile(hist, 0, count); high = percentile(hist, 1, count); }
  const normalized = new Uint8Array(count);
  const span = Math.max(1, high - low);
  for (let i = 0; i < count; i++) normalized[i] = clamp(Math.round((gray[i] - low) * 255 / span), 0, 255);
  const filtered = blur(normalized, width, height), contrastHist = new Uint32Array(256);
  for (const value of filtered) contrastHist[value]++;
  const selected = threshold === null || !Number.isFinite(Number(threshold)) ? otsu(contrastHist, count) : clamp(Math.round(Number(threshold)), 0, 255);
  let mask = new Uint8Array(count);
  if (high - low < 4 && threshold === null) return { contours: [], threshold: selected, mask, width, height };
  for (let i = 0; i < count; i++) mask[i] = invert ? +(filtered[i] >= selected) : +(filtered[i] <= selected);
  mask = morphology(morphology(mask, width, height, true), width, height, false);
  return { ...traceMask(mask, width, height, { minArea, smoothing }), threshold: selected };
}

/** Trace measured binary pixel edges without blurring away gaps or closing thin shafts. */
export function traceMask(mask, width, height, { minArea = .001, smoothing = 1.3, barriers = null, includeLabels = false } = {}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 || width * height > 16000000 || mask?.length !== width * height) throw new Error('Maska nemá platná pixelová data.');
  if (barriers && barriers.length !== mask.length) throw new Error('Mapa hran má jiný rozměr než maska.');
  const count = width * height;
  const { labels, components } = labelComponents(mask, width, height, barriers);
  const minimum = Math.max(12, minArea < 1 ? count * Math.max(0, minArea) : minArea), contours = [], clean = new Uint8Array(count), accepted = new Set();
  for (const c of components) {
    if (c.area < minimum || c.minX <= 1 || c.minY <= 1 || c.maxX >= width - 2 || c.maxY >= height - 2) continue;
    const points = simplifyContour(exteriorContour(labels, c, width, height), Math.max(0, Number(smoothing) || 0));
    if (points.length < 3) continue;
    accepted.add(c.id);
    contours.push({ points, area: Math.abs(polygonArea(points)), width: c.maxX - c.minX + 1, height: c.maxY - c.minY + 1, ...(includeLabels ? { componentId: c.id, seed: c.start } : {}) });
  }
  for (let i = 0; i < count; i++) if (accepted.has(labels[i])) clean[i] = 1;
  contours.sort((a, b) => b.area - a.area);
  return { contours, mask: clean, width, height, ...(includeLabels ? { labels } : {}) };
}

/** Best-effort white-sheet detection. Null means the user must set four corners. */
export function detectPaper(imageData) {
  validateImage(imageData);
  const scale = Math.min(1, 600 / Math.max(imageData.width, imageData.height));
  const width = Math.max(2, Math.round(imageData.width * scale)), height = Math.max(2, Math.round(imageData.height * scale));
  const gray = new Uint8Array(width * height), hist = new Uint32Array(256);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sx = Math.min(imageData.width - 1, Math.round(x / scale)), sy = Math.min(imageData.height - 1, Math.round(y / scale)), p = (sy * imageData.width + sx) * 4;
    const value = Math.round(imageData.data[p] * .2126 + imageData.data[p + 1] * .7152 + imageData.data[p + 2] * .0722);
    gray[y * width + x] = value; hist[value]++;
  }
  const bright = percentile(hist, .9, gray.length);
  if (bright < 145) return null;
  const cut = Math.max(140, Math.min(bright - 22, Math.max(otsu(hist, gray.length), 165)));
  const mask = gray.map(v => +(v >= cut)), { labels, components } = labelComponents(mask, width, height);
  const candidates = components.filter(c => c.area > gray.length * .08 && (c.maxX - c.minX) * (c.maxY - c.minY) < gray.length * .96).sort((a, b) => b.area - a.area);
  for (const c of candidates) {
    const corners = [null, null, null, null], values = [Infinity, -Infinity, -Infinity, Infinity];
    for (let y = c.minY; y <= c.maxY; y++) for (let x = c.minX; x <= c.maxX; x++) {
      if (labels[y * width + x] !== c.id) continue;
      if (x + y < values[0]) { values[0] = x + y; corners[0] = { x, y }; }
      if (x - y > values[1]) { values[1] = x - y; corners[1] = { x, y }; }
      if (x + y > values[2]) { values[2] = x + y; corners[2] = { x, y }; }
      if (x - y < values[3]) { values[3] = x - y; corners[3] = { x, y }; }
    }
    const unique = new Set(corners.map(p => `${p.x},${p.y}`));
    // Return the exact source pixels sampled above. Fractional inverse coordinates
    // can interpolate a neighbouring tabletop pixel into a whole rectified edge.
    if (unique.size === 4 && Math.abs(polygonArea(corners)) > gray.length * .07) return corners.map(p => ({ x: Math.min(imageData.width - 1, Math.round(p.x / scale)), y: Math.min(imageData.height - 1, Math.round(p.y / scale)) }));
  }
  return null;
}

function quadTransform(corners) {
  if (!Array.isArray(corners) || corners.length !== 4 || corners.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw new Error('Označte čtyři rohy papíru v pořadí levý horní, pravý horní, pravý dolní, levý dolní.');
  const [p0, p1, p2, p3] = corners;
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = corners[i], b = corners[(i + 1) % 4], c = corners[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < .01 || (sign && sign !== Math.sign(cross))) throw new Error('Rohy papíru se nesmí křížit ani ležet na jedné přímce.');
    sign = Math.sign(cross);
  }
  if (Math.abs(polygonArea(corners)) < 4) throw new Error('Označená plocha papíru je příliš malá.');
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;
  let g = 0, h = 0;
  if (Math.abs(dx3) + Math.abs(dy3) > 1e-9) {
    const denominator = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(denominator) < 1e-9) throw new Error('Z této perspektivy nelze papír bezpečně narovnat.');
    g = (dx3 * dy2 - dx2 * dy3) / denominator;
    h = (dx1 * dy3 - dx3 * dy1) / denominator;
  }
  return { a: p1.x - p0.x + g * p1.x, b: p3.x - p0.x + h * p3.x, c: p0.x, d: p1.y - p0.y + g * p1.y, e: p3.y - p0.y + h * p3.y, f: p0.y, g, h };
}

/** Perspective-correct A4/reference rectangle using bilinear source sampling. */
export function rectifyImage(imageData, corners, widthMm = 210, heightMm = 297, maxSize = 1100) {
  validateImage(imageData);
  if (!(widthMm > 0) || !(heightMm > 0) || !Number.isFinite(widthMm + heightMm) || !(maxSize >= 16 && maxSize <= 4096)) throw new Error('Zadejte platné rozměry měřítka.');
  const transform = quadTransform(corners), pxPerMm = maxSize / Math.max(widthMm, heightMm);
  const width = Math.max(2, Math.round(widthMm * pxPerMm)), height = Math.max(2, Math.round(heightMm * pxPerMm));
  const data = new Uint8ClampedArray(width * height * 4), source = imageData.data, sw = imageData.width, sh = imageData.height;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = x / (width - 1), v = y / (height - 1), den = transform.g * u + transform.h * v + 1;
    const sx = (transform.a * u + transform.b * v + transform.c) / den, sy = (transform.d * u + transform.e * v + transform.f) / den, out = (y * width + x) * 4;
    if (sx < 0 || sy < 0 || sx > sw - 1 || sy > sh - 1) { data[out] = data[out + 1] = data[out + 2] = data[out + 3] = 255; continue; }
    const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(x0 + 1, sw - 1), y1 = Math.min(y0 + 1, sh - 1), fx = sx - x0, fy = sy - y0;
    for (let k = 0; k < 4; k++) data[out + k] = source[(y0 * sw + x0) * 4 + k] * (1 - fx) * (1 - fy) + source[(y0 * sw + x1) * 4 + k] * fx * (1 - fy) + source[(y1 * sw + x0) * 4 + k] * (1 - fx) * fy + source[(y1 * sw + x1) * 4 + k] * fx * fy;
  }
  const result = typeof ImageData === 'function' ? new ImageData(data, width, height) : { data, width, height };
  // Pixel-edge coordinates span width/height; this scale matches returned contours.
  return { imageData: result, pxPerMm, widthMm, heightMm };
}

/** Pixels per millimetre for two ruler marks; perspective must already be near-normal. */
export function calibrateSegment(a, b, distanceMm) {
  if(!a||!b||![a.x,a.y,b.x,b.y,distanceMm].every(Number.isFinite)||distanceMm<1||distanceMm>5000)throw new Error('Označte dvě různé značky pravítka a zadejte jejich skutečnou vzdálenost.');
  const distance = Math.hypot(b.x - a.x, b.y - a.y);
  if (distance < 12) throw new Error('Značky pravítka jsou příliš blízko. Použijte delší úsek alespoň 12 pixelů.');
  return distance / distanceMm;
}
