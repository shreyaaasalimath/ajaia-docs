import { useEffect, useReducer } from 'react';
import {
  IconUndo, IconRedo, IconBulletList, IconNumberList, IconQuote, IconCode, IconDivider, IconStrike,
} from './Icons.jsx';

// Re-render on selection/transaction so active states stay accurate.
function useEditorTick(editor) {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    if (!editor) return;
    editor.on('transaction', force);
    return () => editor.off('transaction', force);
  }, [editor]);
}

export default function Toolbar({ editor }) {
  useEditorTick(editor);
  if (!editor) return null;

  const btn = (label, title, isActive, run, disabled = false) => (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={isActive}
      className={`tool ${isActive ? 'active' : ''}`}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()} // keep editor selection
      onClick={run}
    >
      {label}
    </button>
  );

  const chain = () => editor.chain().focus();
  const blockType = editor.isActive('heading', { level: 1 })
    ? 'h1'
    : editor.isActive('heading', { level: 2 })
      ? 'h2'
      : editor.isActive('heading', { level: 3 })
        ? 'h3'
        : 'p';

  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      {btn(<IconUndo />, 'Undo (Ctrl+Z)', false, () => chain().undo().run(), !editor.can().undo())}
      {btn(<IconRedo />, 'Redo (Ctrl+Shift+Z)', false, () => chain().redo().run(), !editor.can().redo())}
      <span className="sep" />
      <select
        className="tool-select"
        aria-label="Text style"
        value={blockType}
        onChange={(e) => {
          const v = e.target.value;
          if (v === 'p') chain().setParagraph().run();
          else chain().setHeading({ level: Number(v[1]) }).run();
        }}
      >
        <option value="p">Normal text</option>
        <option value="h1">Heading 1</option>
        <option value="h2">Heading 2</option>
        <option value="h3">Heading 3</option>
      </select>
      <span className="sep" />
      {btn(<b>B</b>, 'Bold (Ctrl+B)', editor.isActive('bold'), () => chain().toggleBold().run())}
      {btn(<i>I</i>, 'Italic (Ctrl+I)', editor.isActive('italic'), () => chain().toggleItalic().run())}
      {btn(<u>U</u>, 'Underline (Ctrl+U)', editor.isActive('underline'), () => chain().toggleUnderline().run())}
      {btn(<IconStrike />, 'Strikethrough', editor.isActive('strike'), () => chain().toggleStrike().run())}
      <span className="sep" />
      {btn(<IconBulletList />, 'Bulleted list', editor.isActive('bulletList'), () => chain().toggleBulletList().run())}
      {btn(<IconNumberList />, 'Numbered list', editor.isActive('orderedList'), () => chain().toggleOrderedList().run())}
      {btn(<IconQuote />, 'Quote', editor.isActive('blockquote'), () => chain().toggleBlockquote().run())}
      {btn(<IconCode />, 'Code block', editor.isActive('codeBlock'), () => chain().toggleCodeBlock().run())}
      {btn(<IconDivider />, 'Divider', false, () => chain().setHorizontalRule().run())}
    </div>
  );
}
