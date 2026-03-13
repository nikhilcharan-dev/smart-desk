import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { MAIN_SESSION_ID } from '../../utils/terminal';
import { ScrollText, RefreshCw, Search, X, Pause, Play, Trash2, Download, Bot, Loader2 } from 'lucide-react';
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

export default function LogViewer() {
    const [lines, setLines] = useState([]);
    const [loading, setLoading] = useState(false);
    const [logPath, setLogPath] = useState('/var/log/syslog');
    const [customPath, setCustomPath] = useState('');
    const [lineCount, setLineCount] = useState(100);
    const [filter, setFilter] = useState('');
    const [autoScroll] = useState(true);
    const [paused, setPaused] = useState(false);
    const [aiAnalysis, setAiAnalysis] = useState(null); // { text: '', loading: false, error: null }
    const listRef = useRef(null);
    const pausedLinesRef = useRef([]);

    const fetchLog = useCallback(async (path, count) => {
        setLoading(true);
        try {
            let command;
            if (path === '__journalctl__') {
                command = `journalctl -n ${count} --no-pager 2>/dev/null || echo "journalctl not available"`;
            } else {
                command = `tail -n ${count} ${path} 2>/dev/null || echo "Cannot read ${path}"`;
            }
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
            setLines([`Error: ${err}`]);
        } finally {
            setLoading(false);
        }
    }, [paused]);

    useEffect(() => {
        fetchLog(logPath, lineCount);
    }, [logPath, lineCount, fetchLog]);

    useEffect(() => {
        if (autoScroll && listRef.current && !paused) {
            listRef.current.scrollTop = listRef.current.scrollHeight;
        }
    }, [lines, autoScroll, paused]);

    const handleRefresh = () => {
        setPaused(false);
        fetchLog(logPath, lineCount);
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

    const handleCustomSubmit = () => {
        if (customPath.trim()) {
            setLogPath(customPath.trim());
        }
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
                </div>

                <div className="lv-toolbar">
                    <div className="lv-custom-path">
                        <input
                            placeholder="Custom log path..."
                            value={customPath}
                            onChange={e => setCustomPath(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleCustomSubmit()}
                        />
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
                <span className={`lv-status-dot ${paused ? 'paused' : 'live'}`} />
                <span>{paused ? 'Paused' : 'Live'}</span>
            </div>
        </div>
    );
}
