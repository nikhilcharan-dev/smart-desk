import React from 'react';
import { X, Columns, Plus } from 'lucide-react';
import './PaneManager.css';
import TerminalPane from './TerminalPane';

export default function PaneManager({ panes, setPanes, activePaneId, setActivePaneId, onDisconnect }) {

    const closePane = (id) => {
        const pane = panes.find(p => p.id === id);
        if (pane?.profile?.id && onDisconnect) {
            onDisconnect(pane.profile.id);
        }
        const newPanes = panes.filter(p => p.id !== id);
        setPanes(newPanes);
        if (activePaneId === id && newPanes.length > 0) {
            setActivePaneId(newPanes[newPanes.length - 1].id);
        } else if (newPanes.length === 0) {
            setActivePaneId(null);
        }
    };

    if (panes.length === 0) return null;

    return (
        <div className="pm">
            {/* Tab Bar */}
            <div className="pm__tabs">
                <div className="pm__tab-list">
                    {panes.map(pane => (
                        <button
                            key={pane.id}
                            className={`pm__tab ${activePaneId === pane.id ? 'pm__tab--active' : ''}`}
                            onClick={() => setActivePaneId(pane.id)}
                        >
                            <span className="pm__tab-dot" />
                            <span className="pm__tab-label">
                                {pane.profile ? pane.profile.name : 'Terminal'}
                            </span>
                            <span
                                className="pm__tab-close"
                                onClick={(e) => { e.stopPropagation(); closePane(pane.id); }}
                                title="Close session"
                            >
                                <X size={11} />
                            </span>
                        </button>
                    ))}
                </div>
                <div className="pm__tab-meta">
                    {panes.length} session{panes.length > 1 ? 's' : ''}
                </div>
            </div>

            {/* Terminal Content */}
            <div className="pm__content">
                {panes.map(pane => (
                    <div
                        key={pane.id}
                        className="pm__pane"
                        style={{ display: activePaneId === pane.id ? 'flex' : 'none' }}
                    >
                        <TerminalPane
                            sessionId={pane.sessionId}
                            profile={pane.profile}
                            isActive={activePaneId === pane.id}
                            onFocus={() => setActivePaneId(pane.id)}
                        />
                    </div>
                ))}
            </div>
        </div>
    );
}
