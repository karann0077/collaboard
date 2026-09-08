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
