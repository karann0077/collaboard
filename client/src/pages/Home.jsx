import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Home() {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const navigate = useNavigate();

  const createMeeting = async () => {
    if (!name.trim()) return alert('Please enter your name');
    try {
      const res = await fetch('http://127.0.0.1:4000/create-room');
      const data = await res.json();
      navigate(`/room/${data.roomId}`, { state: { name } });
    } catch (err) {
      console.error(err);
      alert('Failed to create room. Make sure the server is running.');
    }
  };

  const joinMeeting = () => {
    if (!name.trim()) return alert('Please enter your name');
    if (!code.trim()) return alert('Enter meeting code to join');
    navigate(`/room/${code.trim()}`, { state: { name } });
  };

  return (
    <div className="home-hero">
      <header className="topbar">
        <div className="logo">Collaboard</div>
        <div className="tag">Draw. Collaborate. Ship.</div>
      </header>

      <main className="home-grid">
        <section className="card create-card">
          <h2>Create meeting</h2>
          <p className="muted">Start a new live board. Share the code to invite collaborators instantly.</p>
          <label>Your name</label>
          <input placeholder="Your name" value={name} onChange={e=>setName(e.target.value)} />
          <div className="actions">
            <button className="primary" onClick={createMeeting}>Create Board</button>
            <button className="secondary" onClick={()=>{ setName('Guest'); createMeeting(); }}>Quick Guest</button>
          </div>
        </section>

        <section className="card join-card">
          <h2>Join meeting</h2>
          <p className="muted">Enter the meeting code shared by host to join.</p>
          <label>Your name</label>
          <input placeholder="Your name" value={name} onChange={e=>setName(e.target.value)} />
          <label style={{marginTop:12}}>Meeting code</label>
          <input placeholder="Meeting code" value={code} onChange={e=>setCode(e.target.value)} />
          <div className="actions">
            <button onClick={joinMeeting} className="primary">Join Board</button>
            <button onClick={()=>{ navigator.clipboard.writeText(location.href); alert('Page URL copied'); }} className="secondary">Copy this Page</button>
          </div>
        </section>
      </main>

      <footer className="home-foot">
        <div>Real-time • Low-latency • Collaborative</div>
      </footer>
    </div>
  );
}
