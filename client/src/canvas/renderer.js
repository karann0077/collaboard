/**
 * renderer.js — Canvas drawing utilities for Collaboard.
 *
 * Bug #6: added renderCursors() to draw remote user cursors on the overlay canvas.
 */

/** Draw a freehand stroke (array of points). */
function stroke(ctx, object) {
  const { path = [] } = object;
  if (!path.length) return;
  ctx.beginPath();
  ctx.moveTo(path[0].x, path[0].y);
  path.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
  ctx.stroke();
}

/** Draw a shape, line, arrow, or text object. */
function shape(ctx, object) {
  ctx.beginPath();
  if (object.type === 'rect') {
    ctx.rect(object.x, object.y, object.w, object.h);
  } else if (object.type === 'circle') {
    ctx.arc(object.x, object.y, object.r, 0, Math.PI * 2);
  } else if (object.type === 'line' || object.type === 'arrow') {
    ctx.moveTo(object.x1, object.y1);
    ctx.lineTo(object.x2, object.y2);
    if (object.type === 'arrow') {
      const a = Math.atan2(object.y2 - object.y1, object.x2 - object.x1);
      ctx.lineTo(object.x2 - 15 * Math.cos(a - Math.PI / 6), object.y2 - 15 * Math.sin(a - Math.PI / 6));
      ctx.moveTo(object.x2, object.y2);
      ctx.lineTo(object.x2 - 15 * Math.cos(a + Math.PI / 6), object.y2 - 15 * Math.sin(a + Math.PI / 6));
    }
  } else if (object.type === 'text') {
    ctx.font = `${object.fontSize || 16}px sans-serif`;
    ctx.fillText(object.text || '', object.x, object.y);
    return;
  } else {
    return;
  }

  if (object.fill && object.fill !== 'transparent') ctx.fill();
  ctx.stroke();
}

/**
 * drawObject — draw a single DrawableObject onto a 2D context.
 * Applies stroke style, color, width, and line-dash pattern.
 */
export function drawObject(ctx, object) {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = object.color || '#000';
  ctx.fillStyle = object.fill || object.color || '#000';
  ctx.lineWidth = object.width || 2;
  if (object.style === 'dashed') ctx.setLineDash([10, 6]);
  else if (object.style === 'dotted') ctx.setLineDash([2, 6]);
  else ctx.setLineDash([]);

  if (object.path) stroke(ctx, object);
  else shape(ctx, object);
  ctx.restore();
}

/**
 * renderDocument — clear and redraw the entire document onto a canvas.
 * Called whenever the committed document state changes.
 */
export function renderDocument(canvas, document) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  document.objects.forEach((object) => drawObject(ctx, object));
}

/**
 * renderCursors — draw remote user cursors on the overlay canvas.
 * Bug #6 fix: cursors are drawn as colored dots + name labels.
 *
 * @param {HTMLCanvasElement} canvas       - the overlay canvas
 * @param {Map}               cursors      - Map<actorId, { actorId, color, x, y, name? }>
 * @param {Object|null}       activeObject - current in-progress drawing object (or null)
 * @param {string}            dpr          - device pixel ratio multiplier
 */
export function renderOverlay(canvas, cursors, activeObject) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw the active in-progress object (preview while drawing)
  if (activeObject) {
    drawObject(ctx, activeObject);
  }

  // Draw remote cursors
  for (const [, cursor] of cursors) {
    const { color, x, y, name } = cursor;
    const cx = x * dpr;
    const cy = y * dpr;

    // Cursor dot
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fillStyle = color || '#6366f1';
    ctx.fill();
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Name label
    if (name) {
      ctx.font = 'bold 12px sans-serif';
      const textWidth = ctx.measureText(name).width;
      const pad = 4;
      ctx.fillStyle = color || '#6366f1';
      ctx.beginPath();
      ctx.roundRect(cx + 10, cy - 10, textWidth + pad * 2, 18, 4);
      ctx.fill();
      ctx.fillStyle = 'white';
      ctx.fillText(name, cx + 10 + pad, cy + 4);
    }
  }
}
