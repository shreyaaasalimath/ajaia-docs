import { useState } from 'react';
import { api } from './api.js';

const DEMO = [
  { email: 'alice@ajaia.test', name: 'Alice', note: 'owns the welcome doc' },
  { email: 'bob@ajaia.test', name: 'Bob', note: 'has the welcome doc shared' },
  { email: 'carol@ajaia.test', name: 'Carol', note: 'no access yet' },
];

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('alice@ajaia.test');
  const [password, setPassword] = useState('password123');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e?.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { user } = await api.login(email, password);
      onLogin(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="brand big">
          <span className="logo">A</span> Ajaia Docs
        </div>
        <p className="muted">Sign in with one of the demo accounts to try editing and sharing.</p>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        {error && <div className="error">{error}</div>}
        <button className="btn primary block" disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
        <div className="demo">
          <div className="small muted">Demo accounts (password: <code>password123</code>)</div>
          {DEMO.map((d) => (
            <button
              type="button"
              key={d.email}
              className={`demo-user ${email === d.email ? 'selected' : ''}`}
              onClick={() => {
                setEmail(d.email);
                setPassword('password123');
              }}
            >
              <strong>{d.name}</strong> <span className="muted small">{d.email} · {d.note}</span>
            </button>
          ))}
        </div>
      </form>
    </div>
  );
}
