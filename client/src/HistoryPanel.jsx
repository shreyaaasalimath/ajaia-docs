import { useEffect, useState } from 'react';
import { api } from './api.js';

function formatWhen(iso) {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return sameDay ? `Today, ${time}` : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}

/**
 * Version history: list of snapshots, a read-only preview, and restore.
 * Restoring creates a new version, so it can itself be undone.
 */
export default function HistoryPanel({ docId, refreshKey, beforeRestore, onRestored, onClose, notify }) {
  const [versions, setVersions] = useState(null);
  const [selected, setSelected] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .versions(docId)
      .then((r) => setVersions(r.versions))
      .catch((e) => {
        setVersions([]);
        notify(e.message, 'error');
      });
  }, [docId, refreshKey, notify]);

  async function select(v) {
    setSelected(v.id);
    setPreview(null);
    try {
      setPreview((await api.version(docId, v.id)).version);
    } catch (e) {
      notify(e.message, 'error');
    }
  }

  async function restore() {
    if (!preview) return;
    if (!window.confirm('Restore this version? Your current content is kept in history, so you can switch back.')) return;
    setBusy(true);
    try {
      await beforeRestore();
      const { document } = await api.restoreVersion(docId, preview.id);
      onRestored(document);
      notify('Version restored');
      setSelected(null);
      setPreview(null);
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="side-panel history" aria-label="Version history">
      <div className="side-head">
        <h3>Version history</h3>
        <button className="btn small" onClick={onClose} aria-label="Close history">✕</button>
      </div>
      {!versions ? (
        <p className="muted small pad">Loading…</p>
      ) : !versions.length ? (
        <p className="muted small pad">No history yet. Versions appear as you edit.</p>
      ) : (
        <ol className="version-list">
          {versions.map((v) => (
            <li key={v.id}>
              <button className={`version ${selected === v.id ? 'active' : ''}`} onClick={() => select(v)}>
                <span className="version-when">
                  {formatWhen(v.savedAt)}
                  {v.current && <span className="pill">Current</span>}
                </span>
                <span className="version-meta">
                  {v.author}
                  {v.note ? ` · ${v.note}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
      {selected && (
        <div className="version-preview">
          <div className="preview-head">
            <strong>{preview ? preview.title : 'Loading…'}</strong>
            <button
              className="btn primary small"
              onClick={restore}
              disabled={!preview || busy || versions?.find((v) => v.id === selected)?.current}
            >
              {busy ? 'Restoring…' : 'Restore this version'}
            </button>
          </div>
          {/* Content is sanitized on the server before it is stored. */}
          {preview && <div className="preview-body ProseMirror" dangerouslySetInnerHTML={{ __html: preview.content }} />}
        </div>
      )}
    </aside>
  );
}
