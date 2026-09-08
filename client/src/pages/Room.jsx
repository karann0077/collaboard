import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { createEmptyDocument } from '../../../packages/shared/src/index.ts';
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
