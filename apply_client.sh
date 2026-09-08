#!/bin/bash
set -e
cd /Users/DELL/Desktop/collab_board/client/src

mkdir -p hooks components canvas

# 1. client/src/collaboration/socket.js
cat << 'EJS' > collaboration/socket.js
import { io } from 'socket.io-client';

const SERVER = import.meta.env.VITE_SERVER_URL || 'http://localhost:4000';
let socketInstance = null;

export function getSocket() {
  if (!socketInstance) {
    socketInstance = io(SERVER, { withCredentials: true, autoConnect: false });
  }
  return socketInstance;
}

export function connectSocket() {
  const socket = getSocket();
  if (!socket.connected) {
    socket.connect();
  }
  return socket;
}

export function disconnectSocket() {
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
  }
}
EJS

# 2. hooks/useRoomSocket.js
cat << 'EJS' > hooks/useRoomSocket.js
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSocket, connectSocket, disconnectSocket } from '../collaboration/socket';

const SERVER = import.meta.env.VITE_SERVER_URL || 'http://localhost:4000';

export function useRoomSocket(roomId, name, engineRef) {
  const [status, setStatus] = useState('Connecting');
  const navigate = useNavigate();
  const socketRef = useRef(null);

  useEffect(() => {
    let disposed = false;
    let socket;
    
    const connect = () => {
      if (disposed) return;
      socket = connectSocket();
      socketRef.current = socket;
      
      socket.on('connect', () => {
        setStatus('Connected');
        socket.emit('join-room', { roomId, name: name || 'Guest' });
      });
      
      socket.on('disconnect', () => setStatus('Disconnected'));
      
      socket.on('initial-state', ({ document: next, baseSeq, participants: people }) => {
        engineRef.current.install(next, baseSeq);
      });
      
      socket.on('event-committed', (event) => engineRef.current.receive(event));
      
      socket.on('sync-response', (res) => {
        if (res.mode === 'snapshot' && res.snapshot) {
          engineRef.current.install(res.snapshot.document, res.snapshot.seq);
        } else if (res.mode === 'events') {
          res.events.forEach(e => engineRef.current.receive(e));
        }
      });
      
      socket.on('room-not-found', () => {
        alert('Room not found');
        navigate('/');
      });
      
      socket.on('error-message', (message) => console.warn(message));
    };

    // Pre-flight health check to get session cookie, then connect socket
    fetch(`${SERVER}/health`, { credentials: 'include' })
      .catch(() => {})
      .finally(connect);

    return () => {
      disposed = true;
      if (socket) {
        socket.off('connect');
        socket.off('disconnect');
        socket.off('initial-state');
        socket.off('event-committed');
        socket.off('sync-response');
        socket.off('room-not-found');
        socket.off('error-message');
      }
      disconnectSocket();
    };
  }, [roomId, name, navigate, engineRef]);

  return { status, socketRef };
}
EJS

# 3. hooks/usePresence.js
cat << 'EJS' > hooks/usePresence.js
import { useEffect, useState } from 'react';
import { getSocket } from '../collaboration/socket';

export function usePresence() {
  const [participants, setParticipants] = useState([]);
  
  useEffect(() => {
    const socket = getSocket();
    
    const handleInitial = ({ participants: people }) => setParticipants(people || []);
    const handleUpdate = (people) => setParticipants(people || []);
    
    socket.on('initial-state', handleInitial);
    socket.on('participants', handleUpdate);
    
    return () => {
      socket.off('initial-state', handleInitial);
      socket.off('participants', handleUpdate);
    };
  }, []);

  return participants;
}
EJS

# 4. components/Toolbar.jsx
cat << 'EJS' > components/Toolbar.jsx
import React from 'react';

const TOOLS = [
  ['pen', '✏️ Pen'],
  ['rect', '▭ Rectangle'],
  ['circle', '◯ Circle'],
  ['line', '╱ Line'],
  ['arrow', '→ Arrow'],
  ['text', 'T Text'],
  ['eraser', '🧽 Eraser']
];

export function Toolbar({ tool, setTool, color, setColor, width, setWidth, style, setStyle }) {
  return (
    <aside className="toolbar">
      {TOOLS.map(([id, label]) => (
        <div key={id} className={'tool' + (tool === id ? ' selected' : '')} onClick={() => setTool(id)}>
          {label}
        </div>
      ))}
      <hr />
      <div className="control">
        <label>Color</label>
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
      </div>
      <div className="control">
        <label>Width: {width}px</label>
        <input type="range" min="1" max="20" value={width} onChange={(e) => setWidth(Number(e.target.value))} />
      </div>
      <div className="control">
        <label>Style</label>
        <select value={style} onChange={(e) => setStyle(e.target.value)}>
          <option value="solid">Solid</option>
          <option value="dashed">Dashed</option>
          <option value="dotted">Dotted</option>
        </select>
      </div>
    </aside>
  );
}
EJS

# 5. components/Participants.jsx
cat << 'EJS' > components/Participants.jsx
import React from 'react';
import { usePresence } from '../hooks/usePresence';

export function Participants() {
  const participants = usePresence();
  
  return (
    <div className="participants">
      <h4>Participants ({participants.length})</h4>
      <ul>
        {participants.map((p) => (
          <li key={p.id}>
            <span className="avatar" style={{ background: p.color }} />
            {p.name}
          </li>
        ))}
      </ul>
    </div>
  );
}
EJS

# 6. Refactor Room.jsx
cat << 'EJS' > pages/Room.jsx
import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { createEmptyDocument } from '@collaboard/shared';
import { createSyncEngine } from '../collaboration/syncEngine';
import { sendCommand } from '../collaboration/commandClient';
import { drawObject, renderDocument } from '../canvas/renderer';
import { useRoomSocket } from '../hooks/useRoomSocket';
import { Toolbar } from '../components/Toolbar';
import { Participants } from '../components/Participants';

const makeId = (prefix) => `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`;

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

  const { status, socketRef } = useRoomSocket(roomId, name, engineRef);

  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState('#111827');
  const [width, setWidth] = useState(3);
  const [style, setStyle] = useState('solid');
  const [textInput, setTextInput] = useState(null);
  const activeRef = useRef(null);

  const render = () => {
    if (canvasRef.current) renderDocument(canvasRef.current, engineRef.current?.state().document || document);
  };
  
  useEffect(() => { renderDocument(canvasRef.current, document); }, [document]);

  useEffect(() => {
    const resize = () => {
      const canvas = canvasRef.current;
      const overlay = overlayRef.current;
      if (!canvas) return;
      canvas.width = Math.max(800, window.innerWidth * 0.72);
      canvas.height = Math.max(600, window.innerHeight * 0.76);
      overlay.width = canvas.width;
      overlay.height = canvas.height;
      render();
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

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

  const point = (event) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const preview = (object) => {
    const canvas = overlayRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (object) drawObject(ctx, object);
  };

  const pointerDown = (event) => {
    const p = point(event);
    if (tool === 'text') {
      setTextInput({ ...p, value: '' });
      return;
    }
    activeRef.current = tool === 'pen' || tool === 'eraser' 
      ? { kind: 'stroke', path: [p] } 
      : { kind: 'shape', start: p, current: p };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const pointerMove = (event) => {
    const active = activeRef.current;
    const p = point(event);
    socketRef.current?.emit('cursor-move', p);
    if (!active) return;
    
    if (active.kind === 'stroke') active.path.push(p);
    else active.current = p;
    
    preview(toObject(active));
  };

  const toObject = (active) => {
    if (active.kind === 'stroke') {
      return {
        objectId: makeId('obj'),
        path: active.path,
        color: tool === 'eraser' ? '#fff' : color,
        width: tool === 'eraser' ? width * 2 : width,
        style
      };
    }
    const { start, current } = active;
    if (tool === 'rect') return { objectId: makeId('obj'), type: 'rect', x: start.x, y: start.y, w: current.x - start.x, h: current.y - start.y, color, width, style };
    if (tool === 'circle') return { objectId: makeId('obj'), type: 'circle', x: start.x, y: start.y, r: Math.hypot(current.x - start.x, current.y - start.y), color, width, style };
    return { objectId: makeId('obj'), type: tool, x1: start.x, y1: start.y, x2: current.x, y2: current.y, color, width, style };
  };

  const pointerUp = () => {
    const active = activeRef.current;
    if (!active) return;
    activeRef.current = null;
    preview();
    
    const object = toObject(active);
    if (active.kind === 'stroke' && object.path.length < 2) return;
    
    const type = active.kind === 'stroke' ? 'stroke.created' : 'shape.created';
    sendCommand(socketRef.current, type, object).catch((err) => console.warn(err.message));
  };

  const submitText = () => {
    if (!textInput?.value.trim()) return setTextInput(null);
    const object = { objectId: makeId('obj'), type: 'text', x: textInput.x, y: textInput.y, text: textInput.value, color, fontSize: 20 };
    setTextInput(null);
    sendCommand(socketRef.current, 'text.created', object).catch((err) => console.warn(err.message));
  };

  const clear = () => {
    if (confirm('Clear the entire board for everyone? You can undo your clear.')) {
      sendCommand(socketRef.current, 'board.cleared', {}).catch((err) => console.warn(err.message));
    }
  };

  return (
    <div className="room-root">
      <div className="room-top">
        <div className="brand">Collaboard</div>
        <div className="room-info">
          <div>Room: <strong>{roomId}</strong></div>
          <div>Status: <strong>{status}</strong></div>
          <div>Version: <strong>{document.version}</strong></div>
        </div>
        <div className="room-actions">
          <button onClick={() => navigator.clipboard.writeText(roomId)}>📋 Copy Code</button>
          <button onClick={clear}>🗑️ Clear</button>
        </div>
      </div>
      <div className="room-body">
        <div className="sidebar-container">
          <Toolbar tool={tool} setTool={setTool} color={color} setColor={setColor} width={width} setWidth={setWidth} style={style} setStyle={setStyle} />
          <Participants />
        </div>
        <main className="canvas-wrap">
          <div className="canvas-area" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerLeave={pointerUp}>
            <canvas ref={canvasRef} className="board-canvas" />
            <canvas ref={overlayRef} className="overlay-canvas" />
            {textInput && (
              <input autoFocus className="text-input-box" style={{ left: textInput.x, top: textInput.y }} value={textInput.value} onChange={(e) => setTextInput({ ...textInput, value: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') submitText(); if (e.key === 'Escape') setTextInput(null); }} onBlur={submitText} />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
EJS

echo "Client correctly refactored."
