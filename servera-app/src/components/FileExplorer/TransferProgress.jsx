import { useState, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { X, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import './FileExplorer.css';

export default function TransferProgress() {
    const [transfers, setTransfers] = useState([]);

    useEffect(() => {
        const unlisten = listen('transfer-progress', (event) => {
            const data = event.payload;
            const key = data.root_name || "General";

            setTransfers(prev => {
                const existingIdx = prev.findIndex(t => t.id === key);
                if (existingIdx > -1) {
                    const next = [...prev];
                    // Update existing item
                    next[existingIdx] = {
                        ...next[existingIdx],
                        ...data,
                        // Maintain original filename if the new one is missing (e.g. completion event)
                        filename: data.filename || next[existingIdx].filename
                    };
                    return next;
                }
                // New item
                return [...prev, { ...data, id: key }];
            });

            if (data.status === 'finished' || data.status === 'error') {
                setTimeout(() => {
                    setTransfers(prev => prev.filter(t => t.id !== key));
                }, 4000);
            }
        });

        return () => {
            unlisten.then(f => f());
        };
    }, []);

    if (transfers.length === 0) return null;

    return (
        <div className="transfer-overlay">
            <div className="transfer-header">
                <h3>Transfers</h3>
                <button className="icon-btn-small" onClick={() => setTransfers([])}>
                    <X size={14} />
                </button>
            </div>
            <div className="transfer-list">
                {transfers.map(t => (
                    <div key={t.id} className="transfer-item">
                        <div className="transfer-info">
                            <span className="transfer-filename">{t.filename || "General"}</span>
                            <span className="transfer-status">
                                {t.status === 'uploading' && <Loader2 size={12} className="animate-spin" />}
                                {t.status === 'downloading' && <Loader2 size={12} className="animate-spin" />}
                                {t.status === 'finished' && <CheckCircle size={12} className="text-green-500" />}
                                {t.status === 'error' && <AlertCircle size={12} className="text-red-500" />}
                                <span className="status-text">{t.status}</span>
                            </span>
                        </div>
                        <div className="progress-container">
                            <div
                                className={`progress-bar-fill ${t.status}`}
                                style={{ width: `${(t.progress || 0) * 100}%` }}
                            ></div>
                        </div>
                        <div className="transfer-details">{t.details}</div>
                        {t.error && <div className="transfer-error">{t.error}</div>}
                    </div>
                ))}
            </div>
        </div>
    );
}
