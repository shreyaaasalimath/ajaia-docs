// Content handling: sanitizing stored HTML and converting uploaded files to HTML.
import sanitizeHtml from 'sanitize-html';
import mammoth from 'mammoth';
import { marked } from 'marked';
import path from 'node:path';

// Only the structure the editor can actually render. Anything else
// (scripts, styles, event handlers, iframes) is stripped on the server, because
// shared documents are rendered in other users' browsers.
const SANITIZE_OPTIONS = {
  allowedTags: [
    'p', 'br', 'h1', 'h2', 'h3', 'strong', 'b', 'em', 'i', 'u', 's',
    'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'hr', 'a',
  ],
  allowedAttributes: { a: ['href', 'target', 'rel'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  // Links from imported files open in a new tab without giving the target page
  // access to window.opener (reverse tabnabbing).
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer nofollow' },
    }),
  },
};

export function sanitizeContent(html) {
  return sanitizeHtml(String(html ?? ''), SANITIZE_OPTIONS);
}

export const SUPPORTED_EXTENSIONS = ['.txt', '.md', '.docx'];
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024; // 2 MB

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function textToHtml(text) {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

export class UnsupportedFileError extends Error {}

/** Convert an uploaded file buffer into { title, html }. */
export async function fileToHtml(originalName, buffer) {
  const ext = path.extname(originalName || '').toLowerCase();
  const title = path.basename(originalName || 'Untitled', ext).slice(0, 200) || 'Untitled';
  let html;
  if (ext === '.txt') {
    html = textToHtml(buffer.toString('utf8'));
  } else if (ext === '.md') {
    html = await marked.parse(buffer.toString('utf8'));
  } else if (ext === '.docx') {
    try {
      html = (await mammoth.convertToHtml({ buffer })).value;
    } catch {
      throw new UnsupportedFileError('Could not read this .docx file. Is it a valid Word document?');
    }
  } else {
    throw new UnsupportedFileError(
      `Unsupported file type "${ext || 'none'}". Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`
    );
  }
  return { title, html: sanitizeContent(html) };
}
