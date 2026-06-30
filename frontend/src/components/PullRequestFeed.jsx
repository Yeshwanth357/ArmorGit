import React, { useEffect, useState, useRef, useCallback } from 'react';
import { RefreshCw, GitPullRequest, Wifi, WifiOff } from 'lucide-react';

/**
 * PullRequestFeed - Displays real open pull requests from the GitHub repo
 * configured via GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO in .env.
 *
 * Strategy:
 *  - Initial load: fetch() the REST endpoint for an instant snapshot.
 *  - Live updates:  EventSource SSE that auto-reconnects on transient errors.
 *  - Fallback:      If SSE fails 3 times, switch to polling every 15 s.
 */
const PullRequestFeed = ({ onSelectPR, activePrNumber }) => {
  const [prs, setPrs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sseStatus, setSseStatus] = useState('connecting'); // 'connecting' | 'live' | 'polling'
  const esRef = useRef(null);
  const failCountRef = useRef(0);
  const pollTimerRef = useRef(null);

  /* ─── Fetch snapshot ─────────────────────────────────────────────── */
  const fetchSnapshot = useCallback(async () => {
    try {
      const res = await fetch('/api/pull-requests');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPrs(data);
    } catch (err) {
      console.warn('[PullRequestFeed] snapshot fetch failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  /* ─── Polling fallback (used when SSE keeps failing) ────────────── */
  const startPolling = useCallback(() => {
    if (pollTimerRef.current) return;
    setSseStatus('polling');
    const tick = async () => {
      try {
        const res = await fetch('/api/pull-requests');
        if (res.ok) {
          const data = await res.json();
          setPrs(data);
        }
      } catch (_) {}
    };
    tick();
    pollTimerRef.current = setInterval(tick, 15_000);
  }, []);

  /* ─── SSE connection ─────────────────────────────────────────────── */
  const connectSSE = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    const es = new EventSource('/api/pull-requests/stream');
    esRef.current = es;

    es.onopen = () => {
      failCountRef.current = 0;
      setSseStatus('live');
    };

    es.onmessage = (e) => {
      try {
        const updated = JSON.parse(e.data);
        if (Array.isArray(updated)) {
          setPrs(updated);
          setLoading(false);
          failCountRef.current = 0;
          setSseStatus('live');
        }
      } catch (parseErr) {
        console.warn('[PullRequestFeed] SSE parse error:', parseErr);
      }
    };

    es.onerror = () => {
      failCountRef.current += 1;
      console.warn(`[PullRequestFeed] SSE error #${failCountRef.current}`);
      es.close();
      esRef.current = null;

      if (failCountRef.current >= 3) {
        // Give up on SSE, fall back to polling
        startPolling();
      } else {
        // Retry SSE after a short delay
        setSseStatus('connecting');
        setTimeout(connectSSE, 3_000 * failCountRef.current);
      }
    };
  }, [startPolling]);

  /* ─── Mount / unmount ────────────────────────────────────────────── */
  useEffect(() => {
    fetchSnapshot();
    connectSSE();

    return () => {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [fetchSnapshot, connectSSE]);

  /* ─── Render ─────────────────────────────────────────────────────── */
  const statusBadge = {
    connecting: { label: 'Connecting…', color: 'text-amber-400', icon: <RefreshCw className="h-3 w-3 animate-spin" /> },
    live:       { label: 'Live',        color: 'text-emerald-400', icon: <Wifi className="h-3 w-3" /> },
    polling:    { label: 'Polling',     color: 'text-sky-400',     icon: <RefreshCw className="h-3 w-3" /> },
  }[sseStatus];

  return (
    <div className="glass-panel rounded-xl p-4 flex flex-col gap-3 relative overflow-hidden">
      <div className="absolute top-0 right-0 h-24 w-24 bg-sky-500/5 rounded-full blur-xl pointer-events-none" />

      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
        <h3 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5 uppercase tracking-wider">
          <GitPullRequest className="h-4 w-4 text-sky-400" />
          GitHub PR Feed
        </h3>
        <div className={`flex items-center gap-1 text-[10px] font-mono ${statusBadge.color}`}>
          {statusBadge.icon}
          <span>{statusBadge.label}</span>
          {prs.length > 0 && (
            <span className="ml-1 bg-slate-900 border border-slate-800 text-slate-400 py-0.5 px-1.5 rounded-full">
              {prs.length} open
            </span>
          )}
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 text-slate-400 min-h-[80px]">
          <RefreshCw className="h-4 w-4 animate-spin text-sky-400" />
          <span className="text-xs font-mono">Loading pull requests…</span>
        </div>
      ) : prs.length === 0 ? (
        <div className="text-center py-6 text-slate-500 text-xs italic">
          No open pull requests found in the configured repository.
        </div>
      ) : (
        <ul className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
          {prs.map((pr) => {
            const isActive = pr.number === activePrNumber;
            return (
              <li
                key={pr.number}
                className={`flex items-center justify-between p-2 rounded transition-all border ${
                  isActive
                    ? 'bg-sky-500/10 border-sky-500/40 text-sky-300'
                    : 'bg-slate-900/40 border-slate-800/60 text-slate-200 hover:border-slate-700'
                }`}
              >
                <div className="flex flex-col gap-0.5 overflow-hidden mr-2">
                  <span className="font-semibold text-xs truncate max-w-[190px]" title={pr.title}>
                    <span className="text-sky-400 mr-1">#{pr.number}</span>
                    {pr.title}
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono">by @{pr.author}</span>
                </div>
                <button
                  onClick={() => onSelectPR(pr.number)}
                  disabled={isActive}
                  className={`shrink-0 px-2.5 py-1 rounded text-xxs font-mono font-bold tracking-wider transition-all border ${
                    isActive
                      ? 'bg-sky-500/20 border-sky-400/50 text-sky-300 cursor-default'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700 cursor-pointer'
                  }`}
                >
                  {isActive ? 'SELECTED' : 'SELECT'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default PullRequestFeed;
