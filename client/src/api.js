// Thin fetch wrapper: JSON in/out, errors surface the server's message.
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(method, url, body) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (body instanceof FormData) {
    opts.body = body;
  } else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, opts);
  } catch {
    throw new ApiError(0, 'Network error. Check your connection and try again.');
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !url.startsWith('/api/auth/')) {
    // Session expired mid-use: let the app return to the sign-in screen.
    window.dispatchEvent(new CustomEvent('ajaia:unauthorized'));
  }
  if (!res.ok) throw new ApiError(res.status, data.error || `Request failed (${res.status})`);
  return data;
}

const fileForm = (file) => {
  const fd = new FormData();
  fd.append('file', file);
  return fd;
};

export const api = {
  me: () => request('GET', '/api/auth/me'),
  login: (email, password) => request('POST', '/api/auth/login', { email, password }),
  logout: () => request('POST', '/api/auth/logout'),
  users: () => request('GET', '/api/users'),
  listDocs: () => request('GET', '/api/documents'),
  createDoc: (title) => request('POST', '/api/documents', { title }),
  getDoc: (id) => request('GET', `/api/documents/${id}`),
  updateDoc: (id, patch) => request('PATCH', `/api/documents/${id}`, patch),
  copyDoc: (id) => request('POST', `/api/documents/${id}/copy`),
  deleteDoc: (id) => request('DELETE', `/api/documents/${id}`),
  share: (id, email, role) => request('POST', `/api/documents/${id}/shares`, { email, role }),
  unshare: (id, userId) => request('DELETE', `/api/documents/${id}/shares/${userId}`),
  versions: (id) => request('GET', `/api/documents/${id}/versions`),
  version: (id, vid) => request('GET', `/api/documents/${id}/versions/${vid}`),
  restoreVersion: (id, vid) => request('POST', `/api/documents/${id}/versions/${vid}/restore`),
  presence: (id, editing) => request('POST', `/api/documents/${id}/presence`, { editing }),
  leavePresence: (id) => request('DELETE', `/api/documents/${id}/presence`),
  importFile: (file) => request('POST', '/api/documents/import', fileForm(file)),
  convertFile: (file) => request('POST', '/api/convert', fileForm(file)),
};

export const ACCEPTED_FILES = '.txt,.md,.docx';
export const MAX_UPLOAD_MB = 2;

export function checkFile(file) {
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  if (!ACCEPTED_FILES.split(',').includes(ext)) {
    return `"${file.name}" is not supported. Use a .txt, .md or .docx file.`;
  }
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) return `"${file.name}" is larger than ${MAX_UPLOAD_MB} MB.`;
  return null;
}
