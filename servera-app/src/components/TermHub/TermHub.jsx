import React, { useState, useEffect, useCallback } from 'react';
import { invoke } from "@tauri-apps/api/core";
import { Maximize2, Minimize2, Plus, Search, Server, Wifi, WifiOff, RefreshCw } from 'lucide-react';
import './TermHub.css';
import ServerGrid from './KanbanBoard';
import PaneManager from './PaneManager';

export default function TermHub() {
    const [isFocusMode, setIsFocusMode] = useState(false);
    const [profiles, setProfiles] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [connectionStates, setConnectionStates] = useState({});
    const [panes, setPanes] = useState([]);
    const [activePaneId, setActivePaneId] = useState(null);

    const loadProfiles = useCallback(async () => {
        try {
            const data = await invoke("load_profiles");
            setProfiles(data);
        } catch (err) {
            console.error("Failed to load profiles:", err);
        }
    }, []);

    useEffect(() => {
        let cancelled = false;
        invoke("load_profiles")
            .then(data => { if (!cancelled) setProfiles(data); })
            .catch(err => console.error("Failed to load profiles:", err));
        return () => { cancelled = true; };
    }, []);

    const handleConnect = async (profile) => {
        setConnectionStates(prev => ({ ...prev, [profile.id]: 'connecting' }));
        try {
            const sessionId = `term-${profile.id}`;
            await invoke("connect_to_profile", {
                profileId: profile.id,
                sessionId: sessionId
            });
            setConnectionStates(prev => ({ ...prev, [profile.id]: 'connected' }));

            const newPaneId = `pane-${Math.random().toString(36).substr(2, 9)}`;
            setPanes(prev => [...prev, { id: newPaneId, sessionId, profile }]);
            setActivePaneId(newPaneId);
        } catch (err) {
            console.error("Connection failed:", err);
            setConnectionStates(prev => ({ ...prev, [profile.id]: 'failed' }));
        }
    };

    const handleDisconnect = (profileId) => {
        setConnectionStates(prev => ({ ...prev, [profileId]: 'idle' }));
        setPanes(prev => prev.filter(p => p.profile?.id !== profileId));
    };

    const activeCount = Object.values(connectionStates).filter(s => s === 'connected').length;
    const totalCount = profiles.length;

    const filteredProfiles = profiles.filter(p =>
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.ip?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.user?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className={`termhub ${isFocusMode ? 'termhub--focus' : ''}`}>
            {/* Header */}
            {!isFocusMode && (
                <header className="termhub__header">
                    <div className="termhub__header-left">
                        <div className="termhub__title-group">
                            <h2 className="termhub__title">TermHub</h2>
                            <div className="termhub__stats">
                                <span className="termhub__stat">
                                    <Wifi size={12} />
                                    <span>{activeCount} active</span>
                                </span>
                                <span className="termhub__stat-divider">·</span>
                                <span className="termhub__stat muted">
                                    <Server size={12} />
                                    <span>{totalCount} servers</span>
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="termhub__header-center">
                        <div className="termhub__search">
                            <Search size={14} className="termhub__search-icon" />
                            <input
                                className="termhub__search-input"
                                placeholder="Search servers..."
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="termhub__header-right">
                        <button
                            className="termhub__btn termhub__btn--ghost"
                            onClick={loadProfiles}
                            title="Refresh profiles"
                        >
                            <RefreshCw size={14} />
                        </button>
                        <button
                            className="termhub__btn termhub__btn--ghost"
                            onClick={() => setIsFocusMode(true)}
                        >
                            <Maximize2 size={14} />
                        </button>
                    </div>
                </header>
            )}

            {/* Main Content */}
            <div className="termhub__body">
                {/* Server Cards Grid */}
                <div className={`termhub__servers ${panes.length > 0 ? 'termhub__servers--compact' : ''}`}>
                    <ServerGrid
                        profiles={filteredProfiles}
                        connectionStates={connectionStates}
                        onConnect={handleConnect}
                        onDisconnect={handleDisconnect}
                    />
                </div>

                {/* Active Sessions Panel */}
                {panes.length > 0 && (
                    <div className="termhub__sessions">
                        <PaneManager
                            panes={panes}
                            setPanes={setPanes}
                            activePaneId={activePaneId}
                            setActivePaneId={setActivePaneId}
                            onDisconnect={handleDisconnect}
                        />
                    </div>
                )}
            </div>

            {/* Focus Mode Exit */}
            {isFocusMode && (
                <button className="termhub__exit-focus" onClick={() => setIsFocusMode(false)}>
                    <Minimize2 size={14} /> Exit Focus
                </button>
            )}
        </div>
    );
}
