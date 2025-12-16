import React, { useEffect, useRef, useState } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';

const SERVER = 'http://127.0.0.1:4000';

// Helper functions to draw strokes and shapes
function drawStrokeOnCtx(ctx, stroke) {
  if (!stroke || !stroke.path || stroke.path.length === 0) return;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (stroke.style === 'dashed') ctx.setLineDash([10, 6]);
  else if (stroke.style === 'dotted') ctx.setLineDash([2, 6]);
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
  if (shape.style === 'dashed') ctx.setLineDash([10, 6]);
  else if (shape.style === 'dotted') ctx.setLineDash([2, 6]);
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
    ctx.arc(x, y, r, 0, Math.PI * 2);
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
    ctx.font = `${shape.fontSize || 16}px sans-serif`;
    ctx.fillText(shape.text || '', shape.x, shape.y);
  } else if (shape.type === 'arrow') {
    const { x1, y1, x2, y2 } = shape;
    const headlen = 15;
    const angle = Math.atan2(y2 - y1, x2 - x1);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x2 - headlen * Math.cos(angle - Math.PI / 6), y2 - headlen * Math.sin(angle - Math.PI / 6));
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headlen * Math.cos(angle + Math.PI / 6), y2 - headlen * Math.sin(angle + Math.PI / 6));
    ctx.stroke();
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
  const textInputRef = useRef(null);
  
  const [color, setColor] = useState('#0f172a');
  const [width, setWidth] = useState(3);
  const [style, setStyle] = useState('solid');
  const [tool, setTool] = useState('pen');
  const [participants, setParticipants] = useState([]);
  const [status, setStatus] = useState('Connecting...');
  const [showCopied, setShowCopied] = useState(false);
  const [fill, setFill] = useState('transparent');
  const [fontSize, setFontSize] = useState(18);
  
  // Text input state
  const [textInput, setTextInput] = useState({
    show: false,
    x: 0,
    y: 0,
    value: '',
    tempShape: null
  });
  
  const drawing = useRef(false);
  const currentPath = useRef([]);
  const currentShape = useRef(null);
  const cursors = useRef({});
  const assignedColor = useRef('#000');
  const lastCursorEmit = useRef(0);
  const history = useRef([]);
  const historyStep = useRef(-1);

  useEffect(() => {
    let userName = suppliedName;
    if (!userName) {
      userName = prompt('Enter your name to join the room');
      if (!userName) {
        navigate('/');
        return;
      }
    }

    const socket = io(SERVER, { transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      setStatus('Connected');
      socket.emit('join-room', { roomId, name: userName });
    });

    socket.on('room-not-found', () => {
      alert('Room not found. Please check the code and try again.');
      navigate('/');
    });

    socket.on('initial-state', ({ strokes, shapes, assignedColor: ac, participants: parts }) => {
      assignedColor.current = ac || assignedColor.current;
      setParticipants(parts || []);
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      if (shapes && shapes.length) {
        for (const s of shapes) drawShapeOnCtx(ctx, s);
      }
      if (strokes && strokes.length) {
        for (const st of strokes) drawStrokeOnCtx(ctx, st);
      }
    });

    socket.on('remote-stroke', stroke => {
      const ctx = canvasRef.current.getContext('2d');
      drawStrokeOnCtx(ctx, stroke);
    });

    socket.on('shape-created', shape => {
      const ctx = canvasRef.current.getContext('2d');
      drawShapeOnCtx(ctx, shape);
    });

    socket.on('participants', list => {
      setParticipants(list || []);
    });

    socket.on('remote-cursor', ({ id, name, color, x, y }) => {
      cursors.current[id] = { id, name, color, x, y, ts: Date.now() };
    });

    socket.on('clear-board', () => {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      history.current = [];
      historyStep.current = -1;
    });

    socket.on('disconnect', () => setStatus('Disconnected'));

    return () => {
      if (socket && socket.disconnect) socket.disconnect();
    };
  }, [roomId, suppliedName, navigate]);

  // Store current mouse position for overlay rendering
  const mousePos = useRef({ x: 0, y: 0 });

  // Cursor animation loop
  useEffect(() => {
    const loop = () => {
      const overlay = overlayRef.current;
      if (!overlay) return;
      const ctx = overlay.getContext('2d');
      ctx.clearRect(0, 0, overlay.width, overlay.height);
      
      const now = Date.now();
      
      // Draw remote cursors
      for (const id in cursors.current) {
        const c = cursors.current[id];
        if (!c) continue;
        if (now - c.ts > 5000) {
          delete cursors.current[id];
          continue;
        }
        
        ctx.save();
        ctx.shadowBlur = 8;
        ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
        ctx.beginPath();
        ctx.fillStyle = c.color || '#f97316';
        ctx.arc(c.x, c.y, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        
        const text = c.name || 'User';
        ctx.font = '12px sans-serif';
        const metrics = ctx.measureText(text);
        const padding = 4;
        const bgX = c.x + 12;
        const bgY = c.y - 8;
        
        ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
        ctx.fillRect(bgX - padding, bgY - padding, metrics.width + padding * 2, 16 + padding);
        ctx.fillStyle = 'white';
        ctx.fillText(text, bgX, c.y + 5);
      }
      
      // Draw text input preview if active
      if (textInput.show && textInput.tempShape) {
        drawShapeOnCtx(ctx, textInput.tempShape);
      }
      
      // Draw current shape being created
      if (currentShape.current) {
        const s = currentShape.current;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.fillStyle = fill;
        ctx.lineWidth = width;
        ctx.globalAlpha = 0.7;
        if (style === 'dashed') ctx.setLineDash([10, 6]);
        else if (style === 'dotted') ctx.setLineDash([2, 6]);
        
        if (s.type === 'rect') {
          ctx.beginPath();
          ctx.rect(s.x, s.y, s.w, s.h);
          if (fill && fill !== 'transparent') {
            ctx.globalAlpha = 0.3;
            ctx.fill();
            ctx.globalAlpha = 0.7;
          }
          ctx.stroke();
          
          // Show dimensions
          ctx.globalAlpha = 1;
          ctx.fillStyle = '#6366f1';
          ctx.font = 'bold 12px sans-serif';
          const dimText = `${Math.abs(Math.round(s.w))} × ${Math.abs(Math.round(s.h))}`;
          const metrics = ctx.measureText(dimText);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
          ctx.fillRect(s.x + s.w / 2 - metrics.width / 2 - 4, s.y + s.h / 2 - 10, metrics.width + 8, 20);
          ctx.fillStyle = '#6366f1';
          ctx.fillText(dimText, s.x + s.w / 2 - metrics.width / 2, s.y + s.h / 2 + 4);
        } else if (s.type === 'circle') {
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
          if (fill && fill !== 'transparent') {
            ctx.globalAlpha = 0.3;
            ctx.fill();
            ctx.globalAlpha = 0.7;
          }
          ctx.stroke();
          
          // Show radius line
          ctx.globalAlpha = 1;
          ctx.strokeStyle = '#6366f1';
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(s.x, s.y);
          const angle = Math.atan2(mousePos.current.y - s.y, mousePos.current.x - s.x);
          ctx.lineTo(s.x + s.r * Math.cos(angle), s.y + s.r * Math.sin(angle));
          ctx.stroke();
          
          ctx.fillStyle = '#6366f1';
          ctx.font = 'bold 12px sans-serif';
          const rText = `r: ${Math.round(s.r)}`;
          const metrics = ctx.measureText(rText);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
          ctx.fillRect(s.x + s.r / 2 * Math.cos(angle) - metrics.width / 2 - 4, s.y + s.r / 2 * Math.sin(angle) - 10, metrics.width + 8, 20);
          ctx.fillStyle = '#6366f1';
          ctx.fillText(rText, s.x + s.r / 2 * Math.cos(angle) - metrics.width / 2, s.y + s.r / 2 * Math.sin(angle) + 4);
        } else if (s.type === 'line') {
          ctx.beginPath();
          ctx.moveTo(s.x1, s.y1);
          ctx.lineTo(s.x2, s.y2);
          ctx.stroke();
          
          // Show length
          ctx.globalAlpha = 1;
          ctx.fillStyle = '#6366f1';
          ctx.font = 'bold 12px sans-serif';
          const length = Math.round(Math.sqrt(Math.pow(s.x2 - s.x1, 2) + Math.pow(s.y2 - s.y1, 2)));
          const lText = `${length}px`;
          const metrics = ctx.measureText(lText);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
          ctx.fillRect((s.x1 + s.x2) / 2 - metrics.width / 2 - 4, (s.y1 + s.y2) / 2 - 10, metrics.width + 8, 20);
          ctx.fillStyle = '#6366f1';
          ctx.fillText(lText, (s.x1 + s.x2) / 2 - metrics.width / 2, (s.y1 + s.y2) / 2 + 4);
        } else if (s.type === 'arrow') {
          const headlen = 15;
          const angle = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
          ctx.beginPath();
          ctx.moveTo(s.x1, s.y1);
          ctx.lineTo(s.x2, s.y2);
          ctx.lineTo(s.x2 - headlen * Math.cos(angle - Math.PI / 6), s.y2 - headlen * Math.sin(angle - Math.PI / 6));
          ctx.moveTo(s.x2, s.y2);
          ctx.lineTo(s.x2 - headlen * Math.cos(angle + Math.PI / 6), s.y2 - headlen * Math.sin(angle + Math.PI / 6));
          ctx.stroke();
          
          // Show length
          ctx.globalAlpha = 1;
          ctx.fillStyle = '#6366f1';
          ctx.font = 'bold 12px sans-serif';
          const length = Math.round(Math.sqrt(Math.pow(s.x2 - s.x1, 2) + Math.pow(s.y2 - s.y1, 2)));
          const lText = `${length}px`;
          const metrics = ctx.measureText(lText);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
          ctx.fillRect((s.x1 + s.x2) / 2 - metrics.width / 2 - 4, (s.y1 + s.y2) / 2 - 10, metrics.width + 8, 20);
          ctx.fillStyle = '#6366f1';
          ctx.fillText(lText, (s.x1 + s.x2) / 2 - metrics.width / 2, (s.y1 + s.y2) / 2 + 4);
        }
        ctx.restore();
      }
      
      // Draw cursor preview for pen/eraser when not drawing
      if (!drawing.current && !currentShape.current) {
        const pos = mousePos.current;
        if (tool === 'pen') {
          ctx.save();
          ctx.strokeStyle = color;
          ctx.fillStyle = color;
          ctx.globalAlpha = 0.5;
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, width / 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        } else if (tool === 'eraser') {
          ctx.save();
          ctx.strokeStyle = '#ef4444';
          ctx.lineWidth = 2;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, width, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        } else if (tool === 'rect') {
          ctx.save();
          ctx.strokeStyle = color;
          ctx.lineWidth = 1;
          ctx.globalAlpha = 0.4;
          ctx.strokeRect(pos.x - 10, pos.y - 10, 20, 20);
          ctx.restore();
        } else if (tool === 'circle') {
          ctx.save();
          ctx.strokeStyle = color;
          ctx.lineWidth = 1;
          ctx.globalAlpha = 0.4;
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, 10, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        } else if (tool === 'line' || tool === 'arrow') {
          ctx.save();
          ctx.strokeStyle = color;
          ctx.lineWidth = 1;
          ctx.globalAlpha = 0.4;
          ctx.beginPath();
          ctx.moveTo(pos.x - 10, pos.y);
          ctx.lineTo(pos.x + 10, pos.y);
          ctx.stroke();
          ctx.restore();
        }
      }
      
      requestAnimationFrame(loop);
    };
    const id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [textInput, tool, color, width, style, fill]);

  // Canvas resize
  useEffect(() => {
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    const resize = () => {
      const data = canvas.toDataURL();
      canvas.width = Math.max(window.innerWidth * 0.7, 800);
      canvas.height = Math.max(window.innerHeight * 0.75, 600);
      overlay.width = canvas.width;
      overlay.height = canvas.height;
      
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

  const emitCursor = (x, y) => {
    if (!socketRef.current || !socketRef.current.connected) return;
    const now = Date.now();
    if (now - lastCursorEmit.current < 60) return;
    lastCursorEmit.current = now;
    socketRef.current.emit('cursor-move', { roomId, x, y });
  };

  const getPos = e => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handlePointerDown = e => {
    if (textInput.show) return; // Don't draw while text input is active
    
    const pos = getPos(e);
    if (tool === 'pen' || tool === 'eraser') {
      drawing.current = true;
      currentPath.current = [{ x: pos.x, y: pos.y }];
    } else if (tool === 'rect') {
      currentShape.current = { 
        type: 'rect', x: pos.x, y: pos.y, w: 0, h: 0, 
        color, width, style, fill, userColor: assignedColor.current 
      };
    } else if (tool === 'circle') {
      currentShape.current = { 
        type: 'circle', x: pos.x, y: pos.y, r: 0, 
        color, width, style, fill, userColor: assignedColor.current 
      };
    } else if (tool === 'line') {
      currentShape.current = { 
        type: 'line', x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y, 
        color, width, style, userColor: assignedColor.current 
      };
    } else if (tool === 'arrow') {
      currentShape.current = { 
        type: 'arrow', x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y, 
        color, width, style, userColor: assignedColor.current 
      };
    } else if (tool === 'text') {
      // Show text input at cursor position
      setTextInput({
        show: true,
        x: pos.x,
        y: pos.y,
        value: '',
        tempShape: null
      });
      setTimeout(() => {
        if (textInputRef.current) {
          textInputRef.current.focus();
        }
      }, 10);
    }
  };

  const handlePointerMove = e => {
    const pos = getPos(e);
    mousePos.current = pos; // Store for overlay rendering
    emitCursor(pos.x, pos.y);
    
    if (tool === 'pen') {
      if (!drawing.current) return;
      const p = { x: pos.x, y: pos.y };
      currentPath.current.push(p);
      const ctx = canvasRef.current.getContext('2d');
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      if (style === 'dashed') ctx.setLineDash([10, 6]);
      else if (style === 'dotted') ctx.setLineDash([2, 6]);
      ctx.beginPath();
      const last = currentPath.current;
      if (last.length >= 2) {
        const a = last[last.length - 2];
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
      ctx.restore();
    } else if (tool === 'eraser') {
      if (!drawing.current) return;
      const p = { x: pos.x, y: pos.y };
      currentPath.current.push(p);
      const ctx = canvasRef.current.getContext('2d');
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = width * 2;
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
      // Update current shape dimensions
      if (currentShape.current) {
        const s = currentShape.current;
        if (s.type === 'rect') {
          s.w = pos.x - s.x;
          s.h = pos.y - s.y;
        } else if (s.type === 'circle') {
          const dx = pos.x - s.x;
          const dy = pos.y - s.y;
          s.r = Math.sqrt(dx * dx + dy * dy);
        } else if (s.type === 'line' || s.type === 'arrow') {
          s.x2 = pos.x;
          s.y2 = pos.y;
        }
      }
    }
  };

  const handlePointerUp = e => {
    if (tool === 'pen' || tool === 'eraser') {
      if (!drawing.current) return;
      drawing.current = false;
      const stroke = { 
        path: currentPath.current.slice(), 
        color: tool === 'eraser' ? '#ffffff' : color, 
        width: tool === 'eraser' ? width * 2 : width, 
        style, 
        userColor: assignedColor.current 
      };
      if (socketRef.current && socketRef.current.connected) {
        socketRef.current.emit('draw-stroke', { roomId, stroke });
      }
      currentPath.current = [];
    } else {
      if (!currentShape.current) return;
      const s = currentShape.current;
      const overlay = overlayRef.current;
      const octx = overlay.getContext('2d');
      octx.clearRect(0, 0, overlay.width, overlay.height);
      const ctx = canvasRef.current.getContext('2d');
      drawShapeOnCtx(ctx, s);
      if (socketRef.current && socketRef.current.connected) {
        socketRef.current.emit('create-shape', { roomId, shape: s });
      }
      currentShape.current = null;
    }
  };

  const handleTextInputChange = (e) => {
    const value = e.target.value;
    setTextInput(prev => {
      const tempShape = {
        type: 'text',
        x: prev.x,
        y: prev.y,
        text: value,
        color,
        fontSize,
        userColor: assignedColor.current
      };
      return { ...prev, value, tempShape };
    });
  };

  const handleTextSubmit = () => {
    if (!textInput.value.trim()) {
      setTextInput({ show: false, x: 0, y: 0, value: '', tempShape: null });
      return;
    }
    
    const shape = {
      type: 'text',
      x: textInput.x,
      y: textInput.y,
      text: textInput.value,
      color,
      fontSize,
      userColor: assignedColor.current
    };
    
    const ctx = canvasRef.current.getContext('2d');
    drawShapeOnCtx(ctx, shape);
    
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit('create-shape', { roomId, shape });
    }
    
    setTextInput({ show: false, x: 0, y: 0, value: '', tempShape: null });
  };

  const handleTextKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleTextSubmit();
    } else if (e.key === 'Escape') {
      setTextInput({ show: false, x: 0, y: 0, value: '', tempShape: null });
    }
  };

  const clearBoard = () => {
    if (!confirm('Clear the entire board for everyone? This cannot be undone.')) return;
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit('clear-board', { roomId });
    }
  };

  const copyRoomCode = () => {
    navigator.clipboard.writeText(roomId);
    setShowCopied(true);
    setTimeout(() => setShowCopied(false), 2000);
  };

  const downloadCanvas = () => {
    const canvas = canvasRef.current;
    const link = document.createElement('a');
    link.download = `collaboard-${roomId}-${Date.now()}.png`;
    link.href = canvas.toDataURL();
    link.click();
  };

  // Get cursor class based on tool
  const getCursorClass = () => {
    if (tool === 'pen') return 'pen-cursor';
    if (tool === 'eraser') return 'eraser-cursor';
    if (tool === 'text') return 'text-cursor';
    return 'shape-cursor';
  };

  return (
    <div className="room-root">
      <div className="room-top">
        <div className="brand">Collaboard</div>
        <div className="room-info">
          <div>Room: <strong>{roomId}</strong></div>
          <div>Status: <strong style={{ color: status === 'Connected' ? '#10b981' : '#ef4444' }}>{status}</strong></div>
          <div>Participants: <strong>{participants.length}</strong></div>
        </div>
        <div className="room-actions">
          <button onClick={copyRoomCode}>
            {showCopied ? '✓ Copied!' : '📋 Copy Code'}
          </button>
          <button onClick={downloadCanvas}>💾 Download</button>
          <button onClick={clearBoard}>🗑️ Clear</button>
        </div>
      </div>

      <div className="room-body">
        <aside className="toolbar">
          <div className={'tool' + (tool === 'pen' ? ' selected' : '')} onClick={() => setTool('pen')}>
            ✏️ Pen
          </div>
          <div className={'tool' + (tool === 'rect' ? ' selected' : '')} onClick={() => setTool('rect')}>
            ▭ Rectangle
          </div>
          <div className={'tool' + (tool === 'circle' ? ' selected' : '')} onClick={() => setTool('circle')}>
            ◯ Circle
          </div>
          <div className={'tool' + (tool === 'line' ? ' selected' : '')} onClick={() => setTool('line')}>
            ╱ Line
          </div>
          <div className={'tool' + (tool === 'arrow' ? ' selected' : '')} onClick={() => setTool('arrow')}>
            → Arrow
          </div>
          <div className={'tool' + (tool === 'text' ? ' selected' : '')} onClick={() => setTool('text')}>
            T Text
          </div>
          <div className={'tool' + (tool === 'eraser' ? ' selected' : '')} onClick={() => setTool('eraser')}>
            🧽 Eraser
          </div>

          <hr />

          <div className="control">
            <label>Color</label>
            <input type="color" value={color} onChange={e => setColor(e.target.value)} />
          </div>

          <div className="control">
            <label>Width: {width}px</label>
            <input type="range" min="1" max="20" value={width} onChange={e => setWidth(Number(e.target.value))} />
          </div>

          {(tool === 'rect' || tool === 'circle') && (
            <div className="control">
              <label>Fill</label>
              <select value={fill} onChange={e => setFill(e.target.value)}>
                <option value="transparent">None</option>
                <option value={color}>Solid</option>
              </select>
            </div>
          )}

          {tool === 'text' && (
            <div className="control">
              <label>Font Size: {fontSize}px</label>
              <input type="range" min="12" max="72" value={fontSize} onChange={e => setFontSize(Number(e.target.value))} />
            </div>
          )}

          <div className="control">
            <label>Style</label>
            <select value={style} onChange={e => setStyle(e.target.value)}>
              <option value="solid">Solid</option>
              <option value="dashed">Dashed</option>
              <option value="dotted">Dotted</option>
            </select>
          </div>

          <hr />
          
          <div className="participants">
            <h4>Participants ({participants.length})</h4>
            <ul>
              {participants.map(p => (
                <li key={p.id}>
                  <span className="avatar" style={{ background: p.color }}></span>
                  {p.name}
                </li>
              ))}
            </ul>
          </div>
        </aside>

        <main className="canvas-wrap">
          <div
            className="canvas-area"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
          >
            <canvas ref={canvasRef} className={`board-canvas ${getCursorClass()}`} />
            <canvas ref={overlayRef} className="overlay-canvas" />
            
            {textInput.show && (
              <div
                className="text-input-box"
                style={{
                  position: 'absolute',
                  left: textInput.x + 'px',
                  top: textInput.y + 'px',
                  transform: 'translate(0, -100%)',
                  zIndex: 1000
                }}
              >
                <input
                  ref={textInputRef}
                  type="text"
                  value={textInput.value}
                  onChange={handleTextInputChange}
                  onKeyDown={handleTextKeyDown}
                  onBlur={handleTextSubmit}
                  placeholder="Type text..."
                  style={{
                    fontSize: fontSize + 'px',
                    color: color,
                    border: '2px solid #6366f1',
                    borderRadius: '8px',
                    padding: '8px 12px',
                    minWidth: '200px',
                    outline: 'none',
                    backgroundColor: 'white',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
                  }}
                />
                <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '4px' }}>
                  Press Enter to submit, Esc to cancel
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
