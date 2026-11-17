import { useState } from 'react';
import { api, uploadRule } from './api.js';
import { Avatar } from './usePresence.jsx';
import { IconDoc, IconUsers, IconHistory, IconFileIn } from './Icons.jsx';

const HIGHLIGHTS = [
  { icon: IconUsers, title: 'Share with your team', text: 'Give edit or view access and see who is in the doc right now.' },
  { icon: IconHistory, title: 'Never lose work', text: 'Autosave, conflict protection and full version history.' },
  { icon: IconFileIn, title: 'Bring your files', text: () => `Turn ${uploadRule()} files into editable documents.` },
];

export default function Login({ onLogin, notice, config }) {
  const demo = config?.demoAccounts || [];
  const canSignup = Boolean(config?.allowSignup);
  const minLength = config?.minPasswordLength || 8;
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup'
  const [name, setName] = useState('');
  const [email, setEmail] = useState(demo[0]?.email || '');
  const [password, setPassword] = useState(demo[0]?.password || '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const signup = mode === 'signup';

  function switchMode(next) {
    setMode(next);
    setError('');
    if (next === 'signup') {
      setEmail('');
      setPassword('');
    }
  }

  async function submit(e) {
    e?.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { user } = signup ? await api.signup(name, email, password) : await api.login(email, password);
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
                <span>{typeof text === 'function' ? text() : text}</span>
              </span>
            </li>
          ))}
        </ul>
        <div className="hero-card">
          <div className="hero-card-top">
            <span className="hero-dot" /><span className="hero-dot" /><span className="hero-dot" />
            <span className="hero-avatars">
              <Avatar name="Maya Chen" email="maya" size={22} />
              <Avatar name="Leo Park" email="leo" size={22} ring />
            </span>
          </div>
          <div className="hero-line w70" /><div className="hero-line w90" /><div className="hero-line w50" />
        </div>
      </section>

      <section className="login-side">
        <form className="login-card" onSubmit={submit}>
          <h2>{signup ? 'Create your account' : 'Sign in'}</h2>
          <p className="muted">
            {signup
              ? 'Start writing and sharing in under a minute.'
              : demo.length
                ? 'Use a demo account below, or your own account.'
                : 'Welcome back.'}
          </p>
          {signup && (
            <label>
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} required />
            </label>
          )}
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete={signup ? 'email' : 'username'} required />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={signup ? 'new-password' : 'current-password'}
              minLength={signup ? minLength : undefined}
              required
            />
            {signup && <span className="field-hint">At least {minLength} characters</span>}
          </label>
          {notice && !error && <div className="notice" role="status">{notice}</div>}
          {error && <div className="error" role="alert">{error}</div>}
          <button className="btn primary block lg" disabled={loading}>
            {loading ? (signup ? 'Creating account…' : 'Signing in…') : signup ? 'Create account' : 'Sign in'}
          </button>
          {canSignup && (
            <p className="switch-mode">
              {signup ? 'Already have an account?' : 'New here?'}{' '}
              <button type="button" className="link" onClick={() => switchMode(signup ? 'signin' : 'signup')}>
                {signup ? 'Sign in' : 'Create an account'}
              </button>
            </p>
          )}
          {!signup && demo.length > 0 && (
            <div className="demo">
              <div className="small muted">Demo accounts</div>
              {demo.map((d) => (
                <button
                  type="button"
                  key={d.email}
                  className={`demo-user ${email === d.email ? 'selected' : ''}`}
                  onClick={() => {
                    setEmail(d.email);
                    setPassword(d.password);
                  }}
                >
                  <Avatar name={d.name} email={d.email} size={30} />
                  <span>
                    <strong>{d.name.split(' ')[0]}</strong>
                    <span className="muted small"> {d.hint}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </form>
      </section>
    </div>
  );
}
