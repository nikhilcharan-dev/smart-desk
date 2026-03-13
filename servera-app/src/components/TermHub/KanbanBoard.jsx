import React from 'react';
import { Server, Wifi, WifiOff, Loader2, AlertTriangle, Clock, Tag, Plug, Unplug } from 'lucide-react';
import './KanbanBoard.css';

export default function ServerGrid({ profiles, connectionStates, onConnect, onDisconnect }) {
    const getStatus = (id) => connectionStates[id] || 'idle';

    if (profiles.length === 0) {
        return (
            <div className="sg-empty">
                <Server size={32} strokeWidth={1.5} />
                <p>No server profiles found</p>
                <span>Create a profile from the connection page to get started</span>
            </div>
        );
    }

    return (
        <div className="sg-grid">
            {profiles.map(profile => (
                <ServerCard
                    key={profile.id}
                    profile={profile}
                    status={getStatus(profile.id)}
                    onConnect={() => onConnect(profile)}
                    onDisconnect={() => onDisconnect(profile.id)}
                />
            ))}
        </div>
    );
}

function ServerCard({ profile, status, onConnect, onDisconnect }) {
    const isClickable = status === 'idle' || status === 'failed';

    const statusConfig = {
        idle: { icon: <Plug size={13} />, label: 'Connect', className: 'idle' },
        connecting: { icon: <Loader2 size={13} className="sg-spin" />, label: 'Connecting...', className: 'connecting' },
        connected: { icon: <Wifi size={13} />, label: 'Connected', className: 'connected' },
        failed: { icon: <AlertTriangle size={13} />, label: 'Retry', className: 'failed' },
    };

    const cfg = statusConfig[status] || statusConfig.idle;

    return (
        <div
            className={`sg-card sg-card--${cfg.className}`}
            onClick={isClickable ? onConnect : undefined}
            role={isClickable ? 'button' : undefined}
            tabIndex={isClickable ? 0 : undefined}
        >
            {/* Status Indicator Dot */}
            <div className={`sg-card__indicator sg-card__indicator--${status}`} />

            {/* Avatar + Info */}
            <div className="sg-card__main">
                <div
                    className="sg-card__avatar"
                    style={{ background: profile.color || 'linear-gradient(135deg, #3b82f6, #8b5cf6)' }}
                >
                    {profile.name.charAt(0).toUpperCase()}
                </div>
                <div className="sg-card__info">
                    <div className="sg-card__name">{profile.name}</div>
                    <div className="sg-card__host">
                        {profile.user}@{profile.ip}
                    </div>
                </div>
            </div>

            {/* Tags */}
            {profile.tags && profile.tags.length > 0 && (
                <div className="sg-card__tags">
                    {profile.tags.slice(0, 3).map(tag => (
                        <span key={tag} className="sg-card__tag">
                            <Tag size={9} /> {tag}
                        </span>
                    ))}
                </div>
            )}

            {/* Footer */}
            <div className="sg-card__footer">
                <div className="sg-card__meta">
                    <Clock size={11} />
                    <span>
                        {profile.last_connected
                            ? new Date(profile.last_connected).toLocaleDateString()
                            : 'Never connected'}
                    </span>
                </div>

                {status === 'connected' ? (
                    <button
                        className="sg-card__action sg-card__action--disconnect"
                        onClick={(e) => { e.stopPropagation(); onDisconnect(); }}
                        title="Disconnect"
                    >
                        <Unplug size={12} />
                    </button>
                ) : (
                    <div className={`sg-card__status sg-card__status--${status}`}>
                        {cfg.icon}
                        <span>{cfg.label}</span>
                    </div>
                )}
            </div>
        </div>
    );
}
