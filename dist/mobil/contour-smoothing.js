/** Bounded, local contour cleanup. Coordinates and tolerance use the same units. */
export const CONTOUR_SMOOTHING_MM = .5;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const area = points => points.reduce((sum, p, i) => {
  const q = points[(i + 1) % points.length]; return sum + p.x * q.y - q.x * p.y;
}, 0) / 2;

function measuredPath(points) {
  const lengths = [0];
  for (let i = 0; i < points.length; i++) lengths.push(lengths[i] + distance(points[i], points[(i + 1) % points.length]));
  const length = lengths.at(-1);
  const at = value => {
    const offset = ((value % length) + length) % length;
    let lo = 0, hi = points.length;
    while (lo + 1 < hi) { const mid = (lo + hi) >>> 1; if (lengths[mid] <= offset) lo = mid; else hi = mid; }
    const a = points[lo], b = points[(lo + 1) % points.length], t = (offset - lengths[lo]) / (lengths[lo + 1] - lengths[lo]);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  };
  return { lengths, length, at };
}

function turn(path, offset, radius) {
  const a = path.at(offset - radius), b = path.at(offset), c = path.at(offset + radius);
  const ux = b.x - a.x, uy = b.y - a.y, vx = c.x - b.x, vy = c.y - b.y;
  return Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy));
}

function corners(points, path, tolerance) {
  const radius = tolerance * 4, candidates = [];
  if (path.length < radius * 6) return [];
  for (let i = 0; i < points.length; i++) {
    const offset = path.lengths[i], angle = turn(path, offset, radius), broader = turn(path, offset, radius * 2);
    // A manufactured corner persists across scales; curvature on a round head
    // spreads over the wider window instead. Pixel staircase corners vanish.
    if (angle > .9 && broader < angle * 1.55 && broader > angle * .65) candidates.push({ index: i, offset, angle });
  }
  candidates.sort((a, b) => b.angle - a.angle);
  const selected = [];
  for (const candidate of candidates) if (selected.every(other => {
    const d = Math.abs(candidate.offset - other.offset); return Math.min(d, path.length - d) >= radius;
  })) selected.push(candidate);
  return selected.sort((a, b) => a.offset - b.offset);
}

function segmentDistance(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, lengthSq = dx * dx + dy * dy;
  const t = lengthSq ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

function simplifyOpen(points, tolerance) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length), stack = [[0, points.length - 1]];
  keep[0] = keep[points.length - 1] = 1;
  while (stack.length) {
    const [first, last] = stack.pop(); let furthest = -1, error = tolerance;
    for (let i = first + 1; i < last; i++) {
      const d = segmentDistance(points[i], points[first], points[last]);
      if (d > error) { error = d; furthest = i; }
    }
    if (furthest !== -1) { keep[furthest] = 1; stack.push([first, furthest], [furthest, last]); }
  }
  return points.filter((_, i) => keep[i]);
}

function simplifyClosed(points, tolerance) {
  let far = 1;
  for (let i = 2; i < points.length; i++) if (distance(points[0], points[i]) > distance(points[0], points[far])) far = i;
  return [...simplifyOpen(points.slice(0, far + 1), tolerance).slice(0, -1), ...simplifyOpen([...points.slice(far), points[0]], tolerance).slice(0, -1)];
}

function fit(samples, index, radius, closed) {
  const target = samples[index], matrix = [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]];
  const count = samples.length, step = samples[1].offset - samples[0].offset, reach = Math.ceil(radius / step);
  for (let delta = -reach; delta <= reach; delta++) {
    const j = index + delta;
    if (!closed && (j < 0 || j >= count)) continue;
    const p = samples[(j % count + count) % count], t = delta * step / radius;
    if (Math.abs(t) >= 1) continue;
    const weight = (1 - Math.abs(t) ** 3) ** 3, basis = [1, t, t * t];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) matrix[row][col] += weight * basis[row] * basis[col];
      matrix[row][3] += weight * basis[row] * (p.x - target.x);
      matrix[row][4] += weight * basis[row] * (p.y - target.y);
    }
  }
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let row = col + 1; row < 3; row++) if (Math.abs(matrix[row][col]) > Math.abs(matrix[pivot][col])) pivot = row;
    if (Math.abs(matrix[pivot][col]) < 1e-10) return { x: target.x, y: target.y };
    [matrix[pivot], matrix[col]] = [matrix[col], matrix[pivot]];
    const scale = matrix[col][col];
    for (let k = col; k < 5; k++) matrix[col][k] /= scale;
    for (let row = 0; row < 3; row++) if (row !== col) {
      const factor = matrix[row][col]; for (let k = col; k < 5; k++) matrix[row][k] -= factor * matrix[col][k];
    }
  }
  return { x: target.x + matrix[0][3], y: target.y + matrix[0][4] };
}

function fittedLine(samples, first, last, tolerance) {
  const count = last - first + 1; let x = 0, y = 0;
  for (let i = first; i <= last; i++) { x += samples[i].x; y += samples[i].y; }
  x /= count; y /= count;
  let xx = 0, yy = 0, xy = 0;
  for (let i = first; i <= last; i++) { const dx = samples[i].x - x, dy = samples[i].y - y; xx += dx * dx; yy += dy * dy; xy += dx * dy; }
  const angle = Math.atan2(2 * xy, xx - yy) / 2, ux = Math.cos(angle), uy = Math.sin(angle);
  let low = Infinity, high = -Infinity, u0 = Infinity, u1 = -Infinity, qsum = 0, q2sum = 0, vqsum = 0;
  for (let i = first; i <= last; i++) {
    const p = samples[i], u = (p.x - x) * ux + (p.y - y) * uy, v = -(p.x - x) * uy + (p.y - y) * ux, q = u * u;
    low = Math.min(low, v); high = Math.max(high, v); u0 = Math.min(u0, u); u1 = Math.max(u1, u); qsum += q; q2sum += q * q; vqsum += v * q;
  }
  if ((high - low) / 2 > tolerance * .87) return null;
  const variance = q2sum - qsum * qsum / count, bend = variance > 1e-9 ? Math.abs(vqsum / variance) * (u1 - u0) ** 2 / 4 : 0;
  if (bend > tolerance * .25) return null;
  const shift = (low + high) / 2;
  return { x: x - uy * shift, y: y + ux * shift, ux, uy, first, last };
}

function fittedCircle(samples, tolerance) {
  let x = 0, y = 0;
  for (const p of samples) { x += p.x; y += p.y; }
  x /= samples.length; y /= samples.length;
  let xx = 0, yy = 0, xy = 0, xz = 0, yz = 0, zsum = 0;
  for (const p of samples) {
    const dx = p.x - x, dy = p.y - y, z = dx * dx + dy * dy;
    xx += dx * dx; yy += dy * dy; xy += dx * dy; xz += dx * z; yz += dy * z; zsum += z;
  }
  const determinant = xx * yy - xy * xy;
  if (Math.abs(determinant) < 1e-10) return null;
  const cx = (xz * yy - yz * xy) / determinant / 2, cy = (yz * xx - xz * xy) / determinant / 2, radius = Math.sqrt(zsum / samples.length + cx * cx + cy * cy);
  const center = { x: x + cx, y: y + cy };
  if (!Number.isFinite(radius) || radius > samples.at(-1).offset * 4 || samples.some(p => Math.abs(distance(p, center) - radius) > tolerance * .94)) return null;
  return samples.map(p => {
    const scale = radius / distance(p, center); return { x: center.x + (p.x - center.x) * scale, y: center.y + (p.y - center.y) * scale };
  });
}

function straighten(samples, smoothed, tolerance, closed) {
  const step = samples[1].offset - samples[0].offset, stride = Math.max(1, Math.round(tolerance * 4 / step)), minimum = Math.ceil(tolerance * 24 / step), candidates = [];
  if (samples.length <= minimum) return;
  for (let first = 0; first + minimum < samples.length; first += stride) {
    let best = null;
    for (let last = first + minimum; last < samples.length; last += stride) {
      const line = fittedLine(samples, first, last, tolerance);
      if (!line) break;
      best = line;
    }
    if (best) {
      candidates.push(best);
      // The accepted interval is already supported by all of its measurements.
      // Revisiting every interior start repeats the same long-line fits and
      // makes straight metre-long tools need cubic work. Continue at its end;
      // later curves, width transitions and separate sides are still examined.
      first = best.last - stride;
    }
  }
  candidates.sort((a, b) => (b.last - b.first) - (a.last - a.first));
  const accepted = [];
  for (const line of candidates) {
    if (accepted.some(other => line.first <= other.last && line.last >= other.first)) continue;
    accepted.push(line);
    for (let i = line.first; i <= line.last; i++) {
      if (!closed && (i === 0 || i === samples.length - 1)) continue;
      const p = samples[i], along = (p.x - line.x) * line.ux + (p.y - line.y) * line.uy;
      smoothed[i] = { x: line.x + along * line.ux, y: line.y + along * line.uy };
    }
  }
}

function distanceIndex(points, tolerance) {
  const size = tolerance * 4, cells = new Map();
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length], count = Math.max(1, Math.ceil(distance(a, b) / (size / 2))), visited = new Set();
    for (let j = 0; j <= count; j++) {
      const t = j / count, key = `${Math.floor((a.x + (b.x - a.x) * t) / size)},${Math.floor((a.y + (b.y - a.y) * t) / size)}`;
      if (visited.has(key)) continue;
      visited.add(key); const entries = cells.get(key) || []; entries.push(i); cells.set(key, entries);
    }
  }
  return p => {
    let nearest = Infinity; const x = Math.floor(p.x / size), y = Math.floor(p.y / size);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const i of cells.get(`${x + dx},${y + dy}`) || []) nearest = Math.min(nearest, segmentDistance(p, points[i], points[(i + 1) % points.length]));
    return nearest;
  };
}

function withinTube(a, b, tolerance) {
  const nearest = distanceIndex(b, tolerance);
  const segmentInside = (p, q, dp, dq, depth) => {
    if (dp > tolerance || dq > tolerance) return false;
    // Distance to a closed set is 1-Lipschitz. This certifies the entire edge,
    // recursively resolving only portions close to the allowed boundary.
    if ((dp + dq + distance(p, q)) / 2 <= tolerance * .999999) return true;
    if (depth >= 24) return false;
    const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, dm = nearest(mid);
    return segmentInside(p, mid, dp, dm, depth + 1) && segmentInside(mid, q, dm, dq, depth + 1);
  };
  for (let i = 0; i < a.length; i++) {
    const p = a[i], q = a[(i + 1) % a.length];
    if (!segmentInside(p, q, nearest(p), nearest(q), 0)) return false;
  }
  return true;
}

function intersects(a, b, c, d) {
  const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
  const epsilon = 1e-9;
  if (((abC > epsilon && abD < -epsilon) || (abC < -epsilon && abD > epsilon)) && ((cdA > epsilon && cdB < -epsilon) || (cdA < -epsilon && cdB > epsilon))) return true;
  const on = (p, q, r, value) => Math.abs(value) <= epsilon && r.x >= Math.min(p.x, q.x) - epsilon && r.x <= Math.max(p.x, q.x) + epsilon && r.y >= Math.min(p.y, q.y) - epsilon && r.y <= Math.max(p.y, q.y) + epsilon;
  return on(a, b, c, abC) || on(a, b, d, abD) || on(c, d, a, cdA) || on(c, d, b, cdB);
}

export function simple(points) {
  // Two dimensional buckets also bound dense vertical/horizontal outlines,
  // where a one dimensional sweep would retain thousands of parallel edges.
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of points) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  const size = Math.max(x1 - x0, y1 - y0) / Math.max(1, Math.sqrt(points.length));
  if (!(size > 0)) return false;
  const cells = new Map();
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length], tested = new Set();
    const left = Math.floor((Math.min(a.x, b.x) - x0) / size), right = Math.floor((Math.max(a.x, b.x) - x0) / size), top = Math.floor((Math.min(a.y, b.y) - y0) / size), bottom = Math.floor((Math.max(a.y, b.y) - y0) / size);
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
      const key = `${x},${y}`, entries = cells.get(key) || [];
      for (const j of entries) {
        const gap = i - j;
        if (gap === 1 || gap === points.length - 1 || tested.has(j)) continue;
        tested.add(j);
        if (intersects(a, b, points[j], points[(j + 1) % points.length])) return false;
      }
      entries.push(i); cells.set(key, entries);
    }
  }
  return true;
}

/**
 * Smooth measured outlines without guessing symmetry or tool templates.
 * Movement is limited to tolerance, persistent corners stay measured, and an
 * invalid or substantially area-changing result falls back to the source.
 */
export function regularizeContour(points, tolerance = 0) {
  const source = points.map(p => ({ x: p.x, y: p.y }));
  if (!(tolerance > 0) || !Number.isFinite(tolerance) || source.length < 3 || source.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return source;
  const clean = source.filter((p, i) => distance(p, source[(i + source.length - 1) % source.length]) > 1e-10);
  if (clean.length < 3) return source;
  const path = measuredPath(clean), step = tolerance * .4;
  // Keep pathological/noisy segmentation bounded; it must be reviewed rather
  // than turn a bad mask into an expensive, invented smooth tool.
  if (path.length / step > 16000 || Math.abs(area(clean)) < tolerance * tolerance || !simple(clean)) return source;
  const anchors = corners(clean, path, tolerance);
  const spans = anchors.length >= 2 ? anchors.map((anchor, i) => ({ start: anchor.offset, length: (anchors[(i + 1) % anchors.length].offset - anchor.offset + path.length) % path.length, closed: false })) : [{ start: 0, length: path.length, closed: true }];
  const originalArea = area(clean);
  // Broad support removes chatter on large heads; a tight rounded end needs a
  // smaller neighbourhood. Retry the fit rather than discard useful straight
  // sides when one high-curvature transition cannot meet the same error tube.
  for (const support of [16, 8, 4]) {
    const output = [];
    for (const span of spans) {
      const count = Math.max(4, Math.ceil(span.length / step)), samples = [];
      for (let i = 0; i < count + (span.closed ? 0 : 1); i++) samples.push({ ...path.at(span.start + span.length * i / count), offset: span.length * i / count });
      const measuredSpan = clean.filter((_, i) => (path.lengths[i] - span.start + path.length) % path.length <= span.length);
      if (!span.closed && measuredSpan.every(p => segmentDistance(p, samples[0], samples.at(-1)) <= tolerance)) {
        output.push({ x: samples[0].x, y: samples[0].y }); continue;
      }
      const circular = fittedCircle(samples, tolerance), smoothed = [];
      for (let i = 0; i < samples.length; i++) {
        const p = samples[i], fitted = !span.closed && (i === 0 || i === samples.length - 1) ? p : circular?.[i] || fit(samples, i, tolerance * support, span.closed);
        smoothed.push({ x: fitted.x, y: fitted.y });
      }
      if (!circular) straighten(samples, smoothed, tolerance, span.closed);
      output.push(...(span.closed ? simplifyClosed(smoothed, tolerance * .1) : simplifyOpen(smoothed, tolerance * .1).slice(0, -1)));
    }
    const resultArea = area(output);
    if (output.length >= 3 && output.length <= 6000 && Math.sign(resultArea) === Math.sign(originalArea) && Math.abs(resultArea - originalArea) <= Math.max(tolerance * tolerance * 2, Math.abs(originalArea) * .025) && simple(output) && withinTube(clean, output, tolerance) && withinTube(output, clean, tolerance)) return output;
  }
  return source;
}
