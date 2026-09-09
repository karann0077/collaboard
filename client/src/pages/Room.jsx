import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { createEmptyDocument } from '../../../packages/shared/src/document.ts';
import { createSyncEngine } from '../collaboration/syncEngine';
import { sendCommand } from '../collaboration/commandClient';
import { drawObject, renderDocument, renderOverlay } from '../canvas/renderer';
import { useRoomSocket } from '../hooks/useRoomSocket';
import { Toolbar } from '../components/Toolbar';
import { Participants } from '../components/Participants';

const makeId = (prefix) => `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`;

// ─── Hit-testing for eraser (Bug #9) ─────────────────────────────────────────

/** Bounding box of a stroke path. */
function strokeBounds(path) {
  const xs = path.map(p => p.x);
  const ys = path.map(p => p.y);
  return {
    x: Math.min(...xs), y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys)
  };
}

/** Check if point (px, py) is within `radius` pixels of any segment of `path`. */
function pointNearPath(path, px, py, radius) {
  for (let i = 0; i < path.length - 1; i++) {
    const ax = path[i].x, ay = path[i].y;
    const bx = path[i + 1].x, by = path[i + 1].y;
    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) {
      if (Math.hypot(px - ax, py - ay) <= radius) return true;
      continue;
    }
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
    const closestX = ax + t * dx;
    const closestY = ay + t * dy;
    if (Math.hypot(px - closestX, py - closestY) <= radius) return true;
  }
  return false;
}

/** Check if point is within the bounding box of a shape object. */
function pointInShapeBounds(obj, px, py, margin = 10) {
  if (obj.type === 'rect') {
    const x = Math.min(obj.x, obj.x + obj.w);
    const y = Math.min(obj.y, obj.y + obj.h);
    const w = Math.abs(obj.w);
    const h = Math.abs(obj.h);
    return px >= x - margin && px <= x + w + margin && py >= y - margin && py <= y + h + margin;
  }
  if (obj.type === 'circle') {
    return Math.hypot(px - obj.x, py - obj.y) <= obj.r + margin;
  }
  if (obj.type === 'line' || obj.type === 'arrow') {
    return pointNearPath([{ x: obj.x1, y: obj.y1 }, { x: obj.x2, y: obj.y2 }], px, py, margin);
  }
  if (obj.type === 'text') {
    // Approximate text bounding box
    const fontSize = obj.fontSize || 16;
    const textWidth = (obj.text || '').length * fontSize * 0.6;
    return px >= obj.x - margin && px <= obj.x + textWidth + margin &&
           py >= obj.y - fontSize - margin && py <= obj.y + margin;
  }
  return false;
}

/**
 * findObjectAtPoint — returns the top-most object under (px, py) in the document.
 * Searches in reverse order (last drawn = on top).
 */
function findObjectAtPoint(objects, px, py, eraserRadius = 12) {
  for (let i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i];
    if (obj.path) {
      // Stroke object
      if (pointNearPath(obj.path, px, py, eraserRadius)) return obj;
    } else {
      if (pointInShapeBounds(obj, px, py, eraserRadius)) return obj;
    }
  }
  return null;
}

// ─── Room component ──────────────────────────────────────────────────────────

export default function Room() {
  const { roomId } = useParams();
  const location = useLocation();
  const name = location.state?.name || 'Guest';

  const canvasRef = useRef();
  const overlayRef = useRef();

  const [document, setDocument] = useState(createEmptyDocument());
  const engineRef = useRef();

  // Initialize sync engine exactly once
  if (!engineRef.current) {
    engineRef.current = createSyncEngine({
      onChange: ({ document: next }) => setDocument({ ...next, objects: [...next.objects] }),
      requestSync: (lastSeq) => socketRef.current?.emit('sync-request', { lastSeq })
    });
  }

  const { status, socketRef, role, remoteCursors } = useRoomSocket(roomId, name, engineRef);

  const isViewer = role === 'viewer';

  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState('#111827');
  const [width, setWidth] = useState(3);
  const [style, setStyle] = useState('solid');
  const [textInput, setTextInput] = useState(null);
  const activeRef = useRef(null);
  const lastCursorEmit = useRef(0);  // Bug #7: throttle cursor emissions

  // ─── Canvas sizing with ResizeObserver + devicePixelRatio ─────────────────
  // Bug #23: use actual container size instead of window magic numbers
  // Bug #24: scale by devicePixelRatio for crisp rendering on HiDPI screens

  const applyCanvasSize = useCallback((width, height) => {
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    if (!canvas || !overlay) return;

    const dpr = window.devicePixelRatio || 1;

    // Physical pixel size
    canvas.width  = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    overlay.width  = canvas.width;
    overlay.height = canvas.height;

    // CSS display size
    canvas.style.width  = `${width}px`;
    canvas.style.height = `${height}px`;
    overlay.style.width  = `${width}px`;
    overlay.style.height = `${height}px`;

    // Scale context so drawing coordinates stay in CSS-pixel space
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    renderDocument(canvas, engineRef.current?.state().document || document);
  }, [document]);

  useEffect(() => {
    const wrap = canvasRef.current?.closest('.canvas-wrap');
    if (!wrap) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) applyCanvasSize(width, height);
    });

    observer.observe(wrap);
    return () => observer.disconnect();
  }, [applyCanvasSize]);

  // ─── Re-render document when state changes ──────────────────────────────
  useEffect(() => {
    if (canvasRef.current) renderDocument(canvasRef.current, document);
  }, [document]);

  // ─── Overlay rendering (preview + cursors) ──────────────────────────────
  const renderCurrentOverlay = useCallback(() => {
    if (!overlayRef.current) return;
    const activeObj = activeRef.current ? toObject(activeRef.current) : null;
    renderOverlay(overlayRef.current, remoteCursors, activeObj);
  }, [remoteCursors]);

  useEffect(() => {
    renderCurrentOverlay();
  }, [remoteCursors, renderCurrentOverlay]);

  // ─── Keyboard shortcuts ─────────────────────────────────────────────────
  useEffect(() => {
    const keys = (event) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === 'z') {
        event.preventDefault();
        sendCommand(socketRef.current, event.shiftKey ? 'redo' : 'undo').catch(() => {});
      } else if (event.key.toLowerCase() === 'y') {
        event.preventDefault();
        sendCommand(socketRef.current, 'redo').catch(() => {});
      }
    };
    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
  }, []);

  // ─── Coordinate helper ──────────────────────────────────────────────────
  const point = (event) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  // ─── Object construction from active drawing state ──────────────────────
  const toObject = (active) => {
    if (active.kind === 'stroke') {
      return {
        objectId: active.objectId,
        path: active.path,
        color: tool === 'eraser' ? '#fff' : color,
        width: tool === 'eraser' ? width * 2 : width,
        style
      };
    }
    const { start, current } = active;
    const activeTool = active.tool || tool;

    if (activeTool === 'rect') {
      // Bug #8 fix: normalize so dragging in any direction works
      return {
        objectId: active.objectId,
        type: 'rect',
        x: Math.min(start.x, current.x),
        y: Math.min(start.y, current.y),
        w: Math.abs(current.x - start.x),
        h: Math.abs(current.y - start.y),
        color, width, style
      };
    }
    if (activeTool === 'circle') {
      return {
        objectId: active.objectId,
        type: 'circle',
        x: start.x,
        y: start.y,
        r: Math.hypot(current.x - start.x, current.y - start.y),
        color, width, style
      };
    }
    return {
      objectId: active.objectId,
      type: activeTool,
      x1: start.x, y1: start.y,
      x2: current.x, y2: current.y,
      color, width, style
    };
  };

  // ─── Pointer events ─────────────────────────────────────────────────────
  const pointerDown = (event) => {
    if (isViewer) return;  // Bug #10: block viewer input
    const p = point(event);

    if (tool === 'text') {
      setTextInput({ ...p, value: '' });
      return;
    }

    if (tool === 'eraser') {
      // Bug #9: real eraser — find and delete the object under cursor
      const currentDoc = engineRef.current?.state().document;
      if (currentDoc) {
        const hit = findObjectAtPoint(currentDoc.objects, p.x, p.y, width * 2);
        if (hit) {
          sendCommand(socketRef.current, 'object.deleted', { objectId: hit.objectId })
            .catch((err) => console.warn('[Eraser]', err.message));
        }
      }
      return;
    }

    const objectId = makeId('obj');
    activeRef.current = (tool === 'pen')
      ? { kind: 'stroke', objectId, path: [p] }
      : { kind: 'shape', objectId, tool, start: p, current: p };

    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const pointerMove = (event) => {
    const active = activeRef.current;
    const p = point(event);

    // Bug #7: throttle cursor emissions to ~30fps
    const now = Date.now();
    if (now - lastCursorEmit.current >= 33) {
      lastCursorEmit.current = now;
      socketRef.current?.emit('cursor-move', p);
    }

    if (!active) return;

    if (active.kind === 'stroke') active.path.push(p);
    else active.current = p;

    renderCurrentOverlay();
  };

  const pointerUp = () => {
    const active = activeRef.current;
    if (!active || isViewer) return;
    activeRef.current = null;
    renderCurrentOverlay();

    const object = toObject(active);
    if (active.kind === 'stroke' && object.path.length < 2) return;

    const type = active.kind === 'stroke' ? 'stroke.created' : 'shape.created';
    sendCommand(socketRef.current, type, object).catch((err) => console.warn(err.message));
  };

  const submitText = () => {
    if (!textInput?.value.trim()) return setTextInput(null);
    const object = {
      objectId: makeId('obj'),
      type: 'text',
      x: textInput.x,
      y: textInput.y,
      text: textInput.value,
      color,
      fontSize: 20
    };
    setTextInput(null);
    sendCommand(socketRef.current, 'text.created', object).catch((err) => console.warn(err.message));
  };

  const clear = () => {
    if (confirm('Clear the entire board for everyone? You can undo your clear.')) {
      sendCommand(socketRef.current, 'board.cleared', {}).catch((err) => console.warn(err.message));
    }
  };

  // ─── Cursor style ───────────────────────────────────────────────────────
  const cursorClass = isViewer ? 'default'
    : tool === 'eraser' ? 'eraser-cursor'
    : tool === 'text'   ? 'text-cursor'
    : 'crosshair';

  return (
    <div className="room-root">
      <div className="room-top">
        <div className="brand">Collaboard</div>
        <div className="room-info">
          <div>Room: <strong>{roomId}</strong></div>
          <div>Status: <strong>{status}</strong></div>
          <div>Version: <strong>{document.version}</strong></div>
          {isViewer && <div className="viewer-tag">👁 View Only</div>}
        </div>
        <div className="room-actions">
          <button onClick={() => navigator.clipboard.writeText(roomId)}>📋 Copy Code</button>
          {!isViewer && (
            <button onClick={clear}>🗑️ Clear</button>
          )}
        </div>
      </div>

      <div className="room-body">
        <div className="sidebar-container">
          {/* Bug #10: pass disabled prop for viewer role */}
          <Toolbar
            tool={tool} setTool={setTool}
            color={color} setColor={setColor}
            width={width} setWidth={setWidth}
            style={style} setStyle={setStyle}
            disabled={isViewer}
          />
          <Participants />
        </div>

        <main className="canvas-wrap">
          <div
            className="canvas-area"
            style={{ cursor: cursorClass }}
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={pointerUp}
            onPointerLeave={pointerUp}
          >
            <canvas ref={canvasRef} className="board-canvas" />
            <canvas ref={overlayRef} className="overlay-canvas" />
            {textInput && (
              <input
                autoFocus
                className="text-input-box"
                style={{ left: textInput.x, top: textInput.y }}
                value={textInput.value}
                onChange={(e) => setTextInput({ ...textInput, value: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitText();
                  if (e.key === 'Escape') setTextInput(null);
                }}
                onBlur={submitText}
              />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
