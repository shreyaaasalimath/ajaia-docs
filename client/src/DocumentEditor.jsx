import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Placeholder from '@tiptap/extension-placeholder';
import TurndownService from 'turndown';
import { api, checkFile, ACCEPTED_FILES } from './api.js';
import Toolbar from './Toolbar.jsx';
import SharePanel from './SharePanel.jsx';

const SAVE_DELAY_MS = 800;

const STATUS_LABEL = {
  saved: 'All changes saved',
  unsaved: 'Unsaved changes…',
  saving: 'Saving…',
  error: 'Save failed. Retrying when you keep typing',
  conflict: 'Someone else changed this doc. Reload to continue',
  invalid: 'Title cannot be empty',
};

// Loads the document, then hands off to the editor once content is available
// (TipTap is initialised with the saved HTML rather than patched in later).
export default function DocumentEditor(props) {
  const { docId, notify } = props;
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .getDoc(docId)
      .then((r) => setDoc(r.document))
      .catch((e) => {
        setError(e.message);
        if (e.status !== 404) notify(e.message, 'error');
      });
  }, [docId, notify]);

  if (error) {
    return (
      <div className="home">
        <h2>Cannot open this document</h2>
        <p className="muted">{error}. It may have been deleted, or it has not been shared with you.</p>
        <a className="btn" href="#/">Back to documents</a>
      </div>
    );
  }
  if (!doc) return <div className="center muted">Loading document…</div>;
  return <LoadedEditor {...props} initialDoc={doc} />;
}

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

function LoadedEditor({ docId, initialDoc, onChanged, onDeleted, notify }) {
  const [doc, setDoc] = useState(initialDoc);
  const [title, setTitle] = useState(initialDoc.title);
  const [status, setStatus] = useState('saved');
  const [showShare, setShowShare] = useState(false);
  const canEdit = doc.role === 'owner' || doc.role === 'editor';
  const isOwner = doc.role === 'owner';

  // Refs so the debounced save always sees the latest values.
  const versionRef = useRef(initialDoc.version);
  const titleRef = useRef(initialDoc.title);
  const savedTitleRef = useRef(initialDoc.title);
  const savingRef = useRef(false);
  const dirtyRef = useRef(false);
  const blockedRef = useRef(false); // stop saving after a conflict
  const timerRef = useRef(null);
  const htmlRef = useRef(initialDoc.content); // latest HTML, readable even after the editor is destroyed
  const importInput = useRef(null);

  const save = useCallback(async () => {
    clearTimeout(timerRef.current);
    if (blockedRef.current) return;
    if (!titleRef.current.trim()) return setStatus('invalid');
    if (savingRef.current) {
      dirtyRef.current = true; // save again once the in-flight request finishes
      return;
    }
    savingRef.current = true;
    dirtyRef.current = false;
    setStatus('saving');
    const titleChanged = titleRef.current.trim() !== savedTitleRef.current;
    try {
      const { document } = await api.updateDoc(docId, {
        title: titleRef.current.trim(),
        content: htmlRef.current,
        version: versionRef.current,
      });
      versionRef.current = document.version;
      savedTitleRef.current = document.title;
      setDoc((d) => ({ ...d, title: document.title, updatedAt: document.updatedAt }));
      setStatus(dirtyRef.current ? 'unsaved' : 'saved');
      if (titleChanged) onChanged();
    } catch (e) {
      if (e.status === 409) {
        blockedRef.current = true;
        setStatus('conflict');
      } else {
        setStatus('error');
        notify(e.message, 'error');
      }
    } finally {
      savingRef.current = false;
      if (dirtyRef.current && !blockedRef.current) timerRef.current = setTimeout(save, SAVE_DELAY_MS);
    }
  }, [docId, notify, onChanged]);

  const scheduleSave = useCallback(() => {
    if (blockedRef.current) return;
    dirtyRef.current = true;
    setStatus('unsaved');
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(save, SAVE_DELAY_MS);
  }, [save]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Underline,
      Placeholder.configure({ placeholder: 'Start writing…' }),
    ],
    content: initialDoc.content,
    editable: canEdit,
    onUpdate: ({ editor: ed }) => {
      htmlRef.current = ed.getHTML();
      scheduleSave();
    },
  });

  // Warn before closing the tab with unsaved work; flush pending save on unmount.
  useEffect(() => {
    const onBeforeUnload = (e) => {
      if (dirtyRef.current || savingRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      if (dirtyRef.current && !blockedRef.current) save();
    };
  }, [save]);

  // Ctrl/Cmd+S saves immediately instead of opening the browser dialog.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (canEdit) save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save, canEdit]);

  async function insertFromFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !editor) return;
    const problem = checkFile(file);
    if (problem) return notify(problem, 'error');
    try {
      const { html } = await api.convertFile(file);
      editor.chain().focus().insertContent(html).run();
      notify(`Inserted content from "${file.name}"`);
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  async function remove() {
    if (!window.confirm(`Delete "${doc.title}"? This cannot be undone.`)) return;
    try {
      blockedRef.current = true;
      await api.deleteDoc(docId);
      notify('Document deleted');
      onDeleted();
    } catch (e) {
      blockedRef.current = false;
      notify(e.message, 'error');
    }
  }

  function exportAs(kind) {
    if (!editor) return;
    const name = (titleRef.current.trim() || 'document').replace(/[^\w\- ]+/g, '');
    if (kind === 'md') {
      const md = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-' }).turndown(editor.getHTML());
      download(`${name}.md`, md, 'text/markdown');
    } else {
      download(`${name}.html`, `<!doctype html><meta charset="utf-8"><title>${name}</title>${editor.getHTML()}`, 'text/html');
    }
  }

  return (
    <div className="editor-page">
      <header className="editor-header">
        <div className="title-row">
          <input
            className="title-input"
            value={title}
            aria-label="Document title"
            maxLength={200}
            readOnly={!canEdit}
            onChange={(e) => {
              setTitle(e.target.value);
              titleRef.current = e.target.value;
              scheduleSave();
            }}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
          <div className="header-actions">
            {isOwner ? (
              <button className="btn primary" onClick={() => setShowShare((s) => !s)}>
                Share{doc.shares?.length ? ` · ${doc.shares.length}` : ''}
              </button>
            ) : (
              <span className={`badge ${doc.role}`}>
                {doc.role === 'viewer' ? 'View only' : 'Can edit'} · shared by {doc.owner.name}
              </span>
            )}
            <details className="menu">
              <summary className="btn">⋯</summary>
              <div className="menu-items">
                {canEdit && <button onClick={() => importInput.current.click()}>Insert from file (.txt, .md, .docx)</button>}
                <button onClick={() => exportAs('md')}>Download as Markdown</button>
                <button onClick={() => exportAs('html')}>Download as HTML</button>
                <button onClick={() => window.print()}>Print / Save as PDF</button>
                {isOwner && <button className="danger" onClick={remove}>Delete document</button>}
              </div>
            </details>
            <input ref={importInput} type="file" accept={ACCEPTED_FILES} hidden onChange={insertFromFile} />
          </div>
        </div>
        <div className="status-row">
          {canEdit ? (
            <span className={`status ${status}`}>
              {STATUS_LABEL[status]}
              {status === 'conflict' && (
                <button className="link" onClick={() => window.location.reload()}>Reload</button>
              )}
            </span>
          ) : (
            <span className="status">You have view-only access. Ask {doc.owner.name} for edit access.</span>
          )}
          <span className="muted small">Owner: {isOwner ? 'You' : `${doc.owner.name} (${doc.owner.email})`}</span>
        </div>
        {canEdit && <Toolbar editor={editor} />}
      </header>

      {showShare && isOwner && (
        <SharePanel
          docId={docId}
          shares={doc.shares || []}
          onChange={(shares) => setDoc((d) => ({ ...d, shares }))}
          onClose={() => setShowShare(false)}
          notify={notify}
        />
      )}

      <div className="page-scroll">
        <div className="page">
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}
