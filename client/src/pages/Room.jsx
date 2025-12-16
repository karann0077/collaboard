import React, { useEffect, useRef, useState } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';

const SERVER = import.meta.env.VITE_SERVER_URL;


// helpers to draw shapes
function drawStrokeOnCtx(ctx, stroke) {
  if (!stroke || !stroke.path || stroke.path.length === 0) return;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (stroke.style === 'dashed') ctx.setLineDash([10,6]);
  else if (stroke.style === 'dotted') ctx.setLineDash([2,6]);
  else ctx.setLineDash([]);
  ctx.strokeStyle = stroke.color || '#000';
  ctx.lineWidth = stroke.width || 2;
  ctx.beginPath();
  const p0 = stroke.path[0];
  ctx.moveTo(p0.x, p0.y);
  for (let i = 1; i < stroke.path.length; i++) {
    const p = stroke.path[i];
    ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawShapeOnCtx(ctx, shape) {
  ctx.save();
  ctx.strokeStyle = shape.color || '#000';
  ctx.fillStyle = shape.fill || 'transparent';
  ctx.lineWidth = shape.width || 2;
  if (shape.style === 'dashed') ctx.setLineDash([10,6]);
  else if (shape.style === 'dotted') ctx.setLineDash([2,6]);
  else ctx.setLineDash([]);
  if (shape.type === 'rect') {
    const { x, y, w, h } = shape;
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    if (shape.fill && shape.fill !== 'transparent') ctx.fill();
    ctx.stroke();
  } else if (shape.type === 'circle') {
    const { x, y, r } = shape;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI*2);
    if (shape.fill && shape.fill !== 'transparent') ctx.fill();
    ctx.stroke();
  } else if (shape.type === 'line') {
    const { x1, y1, x2, y2 } = shape;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  } else if (shape.type === 'text') {
    ctx.fillStyle = shape.color || '#000';
    ctx.font = (shape.fontSize||16) + 'px sans-serif';
    ctx.fillText(shape.text||'', shape.x, shape.y);
  }
  ctx.restore();
}

export default function Room() {
  const { roomId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const suppliedName = (location.state && location.state.name) || null;
  const socketRef = useRef(null);
  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const [color, setColor] = useState('#0f172a');
  const [width, setWidth] = useState(2);
  const [style, setStyle] = useState('solid'); // solid, dashed, dotted
  const [tool, setTool] = useState('pen'); // pen, rect, circle, line, text, eraser
  const drawing = useRef(false);
  const currentPath = useRef([]);
  const currentShape = useRef(null);
  const [participants, setParticipants] = useState([]);
  const [status, setStatus] = useState('Connecting...');
  const cursors = useRef({}); // remote cursors
  const assignedColor = useRef('#000');

  useEffect(() => {
    let userName = suppliedName;
    if (!userName) {
      userName = prompt('Enter your name to join the room');
      if (!userName) { navigate('/'); return; }
    }

    const socket = io(SERVER, { transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      setStatus('Connected');
      socket.emit('join-room', { roomId, name: userName });
    });

    socket.on('room-not-found', () => {
      alert('Room not found');
      navigate('/');
    });

    socket.on('initial-state', ({ strokes, shapes, assignedColor: ac, participants: parts }) => {
      assignedColor.current = ac || assignedColor.current;
      setParticipants(parts || []);
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0,0,canvas.width, canvas.height);
      // draw shapes first then strokes
      if (shapes && shapes.length) {
        for (const s of shapes) drawShapeOnCtx(ctx, s);
      }
      if (strokes && strokes.length) {
        for (const st of strokes) drawStrokeOnCtx(ctx, st);
      }
    });

    socket.on('remote-stroke', (stroke) => {
      const ctx = canvasRef.current.getContext('2d');
      drawStrokeOnCtx(ctx, stroke);
    });

    socket.on('shape-created', (shape) => {
      const ctx = canvasRef.current.getContext('2d');
      drawShapeOnCtx(ctx, shape);
    });

    socket.on('participants', (list) => {
      setParticipants(list || []);
    });

    socket.on('remote-cursor', ({ id, name, color, x, y }) => {
      cursors.current[id] = { id, name, color, x, y, ts: Date.now() };
      // cleanup later via interval
    });

    socket.on('clear-board', () => {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0,0,canvas.width, canvas.height);
    });

    socket.on('disconnect', () => setStatus('Disconnected'));

    return () => {
      if (socket && socket.disconnect) socket.disconnect();
    };
  }, [roomId, suppliedName, navigate]);

  // cursor render loop
  useEffect(() => {
    const loop = () => {
      const overlay = overlayRef.current;
      const ctx = overlay.getContext('2d');
      ctx.clearRect(0,0,overlay.width, overlay.height);
      // draw remote cursors
      const now = Date.now();
      for (const id in cursors.current) {
        const c = cursors.current[id];
        if (!c) continue;
        // remove old cursors
        if (now - c.ts > 5000) { delete cursors.current[id]; continue; }
        ctx.beginPath();
        ctx.fillStyle = c.color || '#f97316';
        ctx.arc(c.x, c.y, 6, 0, Math.PI*2);
        ctx.fill();
        ctx.font = '12px sans-serif';
        ctx.fillStyle = '#111827';
        ctx.fillText(c.name || 'User', c.x + 10, c.y + 4);
      }
      requestAnimationFrame(loop);
    };
    const id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, []);

  // resize canvases
  useEffect(() => {
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    const resize = () => {
      const data = canvas.toDataURL();
      canvas.width = Math.max(window.innerWidth * 0.75, 800);
      canvas.height = Math.max(window.innerHeight * 0.75, 600);
      overlay.width = canvas.width;
      overlay.height = canvas.height;
      // redraw saved image
      const img = new Image();
      img.onload = () => {
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
      };
      img.src = data;
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  // throttled cursor emitter
  const lastCursorEmit = useRef(0);
  const emitCursor = (x,y) => {
    if (!socketRef.current || !socketRef.current.connected) return;
    const now = Date.now();
    if (now - lastCursorEmit.current < 60) return; // ~16Hz
    lastCursorEmit.current = now;
    socketRef.current.emit('cursor-move', { roomId, x, y });
  };

  const getPos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handlePointerDown = (e) => {
    const pos = getPos(e);
    if (tool === 'pen' || tool === 'eraser') {
      drawing.current = true;
      currentPath.current = [{ x: pos.x, y: pos.y }];
    } else if (tool === 'rect') {
      currentShape.current = { type: 'rect', x: pos.x, y: pos.y, w:0, h:0, color, width, style, fill: 'transparent', userColor: assignedColor.current };
    } else if (tool === 'circle') {
      currentShape.current = { type: 'circle', x: pos.x, y: pos.y, r:0, color, width, style, fill: 'transparent', userColor: assignedColor.current };
    } else if (tool === 'line') {
      currentShape.current = { type: 'line', x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y, color, width, style, userColor: assignedColor.current };
    } else if (tool === 'text') {
      const text = prompt('Enter text:');
      if (!text) return;
      const shape = { type: 'text', x: pos.x, y: pos.y, text, color, width, fontSize: 18, userColor: assignedColor.current };
      const ctx = canvasRef.current.getContext('2d');
      drawShapeOnCtx(ctx, shape);
      if (socketRef.current && socketRef.current.connected) {
        socketRef.current.emit('create-shape', { roomId, shape });
      }
    }
  };

  const handlePointerMove = (e) => {
    const pos = getPos(e);
    emitCursor(pos.x, pos.y);
    if (tool === 'pen' || tool === 'eraser') {
      if (!drawing.current) return;
      const p = { x: pos.x, y: pos.y };
      currentPath.current.push(p);
      const ctx = canvasRef.current.getContext('2d');
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeStyle = tool === 'eraser' ? '#ffffff' : color;
      ctx.lineWidth = width;
      if (style === 'dashed') ctx.setLineDash([10,6]);
      else if (style === 'dotted') ctx.setLineDash([2,6]);
      else ctx.setLineDash([]);
      ctx.beginPath();
      const last = currentPath.current;
      if (last.length >= 2) {
        const a = last[last.length - 2];
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
      ctx.restore();
    } else {
      // preview shape on overlay
      if (!currentShape.current) return;
      const overlay = overlayRef.current;
      const octx = overlay.getContext('2d');
      octx.clearRect(0,0,overlay.width, overlay.height);
      const s = currentShape.current;
      if (s.type === 'rect') {
        s.w = pos.x - s.x;
        s.h = pos.y - s.y;
        drawShapeOnCtx(octx, s);
      } else if (s.type === 'circle') {
        const dx = pos.x - s.x;
        const dy = pos.y - s.y;
        s.r = Math.sqrt(dx*dx + dy*dy);
        drawShapeOnCtx(octx, s);
      } else if (s.type === 'line') {
        s.x2 = pos.x; s.y2 = pos.y;
        drawShapeOnCtx(octx, s);
      }
    }
  };

  const handlePointerUp = (e) => {
    const pos = getPos(e);
    if (tool === 'pen' || tool === 'eraser') {
      if (!drawing.current) return;
      drawing.current = false;
      const stroke = { path: currentPath.current.slice(), color: tool === 'eraser' ? '#ffffff' : color, width, style, userColor: assignedColor.current };
      if (socketRef.current && socketRef.current.connected) {
        socketRef.current.emit('draw-stroke', { roomId, stroke });
      }
      currentPath.current = [];
    } else {
      if (!currentShape.current) return;
      const s = currentShape.current;
      // finalize shape - clear overlay then draw onto main canvas
      const overlay = overlayRef.current;
      const octx = overlay.getContext('2d');
      octx.clearRect(0,0,overlay.width, overlay.height);
      // compute final attributes already updated in move handler
      const ctx = canvasRef.current.getContext('2d');
      drawShapeOnCtx(ctx, s);
      if (socketRef.current && socketRef.current.connected) {
        socketRef.current.emit('create-shape', { roomId, shape: s });
      }
      currentShape.current = null;
    }
  };

  const clearBoard = () => {
    if (!confirm('Clear the board for everyone?')) return;
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit('clear-board', { roomId });
    }
  };

  return (
    <div className="room-root">
      <div className="room-top">
        <div className="brand">Collaboard</div>
        <div className="room-info">
          <div>Room: <strong>{roomId}</strong></div>
          <div>Status: {status}</div>
        </div>
        <div className="room-actions">
          <button onClick={() => { navigator.clipboard.writeText(roomId); alert('Room code copied'); }}>Copy code</button>
          <button onClick={clearBoard}>Clear</button>
        </div>
      </div>

      <div className="room-body">
        <aside className="toolbar">
          <div className={'tool'+(tool==='pen'?' selected':'')} onClick={()=>setTool('pen')}>✏️ Pen</div>
          <div className={'tool'+(tool==='rect'?' selected':'')} onClick={()=>setTool('rect')}>▭ Rect</div>
          <div className={'tool'+(tool==='circle'?' selected':'')} onClick={()=>setTool('circle')}>◯ Circle</div>
          <div className={'tool'+(tool==='line'?' selected':'')} onClick={()=>setTool('line')}>／ Line</div>
          <div className={'tool'+(tool==='text'?' selected':'')} onClick={()=>setTool('text')}>T Text</div>
          <div className={'tool'+(tool==='eraser'?' selected':'')} onClick={()=>setTool('eraser')}>🧽 Eraser</div>

          <hr />

          <div className="control">
            <label>Color</label>
            <input type="color" value={color} onChange={e=>setColor(e.target.value)} />
          </div>

          <div className="control">
            <label>Width: {width}</label>
            <input type="range" min="1" max="20" value={width} onChange={e=>setWidth(Number(e.target.value))} />
          </div>

          <div className="control">
            <label>Style</label>
            <select value={style} onChange={e=>setStyle(e.target.value)} >
              <option value="solid">Solid</option>
              <option value="dashed">Dashed</option>
              <option value="dotted">Dotted</option>
            </select>
          </div>

          <hr />
          <div className="participants">
            <h4>Participants</h4>
            <ul>
              {participants.map(p=>(
                <li key={p.id}><span className="avatar" style={{background:p.color}}></span> {p.name}</li>
              ))}
            </ul>
          </div>
        </aside>

        <main className="canvas-wrap">
          <div className="canvas-area"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
          >
            <canvas ref={canvasRef} className="board-canvas" />
            <canvas ref={overlayRef} className="overlay-canvas" />
          </div>
        </main>
      </div>
    </div>
  );
}
