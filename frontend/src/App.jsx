import React, { useState, useEffect, useRef } from 'react';
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  FileCode,
  Play,
  AlertTriangle,
  RefreshCw,
  CheckCircle2,
  Lock,
  Unlock,
  Server,
  User,
  KeyRound,
  FileCheck,
  GitPullRequest
} from 'lucide-react';
import PullRequestFeed from './components/PullRequestFeed.jsx';
import CursorGlow from './components/CursorGlow.jsx';

export default function App() {
  // Config state
  const [mode, setMode] = useState('sandbox'); // 'sandbox' or 'production'
  const [isRunning, setIsRunning] = useState(false);
  const [selectedPrNumber, setSelectedPrNumber] = useState(null);
  const [apiKeysStatus, setApiKeysStatus] = useState({
    armoriq_configured: false,
    armoriq_valid: false,
    gemini_configured: false,
    gemini_valid: false,
    mode_recommended: 'sandbox'
  });

  // Log streams
  const [logs, setLogs] = useState([]);
  const [activeToken, setActiveToken] = useState(null);
  const [shieldState, setShieldState] = useState('IDLE'); // 'IDLE', 'VERIFYING', 'SAFE', 'BLOCKED'
  const [verdict, setVerdict] = useState(null); // 'APPROVED', 'REJECTED_VIOLATION', 'MERGED_VULNERABLE'

  // File viewers
  const [viewingFile, setViewingFile] = useState('');

  // DOM Refs
  const terminalEndRef = useRef(null);
  const eventSourceRef = useRef(null);
  const statusPollRef = useRef(null);  // polls /api/status to sync running state

  // Real PR File Contents state
  const [prFiles, setPrFiles] = useState({});

  // Handler to load a real PR from GitHub
  const handleSelectRealPR = async (prNumber) => {
    setSelectedPrNumber(prNumber);
    try {
      const res = await fetch(`/api/pull-requests/${prNumber}`);
      const data = await res.json();
      if (data.status === 'error') {
        alert(data.message);
        return;
      }
      setPrFiles(data.files || {});
      if (data.files && Object.keys(data.files).length > 0) {
        setViewingFile(Object.keys(data.files)[0]);
      }
    } catch (err) {
      console.error("Failed to select real PR:", err);
      alert("Error loading pull request files.");
    }
  };

  // Fetch API Key Config Status
  const fetchKeyStatus = async () => {
    try {
      const res = await fetch('https://armorgit-1.onrender.com/api/verify-keys');
      const data = await res.json();
      setApiKeysStatus(data);
      // Auto-set recommended mode if valid key present
      if (data.mode_recommended === 'production' && mode !== 'production') {
        setMode('production');
      }
    } catch (e) {
      console.error("Failed to fetch keys status", e);
    }
  };

  useEffect(() => {
    fetchKeyStatus();
  }, []);

  // Connect to SSE log stream
  const connectLogs = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource('/api/logs');
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'ping') return;

      setLogs((prev) => {
        // Prevent duplicate log outputs
        if (prev.some(log => log.message === data.message && log.timestamp === data.timestamp)) {
          return prev;
        }
        return [...prev, data];
      });

      // Capture special states from logs
      if (data.type === 'armoriq_audit') {
        setShieldState('SAFE');
        if (data.details?.intent_token) {
          setActiveToken(data.details.intent_token);
        }
      } else if (data.type === 'tool_call') {
        setShieldState('VERIFYING');
      } else if (data.type === 'armoriq_block') {
        setShieldState('BLOCKED');
      } else if (data.type === 'success') {
        setIsRunning(false);
      }

      // Check verdict
      if (data.details?.verdict) {
        setVerdict(data.details.verdict);
      }
    };

    es.onerror = (err) => {
      console.error("SSE Connection error", err);
      es.close();
    };
  };

  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  // Poll /api/status every 2 s while simulation is running.
  // This is the safety net that guarantees the spinner stops even if the
  // SSE "success" log event is missed due to connection timing.
  useEffect(() => {
    if (isRunning) {
      statusPollRef.current = setInterval(async () => {
        try {
          const res = await fetch('/api/status');
          const data = await res.json();
          if (!data.running) {
            setIsRunning(false);
            clearInterval(statusPollRef.current);
          }
        } catch (_) { }
      }, 2000);
    } else {
      clearInterval(statusPollRef.current);
    }
    return () => clearInterval(statusPollRef.current);
  }, [isRunning]);

  // Run PR Review
  const handleTriggerReview = async () => {
    if (isRunning) return;
    if (!selectedPrNumber) {
      alert("Please select a pull request to review.");
      return;
    }

    setIsRunning(true);
    setLogs([]);
    setVerdict(null);
    setShieldState('IDLE');
    setActiveToken(null);
    // Connect to logs FIRST so we don't miss any early events
    connectLogs();
    // Small delay to let the SSE connection establish before firing the job
    await new Promise(r => setTimeout(r, 300));

    try {
      const response = await fetch('/api/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: mode,
          pr_number: selectedPrNumber
        })
      });
      const data = await response.json();
      if (data.status === 'error') {
        alert(data.message);
        setIsRunning(false);
      }
    } catch (e) {
      console.error(e);
      setIsRunning(false);
    }
  };

  const activePRFiles = prFiles;
  const fileKeys = Object.keys(activePRFiles);

  // Make sure viewingFile is in active keys list
  useEffect(() => {
    if (!fileKeys.includes(viewingFile)) {
      setViewingFile(fileKeys[0] || '');
    }
  }, [prFiles]);

  return (
    <div className="min-h-screen flex flex-col font-sans select-none">

      {/* --- PREMIUM GLOWING HEADER --- */}
      <header className="glass-panel border-b border-slate-800/80 px-6 py-4 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="bg-sky-500/10 p-2 rounded-lg border border-sky-500/35 relative">
            <Shield className="h-6 w-6 text-sky-400 relative z-10" />
            <span className="absolute inset-0 bg-sky-500/20 rounded-lg blur-md animate-pulse-slow"></span>
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-100 flex items-center gap-2 font-sans">
              ArmorGit <span className="text-xs bg-slate-800 border border-slate-700/60 font-mono py-0.5 px-2 rounded-full text-slate-400 font-medium">v1.0.0</span>
            </h1>
            <p className="text-xs text-slate-400 font-sans">Autonomous PR Maintainer Agent &amp; Intent Boundary Enforcement</p>
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs font-mono">
          {/* Environment variables config warnings */}
          <div className="flex gap-2">
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border ${apiKeysStatus.armoriq_configured
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : 'bg-amber-500/5 border-amber-500/20 text-amber-500/80'
              }`}>
              <KeyRound className="h-3 w-3" />
              <span>ArmorIQ Key: {apiKeysStatus.armoriq_configured ? 'LOADED' : 'MISSING'}</span>
            </div>

            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border ${apiKeysStatus.gemini_configured
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : 'bg-amber-500/5 border-amber-500/20 text-amber-500/80'
              }`}>
              <KeyRound className="h-3 w-3" />
              <span>Gemini Key: {apiKeysStatus.gemini_configured ? 'LOADED' : 'MISSING'}</span>
            </div>
          </div>

          <div className="h-4 w-px bg-slate-800"></div>

          <div className="flex items-center gap-2 px-3 py-1 rounded-md bg-slate-900 border border-slate-800 text-slate-300">
            <Server className="h-3.5 w-3.5 text-sky-400" />
            <span>Backend: <span className="text-emerald-400 font-semibold">ONLINE</span></span>
          </div>
        </div>
      </header>

      {/* --- DASHBOARD WRAPPER --- */}
      <main className="flex-1 p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 overflow-y-auto">

        {/* --- LEFT SIDEBAR: CONTROL & PR VIEWER (4/12 cols) --- */}
        <section className="lg:col-span-5 flex flex-col gap-6">

          {/* Configuration & Trigger Block */}
          <div className="glass-panel rounded-xl p-5 flex flex-col gap-4 relative overflow-hidden">
            <div className="absolute top-0 right-0 h-40 w-40 bg-sky-500/5 rounded-full blur-2xl pointer-events-none"></div>

            <h2 className="text-sm font-semibold tracking-wide text-slate-300 uppercase flex items-center gap-2">
              <Play className="h-4 w-4 text-sky-400" /> PR Review Controls
            </h2>

            {/* Selected PR Info Card */}
            {selectedPrNumber ? (
              <div className="bg-slate-900/60 border border-slate-800/80 rounded-lg p-3.5 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-sky-400 font-mono font-bold uppercase">Selected Pull Request</span>
                  <span className="text-xs font-mono font-bold text-slate-400">#{selectedPrNumber}</span>
                </div>
                <div className="text-xs font-semibold text-slate-200 truncate">
                  Real-time connected repository files
                </div>
                <p className="text-[10px] text-slate-500 leading-normal">
                  Analyzing real files from GitHub. The system automatically detects prompt injections or malicious signatures.
                </p>
              </div>
            ) : (
              <div className="bg-slate-900/40 border border-slate-800/40 border-dashed rounded-lg p-5 text-center flex flex-col items-center gap-2">
                <GitPullRequest className="h-6 w-6 text-slate-600 animate-pulse" />
                <span className="text-xs font-medium text-slate-400">No PR Selected</span>
                <p className="text-[10px] text-slate-500 max-w-xs leading-normal">
                  Please select an open pull request from the GitHub PR Feed below to view and analyze its content.
                </p>
              </div>
            )}

            {/* Select Mode */}
            <div className="bg-slate-900/60 border border-slate-800/80 rounded-lg p-3.5 flex items-center justify-between text-xs">
              <div className="flex flex-col gap-0.5">
                <span className="font-semibold text-slate-300">Execution Mode</span>
                <span className="text-[10px] text-slate-500">Choose real APIs or sandbox emulation.</span>
              </div>
              <div className="flex bg-slate-950 border border-slate-800 rounded-md p-1">
                <button
                  onClick={() => !isRunning && setMode('sandbox')}
                  disabled={isRunning}
                  className={`px-3 py-1.5 rounded text-xxs font-mono uppercase font-bold tracking-wider transition-all ${mode === 'sandbox'
                      ? 'bg-sky-500/25 border border-sky-500/40 text-sky-400 shadow'
                      : 'text-slate-500 hover:text-slate-300'
                    } ${isRunning ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  Sandbox
                </button>
                <button
                  onClick={() => !isRunning && setMode('production')}
                  disabled={isRunning || !apiKeysStatus.gemini_configured || !apiKeysStatus.armoriq_configured}
                  className={`px-3 py-1.5 rounded text-xxs font-mono uppercase font-bold tracking-wider transition-all flex items-center gap-1 ${mode === 'production'
                      ? 'bg-indigo-500/25 border border-indigo-500/40 text-indigo-400 shadow'
                      : 'text-slate-500 hover:text-slate-400'
                    } ${isRunning || !apiKeysStatus.gemini_configured || !apiKeysStatus.armoriq_configured ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
                  title={(!apiKeysStatus.gemini_configured || !apiKeysStatus.armoriq_configured) ? "Add API Keys to env to enable Production mode" : ""}
                >
                  {(!apiKeysStatus.gemini_configured || !apiKeysStatus.armoriq_configured) && <Lock className="h-2.5 w-2.5" />}
                  Production
                </button>
              </div>
            </div>

            {/* Launch simulation */}
            <button
              onClick={handleTriggerReview}
              disabled={isRunning || !selectedPrNumber}
              className={`w-full py-3 rounded-lg font-semibold tracking-wide text-sm flex items-center justify-center gap-2 border transition-all ${isRunning || !selectedPrNumber
                  ? 'bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed'
                  : 'bg-sky-500 border-sky-400 text-slate-950 font-bold hover:bg-sky-400 shadow-lg shadow-sky-500/10 cursor-pointer'
                }`}
            >
              {isRunning ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin text-slate-500" />
                  <span>Agent Executing PR Review...</span>
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" />
                  <span>Run PR Review Autopilot</span>
                </>
              )}
            </button>
          </div>

          {/* Real-time GitHub PR Feed */}
          <PullRequestFeed onSelectPR={handleSelectRealPR} activePrNumber={selectedPrNumber} />

          {/* Pull Request Source Code File Viewer */}
          <div className="glass-panel rounded-xl flex-1 flex flex-col overflow-hidden">
            <div className="bg-slate-900/80 px-4 py-3 border-b border-slate-800/80 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <GitPullRequest className="h-4 w-4 text-sky-400" /> PR Code Files
              </span>
              <span className="text-[10px] text-slate-500 font-mono">1.2.0 &rarr; main</span>
            </div>

            {/* File selection tabs */}
            <div className="flex bg-slate-900/30 border-b border-slate-800/60 p-2 gap-1 overflow-x-auto text-[11px] font-mono">
              {fileKeys.map((f) => (
                <button
                  key={f}
                  onClick={() => setViewingFile(f)}
                  className={`px-3 py-1.5 rounded transition-all flex items-center gap-1 border ${viewingFile === f
                      ? 'bg-slate-800 border-slate-700 text-slate-100'
                      : 'bg-transparent border-transparent text-slate-500 hover:text-slate-300'
                    }`}
                >
                  <FileCode className="h-3 w-3" />
                  {f}
                </button>
              ))}
            </div>

            {/* Code Content Container */}
            <div className="flex-1 p-4 font-mono text-xs leading-relaxed overflow-y-auto max-h-[350px] relative select-text selection:bg-sky-500/30">

              {viewingFile && activePRFiles[viewingFile] ? (
                <pre className="text-slate-300 bg-slate-900/60 border border-slate-900 rounded p-3 h-full overflow-x-auto whitespace-pre">
                  {activePRFiles[viewingFile]}
                </pre>
              ) : (
                <div className="text-slate-600 italic h-full flex items-center justify-center">
                  Select a file from the tabs above to view content.
                </div>
              )}
            </div>

            <div className="bg-slate-900/40 px-4 py-2.5 border-t border-slate-800/80 flex items-center justify-between text-xxs font-mono text-slate-500">
              <span>Path: backend/repo/{viewingFile}</span>
              <span>Enc: UTF-8</span>
            </div>
          </div>

        </section>

        {/* --- RIGHT PANEL: LIVE AGENT LOGS & AUDIT LOG (7/12 cols) --- */}
        <section className="lg:col-span-7 flex flex-col gap-6">

          {/* ArmorIQ Boundary Shield Monitor Banner */}
          <div className={`rounded-xl border p-4.5 transition-all duration-300 flex items-center justify-between relative overflow-hidden ${shieldState === 'IDLE'
              ? 'bg-slate-900/80 border-slate-800/80 text-slate-400'
              : shieldState === 'VERIFYING'
                ? 'bg-sky-950/20 border-sky-500/40 text-sky-300 shadow-md shadow-sky-950/20'
                : shieldState === 'SAFE'
                  ? 'bg-emerald-950/20 border-emerald-500/40 text-emerald-300 shadow-md shadow-emerald-950/20 animate-pulse'
                  : 'bg-rose-950/20 border-rose-500/50 text-rose-300 shadow-lg shadow-rose-950/20'
            }`}>

            <div className="flex items-center gap-4.5 relative z-10">
              <div className={`p-3 rounded-full border relative ${shieldState === 'IDLE'
                  ? 'bg-slate-900 border-slate-700 text-slate-500'
                  : shieldState === 'VERIFYING'
                    ? 'bg-sky-900/40 border-sky-400/50 text-sky-400 animate-spin'
                    : shieldState === 'SAFE'
                      ? 'bg-emerald-900/40 border-emerald-400/50 text-emerald-400'
                      : 'bg-rose-900/40 border-rose-400/60 text-rose-400'
                }`}>
                {shieldState === 'IDLE' && <Shield className="h-6 w-6" />}
                {shieldState === 'VERIFYING' && <RefreshCw className="h-6 w-6" />}
                {shieldState === 'SAFE' && <ShieldCheck className="h-6 w-6" />}
                {shieldState === 'BLOCKED' && <ShieldAlert className="h-6 w-6" />}

                {/* Glowing backdrop blur */}
                {shieldState !== 'IDLE' && (
                  <span className={`absolute inset-0 rounded-full blur ${shieldState === 'VERIFYING' ? 'bg-sky-500/20' : shieldState === 'SAFE' ? 'bg-emerald-500/20' : 'bg-rose-500/30'
                    }`}></span>
                )}
              </div>

              <div>
                <h3 className="text-sm font-bold tracking-wide uppercase">
                  ArmorIQ Shield Status: <span className="font-mono">{shieldState}</span>
                </h3>
                <p className="text-xxs text-slate-400 mt-1 max-w-md font-sans">
                  {shieldState === 'IDLE' && 'Awaiting PR autopilot launch to capture intent plan.'}
                  {shieldState === 'VERIFYING' && 'Checking current tool execution against cryptographic signature tokens...'}
                  {shieldState === 'SAFE' && 'Intent verified. Agent is executing within cryptographically signed bounds.'}
                  {shieldState === 'BLOCKED' && 'Intent validation mismatch! Unauthorized tool call intercepted and blocked.'}
                </p>
              </div>
            </div>

            {/* Token Badge */}
            {activeToken && (
              <div className="flex flex-col items-end gap-1 font-mono relative z-10 text-right">
                <span className="text-[10px] text-slate-500 uppercase tracking-widest">Active Intent Token</span>
                <span className="text-xxs font-bold text-sky-400/80 bg-slate-900 border border-slate-800 rounded px-2.5 py-1">
                  {activeToken}
                </span>
              </div>
            )}

            {/* Background scanline simulation for blocked state */}
            {shieldState === 'BLOCKED' && (
              <div className="absolute inset-0 bg-red-950/5 pointer-events-none scanline animate-pulse-slow"></div>
            )}
          </div>

          {/* Streaming Agent Console Retro Terminal */}
          <div className="glass-panel rounded-xl flex-1 flex flex-col overflow-hidden max-h-[380px]">
            <div className="bg-slate-900/80 px-4 py-3 border-b border-slate-800/80 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Terminal className="h-4 w-4 text-sky-400" /> Autopilot Agent logs
              </span>

              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping"></span>
                <span className="text-xxs font-mono text-emerald-400/95 uppercase font-semibold">streaming</span>
              </div>
            </div>

            <div className="flex-1 bg-slate-950/90 p-4 font-mono text-xs leading-relaxed overflow-y-auto terminal-scroll min-h-[160px] flex flex-col gap-2.5">
              {logs.length === 0 ? (
                <div className="text-slate-600 italic h-full flex items-center justify-center">
                  Terminal ready. Launch pull request autopilot to view logs...
                </div>
              ) : (
                logs.map((log, index) => {
                  let textStyle = "text-slate-300";
                  let prefix = "[INFO]";

                  if (log.type === 'agent') {
                    textStyle = "text-sky-300";
                    prefix = "[AGENT]";
                  } else if (log.type === 'tool_call') {
                    textStyle = "text-amber-300";
                    prefix = "[CALL]";
                  } else if (log.type === 'armoriq_audit') {
                    textStyle = "text-emerald-400 font-semibold";
                    prefix = "[ARMORIQ]";
                  } else if (log.type === 'armoriq_block') {
                    textStyle = "text-rose-400 font-bold bg-rose-950/20 p-1.5 rounded border border-rose-500/20";
                    prefix = "[VIOLATION]";
                  } else if (log.type === 'success') {
                    textStyle = "text-emerald-500 font-bold";
                    prefix = "[VERDICT]";
                  }

                  return (
                    <div key={index} className={`leading-normal ${textStyle}`}>
                      <span className="text-slate-500 mr-2">[{log.timestamp.slice(11, 19)}]</span>
                      <span className="text-slate-600 mr-2">{prefix}</span>
                      <span>{log.message}</span>

                      {/* Sub details for tool validation error */}
                      {log.type === 'armoriq_block' && log.details?.matched_policy && (
                        <div className="mt-1 ml-2 text-[10px] text-rose-300/80 bg-rose-950/20 p-2 rounded border border-rose-900/30 flex flex-col gap-1">
                          <div><strong>Enforced Policy:</strong> {log.details.matched_policy}</div>
                          <div><strong>Interception ID:</strong> {log.details.delegation_id}</div>
                          <div><strong>State Hash check:</strong> CRYPTO_INVALID</div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
              <div ref={terminalEndRef} />
            </div>
          </div>

          {/* ArmorIQ Cryptographic Audit Ledger */}
          <div className="glass-panel rounded-xl p-5 flex flex-col gap-3">
            <h2 className="text-sm font-semibold tracking-wide text-slate-300 uppercase flex items-center gap-1.5">
              <FileCheck className="h-4.5 w-4.5 text-sky-400" /> Cryptographic Audit Trail
            </h2>

            <div className="border border-slate-800/80 rounded-lg overflow-hidden text-xxs font-mono bg-slate-950">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-900 text-slate-400 uppercase tracking-widest border-b border-slate-800">
                    <th className="py-2.5 px-3">Timestamp</th>
                    <th className="py-2.5 px-3">Tool Invoiced</th>
                    <th className="py-2.5 px-3">Subject ID</th>
                    <th className="py-2.5 px-3">Audit Action</th>
                    <th className="py-2.5 px-3 text-right">Signature Check</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-slate-300 leading-normal">
                  {logs.filter(log => ['armoriq_audit', 'armoriq_block', 'tool_call'].includes(log.type)).length === 0 ? (
                    <tr>
                      <td colSpan="5" className="py-4 px-3 text-slate-600 text-center italic">
                        No audit ledger records generated yet. Run simulation to populate.
                      </td>
                    </tr>
                  ) : (
                    logs.filter(log => ['armoriq_audit', 'armoriq_block'].includes(log.type)).map((log, index) => {
                      const isBlock = log.type === 'armoriq_block';
                      return (
                        <tr key={index} className={isBlock ? "bg-rose-950/5" : "hover:bg-slate-900/30"}>
                          <td className="py-2 px-3 text-slate-500">{log.timestamp.slice(11, 19)}</td>
                          <td className="py-2 px-3 font-semibold text-slate-100">{log.details?.tool || 'intent_capture'}</td>
                          <td className="py-2 px-3 text-slate-400">maintainer@company.com</td>
                          <td className="py-2 px-3">
                            <span className={`px-2 py-0.5 rounded-full font-sans font-bold uppercase ${isBlock
                                ? 'bg-rose-500/15 border border-rose-500/35 text-rose-400'
                                : 'bg-emerald-500/15 border border-emerald-500/35 text-emerald-400'
                              }`}>
                              {isBlock ? 'BLOCK' : 'ALLOW'}
                            </span>
                          </td>
                          <td className={`py-2 px-3 text-right ${isBlock ? 'text-rose-400 font-bold' : 'text-sky-400'}`}>
                            {isBlock ? 'FAILED' : 'VERIFIED'}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Verdict Output Banner */}
            {verdict && (
              <div className={`p-4 rounded-lg border text-sm flex items-center justify-between animate-pulse ${verdict === 'APPROVED'
                  ? 'bg-emerald-950/25 border-emerald-500/40 text-emerald-300'
                  : verdict === 'REJECTED_VIOLATION'
                    ? 'bg-rose-950/35 border-rose-500/50 text-rose-300'
                    : 'bg-amber-950/25 border-amber-500/40 text-amber-300'
                }`}>
                <div className="flex items-center gap-2">
                  {verdict === 'APPROVED' && <CheckCircle2 className="h-5 w-5" />}
                  {verdict === 'REJECTED_VIOLATION' && <ShieldAlert className="h-5 w-5" />}
                  {verdict === 'MERGED_VULNERABLE' && <AlertTriangle className="h-5 w-5" />}
                  <div>
                    <div className="font-bold uppercase leading-tight">
                      {verdict === 'APPROVED' && 'PR Review: Merged successfully'}
                      {verdict === 'REJECTED_VIOLATION' && 'PR Review: Rejected by Guard'}
                      {verdict === 'MERGED_VULNERABLE' && 'PR Review: Merged (Vulnerable)'}
                    </div>
                    <div className="text-xxs text-slate-400 mt-0.5">
                      {verdict === 'APPROVED' && 'All checks passed. Original intent satisfied.'}
                      {verdict === 'REJECTED_VIOLATION' && 'Intercepted unauthorized dependency modifications. Prevented backdoor payload.'}
                      {verdict === 'MERGED_VULNERABLE' && 'Warning: Auto-maintainer was prompt-injected and updated setup.py without security protection.'}
                    </div>
                  </div>
                </div>

                <span className="text-xs font-mono font-bold py-1 px-3 rounded bg-slate-950/80 border border-slate-800">
                  {verdict === 'APPROVED' && 'STATUS: OK'}
                  {verdict === 'REJECTED_VIOLATION' && 'STATUS: BLOCKED'}
                  {verdict === 'MERGED_VULNERABLE' && 'STATUS: INSECURE'}
                </span>
              </div>
            )}
          </div>

        </section>

      </main>

      {/* --- FOOTER CARD --- */}
      <footer className="glass-panel border-t border-slate-900 px-6 py-3 flex items-center justify-between text-xxs text-slate-500 font-mono">
        <span>© 2026 ArmorGit Project. Powered by Google ADK &amp; ArmorIQ Security Control Fabric.</span>
        <div className="flex gap-4">
          <a href="https://platform.armoriq.ai" target="_blank" className="hover:text-sky-400 transition-colors">platform.armoriq.ai</a>
          <span>•</span>
          <a href="https://google.github.io/adk-docs/" target="_blank" className="hover:text-sky-400 transition-colors">google-adk docs</a>
        </div>
      </footer>

      <CursorGlow />
    </div>
  );
}
