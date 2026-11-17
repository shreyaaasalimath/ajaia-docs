import { useState } from 'react';
import { api } from './api.js';
import { Avatar } from './usePresence.jsx';
import { IconDoc, IconUsers, IconHistory, IconFileIn } from './Icons.jsx';

const HIGHLIGHTS = [
  { icon: IconUsers, title: 'Share with your team', text: 'Give edit or view access and see who is in the doc right now.' },
  { icon: IconHistory, title: 'Never lose work', text: 'Autosave, conflict protection and full version history.' },
  { icon: IconFileIn, title: 'Bring your files', text: 'Turn .docx, .md and .txt files into editable documents.' },
];

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
      <section className="login-hero" aria-hidden="true">
        <div className="brand big light">
          <span className="logo"><IconDoc size={18} /></span> Ajaia Docs
        </div>
        <h1>Documents your team can work on together.</h1>
        <ul className="highlights">
          {HIGHLIGHTS.map(({ icon: Icon, title, text }) => (
            <li key={title}>
              <span className="hl-icon"><Icon size={18} /></span>
              <span>
                <strong>{title}</strong>
                <span>{text}</span>
              </span>
            </li>
          ))}
        </ul>
        <div className="hero-card">
          <div className="hero-card-top">
            <span className="hero-dot" /><span className="hero-dot" /><span className="hero-dot" />
            <span className="hero-avatars">
              <Avatar name="Alice Owner" email="alice@ajaia.test" size={22} />
              <Avatar name="Bob Teammate" email="bob@ajaia.test" size={22} ring />
            </span>
          </div>
          <div className="hero-line w70" /><div className="hero-line w90" /><div className="hero-line w50" />
        </div>
      </section>

      <section className="login-side">
        <form className="login-card" onSubmit={submit}>
          <h2>Sign in</h2>
          <p className="muted">Use a demo account to try editing and sharing.</p>
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </label>
          {error && <div className="error" role="alert">{error}</div>}
          <button className="btn primary block lg" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
          <div className="demo">
            <div className="small muted">
              Demo accounts · password <code>password123</code>
            </div>
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
                <Avatar name={d.name} email={d.email} size={30} />
                <span>
                  <strong>{d.name}</strong>
                  <span className="muted small"> {d.note}</span>
                </span>
              </button>
            ))}
          </div>
        </form>
      </section>
    </div>
  );
}
