import { useCallback, useEffect, useRef, useState } from 'react';
import { api, checkFile, ACCEPTED_FILES } from './api.js';
import Login from './Login.jsx';
import DocumentEditor from './DocumentEditor.jsx';

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

  if (user === undefined) return <div className="center muted">Loading…</div>;
  if (!user) return <Login onLogin={setUser} />;

  const DocLink = ({ d, shared }) => (
    <li>
      <a href={`#/doc/${d.id}`} className={d.id === docId ? 'doc-link active' : 'doc-link'}>
        <span className="doc-title">{d.title}</span>
        <span className="doc-meta">
          {shared ? `${d.owner.name} · ${d.role === 'viewer' ? 'can view' : 'can edit'}` : timeAgo(d.updatedAt)}
        </span>
      </a>
    </li>
  );

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="logo">A</span> Ajaia Docs
        </div>
        <div className="sidebar-actions">
          <button className="btn primary" onClick={newDoc} disabled={busy}>
            + New document
          </button>
          <button className="btn" onClick={() => fileInput.current.click()} disabled={busy} title="Supported: .txt, .md, .docx (max 2 MB)">
            ⇪ Import file
          </button>
          <input ref={fileInput} type="file" accept={ACCEPTED_FILES} hidden onChange={onImport} />
          <p className="hint">Import supports .txt, .md and .docx (max 2 MB)</p>
        </div>

        <nav>
          <h4>My documents <span className="count">{docs.owned.length}</span></h4>
          {docs.owned.length ? (
            <ul>{docs.owned.map((d) => <DocLink key={d.id} d={d} />)}</ul>
          ) : (
            <p className="empty">No documents yet.</p>
          )}
          <h4>Shared with me <span className="count">{docs.shared.length}</span></h4>
          {docs.shared.length ? (
            <ul>{docs.shared.map((d) => <DocLink key={d.id} d={d} shared />)}</ul>
          ) : (
            <p className="empty">Nothing shared with you yet.</p>
          )}
        </nav>

        <div className="user-box">
          <div>
            <strong>{user.name}</strong>
            <div className="muted small">{user.email}</div>
          </div>
          <button className="btn small" onClick={logout}>
            Sign out
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
            onDeleted={() => {
              refreshDocs();
              go(null);
            }}
            notify={notify}
          />
        ) : (
          <div className="home">
            <h1>Hi {user.name.split(' ')[0]} 👋</h1>
            <p className="muted">Pick a document on the left, create a new one, or import a file to get started.</p>
            <div className="home-actions">
              <button className="btn primary" onClick={newDoc} disabled={busy}>
                + New document
              </button>
              <button className="btn" onClick={() => fileInput.current.click()} disabled={busy}>
                ⇪ Import .txt / .md / .docx
              </button>
            </div>
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
