// Analytic silver wrenches, independent of the preprocessing implementation.
// The bright streak is enclosed by a measured gray boundary. No recovery is
// expected where a white edge is indistinguishable from its white background.
const shape = (x, y, fillRing = false) => {
  const shaft = x >= -100 && x <= 85 && Math.abs(y) <= 9;
  const jaw = Math.hypot(x + 100, y) <= 28 && !(x < -96 && Math.abs(y) < 12);
  const ring = Math.hypot(x - 100, y) <= 22 && (fillRing || Math.hypot(x - 100, y) >= 13);
  return shaft || jaw || ring;
};

export function lightWrenchesPhoto({ width = 600, height = 420, background = [255, 255, 255], tools = [
  { x: 300, y: 125, angle: -.18 }, { x: 300, y: 285, angle: .23 }
] } = {}) {
  const data = new Uint8ClampedArray(width * height * 4);
  const toolMasks = tools.map(() => new Uint8Array(width * height));
  const truth = new Uint8Array(width * height);
  for (let p = 0; p < width * height; p++) {
    data.set([...background, 255], p * 4);
    const x = p % width + .5, y = Math.floor(p / width) + .5;
    for (let i = 0; i < tools.length; i++) {
      const tool = tools[i], c = Math.cos(tool.angle), s = Math.sin(tool.angle);
      const xx = ((x - tool.x) * c + (y - tool.y) * s) / (tool.scale ?? 1);
      const yy = (-(x - tool.x) * s + (y - tool.y) * c) / (tool.scale ?? 1);
      if (shape(xx, yy, true)) { truth[p] = 1; toolMasks[i][p] = 1; }
      if (!shape(xx, yy)) continue;
      const rimWidth = Math.max(1.2, 1.1 / (tool.scale ?? 1));
      const rim = [[-rimWidth, 0], [rimWidth, 0], [0, -rimWidth], [0, rimWidth]].some(([dx, dy]) => !shape(xx + dx, yy + dy));
      const glare = xx > -85 && xx < 80 && yy > -2 && yy < 4;
      const marking = Math.abs(yy + 5) < 1.2 && xx > -50 && xx < 55 && Math.floor((xx + 50) / 9) % 2 === 0;
      const level = rim ? 165 : marking ? 120 : glare ? 255 : 213 + Math.round(9 * Math.cos(xx * .04));
      const color = !rim && xx > -78 && xx < -72 ? [76, 180, 210] : [level, level, level];
      data.set([...color, 255], p * 4);
    }
  }
  return { width, height, data, truth, toolMasks, tools };
}

export function onTool(tool, x, y) {
  const scale = tool.scale ?? 1;
  return { x: tool.x + scale * (x * Math.cos(tool.angle) - y * Math.sin(tool.angle)),
    y: tool.y + scale * (x * Math.sin(tool.angle) + y * Math.cos(tool.angle)) };
}

export function maskAt(mask, width, point) {
  return mask[Math.floor(point.y) * width + Math.floor(point.x)];
}
