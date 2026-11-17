import { useEffect, useState } from 'react';
import { api } from './api.js';

export default function SharePanel({ docId, shares, onChange, onClose, notify }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('editor');
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.users().then((r) => setUsers(r.users)).catch(() => {});
  }, []);

  async function add(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const r = await api.share(docId, email.trim(), role);
      onChange(r.shares);
      notify(`Shared with ${email.trim()} as ${role}`);
      setEmail('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(s, newRole) {
    try {
      onChange((await api.share(docId, s.email, newRole)).shares);
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  async function revoke(s) {
    try {
      onChange((await api.unshare(docId, s.user_id)).shares);
      notify(`Removed access for ${s.name}`);
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  const sharedIds = new Set(shares.map((s) => s.user_id));
  const suggestions = users.filter((u) => !sharedIds.has(u.id));

  return (
    <section className="share-panel" aria-label="Sharing">
      <div className="share-head">
        <h3>Share document</h3>
        <button className="btn small" onClick={onClose} aria-label="Close sharing">✕</button>
      </div>
      <form className="share-form" onSubmit={add}>
        <input
          type="email"
          placeholder="teammate@ajaia.test"
          list="share-users"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <datalist id="share-users">
          {suggestions.map((u) => (
            <option key={u.id} value={u.email}>{u.name}</option>
          ))}
        </datalist>
        <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Access level">
          <option value="editor">Can edit</option>
          <option value="viewer">Can view</option>
        </select>
        <button className="btn primary" disabled={busy}>Share</button>
      </form>
      {error && <div className="error">{error}</div>}
      <ul className="share-list">
        <li>
          <span><strong>You</strong> <span className="muted small">Owner</span></span>
        </li>
        {shares.map((s) => (
          <li key={s.user_id}>
            <span>
              <strong>{s.name}</strong> <span className="muted small">{s.email}</span>
            </span>
            <span className="share-actions">
              <select value={s.role} onChange={(e) => changeRole(s, e.target.value)} aria-label={`Access for ${s.name}`}>
                <option value="editor">Can edit</option>
                <option value="viewer">Can view</option>
              </select>
              <button className="btn small" onClick={() => revoke(s)}>Remove</button>
            </span>
          </li>
        ))}
      </ul>
      {!shares.length && <p className="muted small">Not shared with anyone yet. Try bob@ajaia.test or carol@ajaia.test.</p>}
    </section>
  );
}
