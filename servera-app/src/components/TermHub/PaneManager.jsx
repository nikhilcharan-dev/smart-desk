import React, { useState } from 'react';
import { X, LayoutGrid, Rows } from 'lucide-react';
import './PaneManager.css';
import TerminalPane from './TerminalPane';

function getGridCols(count) {
    if (count <= 1) return 1;
    if (count === 2) return 2;
    if (count <= 4) return 2;
    return 3;
}

export default function PaneManager({ panes, setPanes, activePaneId, setActivePaneId, onDisconnect }) {
    const [viewMode, setViewMode] = useState('grid'); // 'grid' | 'tabs'

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

    const cols = getGridCols(panes.length);

    return (
        <div className="pm">
            {/* Toolbar */}
            <div className="pm__toolbar">
                <div className="pm__tab-list">
                    {panes.map(pane => (
                        <button
                            key={pane.id}
                            className={`pm__tab ${activePaneId === pane.id ? 'pm__tab--active' : ''}`}
                            onClick={() => {
                                setActivePaneId(pane.id);
                                if (viewMode === 'tabs') setActivePaneId(pane.id);
                            }}
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

                <div className="pm__toolbar-right">
                    <span className="pm__session-count">
                        {panes.length} SESSION{panes.length > 1 ? 'S' : ''}
                    </span>
                    <div className="pm__view-toggle">
                        <button
                            className={`pm__view-btn ${viewMode === 'grid' ? 'pm__view-btn--active' : ''}`}
                            onClick={() => setViewMode('grid')}
                            title="Grid view — all terminals visible"
                        >
                            <LayoutGrid size={13} />
                        </button>
                        <button
                            className={`pm__view-btn ${viewMode === 'tabs' ? 'pm__view-btn--active' : ''}`}
                            onClick={() => setViewMode('tabs')}
                            title="Tab view — one terminal at a time"
                        >
                            <Rows size={13} />
                        </button>
                    </div>
                </div>
            </div>

            {/* Content */}
            {viewMode === 'grid' ? (
                <div
                    className="pm__grid"
                    style={{ '--pm-cols': cols }}
                >
                    {panes.map(pane => (
                        <div
                            key={pane.id}
                            className={`pm__grid-cell ${activePaneId === pane.id ? 'pm__grid-cell--active' : ''}`}
                            onClick={() => setActivePaneId(pane.id)}
                        >
                            <TerminalPane
                                sessionId={pane.sessionId}
                                profile={pane.profile}
                                isActive={activePaneId === pane.id}
                                onFocus={() => setActivePaneId(pane.id)}
                                onClose={() => closePane(pane.id)}
                                showCloseBtn
                            />
                        </div>
                    ))}
                </div>
            ) : (
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
                                onClose={() => closePane(pane.id)}
                            />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
