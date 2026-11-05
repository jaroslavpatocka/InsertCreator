// Turns a measured outline into the shape a person sees. A pixel chain follows every reflection and rib;
// the eye knows that a turned or forged tool is symmetrical about its axis, has straight flanks and sharp
// shoulders, and that a weak edge can be read from the strong edge opposite it. Each of these rules is
// applied only where this outline's own measurements agree with it, and never moves a strong edge.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// Edge strength of metal against a recess; ribs of a black grip stay well below it.
const STRONG = 1.1;

function moments(points) {
  let x = 0, y = 0; for (const p of points) { x += p.x; y += p.y; } x /= points.length; y /= points.length;
  let xx = 0, xy = 0, yy = 0; for (const p of points) { const a = p.x - x, b = p.y - y; xx += a * a; xy += a * b; yy += b * b; }
  return { x, y, angle: .5 * Math.atan2(2 * xy, xx - yy) };
}

function area(points) { let sum = 0; for (let i = 0, j = points.length - 1; i < points.length; j = i++) sum += points[j].x * points[i].y - points[i].x * points[j].y; return Math.abs(sum) / 2; }

/** Outer limits of the outline on each cross-section perpendicular to the axis. */
function sections(points, frame, spacing) {
  const local = points.map(p => { const x = p.x - frame.x, y = p.y - frame.y; return { s: x * frame.ax + y * frame.ay, t: -x * frame.ay + y * frame.ax }; });
  let lo = Infinity, hi = -Infinity; for (const p of local) { lo = Math.min(lo, p.s); hi = Math.max(hi, p.s); }
  const count = Math.max(2, Math.floor((hi - lo) / spacing)), step = (hi - lo) / count, up = new Float32Array(count).fill(Infinity), down = new Float32Array(count).fill(-Infinity), spans = Array.from({ length: count }, () => []);
  for (let i = 0; i < local.length; i++) {
    const a = local[i], b = local[(i + 1) % local.length], from = Math.min(a.s, b.s), to = Math.max(a.s, b.s);
    for (let k = Math.max(0, Math.ceil((from - lo) / step - .5)); k < count; k++) {
      const s = lo + (k + .5) * step; if (s > to) break; if (to === from) continue;
      const t = a.t + (b.t - a.t) * (s - a.s) / (b.s - a.s);
      spans[k].push(t); up[k] = Math.min(up[k], t); down[k] = Math.max(down[k], t);
    }
  }
  // Material missing between the outer limits means an overhang that a two-sided profile cannot draw.
  let missing = 0;
  for (let k = 0; k < count; k++) { const list = spans[k].sort((a, b) => a - b); for (let i = 1; i + 1 < list.length; i += 2) missing += (list[i + 1] - list[i]) * step; }
  return { lo, step, count, up, down, missing };
}

const median = values => { const list = Array.from(values).sort((a, b) => a - b); return list[list.length >> 1] ?? 0; };

// The axis of symmetry is close to the principal axis, but mass alone tilts it towards a heavy end.
function symmetryAxis(points, spacing) {
  const base = moments(points); let best = null;
  for (let degrees = -6; degrees <= 6; degrees += .5) {
    const angle = base.angle + degrees * Math.PI / 180, frame = { x: base.x, y: base.y, ax: Math.cos(angle), ay: Math.sin(angle) };
    const cut = sections(points, frame, spacing * 2), middles = [];
    for (let k = 0; k < cut.count; k++) if (Number.isFinite(cut.up[k])) middles.push((cut.up[k] + cut.down[k]) / 2);
    const middle = median(middles), spread = median(middles.map(v => Math.abs(v - middle)));
    if (!best || spread < best.spread) best = { spread, frame: { ...frame, x: base.x - frame.ay * middle, y: base.y + frame.ax * middle } };
  }
  return best.frame;
}

/** Optimal piecewise straight fit of weighted values; pieces are independent, so a real step stays a step. */
function piecewise(values, weights, noise, cost) {
  const n = values.length, sw = new Float64Array(n + 1), sx = new Float64Array(n + 1), sy = new Float64Array(n + 1), sxx = new Float64Array(n + 1), sxy = new Float64Array(n + 1), syy = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const w = weights[i], y = values[i];
    sw[i + 1] = sw[i] + w; sx[i + 1] = sx[i] + w * i; sy[i + 1] = sy[i] + w * y; sxx[i + 1] = sxx[i] + w * i * i; sxy[i + 1] = sxy[i] + w * i * y; syy[i + 1] = syy[i] + w * y * y;
  }
  const line = (a, b) => {
    const W = sw[b] - sw[a], X = sx[b] - sx[a], Y = sy[b] - sy[a], XX = sxx[b] - sxx[a], XY = sxy[b] - sxy[a], YY = syy[b] - syy[a], d = W * XX - X * X;
    const slope = d > 1e-9 ? (W * XY - X * Y) / d : 0, offset = W > 0 ? (Y - slope * X) / W : 0;
    return { slope, offset, error: Math.max(0, YY - 2 * slope * XY - 2 * offset * Y + slope * slope * XX + 2 * slope * offset * X + offset * offset * W) };
  };
  const best = new Float64Array(n + 1).fill(Infinity), from = new Int32Array(n + 1); best[0] = 0;
  for (let b = 2; b <= n; b++) for (let a = Math.max(0, b - 400); a <= b - 2; a++) {
    if (best[a] === Infinity) continue;
    const total = best[a] + line(a, b).error / (noise * noise) + cost;
    if (total < best[b]) { best[b] = total; from[b] = a; }
  }
  const result = new Float32Array(n); let b = n;
  if (best[n] === Infinity) return Float32Array.from(values);
  while (b > 0) { const a = from[b], fit = line(a, b); for (let i = a; i < b; i++) result[i] = fit.offset + fit.slope * i; b = a; }
  return result;
}

function fitCircle(points, spacing, strength) {
  let used = points;
  for (let round = 0; round < 4; round++) {
    let sx = 0, sy = 0; for (const p of used) { sx += p.x; sy += p.y; } const mx = sx / used.length, my = sy / used.length;
    let uu = 0, uv = 0, vv = 0, uuu = 0, vvv = 0, uvv = 0, vuu = 0;
    for (const p of used) { const u = p.x - mx, v = p.y - my; uu += u * u; uv += u * v; vv += v * v; uuu += u * u * u; vvv += v * v * v; uvv += u * v * v; vuu += v * u * u; }
    const d = 2 * (uu * vv - uv * uv); if (Math.abs(d) < 1e-9) return null;
    const cx = (vv * (uuu + uvv) - uv * (vvv + vuu)) / d, cy = (uu * (vvv + vuu) - uv * (uuu + uvv)) / d, x = mx + cx, y = my + cy;
    const radial = used.map(p => Math.hypot(p.x - x, p.y - y)), r = median(radial);
    if (round === 3) {
      const error = p => Math.abs(Math.hypot(p.x - x, p.y - y) - r), errors = points.map(error).sort((a, b) => a - b), limit = Math.max(1.2 * spacing, r * .035);
      // A spur along a weak edge is a measuring fault; a strong edge away from the circle is real shape.
      const worst = Math.max(0, ...points.filter(p => strength(p.x, p.y) >= STRONG).map(error));
      return errors[Math.floor(errors.length * .85)] <= limit && worst <= limit * 2.2 ? { x, y, r } : null;
    }
    const sorted = used.map((p, i) => ({ p, e: Math.abs(radial[i] - r) })).sort((a, b) => a.e - b.e);
    used = sorted.slice(0, Math.ceil(sorted.length * .85)).map(item => item.p);
  }
  return null;
}

function drawn(frame, cut, up, down) {
  const result = [], at = (s, t) => ({ x: frame.x + s * frame.ax - t * frame.ay, y: frame.y + s * frame.ay + t * frame.ax });
  for (let k = 0; k < cut.count; k++) result.push(at(cut.lo + (k + .5) * cut.step, up[k]));
  for (let k = cut.count - 1; k >= 0; k--) result.push(at(cut.lo + (k + .5) * cut.step, down[k]));
  // A long run may be dropped only if every point in it stays on the kept chord, or a gentle curve collapses.
  const kept = [result[0]]; let anchor = 0;
  for (let i = 2; i <= result.length; i++) {
    const a = result[anchor], b = result[i % result.length], x = b.x - a.x, y = b.y - a.y, length = Math.hypot(x, y) || 1;
    for (let k = anchor + 1; k < i; k++) if (Math.abs((result[k].x - a.x) * y - (result[k].y - a.y) * x) / length > .05) { kept.push(result[i - 1]); anchor = i - 1; break; }
  }
  return kept;
}

/**
 * The regular shape supported by a measured outline, or null when none is. `strength(x,y)` is the edge
 * strength of the photograph; `shaded(x,y)` tells that a pixel is too dark to show any edge; `spacing`
 * is the working pixel size. Coordinates stay in photo pixels.
 */
export function fitToolShape(points, strength, spacing = 1, shaded = () => false) {
  if (points.length < 16) return null;
  const size = area(points), base = moments(points);
  const cross = { x: base.x, y: base.y, ax: Math.cos(base.angle), ay: Math.sin(base.angle) };
  const length = sections(points, cross, spacing), widths = []; for (let k = 0; k < length.count; k++) if (Number.isFinite(length.up[k])) widths.push(length.down[k] - length.up[k]);
  const span = length.count * length.step, width = Math.max(...widths);
  if (span < width * 1.3) {
    const circle = fitCircle(points, spacing, strength);
    if (!circle) return null;
    const count = clamp(Math.round(circle.r * 3), 32, 360);
    return Array.from({ length: count }, (_, i) => ({ x: circle.x + circle.r * Math.cos(i / count * Math.PI * 2), y: circle.y + circle.r * Math.sin(i / count * Math.PI * 2) }));
  }
  const frame = symmetryAxis(points, spacing), cut = sections(points, frame, spacing), n = cut.count;
  if (cut.missing > size * .03 || n < 12) return null;
  const up = new Float32Array(n), down = new Float32Array(n), upWeight = new Float32Array(n), downWeight = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    if (!Number.isFinite(cut.up[k])) return null;
    const s = cut.lo + (k + .5) * cut.step, x = frame.x + s * frame.ax, y = frame.y + s * frame.ay;
    up[k] = -cut.up[k]; down[k] = cut.down[k];
    // Rib ends of a black grip contrast sharply with the gap, but they are texture on a dark surface, so
    // an edge counts as strong only with something visible on one side of it. Black on white is reliable.
    const behind = 2 * spacing, seen = t => !shaded(x - t * frame.ay, y + t * frame.ax);
    upWeight[k] = strength(x - cut.up[k] * frame.ay, y + cut.up[k] * frame.ax) * (seen(cut.up[k] + behind) || seen(cut.up[k] - behind) ? 1 : .35);
    downWeight[k] = strength(x - cut.down[k] * frame.ay, y + cut.down[k] * frame.ax) * (seen(cut.down[k] - behind) || seen(cut.down[k] + behind) ? 1 : .35);
  }
  // Completion: the shaded underside of a grip can be darker than the gap around it, so its outline stops
  // at the first visible inlay. When only darkness lies between a flank and its mirror position, nothing
  // contradicts the mirror, and the wider flank gives the true width of the tool.
  const point = (k, t) => { const a = cut.lo + (k + .5) * cut.step; return [frame.x + a * frame.ax - t * frame.ay, frame.y + a * frame.ay + t * frame.ax]; };
  const hidden = new Int8Array(n), reachLimit = 9 * spacing;
  for (let k = 0; k < n; k++) {
    const gap = up[k] - down[k]; if (Math.abs(gap) <= 1.8 * spacing || Math.abs(gap) > reachLimit) continue;
    const narrow = Math.min(up[k], down[k]), wide = Math.max(up[k], down[k]), sign = gap > 0 ? 1 : -1; let dark = 0, total = 0;
    for (let t = narrow + spacing; t <= wide + spacing * .5; t += spacing * .5) { total++; dark += +shaded(...point(k, sign * t)); }
    if (total && dark >= total * .85) hidden[k] = sign;
  }
  const window = 10;
  for (let k = 0; k < n; k++) {
    let votes = 0; for (let i = Math.max(0, k - window); i <= Math.min(n - 1, k + window); i++) votes += hidden[i];
    if (Math.abs(votes) < window) continue;
    const gap = up[k] - down[k]; if (Math.sign(gap) !== Math.sign(votes) || Math.abs(gap) > reachLimit) continue;
    if (gap > 0) { down[k] = up[k]; downWeight[k] = upWeight[k]; } else { up[k] = down[k]; upWeight[k] = downWeight[k]; }
  }
  // Symmetry: where both flanks agree they are one measurement, and the stronger edge counts for more.
  // Where only a weak flank departs from a strong one, the strong one is the better witness.
  const same = new Uint8Array(n), agree = 1.8 * spacing, lean = 4 * spacing;
  for (let k = 0; k < n; k++) {
    const gap = Math.abs(up[k] - down[k]), a = upWeight[k], b = downWeight[k];
    same[k] = +(gap <= agree || (gap <= lean && Math.min(a, b) < Math.max(a, b) * .5));
  }
  const steady = new Uint8Array(n), half = 4;
  for (let k = 0; k < n; k++) { let votes = 0, total = 0; for (let i = Math.max(0, k - half); i <= Math.min(n - 1, k + half); i++) { votes += same[i]; total++; } steady[k] = +(votes * 2 > total); }
  const shared = new Float32Array(n), sharedWeight = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const a = upWeight[k] ** 2, b = downWeight[k] ** 2;
    shared[k] = (up[k] * a + down[k] * b) / (a + b); sharedWeight[k] = upWeight[k] + downWeight[k];
  }
  const noise = .4 * spacing, cost = 7, runs = [up, down].map((side, index) => {
    const own = index ? downWeight : upWeight, values = new Float32Array(n), weights = new Float32Array(n);
    // Squared, so that a weak edge steers the fit without its ribs buying pieces of their own.
    for (let k = 0; k < n; k++) { values[k] = steady[k] ? shared[k] : side[k]; weights[k] = clamp(((steady[k] ? sharedWeight[k] / 2 : own[k]) / STRONG) ** 2, .02, 1); }
    return piecewise(values, weights, noise, cost);
  });
  // A straight fit runs through the middle of small measured bumps. A pocket must contain the tool, so each
  // flank moves out to the upper envelope of what was measured along it, within the noise of the fit.
  [[up, upWeight], [down, downWeight]].forEach(([side, weight], index) => {
    const run = runs[index], excess = [];
    for (let k = 0; k < n; k++) if (weight[k] >= STRONG) excess.push(side[k] - run[k]);
    excess.sort((p, q) => p - q);
    const shift = clamp(excess[Math.floor(excess.length * .85)] ?? 0, 0, .6 * spacing);
    for (let k = 0; k < n; k++) run[k] += shift;
  });
  // A strong edge is fact: any fit that leaves it gives way there, however regular it would look.
  [[up, upWeight], [down, downWeight]].forEach(([side, weight], index) => {
    const run = runs[index], off = new Uint8Array(n);
    for (let k = 0; k < n; k++) off[k] = +(weight[k] >= STRONG && Math.abs(run[k] - side[k]) > 1.2 * spacing);
    for (let k = 0; k < n; k++) if (off[k] || off[k - 1] || off[k + 1]) run[k] = side[k];
  });
  // Joints between pieces are rounded only along weak edges; a strong step stays a step.
  const blend = (run, weight) => {
    const out = Float32Array.from(run), reach = Math.round(5 / cut.step * spacing);
    for (let k = 0; k < n; k++) {
      if (weight[k] >= STRONG * .8) continue;
      let sum = 0, total = 0, flat = true;
      for (let i = Math.max(0, k - reach); i <= Math.min(n - 1, k + reach); i++) { const v = reach + 1 - Math.abs(i - k); sum += run[i] * v; total += v; flat &&= weight[i] < STRONG * .8; }
      if (flat) out[k] = sum / total;
    }
    return out;
  };
  // A weak flank has no measured shoulder, so it may not jump: it eases into its strong neighbours.
  const eased = (run, weight) => {
    const out = Float32Array.from(run), slope = .55 * cut.step, weak = k => weight[k] < STRONG * .8;
    for (let pass = 0; pass < 2; pass++) {
      for (let k = 1; k < n; k++) if (weak(k)) out[k] = clamp(out[k], out[k - 1] - slope, out[k - 1] + slope);
      for (let k = n - 2; k >= 0; k--) if (weak(k)) out[k] = clamp(out[k], out[k + 1] - slope, out[k + 1] + slope);
    }
    return out;
  };
  const topSide = blend(eased(runs[0], upWeight), upWeight), bottomSide = blend(eased(runs[1], downWeight), downWeight);
  const shape = drawn(frame, cut, Float32Array.from(topSide, v => -v), bottomSide);
  if (shape.length < 8 || Math.abs(area(shape) - size) > size * .12) return null;
  return shape;
}
