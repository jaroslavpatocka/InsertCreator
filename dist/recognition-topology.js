/** Source-supported repair of a one-prototype-cell split in one NN proposal.
 * No files, network, annotations, or tool classes.
 */
import { simplifyContour } from './trace.js';
import { simple } from './contour-smoothing.js';
import {
  geometry, polygonRLE, unionRLE, intersection, insideRLE, throughBackground,
  dilateRLE, traceRLE, checkAbort
} from './recognition-foreground.js';

const median = values => values.sort((a, b) => a - b)[values.length >> 1] ?? 0;
const pixelArea = rle => rle.reduce((sum, value, index) => index % 2 ? sum + value : sum, 0);

function projected(point, start, end) {
  const dx = end.x - start.x, dy = end.y - start.y;
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy || 1)));
  return { x: start.x + dx * t, y: start.y + dy * t };
}

/** Return a minimal, four-connected path of observed source material, or null.
 * A shared NN identity is necessary; source background always vetoes the join.
 */
export function nativeTopologyBridge(image, a, b, {
  cell = Math.ceil(Math.max(image.width, image.height) / 256), signal
} = {}) {
  checkAbort(signal);
  const ids = a.seed?.seedParts ?? [];
  const sharedProposalIds = ids.filter(id => b.seed?.seedParts?.includes(id));
  if (!sharedProposalIds.length) return null;
  const { width, height, data } = image;
  const colorAt = index => {
    const alpha = data[index * 4 + 3] / 255;
    return [0, 1, 2].map(c => data[index * 4 + c] * alpha + 255 * (1 - alpha));
  };
  const dx = b.center.x - a.center.x, dy = b.center.y - a.center.y;
  const length = Math.hypot(dx, dy);
  const parent = geometry({ maskRLE: unionRLE([a.maskRLE, b.maskRLE]) }, width, height);
  if (length && throughBackground(image, parent, a, b, { x: -dy / length, y: dx / length })) return null;

  const ap = simplifyContour(a.seed.points, Math.max(.5, cell * .2));
  const bp = simplifyContour(b.seed.points, Math.max(.5, cell * .2));
  const candidates = [];
  const add = (p, q) => {
    const distance = Math.hypot(q.x - p.x, q.y - p.y);
    if (distance >= .5 && distance <= cell + .5) candidates.push({ p, q, distance });
  };
  for (let i = 0; i < ap.length; i++) {
    checkAbort(signal);
    const s = ap[i], t = ap[(i + 1) % ap.length];
    for (let j = 0; j < bp.length; j++) {
      const u = bp[j], v = bp[(j + 1) % bp.length];
      add(s, projected(s, u, v));
      add(projected(u, s, t), u);
      for (const fraction of [.25, .5, .75]) {
        const p = { x: s.x + (t.x - s.x) * fraction, y: s.y + (t.y - s.y) * fraction };
        add(p, projected(p, u, v));
      }
    }
  }
  candidates.sort((a, b) => a.distance - b.distance);
  const seen = new Set();
  for (const { p, q, distance } of candidates) {
    checkAbort(signal);
    const key = [p.x, p.y, q.x, q.y].map(value => Math.round(value)).join(':');
    if (seen.has(key)) continue;
    seen.add(key);
    if (seen.size > 128) break;
    const x = (p.x + q.x) / 2, y = (p.y + q.y) / 2;
    const minor = Math.min(a.bounds.x1 - a.bounds.x0, a.bounds.y1 - a.bounds.y0, b.bounds.x1 - b.bounds.x0, b.bounds.y1 - b.bounds.y0);
    const radius = Math.min(cell * 16, Math.max(cell * 3, minor * .7));
    const samples = [];
    for (let i = 0; i < 32; i++) {
      const angle = i * Math.PI / 16;
      const xx = Math.floor(x + Math.cos(angle) * radius), yy = Math.floor(y + Math.sin(angle) * radius);
      if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
      const index = yy * width + xx;
      if (!insideRLE(a.maskRLE, index) && !insideRLE(b.maskRLE, index)) samples.push(colorAt(index));
    }
    if (samples.length < 8) continue;
    const background = [0, 1, 2].map(c => median(samples.map(p => p[c])));
    const noise = median(samples.map(p => Math.max(...p.map((v, c) => Math.abs(v - background[c])))));
    if (noise > 24) continue;

    const x0 = Math.max(0, Math.floor(Math.min(p.x, q.x)) - cell);
    const x1 = Math.min(width - 1, Math.ceil(Math.max(p.x, q.x)) + cell);
    const y0 = Math.max(0, Math.floor(Math.min(p.y, q.y)) - cell);
    const y1 = Math.min(height - 1, Math.ceil(Math.max(p.y, q.y)) + cell);
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const allowed = new Uint8Array(w * h), visited = new Uint8Array(w * h);
    const previous = new Int32Array(w * h).fill(-1), depth = new Uint16Array(w * h), queue = new Int32Array(w * h);
    let head = 0, tail = 0, end = -1;
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
      const local = yy * w + xx, index = (yy + y0) * width + xx + x0;
      allowed[local] = +colorAt(index).some((value, c) => Math.abs(value - background[c]) > Math.max(8, noise * 3));
      if (allowed[local] && insideRLE(a.maskRLE, index)) { visited[local] = 1; queue[tail++] = local; }
    }
    while (head < tail) {
      if (!(head & 63)) checkAbort(signal);
      const local = queue[head++], xx = local % w, yy = Math.floor(local / w);
      if (insideRLE(b.maskRLE, (yy + y0) * width + xx + x0)) { end = local; break; }
      if (depth[local] > cell * 3) continue;
      for (const next of [xx ? local - 1 : -1, xx + 1 < w ? local + 1 : -1, yy ? local - w : -1, yy + 1 < h ? local + w : -1]) {
        if (next >= 0 && allowed[next] && !visited[next]) {
          visited[next] = 1; previous[next] = local; depth[next] = depth[local] + 1; queue[tail++] = next;
        }
      }
    }
    if (end < 0) continue;
    const pixels = [];
    for (let index = end; index >= 0; index = previous[index]) pixels.push((Math.floor(index / w) + y0) * width + index % w + x0);
    pixels.sort((a, b) => a - b);
    const maskRLE = [];
    let start = pixels[0], stop = start + 1;
    for (let i = 1; i < pixels.length; i++) {
      if (pixels[i] === stop) stop++;
      else { maskRLE.push(start, stop - start); start = pixels[i]; stop = start + 1; }
    }
    maskRLE.push(start, stop - start);
    return { maskRLE, distance, pixels: pixels.length, backgroundNoise: noise, sharedProposalIds, method: 'native-cell-source-path' };
  }
  return null;
}

/** Repair topology before weak hysteresis, retaining its original owner map. */
export function repairNativeProposalTopology(image, assemblies, { cell, signal } = {}) {
  checkAbort(signal);
  cell ??= Math.ceil(Math.max(image.width, image.height) / 256);
  const { width, height } = image, original = assemblies.slice(), repaired = assemblies.slice();
  const diagnostics = { before: assemblies.length, after: assemblies.length, candidates: 0, accepted: [], rejected: [], weakVetoed: 0 };
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < repaired.length; i++) for (let j = i + 1; j < repaired.length; j++) {
      checkAbort(signal);
      const left = repaired[i], right = repaired[j];
      if (left.sourceMeasured || right.sourceMeasured || !left.seedParts?.some(id => right.seedParts?.includes(id))) continue;
      const a = { ...geometry({ id: 'native-' + i, maskRLE: polygonRLE(left.points, width, height) }, width, height), seed: left };
      const b = { ...geometry({ id: 'native-' + j, maskRLE: polygonRLE(right.points, width, height) }, width, height), seed: right };
      if (Math.max(a.bounds.x0, b.bounds.x0) - Math.min(a.bounds.x1, b.bounds.x1) > cell + 1 || Math.max(a.bounds.y0, b.bounds.y0) - Math.min(a.bounds.y1, b.bounds.y1) > cell + 1) continue;
      diagnostics.candidates++;
      const bridge = nativeTopologyBridge(image, a, b, { cell, signal });
      if (!bridge) continue;
      const oldMask = unionRLE([a.maskRLE, b.maskRLE]), oldArea = pixelArea(oldMask);
      const contours = traceRLE(unionRLE([oldMask, bridge.maskRLE]), width, height, 0);
      if (contours.length !== 1 || !simple(contours[0].points)) { diagnostics.rejected.push({ i, j, reason: 'non-single-or-invalid-contour' }); continue; }
      const contour = contours[0], mask = polygonRLE(contour.points, width, height);
      const retained = intersection(mask, oldMask), added = pixelArea(mask) - retained, lost = oldArea - retained;
      const lostA = a.area - intersection(mask, a.maskRLE), lostB = b.area - intersection(mask, b.maskRLE);
      const limit = Math.min(cell * cell * 2 + 4, Math.max(12, oldArea * .005));
      if (added > limit || lost > Math.min(12, oldArea * .005) || lostA > Math.min(6, a.area * .005) || lostB > Math.min(6, b.area * .005)) { diagnostics.rejected.push({ i, j, reason: 'bounded-area', added, lost, lostA, lostB, limit }); continue; }
      let swallowed = false;
      for (let k = 0; k < repaired.length; k++) if (k !== i && k !== j) {
        const other = polygonRLE(repaired[k].points, width, height);
        if (intersection(mask, other) > intersection(oldMask, other)) { swallowed = true; break; }
      }
      if (swallowed) { diagnostics.rejected.push({ i, j, reason: 'third-identity-contact' }); continue; }
      repaired[i] = { ...contour, seedParts: [...new Set([...left.seedParts, ...right.seedParts])], nativeTopologyRepaired: true };
      repaired.splice(j, 1);
      diagnostics.accepted.push({ i, j, proposalIds: bridge.sharedProposalIds, distance: bridge.distance, pathPixels: bridge.pixels, backgroundNoise: bridge.backgroundNoise, added, lost, limit });
      changed = true;
      break outer;
    }
  }
  diagnostics.after = repaired.length;
  const originalOwners = diagnostics.accepted.length ? original.map((seed, index) => ({ ...geometry({ id: 'native-original-' + index, maskRLE: polygonRLE(seed.points, width, height) }, width, height), seed })) : [];
  const originalExpanded = originalOwners.map(owner => dilateRLE(owner, width, height, cell));
  return { assemblies: repaired, originalOwners, originalExpanded, diagnostics };
}

/** A topology repair cannot make a previously ambiguous weak proposal eligible. */
export function originalNativeWeakOwner(repair, grownMaskRLE, mergedOwner, { signal } = {}) {
  checkAbort(signal);
  if (!mergedOwner.seed.nativeTopologyRepaired) return mergedOwner;
  const owners = repair.originalOwners.flatMap((node, index) => intersection(grownMaskRLE, repair.originalExpanded[index]) ? [node] : []);
  if (owners.length === 1) return owners[0];
  repair.diagnostics.weakVetoed++;
  return null;
}
