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
