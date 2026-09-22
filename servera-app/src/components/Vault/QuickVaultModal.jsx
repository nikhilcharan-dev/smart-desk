import { useState, useEffect, useRef, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
    Search, Copy, Check, Eye, EyeOff, KeyRound, Key, Shield,
    Database, Server, Tag, Sparkles, X, Plus, Terminal
} from 'lucide-react';
import './QuickVaultModal.css';

const CATEGORY_META = {
    'all': { label: 'All', icon: Shield, color: 'var(--accent-primary)' },
    'api-key': { label: 'API Keys', icon: KeyRound, color: '#e5c07b' },
    'ssh-key': { label: 'SSH Keys', icon: Terminal, color: '#98c379' },
    'password': { label: 'Passwords', icon: Key, color: '#61afef' },
    'database': { label: 'Database', icon: Database, color: '#c678dd' },
    'server': { label: 'Server & Sudo', icon: Server, color: '#e06c75' },
    'token': { label: 'Tokens', icon: Sparkles, color: '#56b6c2' },
    'note': { label: 'Notes', icon: Tag, color: '#abb2bf' },
};

export default function QuickVaultModal({ isOpen, onClose, onOpenFullVault }) {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(false);
    const [query, setQuery] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('all');
    const [activeIndex, setActiveIndex] = useState(0);
    const [copiedId, setCopiedId] = useState(null);
    const [revealedIds, setRevealedIds] = useState(new Set());
    const inputRef = useRef(null);
    const listRef = useRef(null);

    // Fetch vault items on open
    useEffect(() => {
        if (isOpen) {
            setQuery('');
            setSelectedCategory('all');
            setActiveIndex(0);
            setCopiedId(null);
            setRevealedIds(new Set());
            loadItems();
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [isOpen]);

    const loadItems = async () => {
        setLoading(true);
        try {
            const res = await invoke('vault_load_items');
            setItems(Array.isArray(res) ? res : []);
        } catch (err) {
            console.error('Failed to load vault items:', err);
        } finally {
            setLoading(false);
        }
    };

    // Filter items based on query & category
    const filtered = useMemo(() => {
        let result = items;
        if (selectedCategory !== 'all') {
            result = result.filter(i => (i.category || '').toLowerCase() === selectedCategory);
        }
        if (query.trim()) {
            const q = query.toLowerCase();
            result = result.filter(i =>
                (i.title && i.title.toLowerCase().includes(q)) ||
                (i.account && i.account.toLowerCase().includes(q)) ||
                (i.host && i.host.toLowerCase().includes(q)) ||
                (i.notes && i.notes.toLowerCase().includes(q)) ||
                (Array.isArray(i.tags) && i.tags.some(t => t.toLowerCase().includes(q)))
            );
        }
        // Sort by last_used_at descending, then created_at descending
        return result.sort((a, b) => (b.last_used_at || b.created_at || 0) - (a.last_used_at || a.created_at || 0));
    }, [items, selectedCategory, query]);

    // Bounds check for active index
    useEffect(() => {
        if (activeIndex >= filtered.length) {
            setActiveIndex(Math.max(0, filtered.length - 1));
        }
    }, [filtered.length, activeIndex]);

    // Keep active item in view
    useEffect(() => {
        const activeEl = listRef.current?.querySelector('.qv-item.active');
        if (activeEl) {
            activeEl.scrollIntoView({ block: 'nearest' });
        }
    }, [activeIndex]);

    const handleCopy = async (item, e) => {
        if (e) e.stopPropagation();
        try {
            await navigator.clipboard.writeText(item.secret);
            setCopiedId(item.id);
            invoke('vault_touch_item', { id: item.id }).catch(() => {});
            setTimeout(() => {
                onClose();
            }, 350);
        } catch (err) {
            console.error('Clipboard copy failed:', err);
        }
    };

    const toggleReveal = (id, e) => {
        e.stopPropagation();
        setRevealedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const handleKeyDown = (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIndex(prev => (prev + 1 < filtered.length ? prev + 1 : 0));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIndex(prev => (prev - 1 >= 0 ? prev - 1 : filtered.length - 1));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (filtered[activeIndex]) {
                handleCopy(filtered[activeIndex]);
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
        }
    };

    if (!isOpen) return null;

    return (
        <div className="qv-backdrop" onClick={onClose}>
            <div className="qv-modal" onClick={e => e.stopPropagation()} onKeyDown={handleKeyDown}>
                {/* Search Header */}
                <div className="qv-header">
                    <Search size={18} className="qv-search-icon" />
                    <input
                        ref={inputRef}
                        type="text"
                        className="qv-input"
                        placeholder="Search secrets by name, user, host, or tag... (Press Enter to Copy)"
                        value={query}
                        onChange={e => {
                            setQuery(e.target.value);
                            setActiveIndex(0);
                        }}
                    />
                    <div className="qv-badge-hint">Alt+V</div>
                    <button className="qv-close-btn" onClick={onClose} title="Close (Esc)">
                        <X size={16} />
                    </button>
                </div>

                {/* Category Pills */}
                <div className="qv-categories">
                    {Object.entries(CATEGORY_META).map(([key, meta]) => {
                        const Icon = meta.icon;
                        const isSelected = selectedCategory === key;
                        return (
                            <button
                                key={key}
                                className={`qv-category-pill ${isSelected ? 'active' : ''}`}
                                onClick={() => {
                                    setSelectedCategory(key);
                                    setActiveIndex(0);
                                    inputRef.current?.focus();
                                }}
                            >
                                <Icon size={13} style={{ color: meta.color }} />
                                <span>{meta.label}</span>
                            </button>
                        );
                    })}
                </div>

                {/* Secrets List */}
                <div className="qv-list" ref={listRef}>
                    {loading ? (
                        <div className="qv-empty">Loading secure vault...</div>
                    ) : filtered.length === 0 ? (
                        <div className="qv-empty">
                            <KeyRound size={32} className="qv-empty-icon" />
                            <p className="qv-empty-text">
                                {query ? 'No matching secrets found' : 'Secrets vault is empty'}
                            </p>
                            {onOpenFullVault && (
                                <button
                                    className="qv-add-btn"
                                    onClick={() => {
                                        onClose();
                                        onOpenFullVault();
                                    }}
                                >
                                    <Plus size={14} />
                                    <span>Add New Secret</span>
                                </button>
                            )}
                        </div>
                    ) : (
                        filtered.map((item, idx) => {
                            const isSelected = idx === activeIndex;
                            const isCopied = copiedId === item.id;
                            const isRevealed = revealedIds.has(item.id);
                            const meta = CATEGORY_META[item.category] || CATEGORY_META['api-key'];
                            const Icon = meta.icon;

                            return (
                                <div
                                    key={item.id}
                                    className={`qv-item ${isSelected ? 'active' : ''} ${isCopied ? 'copied' : ''}`}
                                    onClick={() => handleCopy(item)}
                                    onMouseEnter={() => setActiveIndex(idx)}
                                >
                                    <div className="qv-item-icon-wrapper" style={{ color: meta.color }}>
                                        <Icon size={18} />
                                    </div>
                                    <div className="qv-item-info">
                                        <div className="qv-item-title-row">
                                            <span className="qv-item-title">{item.title}</span>
                                            {item.account && (
                                                <span className="qv-item-account">({item.account})</span>
                                            )}
                                            {item.host && (
                                                <span className="qv-item-host">@{item.host}</span>
                                            )}
                                        </div>
                                        <div className="qv-item-secret-row">
                                            <span className="qv-item-secret-preview">
                                                {isRevealed
                                                    ? item.secret
                                                    : '••••••••••••••••••••'}
                                            </span>
                                            {Array.isArray(item.tags) && item.tags.length > 0 && (
                                                <div className="qv-item-tags">
                                                    {item.tags.slice(0, 3).map(tag => (
                                                        <span key={tag} className="qv-tag">{tag}</span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Action Buttons */}
                                    <div className="qv-item-actions">
                                        <button
                                            className="qv-action-btn"
                                            onClick={(e) => toggleReveal(item.id, e)}
                                            title={isRevealed ? 'Mask secret' : 'Reveal secret'}
                                        >
                                            {isRevealed ? <EyeOff size={15} /> : <Eye size={15} />}
                                        </button>
                                        <button
                                            className={`qv-action-btn qv-copy-btn ${isCopied ? 'success' : ''}`}
                                            onClick={(e) => handleCopy(item, e)}
                                            title="Click to copy secret"
                                        >
                                            {isCopied ? (
                                                <>
                                                    <Check size={15} />
                                                    <span className="qv-copy-label">Copied!</span>
                                                </>
                                            ) : (
                                                <>
                                                    <Copy size={15} />
                                                    <span className="qv-copy-label">Copy</span>
                                                </>
                                            )}
                                        </button>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>

                {/* Footer Bar */}
                <div className="qv-footer">
                    <div className="qv-footer-hints">
                        <span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>
                        <span><kbd>↵</kbd> Copy & Close</span>
                        <span><kbd>Esc</kbd> Close</span>
                    </div>
                    {onOpenFullVault && (
                        <button
                            className="qv-footer-link"
                            onClick={() => {
                                onClose();
                                onOpenFullVault();
                            }}
                        >
                            Open Full Vault Manager →
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
