// Keep the edited tool distinct from the checkboxes that decide what to add.
const ACTIVE = '#577b67';

function outline(ctx, item) {
  ctx.beginPath();
  item.contour.points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
  ctx.closePath();
}

function drawItem(ctx, item, index, scale, active = false) {
  outline(ctx, item);
  ctx.fillStyle = active ? '#577b6740' : item.checked ? '#efb74e22' : '#ffffff60';
  ctx.fill();
  if (active) {
    // A light halo keeps the green edge visible on both dark tools and photos.
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 5 * scale;
    ctx.stroke();
  }
  ctx.strokeStyle = active ? ACTIVE : item.checked ? '#e3a62e' : '#9caa97';
  ctx.lineWidth = (active ? 3 : item.checked ? 1.5 : 1) * scale;
  ctx.stroke();
  const center = item.info.center;
  ctx.beginPath();
  ctx.arc(center.x, center.y, (active ? 12 : 10) * scale, 0, Math.PI * 2);
  ctx.fillStyle = active ? ACTIVE : '#efb74e';
  ctx.fill();
  if (active) {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5 * scale;
    ctx.stroke();
  }
  ctx.fillStyle = active ? '#ffffff' : '#384830';
  ctx.font = `bold ${10 * scale}px system-ui`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(index + 1), center.x, center.y);
}

export function drawCaptureContours(ctx, items, {activeIndex = null, scale = 1} = {}) {
  ctx.save();
  ctx.lineJoin = 'round';
  for (const [index, item] of items.entries()) {
    if (index !== activeIndex) drawItem(ctx, item, index, scale);
  }
  // Draw the active tool last so neighbouring contours cannot obscure its edge.
  if (Number.isInteger(activeIndex) && items[activeIndex]) drawItem(ctx, items[activeIndex], activeIndex, scale, true);
  ctx.restore();
}

/** An enlarged photo of the current tool; manufacturing corrections never warp the photo. */
export function drawCaptureToolPreview(canvas, photo, item, index, view = { zoom: 1, x: 0, y: 0 }) {
  if (!canvas || !photo || !item) return;
  canvas.width = 640;
  canvas.height = 360;
  const ctx = canvas.getContext('2d');
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of item.contour.points) {
    minX = Math.min(minX, point.x); minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
  }
  const zoom = Math.min((canvas.width - 72) / Math.max(1, maxX - minX), (canvas.height - 72) / Math.max(1, maxY - minY));
  const displayScale = canvas.width / Math.max(200, canvas.clientWidth || 320);
  ctx.fillStyle = '#f6f7f3';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(view.x, view.y);
  ctx.scale(view.zoom, view.zoom);
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-(minX + maxX) / 2, -(minY + maxY) / 2);
  ctx.drawImage(photo, 0, 0);
  ctx.lineJoin = 'round';
  drawItem(ctx, item, index, displayScale / (zoom * view.zoom), true);
  ctx.restore();
}
