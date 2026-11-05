// Recover a dark grip only when the original photograph supplies both of its
// boundaries. Bright components are anchors, never a reason to fill their hull.
function components(image) {
  const { width, height, data } = image, labels = new Int32Array(width * height), queue = new Int32Array(labels.length), pieces = [];
  for (let start = 0; start < labels.length; start++) {
    if (labels[start] || data[start * 4] >= 224) continue;
    const id = pieces.length + 1, pixels = []; let head = 0, tail = 1, sx = 0, sy = 0, xx = 0, xy = 0, yy = 0;
    queue[0] = start; labels[start] = id;
    while (head < tail) {
      const p = queue[head++], x = p % width + .5, y = Math.floor(p / width) + .5;
      pixels.push(p); sx += x; sy += y; xx += x * x; xy += x * y; yy += y * y;
      const push = n => { if (!labels[n] && data[n * 4] < 224) { labels[n] = id; queue[tail++] = n; } };
      if (p % width) push(p - 1); if (p % width + 1 < width) push(p + 1);
      if (p >= width) push(p - width); if (p + width < labels.length) push(p + width);
    }
    const x = sx / tail, y = sy / tail, angle = .5 * Math.atan2(2 * (xy / tail - x * y), xx / tail - x * x - yy / tail + y * y);
    pieces.push({ id, pixels, x, y, ax: Math.cos(angle), ay: Math.sin(angle), area: tail });
  }
  for (const piece of pieces) if (piece.area < 12) for (const p of piece.pixels) labels[p] = 0;
  return { labels, pieces: pieces.filter(p => p.area >= 12) };
}

function bounds(piece, frame, width) {
  let lo = Infinity, hi = -Infinity, left = Infinity, right = -Infinity;
  for (const p of piece.pixels) {
    const x = p % width + .5 - frame.x, y = Math.floor(p / width) + .5 - frame.y;
    const s = x * frame.ax + y * frame.ay, t = -x * frame.ay + y * frame.ax;
    lo = Math.min(lo, s); hi = Math.max(hi, s); left = Math.min(left, t); right = Math.max(right, t);
  }
  return { lo, hi, left, right, length: hi - lo + 1, width: right - left + 1 };
}

function sampler(image) {
  const { width, height, data } = image, gray = new Float32Array(width * height);
  // Value in RGB retains the boundary between black rubber and a saturated
  // blue recess even when their luminance is almost identical.
  for (let p = 0; p < gray.length; p++) gray[p] = Math.max(data[p * 4], data[p * 4 + 1], data[p * 4 + 2]);
  return (x, y) => {
    x -= .5; y -= .5;
    if (x < 0 || y < 0 || x >= width - 1 || y >= height - 1) return NaN;
    const ix = Math.floor(x), iy = Math.floor(y), dx = x - ix, dy = y - iy, p = iy * width + ix;
    return (gray[p] * (1 - dx) + gray[p + 1] * dx) * (1 - dy) + (gray[p + width] * (1 - dx) + gray[p + width + 1] * dx) * dy;
  };
}

function section(sample, frame, s, center, radius, minWidth, requireDark, maxWidth = radius * 1.7) {
  const profile = new Float32Array(2 * radius + 1);
  for (let t = -radius; t <= radius; t++) {
    let sum = 0;
    for (const ds of [-1.5, 0, 1.5]) sum += sample(frame.x + (s + ds) * frame.ax - (center + t) * frame.ay, frame.y + (s + ds) * frame.ay + (center + t) * frame.ax);
    profile[t + radius] = sum / 3;
  }
  const value = t => profile[t + radius], mean = (a, b) => { let v = 0; for (let t = a; t <= b; t++) v += value(t); return v / (b - a + 1); };
  const top = [], bottom = [], minimum = Math.max(2, minWidth * .25);
  for (let t = -radius + 4; t <= radius - 4; t++) {
    const nearLeft = mean(t - 1, t), farLeft = mean(t - 4, t - 2), nearRight = mean(t, t + 1), farRight = mean(t + 2, t + 4);
    const nearTop = nearLeft - mean(t + 1, t + 2), broadTop = farLeft - mean(t + 1, t + 3);
    const nearBottom = nearRight - mean(t - 2, t - 1), broadBottom = farRight - mean(t - 3, t - 1);
    // Across an absent anchor connection, broad support must outlast woven
    // background texture. A narrow edge may refine an already anchored rim.
    const useNearTop = !requireDark && nearTop >= broadTop * .65, useNearBottom = !requireDark && nearBottom >= broadBottom * .65;
    const left = useNearTop ? nearTop : broadTop * (requireDark ? 1 : .65), right = useNearBottom ? nearBottom : broadBottom * (requireDark ? 1 : .65);
    const outsideLeft = useNearTop ? nearLeft : farLeft, outsideRight = useNearBottom ? nearRight : farRight;
    if (t < -minimum && left >= 6 && outsideLeft < 150) top.push({ t: t + .5, edge: left, outside: outsideLeft });
    if (t > minimum && right >= 6 && outsideRight < 150) bottom.push({ t: t - .5, edge: right, outside: outsideRight });
  }
  top.sort((a, b) => b.edge - a.edge); bottom.sort((a, b) => b.edge - a.edge);
  const peaks = list => list.filter((p, i) => !list.slice(0, i).some(q => Math.abs(q.t - p.t) < 3)).slice(0, 8);
  const pairs = [];
  for (const a of peaks(top)) for (const b of peaks(bottom)) {
    const width = b.t - a.t;
    if (width < minWidth || width > maxWidth || Math.abs(a.t + b.t) > radius * .65) continue;
    const inside = [];
    for (let t = Math.ceil(a.t + 3); t <= b.t - 3; t += 2) inside.push(value(t));
    inside.sort((x, y) => x - y);
    const contrast = Math.min(a.outside, b.outside) - inside[inside.length >> 1];
    if (requireDark && !(contrast >= 5)) continue;
    pairs.push({ top: center + a.t, bottom: center + b.t, score: Math.min(a.edge, b.edge) + (a.edge + b.edge) * .15 });
  }
  return pairs.sort((a, b) => b.score - a.score).slice(0, 12);
}

function track(sample, frame, from, to, center, radius, minWidth, maxWidth) {
  const rows = [], step = (to - from) / Math.max(1, Math.ceil((to - from) / 2));
  let missing = 0, consecutive = 0, total = 0;
  for (let s = from; s <= to + .01; s += step) {
    total++;
    const options = section(sample, frame, s, center, radius, minWidth, true, maxWidth);
    if (!options.length) {
      if (!rows.length || ++consecutive > 2) return null;
      missing++; continue;
    }
    consecutive = 0;
    const previous = rows.at(-1);
    for (const option of options) {
      option.s = s; option.cost = previous ? -Infinity : option.score;
      if (previous) for (const p of previous) {
        const change = Math.abs(option.top - p.top) + Math.abs(option.bottom - p.bottom);
        if (change > (s - p.s) * 3 + 2) continue;
        const cost = p.cost + option.score - change * 2;
        if (cost > option.cost) { option.cost = cost; option.previous = p; }
      }
    }
    const viable = options.filter(p => Number.isFinite(p.cost));
    if (!viable.length) return null;
    rows.push(viable);
  }
  if (consecutive > 1 || missing > total * .34) return null;
  const result = []; let p = rows.at(-1).sort((a, b) => b.cost - a.cost)[0];
  while (p) { result.push(p); p = p.previous; }
  // A diagonal weave can supply two strong edges, but its corridor wanders
  // across the anchored tool axis instead of continuing the same grip.
  const centers = result.map(row => (row.top + row.bottom) / 2);
  if (Math.max(...centers) - Math.min(...centers) > Math.max(4, minWidth * .35)) return null;
  return result.reverse();
}

function paint(image, labels, frame, rows, allowed) {
  const { width, height, data } = image, contacts = new Set();
  for (let i = 0; i + 1 < rows.length; i++) {
    const a = rows[i], b = rows[i + 1];
    for (let s = a.s; s <= b.s; s += .5) {
      const f = (s - a.s) / (b.s - a.s), top = a.top + (b.top - a.top) * f, bottom = a.bottom + (b.bottom - a.bottom) * f;
      for (let t = top; t <= bottom; t += .5) {
        const x = Math.floor(frame.x + s * frame.ax - t * frame.ay), y = Math.floor(frame.y + s * frame.ay + t * frame.ax);
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const p = y * width + x;
        if (labels[p] && !allowed.has(labels[p])) return false;
        // Four-neighbour adjacency also merges components when auto-trace
        // labels the result; leaving foreign pixels untouched is insufficient.
        for (const n of [x ? p - 1 : p, x + 1 < width ? p + 1 : p, y ? p - width : p, y + 1 < height ? p + width : p]) {
          if (labels[n] && !allowed.has(labels[n])) return false;
        }
        if (allowed.has(labels[p])) contacts.add(labels[p]);
      }
    }
  }
  if (contacts.size !== allowed.size) return false;
  for (let i = 0; i + 1 < rows.length; i++) {
    const a = rows[i], b = rows[i + 1];
    for (let s = a.s; s <= b.s; s += .5) {
      const f = (s - a.s) / (b.s - a.s), top = a.top + (b.top - a.top) * f, bottom = a.bottom + (b.bottom - a.bottom) * f;
      for (let t = top; t <= bottom; t += .5) {
        const x = Math.floor(frame.x + s * frame.ax - t * frame.ay), y = Math.floor(frame.y + s * frame.ay + t * frame.ax);
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const p = (y * width + x) * 4;
        data[p] = data[p + 1] = data[p + 2] = 0;
        labels[p / 4] = frame.id;
      }
    }
  }
  return true;
}

/** Same-size, immutable enhancement of dark grips with two measured edge tracks. */
function recover(original, enhanced) {
  if (original.width !== enhanced.width || original.height !== enhanced.height) return enhanced;
  const { width } = enhanced, { labels, pieces } = components(enhanced);
  // A noisy surface is ambiguous; do not spend an unbounded pairing search on it.
  if (pieces.length > 512) return enhanced;
  const sample = sampler(original), used = new Set(); let attempts = 0;
  const output = { width: enhanced.width, height: enhanced.height, data: new Uint8ClampedArray(enhanced.data) };
  for (const body of pieces) {
    if (used.has(body.id)) continue;
    const own = bounds(body, body, width);
    if (own.length < 30 || own.length < own.width * 2.5) continue;
    for (const tip of pieces) {
      if (tip.id === body.id || used.has(tip.id) || tip.area > body.area * .45) continue;
      const sign = (tip.x - body.x) * body.ax + (tip.y - body.y) * body.ay >= 0 ? 1 : -1;
      const frame = { id: body.id, x: body.x, y: body.y, ax: body.ax * sign, ay: body.ay * sign };
      const a = sign > 0 ? own : { ...own, lo: -own.hi, hi: -own.lo, left: -own.right, right: -own.left }, b = bounds(tip, frame, width), gap = b.lo - a.hi;
      if (gap < 3 || gap > Math.min(a.length * .5, a.width * 3.5) || b.length > a.length * .45 || b.width < 4) continue;
      const center = (b.left + b.right) / 2;
      if (Math.abs(center - (a.left + a.right) / 2) > a.width * .45) continue;
      if (++attempts > 128) return output;
      const radius = Math.ceil(Math.min(a.width * 1.1, b.width * 1.8) + 5), minWidth = Math.max(5, b.width * .55);
      // Bright anchors omit a thin dark rim; allow 1.5 pixels per measured side.
      const maxWidth = Math.max(a.width, b.width) * 1.03 + 3;
      const margin = Math.min(4, gap * .2);
      const rows = track(sample, frame, a.hi + margin, b.lo - margin, center, radius, minWidth, maxWidth);
      if (!rows || rows.length < 2) continue;
      // Extend only while the same measured dark rim continues around a bright
      // inset. This restores the whole black grip, rather than just its gap.
      for (const direction of [-1, 1]) {
        let previous = direction < 0 ? rows[0] : rows.at(-1);
        const first = previous;
        const limit = direction < 0 ? a.hi - Math.min(a.length * .4, a.width * 2.5) : b.hi;
        for (let s = previous.s + direction * 2; direction < 0 ? s >= limit : s <= limit; s += direction * 2) {
          const drift = Math.max(4, b.width * .3);
          const options = section(sample, frame, s, center, radius, minWidth, false, maxWidth).filter(p => Math.abs(p.top - previous.top) + Math.abs(p.bottom - previous.bottom) <= 4 && Math.abs(p.top - first.top) <= drift && Math.abs(p.bottom - first.bottom) <= drift);
          options.sort((p, q) => (q.score - 6 * (Math.abs(q.top - previous.top) + Math.abs(q.bottom - previous.bottom))) - (p.score - 6 * (Math.abs(p.top - previous.top) + Math.abs(p.bottom - previous.bottom))));
          if (!options.length) break;
          previous = { ...options[0], s };
          if (direction < 0) rows.unshift(previous); else rows.push(previous);
        }
      }
      // The profile filter straddles a bright/dark transition at either anchor.
      // Carry its last measured boundary across those few pixels, and require
      // actual contact with both masks before accepting the tentative bridge.
      if (rows[0].s > a.hi - 1) rows.unshift({ ...rows[0], s: a.hi - 1 });
      if (rows.at(-1).s < b.lo + 1) rows.push({ ...rows.at(-1), s: b.lo + 1 });
      if (paint(output, labels, frame, rows, new Set([body.id, tip.id]))) { used.add(tip.id); used.add(body.id); break; }
    }
  }
  return output;
}

export function recoverDarkTools(original, enhanced) {
  if (original.width !== enhanced.width || original.height !== enhanced.height) return enhanced;
  // Keep component queues and edge searches bounded on full camera images.
  const scale = Math.min(1, Math.sqrt(1000000 / (original.width * original.height)));
  if (scale === 1) return recover(original, enhanced);
  const width = Math.max(1, Math.round(original.width * scale)), height = Math.max(1, Math.round(original.height * scale));
  const downsample = image => {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const sx = Math.min(image.width - 1, Math.floor((x + .5) * image.width / width)), sy = Math.min(image.height - 1, Math.floor((y + .5) * image.height / height)), p = (sy * image.width + sx) * 4;
      data.set(image.data.subarray(p, p + 4), (y * width + x) * 4);
    }
    return { width, height, data };
  };
  const baseline = downsample(enhanced), recovered = recover(downsample(original), baseline), data = new Uint8ClampedArray(enhanced.data);
  for (let y = 0; y < original.height; y++) for (let x = 0; x < original.width; x++) {
    const sx = Math.min(width - 1, Math.floor(x * width / original.width)), sy = Math.min(height - 1, Math.floor(y * height / original.height)), source = (sy * width + sx) * 4;
    if (recovered.data[source] === baseline.data[source]) continue;
    const p = (y * original.width + x) * 4;
    data[p] = data[p + 1] = data[p + 2] = recovered.data[source];
  }
  return { width: enhanced.width, height: enhanced.height, data };
}
