import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Placeholder from '@tiptap/extension-placeholder';
import TurndownService from 'turndown';
import { api, checkFile, ACCEPTED_FILES } from './api.js';
import Toolbar from './Toolbar.jsx';
import SharePanel from './SharePanel.jsx';
import HistoryPanel from './HistoryPanel.jsx';
import OutlinePanel from './OutlinePanel.jsx';
import { usePresence, Avatar } from './usePresence.jsx';
import {
  IconOutline, IconHistory, IconShare, IconMore, IconCopy, IconTrash, IconDownload, IconPrint, IconFileIn, IconLock,
} from './Icons.jsx';

const SAVE_DELAY_MS = 800;
const MAX_RETRY_DELAY_MS = 30_000;
// Network failures, server errors and rate limits are worth retrying on their own;
// anything else (validation, too large) needs the user to change something first.
const isRetryable = (e) => e.status === 0 || e.status >= 500 || e.status === 429;

const STATUS_LABEL = {
  saved: 'All changes saved',
  unsaved: 'Unsaved changes…',
  saving: 'Saving…',
  error: 'Not saved. Edit again to retry',
  retrying: 'Connection problem. Your changes are kept here and will be retried…',
  conflict: 'Someone else saved a newer version',
  invalid: 'Title cannot be empty',
  readonly: 'Your access changed to view-only. Recent edits were not saved',
  gone: 'This document was deleted or your access was removed',
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

function countWords(text) {
  const m = text.trim().match(/\S+/g);
  return m ? m.length : 0;
}

function LoadedEditor({ docId, initialDoc, currentUser, onChanged, onCopied, onDeleted, notify }) {
  const [doc, setDoc] = useState(initialDoc);
  const [title, setTitle] = useState(initialDoc.title);
  const [status, setStatus] = useState('saved');
  const [showShare, setShowShare] = useState(false);
  const [panel, setPanel] = useState(null); // 'outline' | 'history' | null
  const [historyKey, setHistoryKey] = useState(0);
  const [remoteNotice, setRemoteNotice] = useState(null);
  const [words, setWords] = useState(0);
  const focusedRef = useRef(false);
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
  const retriesRef = useRef(0);
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;
  const importInput = useRef(null);
  const menuRef = useRef(null);

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
    let retryIn = 0;
    let succeeded = false;
    try {
      const { document } = await api.updateDoc(docId, {
        title: titleRef.current.trim(),
        content: htmlRef.current,
        version: versionRef.current,
      });
      succeeded = true;
      versionRef.current = document.version;
      savedTitleRef.current = document.title;
      setDoc((d) => ({ ...d, title: document.title, updatedAt: document.updatedAt, updatedBy: document.updatedBy }));
      setStatus(dirtyRef.current ? 'unsaved' : 'saved');
      if (retriesRef.current > 0) notify('Back online. All changes saved');
      retriesRef.current = 0;
      setHistoryKey((k) => k + 1);
      if (titleChanged) onChanged();
    } catch (e) {
      // The edit is still only in this tab: keep it marked unsaved so the
      // close-tab warning and the retry logic below both know about it.
      dirtyRef.current = true;
      if (e.status === 409) {
        blockedRef.current = true;
        setStatus('conflict');
      } else if (e.status === 403) {
        blockedRef.current = true;
        setDoc((d) => ({ ...d, role: 'viewer' })); // owner changed our access while we were editing
        setStatus('readonly');
        notify(e.message, 'error');
      } else if (e.status === 404) {
        blockedRef.current = true;
        setStatus('gone');
      } else if (e.status === 401) {
        blockedRef.current = true; // the app returns to the sign-in screen
      } else if (isRetryable(e)) {
        retriesRef.current += 1;
        retryIn = Math.min(MAX_RETRY_DELAY_MS, 2000 * 2 ** (retriesRef.current - 1));
        setStatus('retrying');
        if (retriesRef.current === 1) notify("Can't reach the server. Your changes are kept and will be saved when it is back.", 'error');
      } else {
        setStatus('error');
        notify(e.message, 'error');
      }
    } finally {
      savingRef.current = false;
      if (!blockedRef.current) {
        if (retryIn) timerRef.current = setTimeout(save, retryIn);
        else if (succeeded && dirtyRef.current) timerRef.current = setTimeout(save, SAVE_DELAY_MS);
      }
    }
  }, [docId, notify, onChanged]);

  const scheduleSave = useCallback(() => {
    if (blockedRef.current || !canEditRef.current) return;
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
    onCreate: ({ editor: ed }) => setWords(countWords(ed.getText())),
    onUpdate: ({ editor: ed }) => {
      htmlRef.current = ed.getHTML();
      setWords(countWords(ed.getText()));
      scheduleSave();
    },
    onFocus: () => (focusedRef.current = true),
    onBlur: () => (focusedRef.current = false),
  });

  // Keep the editor's editability in sync with the current role.
  useEffect(() => {
    // Second argument false: changing editability must not fire an "update"
    // event, which would trigger an autosave (403 for viewers, and a needless
    // version bump that would make a collaborator's next save conflict).
    if (editor && !editor.isDestroyed && editor.isEditable !== canEdit) editor.setEditable(canEdit, false);
  }, [editor, canEdit]);

  // Retry right away when the browser comes back online.
  useEffect(() => {
    const onOnline = () => {
      if (dirtyRef.current && !blockedRef.current) save();
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [save]);

  // Close the "more" menu on outside click or Escape.
  useEffect(() => {
    const close = (e) => {
      const menu = menuRef.current;
      if (!menu?.open) return;
      if (e.type === 'keydown' ? e.key === 'Escape' : !menu.contains(e.target)) menu.removeAttribute('open');
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, []);

  // Browser tab shows the document title.
  useEffect(() => {
    document.title = `${title.trim() || 'Untitled'} · Ajaia Docs`;
    return () => {
      document.title = 'Ajaia Docs';
    };
  }, [title]);

  // Replace local state with a server copy (remote change, restore, or conflict recovery).
  const applyDocument = useCallback(
    (document) => {
      const titleChanged = document.title !== savedTitleRef.current;
      versionRef.current = document.version;
      savedTitleRef.current = document.title;
      titleRef.current = document.title;
      htmlRef.current = document.content;
      dirtyRef.current = false;
      blockedRef.current = false;
      setTitle(document.title);
      setDoc((d) => ({
        ...d,
        title: document.title,
        updatedAt: document.updatedAt,
        updatedBy: document.updatedBy,
        role: document.role || d.role,
      }));
      setStatus('saved');
      setRemoteNotice(null);
      setHistoryKey((k) => k + 1);
      if (editor && !editor.isDestroyed) {
        const before = editor.state.doc;
        const { from, to } = editor.state.selection;
        editor.commands.setContent(document.content, false); // false: do not trigger autosave
        const after = editor.state.doc;
        // Keep the cursor where the user had it: positions before the changed
        // region stay put, positions after it shift by the size difference.
        const start = before.content.findDiffStart(after.content);
        const end = start == null ? null : before.content.findDiffEnd(after.content);
        const map = (pos) => {
          if (start == null || pos <= start) return pos;
          if (end && pos >= end.a) return pos + (end.b - end.a);
          return end ? end.b : pos; // cursor was inside the changed text
        };
        const max = after.content.size;
        try {
          editor.commands.setTextSelection({ from: Math.min(map(from), max), to: Math.min(map(to), max) });
        } catch {
          /* position not valid in the new document: keep the default cursor */
        }
        setWords(countWords(editor.getText()));
      }
      if (titleChanged) onChanged();
    },
    [editor, onChanged]
  );

  const loadLatest = useCallback(async () => {
    try {
      const { document } = await api.getDoc(docId);
      applyDocument(document);
      onChanged();
    } catch (e) {
      notify(e.message, 'error');
    }
  }, [docId, applyDocument, onChanged, notify]);

  // Live presence + pulling in collaborators' saves.
  const viewers = usePresence(docId, {
    isEditing: () => canEdit && focusedRef.current,
    onServerState: async (state) => {
      if (state.version <= versionRef.current) return;
      if (state.updatedBy?.id === currentUser.id) return; // our own in-flight save
      const who = state.updatedBy?.name || 'A collaborator';
      if (dirtyRef.current || savingRef.current || blockedRef.current) {
        setRemoteNotice(who); // do not clobber local edits; let the user decide
        return;
      }
      const { document } = await api.getDoc(docId);
      if (dirtyRef.current || savingRef.current) return setRemoteNotice(who);
      applyDocument(document);
      notify(`${who} updated this document`);
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

  async function makeCopy() {
    try {
      if (dirtyRef.current) await save(); // copy what the user sees, not the last autosave
      const { document } = await api.copyDoc(docId);
      notify(`Created "${document.title}"`);
      onCopied(document.id);
    } catch (e) {
      notify(e.message, 'error');
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
            {viewers.length > 0 && (
              <div className="presence" aria-label="People viewing this document">
                {viewers.slice(0, 4).map((v) => (
                  <Avatar
                    key={v.id}
                    name={v.name}
                    email={v.email}
                    ring={v.editing}
                    title={`${v.name} is ${v.editing ? 'editing' : 'viewing'}`}
                  />
                ))}
                {viewers.length > 4 && <span className="avatar more">+{viewers.length - 4}</span>}
              </div>
            )}
            <button
              className={`btn ghost ${panel === 'outline' ? 'on' : ''}`}
              onClick={() => setPanel((p) => (p === 'outline' ? null : 'outline'))}
              title="Outline"
            >
              <IconOutline /> <span className="lbl">Outline</span>
            </button>
            {canEdit && (
              <button
                className={`btn ghost ${panel === 'history' ? 'on' : ''}`}
                onClick={() => setPanel((p) => (p === 'history' ? null : 'history'))}
                title="Version history"
              >
                <IconHistory /> <span className="lbl">History</span>
              </button>
            )}
            {isOwner ? (
              <button className="btn primary" onClick={() => setShowShare((s) => !s)}>
                <IconShare /> Share{doc.shares?.length ? ` · ${doc.shares.length}` : ''}
              </button>
            ) : (
              <span className={`badge ${doc.role}`}>
                {doc.role === 'viewer' && <IconLock size={12} />} {doc.role === 'viewer' ? 'View only' : 'Can edit'} · shared by {doc.owner.name}
              </span>
            )}
            <details className="menu" ref={menuRef}>
              <summary className="icon-btn" aria-label="More actions"><IconMore /></summary>
              {/* Close the menu after any action. */}
              <div className="menu-items" onClick={(e) => e.currentTarget.closest('details').removeAttribute('open')}>
                <button onClick={makeCopy}><IconCopy /> Make a copy</button>
                {canEdit && <button onClick={() => importInput.current.click()}><IconFileIn /> Insert from file (.txt, .md, .docx)</button>}
                <hr />
                <button onClick={() => exportAs('md')}><IconDownload /> Download as Markdown</button>
                <button onClick={() => exportAs('html')}><IconDownload /> Download as HTML</button>
                <button onClick={() => window.print()}><IconPrint /> Print / Save as PDF</button>
                {isOwner && (
                  <>
                    <hr />
                    <button className="danger" onClick={remove}><IconTrash /> Delete document</button>
                  </>
                )}
              </div>
            </details>
            <input ref={importInput} type="file" accept={ACCEPTED_FILES} hidden onChange={insertFromFile} />
          </div>
        </div>
        <div className="status-row">
          {/* After losing edit access mid-session, keep explaining that the last edits were not saved. */}
          {canEdit || status === 'readonly' ? (
            <span className={`status ${status}`} role="status" aria-live="polite">
              {STATUS_LABEL[status]}
              {status === 'conflict' && (
                <button
                  className="link"
                  onClick={() =>
                    window.confirm('Load the latest version? Your unsaved changes in this tab will be discarded.') &&
                    loadLatest()
                  }
                >
                  Load latest
                </button>
              )}
            </span>
          ) : (
            <span className="status">You have view-only access. Ask {doc.owner.name} for edit access.</span>
          )}
          <span className="muted small">
            {words.toLocaleString()} {words === 1 ? 'word' : 'words'} · {Math.max(1, Math.round(words / 200))} min read
            {doc.updatedBy && ` · Last edit by ${doc.updatedBy.id === currentUser.id ? 'you' : doc.updatedBy.name}`}
            {' · '}Owner: {isOwner ? 'You' : doc.owner.name}
          </span>
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

      {remoteNotice && (
        <div className="banner" role="status">
          <span>
            <strong>{remoteNotice}</strong> saved a newer version while you were editing.
          </span>
          <button
            className="btn small"
            onClick={() =>
              window.confirm('Load their version? Your unsaved changes in this tab will be discarded.') && loadLatest()
            }
          >
            Load their version
          </button>
        </div>
      )}

      <div className="editor-body">
        <div className="page-scroll">
          <div className="page">
            <EditorContent editor={editor} />
          </div>
        </div>
        {panel === 'outline' && <OutlinePanel editor={editor} onClose={() => setPanel(null)} />}
        {panel === 'history' && canEdit && (
          <HistoryPanel
            docId={docId}
            refreshKey={historyKey}
            beforeRestore={async () => {
              if (dirtyRef.current) await save();
            }}
            onRestored={applyDocument}
            onClose={() => setPanel(null)}
            notify={notify}
          />
        )}
      </div>
    </div>
  );
}
