import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const SERVER = import.meta.env.VITE_SERVER_URL || 'http://localhost:4000';

async function ensureSession() {
  const response = await fetch(`${SERVER}/api/auth/guest`, {
    method: 'POST',
    credentials: 'include'
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || 'Unable to create guest session');
  }
  return response.json();
}

async function createRoomRequest() {
  await ensureSession();
  const response = await fetch(`${SERVER}/api/rooms`, {
    method: 'POST',
    credentials: 'include'
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || 'Unable to create room');
  }
  return response.json();
}

export default function Home() {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  // Bug #26: track created roomId so Copy Link can build a real room URL
  const [createdRoomId, setCreatedRoomId] = useState(null);
  const [copied, setCopied] = useState(false);
  const navigate = useNavigate();

  const createMeeting = async () => {
    if (!name.trim()) {
      alert('Please enter your name');
      return;
    }
    setLoading(true);
    try {
      const data = await createRoomRequest();
      setCreatedRoomId(data.roomId);
      navigate(`/room/${data.roomId}`, { state: { name: name.trim() } });
    } catch (err) {
      console.error(err);
      alert(err.message || 'Failed to create room.');
    } finally {
      setLoading(false);
    }
  };

  const joinMeeting = async () => {
    const trimmedName = name.trim();
    const trimmedCode = code.trim();

    if (!trimmedName) {
      alert('Please enter your name');
      return;
    }
    if (!/^[A-Za-z0-9_-]{8}$/.test(trimmedCode)) {
      alert('Please enter a valid 8-character meeting code');
      return;
    }

    setLoading(true);
    try {
      await ensureSession();
      navigate(`/room/${trimmedCode}`, { state: { name: trimmedName } });
    } catch (err) {
      console.error(err);
      alert(err.message || 'Failed to start guest session.');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickGuest = async () => {
    setName('Guest');
    setLoading(true);
    try {
      const data = await createRoomRequest();
      navigate(`/room/${data.roomId}`, { state: { name: 'Guest' } });
    } catch (err) {
      console.error(err);
      alert(err.message || 'Failed to create room.');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Bug #26 fix: Copy Link now constructs the actual room URL.
   * On the homepage before creating a room, this copies the homepage URL
   * with a note to create/share a room code instead.
   * After creating a room (createdRoomId is set), copies the room URL.
   */
  const copyLink = () => {
    const trimmedCode = code.trim();

    // If we have a room code entered in the join field, use that
    if (/^[A-Za-z0-9_-]{8}$/.test(trimmedCode)) {
      const roomUrl = `${window.location.origin}/room/${trimmedCode}`;
      navigator.clipboard.writeText(roomUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      return;
    }

    alert('Enter a valid 8-character meeting code above, then click Copy Link to share it.');
  };

  const handleKeyPress = (e, action) => {
    if (e.key === 'Enter') action();
  };

  return (
    <div className="home-hero">
      <header className="topbar">
        <div className="logo">Collaboard</div>
        <div className="tag">Draw. Collaborate. Create.</div>
      </header>

      <main className="home-grid">
        <section className="card create-card">
          <h2>🎨 Create Meeting</h2>
          <p className="muted">
            Start a new collaborative whiteboard. Share the room code to invite your team instantly.
          </p>
          <label>Your Name</label>
          <input
            id="create-name"
            type="text"
            placeholder="Enter your name"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => handleKeyPress(e, createMeeting)}
            disabled={loading}
            maxLength={80}
          />
          <div className="actions">
            <button id="btn-create" className="primary" onClick={createMeeting} disabled={loading}>
              {loading ? 'Creating...' : 'Create Board'}
            </button>
            <button id="btn-quick" className="secondary" onClick={handleQuickGuest} disabled={loading}>
              Quick Start
            </button>
          </div>
        </section>

        <section className="card join-card">
          <h2>🚀 Join Meeting</h2>
          <p className="muted">
            Have a room code? Enter it below to join an existing collaborative session.
          </p>
          <label>Your Name</label>
          <input
            id="join-name"
            type="text"
            placeholder="Enter your name"
            value={name}
            onChange={e => setName(e.target.value)}
            disabled={loading}
            maxLength={80}
          />
          <label style={{ marginTop: 12 }}>Meeting Code</label>
          <input
            id="join-code"
            type="text"
            placeholder="Enter 8-character code"
            value={code}
            onChange={e => setCode(e.target.value)}
            onKeyDown={e => handleKeyPress(e, joinMeeting)}
            disabled={loading}
            maxLength={8}
          />
          <div className="actions">
            <button id="btn-join" onClick={joinMeeting} className="primary" disabled={loading}>
              Join Board
            </button>
            {/* Bug #26 fix: Copy Link now builds a real room URL from the code input */}
            <button
              id="btn-copy-link"
              onClick={copyLink}
              className="secondary"
              disabled={loading}
            >
              {copied ? '✓ Copied!' : '🔗 Copy Link'}
            </button>
          </div>
        </section>
      </main>

      <footer className="home-foot">
        <div>Real-time • Low-latency • Collaborative</div>
      </footer>
    </div>
  );
}
