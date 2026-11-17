import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';

const ACTIVE_INTERVAL_MS = 4000;
const HIDDEN_INTERVAL_MS = 15000; // back off when the tab is in the background

/**
 * Heartbeat to the presence endpoint while a document is open.
 * Returns the other people currently viewing it, and reports the server's
 * latest version to `onServerState` so the editor can pull in remote saves.
 */
export function usePresence(docId, { isEditing, onServerState }) {
  const [viewers, setViewers] = useState([]);
  const callbacks = useRef({ isEditing, onServerState });
  callbacks.current = { isEditing, onServerState };

  useEffect(() => {
    let stopped = false;
    let timer;
    const beat = async () => {
      try {
        const state = await api.presence(docId, callbacks.current.isEditing());
        if (stopped) return;
        setViewers(state.viewers);
        callbacks.current.onServerState(state);
      } catch (e) {
        // Presence is best-effort; editing keeps working if a heartbeat fails.
        // Stop entirely if the document is gone or the session ended.
        if (e.status === 404 || e.status === 401) return;
      }
      if (!stopped) timer = setTimeout(beat, document.hidden ? HIDDEN_INTERVAL_MS : ACTIVE_INTERVAL_MS);
    };
    beat();
    return () => {
      stopped = true;
      clearTimeout(timer);
      api.leavePresence(docId).catch(() => {});
    };
  }, [docId]);

  return viewers;
}

const COLORS = ['#2f5bea', '#c2410c', '#15803d', '#9333ea', '#be123c', '#0e7490', '#a16207'];

export function colorFor(key = '') {
  let hash = 0;
  for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[hash % COLORS.length];
}

export function initials(name = '?') {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('');
}

export function Avatar({ name, email, size = 28, ring = false, title }) {
  return (
    <span
      className={`avatar ${ring ? 'ring' : ''}`}
      style={{ background: colorFor(email || name), width: size, height: size, fontSize: size * 0.4 }}
      title={title || name}
    >
      {initials(name)}
    </span>
  );
}
