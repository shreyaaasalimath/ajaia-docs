import { useCallback, useEffect, useRef, useState } from 'react';
import { api, checkFile, ACCEPTED_FILES } from './api.js';
import Login from './Login.jsx';
import DocumentEditor from './DocumentEditor.jsx';
import { Avatar } from './usePresence.jsx';
import { IconPlus, IconUpload, IconSearch, IconDoc, IconUsers, IconLogout, IconLock } from './Icons.jsx';

// Minimal hash router: "#/doc/<id>" opens a document, anything else is home.
function useHashRoute() {
  const read = () => {
    const m = window.location.hash.match(/^#\/doc\/([\w-]+)/);
    return m ? m[1] : null;
  };
  const [docId, setDocId] = useState(read);
  useEffect(() => {
    const onHash = () => setDocId(read());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const go = useCallback((id) => {
    window.location.hash = id ? `/doc/${id}` : '/';
  }, []);
  return [docId, go];
}

function timeAgo(iso) {
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = loading, null = signed out
  const [docs, setDocs] = useState({ owned: [], shared: [] });
  const [docId, go] = useHashRoute();
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef(null);
  const fileInput = useRef(null);

  const notify = useCallback((message, kind = 'info') => {
    setToast({ message, kind, at: Date.now() });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    api
      .me()
      .then((r) => setUser(r.user))
      .catch(() => setUser(null));
  }, []);

  const refreshDocs = useCallback(async () => {
    try {
      setDocs(await api.listDocs());
    } catch (e) {
      if (e.status === 401) setUser(null);
      else notify(e.message, 'error');
    }
  }, [notify]);

  useEffect(() => {
    if (user) refreshDocs();
  }, [user, refreshDocs]);

  async function newDoc() {
    setBusy(true);
    try {
      const { document } = await api.createDoc();
      await refreshDocs();
      go(document.id);
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function onImport(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const problem = checkFile(file);
    if (problem) return notify(problem, 'error');
    setBusy(true);
    try {
      const { document } = await api.importFile(file);
      await refreshDocs();
      go(document.id);
      notify(`Imported "${file.name}" as a new document`);
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await api.logout().catch(() => {});
    setToast(null);
    setUser(null);
    setDocs({ owned: [], shared: [] });
    go(null);
  }

  // "/" focuses search, like many productivity tools.
  useEffect(() => {
    const onKey = (e) => {
      const typing = ['INPUT', 'TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable;
      if (e.key === '/' && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (user === undefined) return <div className="center muted">Loading…</div>;
  if (!user) return <Login onLogin={setUser} />;

  const q = query.trim().toLowerCase();
  const match = (d) => !q || d.title.toLowerCase().includes(q) || d.owner?.name?.toLowerCase().includes(q);
  const owned = docs.owned.filter(match);
  const shared = docs.shared.filter(match);

  const DocLink = ({ d, shared }) => (
    <li>
      <a href={`#/doc/${d.id}`} className={d.id === docId ? 'doc-link active' : 'doc-link'}>
        <span className={`doc-icon ${shared ? 'shared' : ''}`}>{shared ? <IconUsers size={14} /> : <IconDoc size={14} />}</span>
        <span className="doc-text">
          <span className="doc-title">{d.title}</span>
          <span className="doc-meta">
            {shared ? `${d.owner.name} · ${d.role === 'viewer' ? 'can view' : 'can edit'}` : `Edited ${timeAgo(d.updatedAt)}`}
          </span>
        </span>
      </a>
    </li>
  );

  const recent = [...docs.owned.map((d) => ({ ...d, mine: true })), ...docs.shared]
    .sort((x, y) => new Date(y.updatedAt) - new Date(x.updatedAt))
    .slice(0, 6);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="logo"><IconDoc size={16} /></span> Ajaia Docs
        </div>
        <div className="sidebar-actions">
          <button className="btn primary" onClick={newDoc} disabled={busy}>
            <IconPlus /> New document
          </button>
          <button className="btn" onClick={() => fileInput.current.click()} disabled={busy} title="Supported: .txt, .md, .docx (max 2 MB)">
            <IconUpload /> Import file
          </button>
          <input ref={fileInput} type="file" accept={ACCEPTED_FILES} hidden onChange={onImport} />
          <p className="hint">Import supports .txt, .md and .docx (max 2 MB)</p>
        </div>

        <div className="search">
          <IconSearch size={14} />
          <input
            ref={searchRef}
            type="search"
            placeholder="Search documents"
            aria-label="Search documents"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
          />
          <kbd>/</kbd>
        </div>

        <nav>
          <h4>My documents <span className="count">{owned.length}</span></h4>
          {owned.length ? (
            <ul>{owned.map((d) => <DocLink key={d.id} d={d} />)}</ul>
          ) : (
            <p className="empty">{q ? 'No matches.' : 'No documents yet.'}</p>
          )}
          <h4>Shared with me <span className="count">{shared.length}</span></h4>
          {shared.length ? (
            <ul>{shared.map((d) => <DocLink key={d.id} d={d} shared />)}</ul>
          ) : (
            <p className="empty">{q ? 'No matches.' : 'Nothing shared with you yet.'}</p>
          )}
        </nav>

        <div className="user-box">
          <Avatar name={user.name} email={user.email} size={32} />
          <div className="user-meta">
            <strong>{user.name}</strong>
            <div className="muted small">{user.email}</div>
          </div>
          <button className="btn small signout" onClick={logout} aria-label="Sign out">
            <IconLogout size={14} /> Sign out
          </button>
        </div>
      </aside>

      <main className="main">
        {docId ? (
          <DocumentEditor
            key={docId}
            docId={docId}
            currentUser={user}
            onChanged={refreshDocs}
            onCopied={async (id) => {
              await refreshDocs();
              go(id);
            }}
            onDeleted={() => {
              refreshDocs();
              go(null);
            }}
            notify={notify}
          />
        ) : (
          <div className="home">
            <div className="home-hero">
              <h1>Good to see you, {user.name.split(' ')[0]}</h1>
              <p className="muted">Write, import and share documents with your team.</p>
              <div className="home-actions">
                <button className="btn primary" onClick={newDoc} disabled={busy}>
                  <IconPlus /> New document
                </button>
                <button className="btn" onClick={() => fileInput.current.click()} disabled={busy}>
                  <IconUpload /> Import .txt, .md or .docx
                </button>
              </div>
            </div>
            {recent.length > 0 && (
              <section className="recent">
                <h2>Recent documents</h2>
                <div className="card-grid">
                  {recent.map((d) => (
                    <a key={d.id} href={`#/doc/${d.id}`} className="doc-card">
                      <div className="doc-card-preview">
                        <span /><span /><span /><span />
                      </div>
                      <div className="doc-card-body">
                        <div className="doc-card-title">{d.title}</div>
                        <div className="doc-card-meta">
                          {d.mine ? (
                            <span className="tag">Owned by you</span>
                          ) : (
                            <span className={`tag ${d.role}`}>
                              {d.role === 'viewer' && <IconLock size={11} />} {d.owner.name.split(' ')[0]} · {d.role === 'viewer' ? 'view' : 'edit'}
                            </span>
                          )}
                          <span>{timeAgo(d.updatedAt)}</span>
                        </div>
                      </div>
                    </a>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </main>

      {toast && (
        <div className={`toast ${toast.kind}`} role="status">
          {toast.message}
        </div>
      )}
    </div>
  );
}
