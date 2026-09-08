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
