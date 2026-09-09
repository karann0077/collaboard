import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSocket, connectSocket, disconnectSocket } from '../collaboration/socket';

const SERVER = import.meta.env.VITE_SERVER_URL || 'http://localhost:4000';

/**
 * useRoomSocket — manages the Socket.IO lifecycle for a room.
 *
 * Fixes:
 *   Bug #5 — removed dead fetch('/api/session') that called a non-existent endpoint
 *   Bug #3 — uses engine.applySyncedEvents() for sync-response events instead of receive()
 *   Bug #4 — handles snapshot+delta mode from server
 *   Bug #6 — listens for remote-cursor and remote-cursor-removed events
 *
 * Returns:
 *   status       — 'Connecting' | 'Connected' | 'Disconnected'
 *   socketRef    — ref to the Socket.IO socket instance
 *   role         — 'owner' | 'editor' | 'viewer'
 *   remoteCursors — Map<actorId, { actorId, color, x, y }>
 */
export function useRoomSocket(roomId, name, engineRef) {
  const [status, setStatus] = useState('Connecting');
  const [role, setRole] = useState('editor');
  const [remoteCursors, setRemoteCursors] = useState(new Map());
  const navigate = useNavigate();
  const socketRef = useRef(null);

  useEffect(() => {
    let disposed = false;
    let socket;
    let heartbeatTimer;

    // Bug #5 fix: connect directly — no more dead /api/session fetch
    socket = connectSocket();
    socketRef.current = socket;

    socket.on('connect', () => {
      if (disposed) return;
      setStatus('Connected');
      socket.emit('join-room', { roomId, name: name || 'Guest' });

      heartbeatTimer = setInterval(() => {
        socket.emit('heartbeat');
      }, 15000);
    });

    socket.on('disconnect', () => {
      setStatus('Disconnected');
      clearInterval(heartbeatTimer);
    });

    socket.on('initial-state', ({ document: next, baseSeq, role: userRole }) => {
      setRole(userRole || 'editor');
      engineRef.current.install(next, baseSeq);
    });

    socket.on('event-committed', (event) => engineRef.current.receive(event));

    // Bug #3 + Bug #4 fix: properly handle all sync-response modes
    socket.on('sync-response', (res) => {
      if (res.mode === 'snapshot' && res.snapshot) {
        // Pure snapshot — install it, then check if we need more events
        engineRef.current.install(res.snapshot.document, res.snapshot.seq);
        if (res.currentSeq && res.snapshot.seq < res.currentSeq) {
          // Server didn't include delta; request remaining events
          socket.emit('sync-request', { lastSeq: res.snapshot.seq });
        }
      } else if (res.mode === 'snapshot+delta' && res.snapshot) {
        // Bug #4 fix: server sends snapshot AND subsequent events in one response
        engineRef.current.install(res.snapshot.document, res.snapshot.seq);
        if (res.events && res.events.length > 0) {
          engineRef.current.applySyncedEvents(res.events, res.currentSeq);
        }
      } else if (res.mode === 'events') {
        // Bug #3 fix: use applySyncedEvents, NOT receive() (which re-buffers events)
        if (res.events && res.events.length > 0) {
          engineRef.current.applySyncedEvents(res.events, res.currentSeq);
        }
      }
    });

    // Bug #6 fix: track remote cursors in state
    socket.on('remote-cursor', ({ actorId, color, x, y }) => {
      setRemoteCursors(prev => {
        const next = new Map(prev);
        next.set(actorId, { actorId, color, x, y });
        return next;
      });
    });

    // Clean up cursors when a user disconnects
    socket.on('remote-cursor-removed', ({ actorId }) => {
      setRemoteCursors(prev => {
        const next = new Map(prev);
        next.delete(actorId);
        return next;
      });
    });

    // Also clean up cursors when participant list updates (handles multi-tab edge cases)
    socket.on('participants', (people) => {
      const activeIds = new Set((people || []).map(p => p.id));
      setRemoteCursors(prev => {
        const next = new Map();
        for (const [id, cursor] of prev) {
          if (activeIds.has(id)) next.set(id, cursor);
        }
        return next;
      });
    });

    socket.on('room-not-found', () => {
      alert('Room not found');
      navigate('/');
    });

    socket.on('error-message', (message) => console.warn('[Socket error]', message));

    return () => {
      disposed = true;
      clearInterval(heartbeatTimer);
      if (socket) {
        socket.off('connect');
        socket.off('disconnect');
        socket.off('initial-state');
        socket.off('event-committed');
        socket.off('sync-response');
        socket.off('remote-cursor');
        socket.off('remote-cursor-removed');
        socket.off('participants');
        socket.off('room-not-found');
        socket.off('error-message');
      }
      disconnectSocket();
    };
  }, [roomId, name, navigate, engineRef]);

  return { status, socketRef, role, remoteCursors };
}
