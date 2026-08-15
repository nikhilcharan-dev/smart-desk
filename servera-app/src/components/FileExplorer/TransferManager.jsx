import { X, CheckCircle, AlertCircle, Loader2, RotateCw, Trash2, Upload, Download, ArrowRight } from 'lucide-react';
import { useTransfers } from './TransferContext';
import './FileExplorer.css';

const isActive = (s) => s === 'uploading' || s === 'downloading' || s === 'queued';

function StatusBadge({ status }) {
    if (isActive(status)) return <span className="tm-badge tm-badge-active"><Loader2 size={12} className="animate-spin" /> {status}</span>;
    if (status === 'finished') return <span className="tm-badge tm-badge-done"><CheckCircle size={12} /> completed</span>;
    if (status === 'error') return <span className="tm-badge tm-badge-error"><AlertCircle size={12} /> failed</span>;
    return <span className="tm-badge">{status}</span>;
}

export default function TransferManager() {
    const { managerOpen, closeManager, transfers, retry, retryAllFailed, remove, clearFinished } = useTransfers();

    if (!managerOpen) return null;

    const active = transfers.filter(t => isActive(t.status)).length;
    const done = transfers.filter(t => t.status === 'finished').length;
    const failed = transfers.filter(t => t.status === 'error').length;

    return (
        <div className="tm-backdrop" onClick={closeManager}>
            <div className="tm-panel" onClick={e => e.stopPropagation()}>
                <div className="tm-header">
                    <div className="tm-title-row">
                        <h2 className="tm-title">File Transfers</h2>
                        <div className="tm-stats">
                            <span className="tm-stat">{active} active</span>
                            <span className="tm-stat tm-stat-done">{done} completed</span>
                            <span className="tm-stat tm-stat-error">{failed} failed</span>
                        </div>
                    </div>
                    <div className="tm-header-actions">
                        <button className="tm-btn" onClick={retryAllFailed} disabled={!failed}>
                            <RotateCw size={13} /> Retry failed
                        </button>
                        <button className="tm-btn" onClick={clearFinished} disabled={!done && !failed}>
                            <Trash2 size={13} /> Clear finished
                        </button>
                        <button className="icon-btn-small" title="Close" onClick={closeManager}>
                            <X size={16} />
                        </button>
                    </div>
                </div>

                <div className="tm-list">
                    {transfers.length === 0 && (
                        <div className="tm-empty">No transfers yet. Drag files between panes to copy them.</div>
                    )}
                    {transfers.map(t => (
                        <div key={t.id} className="tm-row">
                            <div className="tm-dir" title={t.kind}>
                                {t.kind === 'upload' ? <Upload size={16} /> : <Download size={16} />}
                            </div>
                            <div className="tm-main">
                                <div className="tm-name-row">
                                    <span className="tm-name">{t.filename || t.name}</span>
                                    <StatusBadge status={t.status} />
                                </div>
                                <div className="tm-path mono">
                                    <span className="tm-path-seg" title={t.src}>{t.src}</span>
                                    <ArrowRight size={11} className="tm-arrow" />
                                    <span className="tm-path-seg" title={t.dest}>{t.dest}</span>
                                </div>
                                <div className="tm-progress-track">
                                    <div className={`tm-progress-fill ${t.status}`} style={{ width: `${(t.progress || 0) * 100}%` }}></div>
                                </div>
                                {t.details && <div className="tm-details">{t.details}</div>}
                                {t.error && <div className="tm-error" title={t.error}>{t.error}</div>}
                            </div>
                            <div className="tm-row-actions">
                                {t.status === 'error' && (
                                    <button className="icon-btn-small" title="Retry" onClick={() => retry(t.id)}>
                                        <RotateCw size={15} />
                                    </button>
                                )}
                                <button className="icon-btn-small tm-del" title="Remove from list" onClick={() => remove(t.id)} disabled={isActive(t.status)}>
                                    <Trash2 size={15} />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
