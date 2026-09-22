import React, { useState, useEffect, useRef, useCallback } from "react";
import Editor from "@monaco-editor/react";
import { X, Save, FileText } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { MAIN_SESSION_ID } from "../../utils/terminal";
import { formatRemoteError } from "../../utils/errors";
import "./FileEditor.css";

const PHASES = [
    { label: "Preparing request...", target: 20 },
    { label: "Reading file...",      target: 82 },
    { label: "Decoding content...",  target: 93 },
    { label: "Initializing editor...", target: 100 },
];

function useFileProgress() {
    const [progress, setProgress] = useState(0);
    const [phaseIndex, setPhaseIndex] = useState(0);
    const rafRef = useRef(null);
    const currentRef = useRef(0);
    const targetRef = useRef(0);

    const animateTo = useCallback((target, onDone) => {
        targetRef.current = target;
        const step = () => {
            const diff = targetRef.current - currentRef.current;
            if (diff <= 0.1) {
                currentRef.current = targetRef.current;
                setProgress(Math.round(currentRef.current));
                if (onDone) onDone();
                return;
            }
            // Ease-out: move 8% of remaining distance each frame
            currentRef.current += diff * 0.08;
            setProgress(Math.round(currentRef.current));
            rafRef.current = requestAnimationFrame(step);
        };
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(step);
    }, []);

    const advanceTo = useCallback((phase) => {
        setPhaseIndex(phase);
        animateTo(PHASES[phase].target);
    }, [animateTo]);

    const advanceToWithDone = useCallback((phase, onDone) => {
        setPhaseIndex(phase);
        animateTo(PHASES[phase].target, onDone);
    }, [animateTo]);

    useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

    return { progress, phaseLabel: PHASES[phaseIndex]?.label ?? "", advanceTo, advanceToWithDone };
}

export default function FileEditor({ file, mode, onClose, onSaveSuccess }) {
    const [content, setContent] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const [language, setLanguage] = useState("plaintext");
    const { progress, phaseLabel, advanceTo, advanceToWithDone } = useFileProgress();
    // Original line-ending style of the loaded file — preserved on save so
    // Monaco's platform-default EOL (CRLF on Windows) never gets baked into
    // remote text files that were LF (e.g. Linux configs, shebangs).
    const eolRef = useRef("\n");
    const monacoRef = useRef(null);

    useEffect(() => {
        const detectLanguage = (filename) => {
            const ext = filename.split('.').pop().toLowerCase();
            const map = {
                'js': 'javascript', 'jsx': 'javascript',
                'ts': 'typescript', 'tsx': 'typescript',
                'json': 'json', 'html': 'html', 'css': 'css',
                'md': 'markdown', 'py': 'python', 'rs': 'rust',
                'sh': 'shell', 'env': 'shell', 'conf': 'ini',
                'yaml': 'yaml', 'yml': 'yaml', 'xml': 'xml'
            };
            return map[ext] || "plaintext";
        };

        const loadFile = async () => {
            setLoading(true);
            setError(null);

            // Phase 0 → 20%: preparing
            advanceTo(0);

            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error("Request timed out (30s). The file might be too large or the connection is slow.")), 30000)
            );

            try {
                const command = mode === 'sftp' ? "sftp_read" : "local_read_file";
                const args = mode === 'sftp' ? { sessionId: MAIN_SESSION_ID, path: file.path } : { path: file.path };

                console.log(`[FileEditor] Loading ${file.path} via ${command}...`);

                // Phase 1 → 82%: reading file (animate towards target while invoke runs)
                advanceTo(1);

                const bytes = await Promise.race([invoke(command, args), timeoutPromise]);

                if (!bytes) throw new Error("No data received from file");
                if (bytes.length > 5 * 1024 * 1024) throw new Error("File is too large (>5MB) to open in the editor.");

                console.log(`[FileEditor] Received ${bytes.length} bytes for ${file.name}`);

                // Phase 2 → 93%: decoding
                advanceTo(2);
                const raw = new Uint8Array(bytes);

                // Refuse binary files — TextDecoder silently replaces invalid
                // UTF-8 with U+FFFD, and saving would write that back as
                // different bytes, corrupting the file. A NUL in the first 8KB
                // is a reliable binary signal; a strict decode catches the rest.
                if (raw.subarray(0, 8192).includes(0)) {
                    throw new Error("This looks like a binary file — opening it here would corrupt it.");
                }
                let text;
                try {
                    text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
                } catch {
                    throw new Error("File is not valid UTF-8 — cannot edit safely.");
                }

                eolRef.current = /\r\n/.test(text) ? "\r\n" : "\n";
                setContent(text);
                setLanguage(detectLanguage(file.name));

                // Phase 3 → 100%: animate to completion, then reveal editor
                advanceToWithDone(3, () => setLoading(false));
            } catch (err) {
                console.error("Failed to load file:", err);
                setError(formatRemoteError(err, `Opening ${file.name}`));
                setLoading(false);
            }
        };

        loadFile();
    }, [file.path, file.name, mode]);  // eslint-disable-line react-hooks/exhaustive-deps

    const handleEditorMount = useCallback((editor, monaco) => {
        monacoRef.current = monaco;
        // Pin the model to the file's original EOL — otherwise Monaco's
        // platform default (CRLF on Windows) silently rewrites every line
        // ending on the next edit or save.
        editor.getModel()?.setEOL(
            eolRef.current === "\r\n" ? monaco.editor.EndOfLineSequence.CRLF
                                      : monaco.editor.EndOfLineSequence.LF
        );
    }, []);

    // Saving a root-owned file needs no special handling here: `sftp_write`
    // escalates to sudo on the backend when the plain write is denied, so a
    // failure that reaches this catch is one sudo could not fix either.
    const handleSave = async () => {
        setSaving(true);
        setError(null);
        try {
            // Normalize regardless of what the model did — belt and braces
            // against any path that still mixes line endings.
            const normalized = content.replace(/\r\n|\r|\n/g, eolRef.current);
            const bytes = new TextEncoder().encode(normalized);
            const command = mode === 'sftp' ? "sftp_write" : "local_write_file";

            // For SFTP write, the backend expects 'content' as Vec<u8>
            const args = mode === 'sftp'
                ? { sessionId: MAIN_SESSION_ID, path: file.path, content: Array.from(bytes) }
                : { path: file.path, content: Array.from(bytes) };

            await invoke(command, args);
            if (onSaveSuccess) onSaveSuccess();
            onClose();
        } catch (err) {
            console.error("Failed to save file:", err);
            setError(formatRemoteError(err, `Saving ${file.name}`));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="file-editor-overlay">
            <div className="file-editor-container">
                <div className="file-editor-header">
                    <div className="file-info">
                        <FileText size={18} className="text-blue-400" />
                        <span className="file-name">{file.name}</span>
                        <span className="file-path">{file.path}</span>
                    </div>
                    <div className="header-actions">
                        <button
                            className="save-btn"
                            onClick={() => handleSave()}
                            disabled={loading || saving}
                        >
                            <Save size={16} className={saving ? "save-spin" : ""} />
                            {saving ? "Saving..." : "Save"}
                        </button>
                        <button className="close-btn" onClick={onClose}>
                            <X size={20} />
                        </button>
                    </div>
                </div>

                <div className="file-editor-body">
                    {loading && !error && (
                        <div className="editor-progress-screen">
                            <div className="editor-progress-icon">
                                <FileText size={36} />
                            </div>
                            <div className="editor-progress-filename">{file.name}</div>
                            <div className="editor-progress-bar-wrap">
                                <div
                                    className="editor-progress-bar-fill"
                                    style={{ width: `${progress}%` }}
                                />
                            </div>
                            <div className="editor-progress-meta">
                                <span className="editor-progress-pct">{progress}%</span>
                                <span className="editor-progress-label">{phaseLabel}</span>
                            </div>
                        </div>
                    )}
                    {error && (
                        <div className="editor-error">
                            <h3>Failed to load file</h3>
                            <p>{error}</p>
                            <button onClick={onClose}>Close</button>
                        </div>
                    )}
                    {!loading && !error && (
                        <div style={{ height: '100%' }}>
                            <Editor
                                height="100%"
                                theme="vs-dark"
                                language={language}
                                value={content}
                                path={file.path}
                                onMount={handleEditorMount}
                                onChange={(value) => setContent(value || "")}
                                loading={null}
                                options={{
                                    fontSize: 14,
                                    minimap: { enabled: true },
                                    scrollBeyondLastLine: false,
                                    automaticLayout: true,
                                    padding: { top: 10, bottom: 10 }
                                }}
                            />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
