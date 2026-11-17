import { useEffect, useState } from 'react';

function readHeadings(editor) {
  const items = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'heading') items.push({ level: node.attrs.level, text: node.textContent.trim() });
    return node.type.name !== 'heading'; // no need to look inside headings
  });
  return items;
}

/** Live table of contents built from the document's headings. Click to jump. */
export default function OutlinePanel({ editor, onClose }) {
  const [headings, setHeadings] = useState(() => (editor ? readHeadings(editor) : []));

  useEffect(() => {
    if (!editor) return;
    const update = () => setHeadings(readHeadings(editor));
    update();
    editor.on('update', update);
    editor.on('create', update);
    return () => {
      editor.off('update', update);
      editor.off('create', update);
    };
  }, [editor]);

  function jump(index) {
    const el = editor.view.dom.querySelectorAll('h1, h2, h3')[index];
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1200);
  }

  return (
    <aside className="side-panel outline" aria-label="Document outline">
      <div className="side-head">
        <h3>Outline</h3>
        <button className="btn small" onClick={onClose} aria-label="Close outline">✕</button>
      </div>
      {headings.length ? (
        <ul className="outline-list">
          {headings.map((hd, i) => (
            <li key={i} className={`lvl-${hd.level}`}>
              <button onClick={() => jump(i)}>{hd.text || <em className="muted">Untitled heading</em>}</button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small pad">Headings you add (Heading 1–3) appear here for quick navigation.</p>
      )}
    </aside>
  );
}
