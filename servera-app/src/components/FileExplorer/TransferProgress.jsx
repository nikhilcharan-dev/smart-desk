import { X, CheckCircle, AlertCircle, Loader2, Maximize2, RotateCw } from 'lucide-react';
import { useTransfers } from './TransferContext';
import './FileExplorer.css';

export default function TransferProgress() {
    const { transfers, openManager, clearAll, retry } = useTransfers();

    if (transfers.length === 0) return null;

    const active = transfers.filter(t => t.status === 'uploading' || t.status === 'downloading' || t.status === 'queued').length;
    const failed = transfers.filter(t => t.status === 'error').length;

    return (
        <div className="transfer-overlay">
            <div className="transfer-header">
                <h3>Transfers{active ? ` · ${active}` : ''}{failed ? ` · ${failed} failed` : ''}</h3>
                <div className="transfer-header-actions">
                    <button className="icon-btn-small" title="Expand transfer manager" onClick={openManager}>
                        <Maximize2 size={13} />
                    </button>
                    <button className="icon-btn-small" title="Clear finished" onClick={clearAll}>
                        <X size={14} />
                    </button>
                </div>
            </div>
            <div className="transfer-list">
                {transfers.map(t => (
                    <div key={t.id} className="transfer-item">
                        <div className="transfer-info">
                            <span className="transfer-filename">{t.filename || t.name || "General"}</span>
                            <span className="transfer-status">
                                {(t.status === 'uploading' || t.status === 'downloading') && <Loader2 size={12} className="animate-spin" />}
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
                        {t.details && <div className="transfer-details">{t.details}</div>}
                        {t.error && <div className="transfer-error">{t.error}</div>}
                        {t.status === 'error' && (
                            <button className="transfer-retry-inline" onClick={() => retry(t.id)}>
                                <RotateCw size={11} /> Retry
                            </button>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
