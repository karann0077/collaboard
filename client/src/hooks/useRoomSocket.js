import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSocket, connectSocket, disconnectSocket } from '../collaboration/socket';

const SERVER = import.meta.env.VITE_SERVER_URL || 'http://localhost:4000';

export function useRoomSocket(roomId, name, engineRef) {
  const [status, setStatus] = useState('Connecting');
  const [role, setRole] = useState('viewer'); // Default to viewer until proven otherwise
  const navigate = useNavigate();
  const socketRef = useRef(null);

  useEffect(() => {
    let disposed = false;
    let socket;
    let heartbeatTimer;
    
    const connect = () => {
      if (disposed) return;
      socket = connectSocket();
      socketRef.current = socket;
      
      socket.on('connect', () => {
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
        setRole(userRole || 'viewer');
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

    fetch(`${SERVER}/api/session`, { credentials: 'include' })
      .catch(() => {})
      .finally(connect);

    return () => {
      disposed = true;
      clearInterval(heartbeatTimer);
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

  return { status, socketRef, role };
}
