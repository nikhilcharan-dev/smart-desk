import React, { useState, useEffect } from "react";
import Editor from "@monaco-editor/react";
import { X, Save, FileText, Loader2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { MAIN_SESSION_ID } from "../../utils/terminal";
import "./FileEditor.css";

export default function FileEditor({ file, mode, onClose, onSaveSuccess }) {
    const [content, setContent] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const [language, setLanguage] = useState("plaintext");

    useEffect(() => {
        const detectLanguage = (filename) => {
            const ext = filename.split('.').pop().toLowerCase();
            const map = {
                'js': 'javascript',
                'jsx': 'javascript',
                'ts': 'typescript',
                'tsx': 'typescript',
                'json': 'json',
                'html': 'html',
                'css': 'css',
                'md': 'markdown',
                'py': 'python',
                'rs': 'rust',
                'sh': 'shell',
                'env': 'shell',
                'conf': 'ini',
                'yaml': 'yaml',
                'yml': 'yaml',
                'xml': 'xml'
            };
            return map[ext] || "plaintext";
        };

        const loadFile = async () => {
            setLoading(true);
            setError(null);
            
            // Set a safety timeout to prevent infinite loading
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error("Request timed out (30s). The file might be too large or the connection is slow.")), 30000)
            );

            try {
                const command = mode === 'sftp' ? "sftp_read" : "local_read_file";
                const args = mode === 'sftp' ? { sessionId: MAIN_SESSION_ID, path: file.path } : { path: file.path };
                
                console.log(`[FileEditor] Loading ${file.path} via ${command}...`);
                
                // Race between the invoke and the timeout
                const bytes = await Promise.race([
                    invoke(command, args),
                    timeoutPromise
                ]);

                if (!bytes) {
                    throw new Error("No data received from file");
                }

                console.log(`[FileEditor] Received ${bytes.length} bytes for ${file.name}`);
                
                // Safety check for binary files or very large files
                if (bytes.length > 5 * 1024 * 1024) {
                    throw new Error("File is too large (>5MB) to open in the editor.");
                }

                const text = new TextDecoder().decode(new Uint8Array(bytes));
                setContent(text);
                setLanguage(detectLanguage(file.name));
            } catch (err) {
                console.error("Failed to load file:", err);
                setError(err.message || err.toString());
            } finally {
                setLoading(false);
            }
        };

        loadFile();
    }, [file.path, file.name, mode]);

    const handleSave = async (useSudo = false) => {
        setSaving(true);
        setError(null);
        try {
            const bytes = new TextEncoder().encode(content);
            let command = mode === 'sftp' ? "sftp_write" : "local_write_file";

            if (useSudo && mode === 'sftp') {
                command = "sftp_write_sudo";
            }

            // For SFTP write, the backend expects 'content' as Vec<u8>
            const args = mode === 'sftp'
                ? { sessionId: MAIN_SESSION_ID, path: file.path, content: Array.from(bytes) }
                : { path: file.path, content: Array.from(bytes) };

            await invoke(command, args);
            if (onSaveSuccess) onSaveSuccess();
            onClose();
        } catch (err) {
            console.error("Failed to save file:", err);
            const errMsg = String(err);

            // Check for permission error
            if (mode === 'sftp' && !useSudo && (errMsg.includes("Permission denied") || errMsg.includes("code: 3") || errMsg.includes("access"))) {
                if (confirm(`Permission denied. Try saving with Sudo (root)?`)) {
                    // Retry with sudo
                    await handleSave(true);
                    return; // Exit current execution, handleSave(true) handles the rest
                }
            }

            setError(errMsg);
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
                            onClick={handleSave}
                            disabled={loading || saving}
                        >
                            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                            Save
                        </button>
                        <button className="close-btn" onClick={onClose}>
                            <X size={20} />
                        </button>
                    </div>
                </div>

                <div className="file-editor-body">
                    {loading ? (
                        <div className="editor-loading">
                            <Loader2 size={40} className="animate-spin text-blue-500" />
                            <p>Loading {file.name}...</p>
                        </div>
                    ) : error ? (
                        <div className="editor-error">
                            <h3>Failed to load file</h3>
                            <p>{error}</p>
                            <button onClick={onClose}>Close</button>
                        </div>
                    ) : (
                        <Editor
                            height="100%"
                            theme="vs-dark"
                            language={language}
                            value={content}
                            onChange={(value) => setContent(value || "")}
                            options={{
                                fontSize: 14,
                                minimap: { enabled: true },
                                scrollBeyondLastLine: false,
                                automaticLayout: true,
                                padding: { top: 10, bottom: 10 }
                            }}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}
