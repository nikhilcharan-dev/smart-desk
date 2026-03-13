import { useState, useEffect, useRef, useMemo } from 'react';
import {
    LayoutDashboard, FolderOpen, Terminal, Monitor,
    Settings, LogOut, Cpu, Network, ScrollText, Code2, Command
} from 'lucide-react';
import './CommandPalette.css';

const ACTIONS = [
    // Navigation
    { id: 'nav-dashboard', name: 'Dashboard', desc: 'System overview & stats', icon: LayoutDashboard, group: 'Navigate', action: 'setView', value: 'dashboard' },
    { id: 'nav-files', name: 'File Explorer', desc: 'Browse local & remote files', icon: FolderOpen, group: 'Navigate', action: 'setView', value: 'files' },
    { id: 'nav-terminal', name: 'Smart Terminal', desc: 'AI-powered terminal', icon: Terminal, group: 'Navigate', action: 'setView', value: 'terminal' },
    { id: 'nav-termhub', name: 'TermHub', desc: 'Multi-server terminals', icon: Monitor, group: 'Navigate', action: 'setView', value: 'termhub' },
    { id: 'nav-processes', name: 'Process Manager', desc: 'View & kill remote processes', icon: Cpu, group: 'Navigate', action: 'setView', value: 'processes' },
    { id: 'nav-ports', name: 'Port Scanner', desc: 'Discover open ports', icon: Network, group: 'Navigate', action: 'setView', value: 'ports' },
    { id: 'nav-logs', name: 'Log Viewer', desc: 'Tail remote log files', icon: ScrollText, group: 'Navigate', action: 'setView', value: 'logs' },
    { id: 'nav-snippets', name: 'Snippets', desc: 'Saved command snippets', icon: Code2, group: 'Navigate', action: 'setView', value: 'snippets' },
    { id: 'nav-settings', name: 'Settings', desc: 'Configure app, AI & sidebar', icon: Settings, group: 'Navigate', action: 'setView', value: 'settings' },
    // Actions
    { id: 'act-disconnect', name: 'Disconnect', desc: 'Close SSH session', icon: LogOut, group: 'Actions', action: 'disconnect' },
];

export default function CommandPalette({ isOpen, onClose, onAction }) {
    const [query, setQuery] = useState('');
    const [activeIndex, setActiveIndex] = useState(0);
    const inputRef = useRef(null);
    const listRef = useRef(null);

    useEffect(() => {
        if (isOpen) {
            setQuery('');
            setActiveIndex(0);
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [isOpen]);

    const filtered = useMemo(() => {
        if (!query.trim()) return ACTIONS;
        const q = query.toLowerCase();
        return ACTIONS.filter(a =>
            a.name.toLowerCase().includes(q) ||
            a.desc.toLowerCase().includes(q) ||
            a.group.toLowerCase().includes(q)
        );
    }, [query]);

    // Group filtered items
    const grouped = useMemo(() => {
        const groups = {};
        filtered.forEach(item => {
            if (!groups[item.group]) groups[item.group] = [];
            groups[item.group].push(item);
        });
        return groups;
    }, [filtered]);

    const flatItems = filtered;

    useEffect(() => {
        if (activeIndex >= flatItems.length) setActiveIndex(Math.max(0, flatItems.length - 1));
    }, [flatItems.length, activeIndex]);

    // Scroll active item into view
    useEffect(() => {
        const activeEl = listRef.current?.querySelector('.cmd-item.active');
        if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
    }, [activeIndex]);

    const executeItem = (item) => {
        onClose();
        if (item.action === 'setView') {
            onAction('setView', item.value);
        } else if (item.action === 'disconnect') {
            onAction('disconnect');
        }
    };

    const handleKeyDown = (e) => {
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setActiveIndex(prev => Math.min(prev + 1, flatItems.length - 1));
                break;
            case 'ArrowUp':
                e.preventDefault();
                setActiveIndex(prev => Math.max(prev - 1, 0));
                break;
            case 'Enter':
                e.preventDefault();
                if (flatItems[activeIndex]) executeItem(flatItems[activeIndex]);
                break;
            case 'Escape':
                e.preventDefault();
                onClose();
                break;
            default:
                break;
        }
    };

    if (!isOpen) return null;

    let itemIdx = 0;

    return (
        <div className="cmd-palette-overlay" onClick={onClose}>
            <div className="cmd-palette" onClick={e => e.stopPropagation()} onKeyDown={handleKeyDown}>
                <div className="cmd-search-bar">
                    <Command size={18} />
                    <input
                        ref={inputRef}
                        className="cmd-search-input"
                        placeholder="Type a command or search..."
                        value={query}
                        onChange={e => { setQuery(e.target.value); setActiveIndex(0); }}
                        autoFocus
                    />
                    <span className="cmd-kbd">ESC</span>
                </div>

                <div className="cmd-results" ref={listRef}>
                    {flatItems.length === 0 && (
                        <div className="cmd-empty">No results for "{query}"</div>
                    )}

                    {Object.entries(grouped).map(([group, items]) => (
                        <div key={group}>
                            <div className="cmd-group-label">{group}</div>
                            {items.map(item => {
                                const thisIdx = itemIdx++;
                                const Icon = item.icon;
                                return (
                                    <div
                                        key={item.id}
                                        className={`cmd-item ${thisIdx === activeIndex ? 'active' : ''}`}
                                        onClick={() => executeItem(item)}
                                        onMouseEnter={() => setActiveIndex(thisIdx)}
                                    >
                                        <div className="cmd-item-icon"><Icon size={16} /></div>
                                        <div className="cmd-item-text">
                                            <span className="cmd-item-name">{item.name}</span>
                                            <span className="cmd-item-desc">{item.desc}</span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>

                <div className="cmd-footer">
                    <span className="cmd-footer-hint"><kbd>↑↓</kbd> Navigate</span>
                    <span className="cmd-footer-hint"><kbd>↵</kbd> Select</span>
                    <span className="cmd-footer-hint"><kbd>Esc</kbd> Close</span>
                </div>
            </div>
        </div>
    );
}
