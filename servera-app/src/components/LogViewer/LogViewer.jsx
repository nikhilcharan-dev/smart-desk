import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { MAIN_SESSION_ID } from '../../utils/terminal';
import { formatRemoteError } from '../../utils/errors';
import { ScrollText, RefreshCw, Search, X, Pause, Play, Trash2, Bot, Loader2, FolderOpen, Folder, File, ArrowUp, ChevronRight, Radio, Square } from 'lucide-react';
import './LogViewer.css';

const LOG_PRESETS = [
    { label: 'Syslog', path: '/var/log/syslog' },
    { label: 'Auth Log', path: '/var/log/auth.log' },
    { label: 'Kern Log', path: '/var/log/kern.log' },
    { label: 'Nginx Access', path: '/var/log/nginx/access.log' },
    { label: 'Nginx Error', path: '/var/log/nginx/error.log' },
    { label: 'Apache Access', path: '/var/log/apache2/access.log' },
    { label: 'Apache Error', path: '/var/log/apache2/error.log' },
    { label: 'Messages', path: '/var/log/messages' },
    { label: 'Journal', path: '__journalctl__' },
];

function classifyLine(line) {
    const lower = line.toLowerCase();
    if (lower.includes('error') || lower.includes('fail') || lower.includes('fatal') || lower.includes('crit')) return 'error';
    if (lower.includes('warn')) return 'warning';
    if (lower.includes('info')) return 'info';
    if (lower.includes('debug')) return 'debug';
    return '';
}

function RemoteFilePicker({ onSelect, onClose }) {
    const [currentPath, setCurrentPath] = useState('/');
    const [inputPath, setInputPath] = useState('/');
    const [entries, setEntries] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [selected, setSelected] = useState(null);

    const loadDir = useCallback(async (path) => {
        setLoading(true);
        setError(null);
        setSelected(null);
        try {
            const res = await invoke('sftp_list', { sessionId: MAIN_SESSION_ID, path: path === '/' ? '/' : path });
            const dirs = res.filter(e => e.is_dir).sort((a, b) => a.name.localeCompare(b.name));
            const files = res.filter(e => !e.is_dir).sort((a, b) => a.name.localeCompare(b.name));
            setEntries([...dirs, ...files]);
        } catch (err) {
            setError(formatRemoteError(err, `Listing ${path}`));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadDir(currentPath);
        setInputPath(currentPath);
    }, [currentPath, loadDir]);

    const goUp = () => {
        if (currentPath === '/') return;
        const parts = currentPath.split('/').filter(p => p);
        parts.pop();
        setCurrentPath(parts.length === 0 ? '/' : '/' + parts.join('/'));
    };

    const breadcrumbs = (() => {
        if (currentPath === '/') return [{ label: '/', path: '/' }];
        const parts = currentPath.split('/').filter(p => p);
        const crumbs = [{ label: '/', path: '/' }];
        let acc = '';
        for (const p of parts) {
            acc += '/' + p;
            crumbs.push({ label: p, path: acc });
        }
        return crumbs;
    })();

    return (
        <div className="rfp-overlay" onClick={onClose}>
            <div className="rfp-modal" onClick={e => e.stopPropagation()}>
                <div className="rfp-header">
                    <FolderOpen size={16} className="rfp-icon" />
                    <span className="rfp-title">Browse Remote Files</span>
                    <button className="rfp-close" onClick={onClose}><X size={14} /></button>
                </div>

                <div className="rfp-nav">
                    <button className="rfp-up-btn" onClick={goUp} disabled={currentPath === '/'} title="Go up">
                        <ArrowUp size={14} />
                    </button>
                    <div className="rfp-breadcrumbs">
                        {breadcrumbs.map((crumb, i) => (
                            <span key={crumb.path} className="rfp-crumb">
                                {i > 0 && <ChevronRight size={10} className="rfp-crumb-sep" />}
                                <button className={`rfp-crumb-btn ${i === breadcrumbs.length - 1 ? 'active' : ''}`}
                                    onClick={() => setCurrentPath(crumb.path)}>
                                    {crumb.label}
                                </button>
                            </span>
                        ))}
                    </div>
                    <input
                        className="rfp-path-input"
                        value={inputPath}
                        onChange={e => setInputPath(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && setCurrentPath(inputPath)}
                        spellCheck={false}
                    />
                </div>

                <div className="rfp-list">
                    {loading && <div className="rfp-status">Loading...</div>}
                    {error && <div className="rfp-status rfp-error">{error}</div>}
                    {!loading && !error && entries.length === 0 && (
                        <div className="rfp-status">Empty directory</div>
                    )}
                    {entries.map(entry => (
                        <div
                            key={entry.path}
                            className={`rfp-entry ${entry.is_dir ? 'dir' : 'file'} ${selected?.path === entry.path ? 'selected' : ''}`}
                            onClick={() => entry.is_dir ? setCurrentPath(entry.path) : setSelected(entry)}
                            onDoubleClick={() => !entry.is_dir && onSelect(entry.path)}
                            title={entry.path}
                        >
                            {entry.is_dir
                                ? <Folder size={14} className="rfp-entry-icon dir" />
                                : <File size={14} className="rfp-entry-icon file" />}
                            <span className="rfp-entry-name">{entry.name}</span>
                        </div>
                    ))}
                </div>

                {selected && (
                    <div className="rfp-selected-bar">
                        <File size={12} />
                        <span className="rfp-selected-path">{selected.path}</span>
                    </div>
                )}

                <div className="rfp-footer">
                    <button className="rfp-btn secondary" onClick={onClose}>Cancel</button>
                    <button
                        className="rfp-btn primary"
                        disabled={!selected}
                        onClick={() => selected && onSelect(selected.path)}
                    >
                        Open
                    </button>
                </div>
            </div>
        </div>
    );
}

export default function LogViewer({ profileId, ip, user, port, password, privateKey, proxyJump }) {
    const storageKey = profileId ? `logTabs:profile:${profileId}` : `logTabs:${user}@${ip}`;

    const [lines, setLines] = useState([]);
    const [loading, setLoading] = useState(false);
    const [logPath, setLogPath] = useState('/var/log/syslog');
    const [customPath, setCustomPath] = useState('');
    const [customTabs, setCustomTabs] = useState(() => {
        try {
            const saved = localStorage.getItem(storageKey);
            if (saved) return JSON.parse(saved);
        } catch { /* ignore */ }
        return [];
    });
    const [lineCount, setLineCount] = useState(100);
    const [filter, setFilter] = useState('');
    const [autoScroll] = useState(true);
    const [paused, setPaused] = useState(false);
    const [aiAnalysis, setAiAnalysis] = useState(null);
    const [showPicker, setShowPicker] = useState(false);

    // Streaming state
    const [streaming, setStreaming] = useState(false);
    const streamIdRef = useRef(null);
    const streamUnlistenRef = useRef(null);
    const MAX_STREAM_LINES = 2000;

    const listRef = useRef(null);
    const pausedLinesRef = useRef([]);

    // Stop any active stream
    const stopStream = useCallback(async () => {
        if (streamIdRef.current) {
            try { await invoke('stop_log_stream', { streamId: streamIdRef.current }); } catch { /* best-effort teardown — stream is being discarded anyway */ }
            streamIdRef.current = null;
        }
        if (streamUnlistenRef.current) {
            streamUnlistenRef.current();
            streamUnlistenRef.current = null;
        }
        setStreaming(false);
    }, []);

    // Start a live stream for the current log path
    const startStream = useCallback(async (path) => {
        await stopStream();
        const sid = `logstream-${Date.now()}`;
        streamIdRef.current = sid;
        setStreaming(true);

        // Listen for stream data
        const unlisten = await listen(`log-stream:${sid}`, (event) => {
            const data = event.payload;
            if (data === '__EOF__') {
                setStreaming(false);
                return;
            }
            const newLines = data.split('\n').filter(l => l.length > 0);
            if (newLines.length > 0) {
                setLines(prev => {
                    const combined = [...prev, ...newLines];
                    return combined.length > MAX_STREAM_LINES
                        ? combined.slice(-MAX_STREAM_LINES)
                        : combined;
                });
            }
        });
        streamUnlistenRef.current = unlisten;

        try {
            await invoke('start_log_stream', {
                sessionId: MAIN_SESSION_ID,
                streamId: sid,
                logPath: path,
                ip, user,
                port: port || 22,
                password: password || null,
                privateKey: privateKey || null,
                proxyJump: proxyJump || null,
                // For a saved profile, credentials are resolved server-side
                // from the keyring — the password never lives in the UI.
                profileId: profileId || null,
            });
        } catch (err) {
            setLines(prev => [...prev, `Stream error: ${err}`]);
            setStreaming(false);
        }
    }, [ip, user, port, password, privateKey, proxyJump, profileId, stopStream]);

    // Cleanup stream on unmount or path change
    useEffect(() => {
        return () => { stopStream(); };
    }, [stopStream]);

    const fetchLog = useCallback(async (path, count) => {
        setLoading(true);
        try {
            // No `2>/dev/null || echo` masking here: a real failure (permission
            // denied on a root-only log) must reach the backend so its sudo
            // auto-fallback can re-run the read elevated. Masking it to exit 0
            // would make the backend think the read succeeded.
            const command = path === '__journalctl__'
                ? `journalctl -n ${count} --no-pager`
                : `tail -n ${count} ${path}`;
            const output = await invoke('exec_ssh_command', {
                sessionId: MAIN_SESSION_ID,
                command
            });
            const newLines = output.split('\n').filter(l => l.trim());
            if (paused) {
                pausedLinesRef.current = newLines;
            } else {
                setLines(newLines);
            }
        } catch (err) {
            // The backend already tried to elevate this read; what reaches here
            // is why that could not happen.
            setLines([formatRemoteError(err, `Reading ${path}`)]);
        } finally {
            setLoading(false);
        }
    }, [paused]);

    useEffect(() => {
        if (!streaming) {
            fetchLog(logPath, lineCount);
        }
    }, [logPath, lineCount, fetchLog, streaming]);

    useEffect(() => {
        if (autoScroll && listRef.current && !paused) {
            listRef.current.scrollTop = listRef.current.scrollHeight;
        }
    }, [lines, autoScroll, paused]);

    useEffect(() => {
        localStorage.setItem(storageKey, JSON.stringify(customTabs));
    }, [customTabs, storageKey]);

    const handleRefresh = () => {
        setPaused(false);
        if (streaming) { stopStream(); }
        fetchLog(logPath, lineCount);
    };

    const handleToggleStream = () => {
        if (streaming) {
            stopStream();
            fetchLog(logPath, lineCount);
        } else {
            startStream(logPath);
        }
    };

    const handlePause = () => {
        setPaused(!paused);
        if (paused && pausedLinesRef.current.length > 0) {
            setLines(pausedLinesRef.current);
            pausedLinesRef.current = [];
        }
    };

    const handlePresetClick = (preset) => {
        setLogPath(preset.path);
        setCustomPath('');
    };

    const addCustomTab = (path) => {
        const label = path.split('/').filter(Boolean).pop() || path;
        setCustomTabs(prev => {
            if (prev.some(t => t.path === path)) return prev;
            return [...prev, { label, path }];
        });
        setLogPath(path);
        setCustomPath('');
    };

    const handleCustomSubmit = () => {
        if (customPath.trim()) addCustomTab(customPath.trim());
    };

    const handlePickerSelect = (path) => {
        setShowPicker(false);
        addCustomTab(path);
    };

    const removeCustomTab = (path) => {
        setCustomTabs(prev => prev.filter(t => t.path !== path));
        if (logPath === path) setLogPath(LOG_PRESETS[0].path);
    };

    const handleAnalyzeLogs = async () => {
        if (lines.length === 0) return;

        setAiAnalysis({ text: '', loading: true, error: null });

        // Grab the last 50 lines (or filtered lines) to not overwhelm context
        const contextLines = (filter ? filtered : lines).slice(-50).join('\n');

        const prompt = `You are a DevOps expert. Analyze these server logs and identify any issues, warnings, or anomalies. Provide a concise summary and, if applicable, a fix.
        
Logs:
${contextLines}`;

        const messages = [{ role: 'user', content: prompt }];

        let unlistenChunk;
        let unlistenDone;

        try {
            unlistenChunk = await listen("ai-stream-chunk", (event) => {
                setAiAnalysis(prev => ({ ...prev, text: prev.text + event.payload, loading: false }));
            });

            unlistenDone = await listen("ai-response-done", () => {
                setAiAnalysis(prev => ({ ...prev, loading: false }));
                if (unlistenChunk) unlistenChunk();
                if (unlistenDone) unlistenDone();
            });

            await invoke("stream_ai_chat", { messages });
        } catch (err) {
            setAiAnalysis({ text: '', loading: false, error: err.message || String(err) });
            if (unlistenChunk) unlistenChunk();
            if (unlistenDone) unlistenDone();
        }
    };

    const filtered = lines.filter(l => {
        if (!filter) return true;
        return l.toLowerCase().includes(filter.toLowerCase());
    });

    return (
        <div className="lv-container">
            <div className="lv-header">
                <div className="lv-title-row">
                    <ScrollText size={20} className="lv-icon" />
                    <h2 className="lv-title">Log Viewer</h2>
                    <span className="lv-count">{filtered.length} lines</span>
                </div>

                <div className="lv-presets">
                    {LOG_PRESETS.map(preset => (
                        <button
                            key={preset.path}
                            className={`lv-preset-btn ${logPath === preset.path ? 'active' : ''}`}
                            onClick={() => handlePresetClick(preset)}
                        >
                            {preset.label}
                        </button>
                    ))}
                    {customTabs.map(tab => (
                        <span key={tab.path} className={`lv-preset-btn lv-custom-tab ${logPath === tab.path ? 'active' : ''}`}>
                            <button
                                className="lv-custom-tab-label"
                                onClick={() => { setLogPath(tab.path); setCustomPath(''); }}
                                title={tab.path}
                            >
                                {tab.label}
                            </button>
                            <button
                                className="lv-custom-tab-remove"
                                onClick={() => removeCustomTab(tab.path)}
                                title="Remove"
                            >
                                <X size={9} />
                            </button>
                        </span>
                    ))}
                </div>

                <div className="lv-toolbar">
                    <div className="lv-custom-path">
                        <input
                            placeholder="Custom log path..."
                            value={customPath}
                            onChange={e => setCustomPath(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleCustomSubmit()}
                        />
                        <button className="lv-browse-btn" onClick={() => setShowPicker(true)} title="Browse remote filesystem">
                            <FolderOpen size={13} />
                        </button>
                        <button onClick={handleCustomSubmit} disabled={!customPath.trim()}>Go</button>
                    </div>
                    <div className="lv-filter">
                        <Search size={14} />
                        <input
                            placeholder="Filter lines..."
                            value={filter}
                            onChange={e => setFilter(e.target.value)}
                        />
                        {filter && <button className="lv-clear" onClick={() => setFilter('')}><X size={12} /></button>}
                    </div>
                    <select className="lv-line-select" value={lineCount} onChange={e => setLineCount(Number(e.target.value))}>
                        <option value={50}>50 lines</option>
                        <option value={100}>100 lines</option>
                        <option value={250}>250 lines</option>
                        <option value={500}>500 lines</option>
                        <option value={1000}>1000 lines</option>
                    </select>
                    <button
                        className={`lv-btn lv-stream-btn ${streaming ? 'streaming' : ''}`}
                        onClick={handleToggleStream}
                        title={streaming ? 'Stop Live Stream (tail -f)' : 'Start Live Stream (tail -f)'}
                    >
                        {streaming ? <Square size={14} /> : <Radio size={14} />}
                    </button>
                    <button className={`lv-btn ${paused ? 'active' : ''}`} onClick={handlePause} title={paused ? 'Resume' : 'Pause'}>
                        {paused ? <Play size={14} /> : <Pause size={14} />}
                    </button>
                    <button className="lv-btn" onClick={() => setLines([])} title="Clear">
                        <Trash2 size={14} />
                    </button>
                    <button className="lv-btn ai-btn" onClick={handleAnalyzeLogs} disabled={loading || lines.length === 0} title="AI Analyze">
                        <Bot size={14} /> Analyze
                    </button>
                    <button className="lv-btn" onClick={handleRefresh} disabled={loading} title="Refresh">
                        <RefreshCw size={14} className={loading ? 'spin' : ''} />
                    </button>
                </div>
            </div>

            {aiAnalysis !== null && (
                <div className="lv-ai-panel">
                    <div className="lv-ai-header">
                        <div className="lv-ai-title">
                            <Bot size={16} className="lv-icon" /> AI Log Analysis
                        </div>
                        <button className="lv-ai-close" onClick={() => setAiAnalysis(null)}><X size={14} /></button>
                    </div>
                    <div className="lv-ai-body">
                        {aiAnalysis.loading && !aiAnalysis.text && (
                            <div className="lv-ai-loading"><Loader2 size={16} className="spin" /> Analyzing logs...</div>
                        )}
                        {aiAnalysis.error && (
                            <div className="lv-ai-error">Error: {aiAnalysis.error}</div>
                        )}
                        {aiAnalysis.text && (
                            <div className="lv-ai-text">{aiAnalysis.text}</div>
                        )}
                    </div>
                </div>
            )}

            <div className="lv-log" ref={listRef}>
                {filtered.map((line, i) => {
                    const cls = classifyLine(line);
                    return (
                        <div key={i} className={`lv-line ${cls}`}>
                            <span className="lv-line-num">{i + 1}</span>
                            <span className="lv-line-text">{line}</span>
                        </div>
                    );
                })}
                {filtered.length === 0 && !loading && (
                    <div className="lv-empty">No log lines to display</div>
                )}
            </div>

            <div className="lv-status">
                <span className="lv-path-display">{logPath === '__journalctl__' ? 'journalctl' : logPath}</span>
                {streaming && <span className="lv-stream-badge">STREAMING</span>}
                <span className={`lv-status-dot ${streaming ? 'streaming' : paused ? 'paused' : 'live'}`} />
                <span>{streaming ? 'tail -f' : paused ? 'Paused' : 'Polling'}</span>
            </div>

            {showPicker && (
                <RemoteFilePicker
                    onSelect={handlePickerSelect}
                    onClose={() => setShowPicker(false)}
                />
            )}
        </div>
    );
}
