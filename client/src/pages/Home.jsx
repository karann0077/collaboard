import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Home() {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const createMeeting = async () => {
    if (!name.trim()) {
      alert('Please enter your name');
      return;
    }
    
    setLoading(true);
    try {
      const res = await fetch('http://127.0.0.1:4000/create-room');
      const data = await res.json();
      navigate(`/room/${data.roomId}`, { state: { name: name.trim() } });
    } catch (err) {
      console.error(err);
      alert('Failed to create room. Make sure the server is running on port 4000.');
    } finally {
      setLoading(false);
    }
  };

  const joinMeeting = () => {
    if (!name.trim()) {
      alert('Please enter your name');
      return;
    }
    if (!code.trim()) {
      alert('Please enter a meeting code');
      return;
    }
    navigate(`/room/${code.trim()}`, { state: { name: name.trim() } });
  };

  const handleQuickGuest = async () => {
    setName('Guest');
    setLoading(true);
    try {
      const res = await fetch('http://127.0.0.1:4000/create-room');
      const data = await res.json();
      navigate(`/room/${data.roomId}`, { state: { name: 'Guest' } });
    } catch (err) {
      console.error(err);
      alert('Failed to create room. Make sure the server is running on port 4000.');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e, action) => {
    if (e.key === 'Enter') {
      action();
    }
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
            type="text"
            placeholder="Enter your name"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyPress={e => handleKeyPress(e, createMeeting)}
            disabled={loading}
          />
          <div className="actions">
            <button 
              className="primary" 
              onClick={createMeeting}
              disabled={loading}
            >
              {loading ? 'Creating...' : 'Create Board'}
            </button>
            <button 
              className="secondary" 
              onClick={handleQuickGuest}
              disabled={loading}
            >
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
            type="text"
            placeholder="Enter your name"
            value={name}
            onChange={e => setName(e.target.value)}
            disabled={loading}
          />
          <label style={{ marginTop: 12 }}>Meeting Code</label>
          <input
            type="text"
            placeholder="Enter 8-character code"
            value={code}
            onChange={e => setCode(e.target.value)}
            onKeyPress={e => handleKeyPress(e, joinMeeting)}
            disabled={loading}
            maxLength={8}
          />
          <div className="actions">
            <button 
              onClick={joinMeeting} 
              className="primary"
              disabled={loading}
            >
              Join Board
            </button>
            <button
              onClick={() => {
                navigator.clipboard.writeText(window.location.href);
                alert('✓ Page URL copied to clipboard!');
              }}
              className="secondary"
            >
              Copy Link
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
