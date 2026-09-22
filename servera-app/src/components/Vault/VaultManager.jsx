import { useState, useEffect, useMemo, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
    KeyRound, Key, Shield, Database, Server, Sparkles, Tag, Terminal,
    Search, Plus, Copy, Check, Eye, EyeOff, Edit3, Trash2,
    RefreshCw, Download, Upload, X, ShieldAlert, CheckCircle2
} from 'lucide-react';
import './VaultManager.css';

const CATEGORIES = [
    { id: 'all', label: 'All Secrets', icon: Shield, color: 'var(--accent-primary)' },
    { id: 'api-key', label: 'API Keys', icon: KeyRound, color: '#e5c07b' },
    { id: 'ssh-key', label: 'SSH & Keys', icon: Terminal, color: '#98c379' },
    { id: 'password', label: 'Passwords', icon: Key, color: '#61afef' },
    { id: 'database', label: 'Database', icon: Database, color: '#c678dd' },
    { id: 'server', label: 'Server & Sudo', icon: Server, color: '#e06c75' },
    { id: 'token', label: 'Tokens', icon: Sparkles, color: '#56b6c2' },
    { id: 'note', label: 'Notes', icon: Tag, color: '#abb2bf' },
];

export default function VaultManager() {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [activeCategory, setActiveCategory] = useState('all');
    const [copiedId, setCopiedId] = useState(null);
    const [revealedIds, setRevealedIds] = useState(new Set());
    const [toastMessage, setToastMessage] = useState(null);

    // Modal state
    const [editModalOpen, setEditModalOpen] = useState(false);
    const [editingItem, setEditingItem] = useState(null);
    const [formItem, setFormItem] = useState({
        title: '',
        category: 'api-key',
        secret: '',
        account: '',
        host: '',
        notes: '',
        tags: '',
    });

    // Password generator modal state
    const [genModalOpen, setGenModalOpen] = useState(false);
    const [genLength, setGenLength] = useState(24);
    const [genUpper, setGenUpper] = useState(true);
    const [genLower, setGenLower] = useState(true);
    const [genNumbers, setGenNumbers] = useState(true);
    const [genSymbols, setGenSymbols] = useState(true);
    const [generatedSecret, setGeneratedSecret] = useState('');
    const [genCopied, setGenCopied] = useState(false);

    // Backup import modal
    const [importModalOpen, setImportModalOpen] = useState(false);
    const [importData, setImportData] = useState('');

    const showToast = useCallback((msg) => {
        setToastMessage(msg);
        setTimeout(() => setToastMessage(null), 3000);
    }, []);

    const loadVault = useCallback(async () => {
        setLoading(true);
        try {
            const data = await invoke('vault_load_items');
            setItems(Array.isArray(data) ? data : []);
        } catch (err) {
            showToast('Failed to load vault: ' + err);
        } finally {
            setLoading(false);
        }
    }, [showToast]);

    useEffect(() => {
        loadVault();
    }, [loadVault]);

    const handleCopy = async (item, e) => {
        if (e) e.stopPropagation();
        try {
            await navigator.clipboard.writeText(item.secret);
            setCopiedId(item.id);
            invoke('vault_touch_item', { id: item.id }).catch(() => {});
            showToast(`Copied "${item.title}" to clipboard!`);
            setTimeout(() => setCopiedId(null), 2000);
        } catch (err) {
            showToast('Copy failed: ' + err);
        }
    };

    const toggleReveal = (id) => {
        setRevealedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    // Open add/edit modal
    const openAddModal = () => {
        setEditingItem(null);
        setFormItem({
            title: '',
            category: activeCategory !== 'all' ? activeCategory : 'api-key',
            secret: '',
            account: '',
            host: '',
            notes: '',
            tags: '',
        });
        setEditModalOpen(true);
    };

    const openEditModal = (item, e) => {
        if (e) e.stopPropagation();
        setEditingItem(item);
        setFormItem({
            title: item.title,
            category: item.category || 'api-key',
            secret: item.secret,
            account: item.account || '',
            host: item.host || '',
            notes: item.notes || '',
            tags: Array.isArray(item.tags) ? item.tags.join(', ') : '',
        });
        setEditModalOpen(true);
    };

    const handleSaveItem = async (e) => {
        e.preventDefault();
        if (!formItem.title.trim()) {
            showToast('Title is required');
            return;
        }
        if (!formItem.secret.trim()) {
            showToast('Secret value is required');
            return;
        }

        const tagsArray = formItem.tags
            .split(',')
            .map(t => t.trim())
            .filter(Boolean);

        const itemPayload = {
            id: editingItem ? editingItem.id : crypto.randomUUID(),
            title: formItem.title.trim(),
            category: formItem.category,
            secret: formItem.secret.trim(),
            account: formItem.account.trim() || null,
            host: formItem.host.trim() || null,
            notes: formItem.notes.trim() || null,
            tags: tagsArray,
            created_at: editingItem ? editingItem.created_at : 0,
            updated_at: 0,
            last_used_at: editingItem ? editingItem.last_used_at : null,
        };

        try {
            await invoke('vault_save_item', { item: itemPayload });
            showToast(editingItem ? 'Secret updated!' : 'Secret saved to vault!');
            setEditModalOpen(false);
            loadVault();
        } catch (err) {
            showToast('Failed to save secret: ' + err);
        }
    };

    const handleDeleteItem = async (item, e) => {
        if (e) e.stopPropagation();
        if (!window.confirm(`Are you sure you want to delete "${item.title}"?`)) return;
        try {
            await invoke('vault_delete_item', { id: item.id });
            showToast('Deleted secret');
            loadVault();
        } catch (err) {
            showToast('Delete failed: ' + err);
        }
    };

    // Password generator logic
    const generatePassword = useCallback(() => {
        let chars = '';
        if (genUpper) chars += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        if (genLower) chars += 'abcdefghijklmnopqrstuvwxyz';
        if (genNumbers) chars += '0123456789';
        if (genSymbols) chars += '!@#$%^&*()_+-=[]{}|;:,.<>?';

        if (!chars) chars = 'abcdefghijklmnopqrstuvwxyz0123456789';

        const array = new Uint32Array(genLength);
        crypto.getRandomValues(array);
        let result = '';
        for (let i = 0; i < genLength; i++) {
            result += chars[array[i] % chars.length];
        }
        setGeneratedSecret(result);
        setGenCopied(false);
    }, [genLength, genUpper, genLower, genNumbers, genSymbols]);

    useEffect(() => {
        if (genModalOpen) {
            generatePassword();
        }
    }, [genModalOpen, generatePassword]);

    const copyGenerated = async () => {
        await navigator.clipboard.writeText(generatedSecret);
        setGenCopied(true);
        showToast('Generated password copied to clipboard!');
        setTimeout(() => setGenCopied(false), 2000);
    };

    const useGeneratedInForm = () => {
        setFormItem(prev => ({ ...prev, secret: generatedSecret }));
        setGenModalOpen(false);
        if (!editModalOpen) {
            openAddModal();
            setFormItem(prev => ({ ...prev, secret: generatedSecret }));
        }
    };

    // Export backup
    const handleExportBackup = async () => {
        try {
            const jsonStr = await invoke('vault_export_backup');
            const blob = new Blob([jsonStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `servera-vault-backup-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
            showToast('Vault backup downloaded!');
        } catch (err) {
            showToast('Export failed: ' + err);
        }
    };

    // Import backup
    const handleImportSubmit = async (e) => {
        e.preventDefault();
        if (!importData.trim()) return;
        try {
            const count = await invoke('vault_import_backup', { jsonData: importData.trim() });
            showToast(`Successfully imported ${count} secrets!`);
            setImportModalOpen(false);
            setImportData('');
            loadVault();
        } catch (err) {
            showToast('Import failed: ' + err);
        }
    };

    // Filter items
    const filteredItems = useMemo(() => {
        return items.filter(item => {
            const matchesCat = activeCategory === 'all' || item.category === activeCategory;
            if (!matchesCat) return false;
            if (!searchQuery.trim()) return true;
            const q = searchQuery.toLowerCase();
            return (
                (item.title && item.title.toLowerCase().includes(q)) ||
                (item.account && item.account.toLowerCase().includes(q)) ||
                (item.host && item.host.toLowerCase().includes(q)) ||
                (item.notes && item.notes.toLowerCase().includes(q)) ||
                (Array.isArray(item.tags) && item.tags.some(t => t.toLowerCase().includes(q)))
            );
        }).sort((a, b) => (b.last_used_at || b.created_at || 0) - (a.last_used_at || a.created_at || 0));
    }, [items, activeCategory, searchQuery]);

    return (
        <div className="vm-container">
            {/* Top Toolbar */}
            <div className="vm-toolbar">
                <div className="vm-title-section">
                    <div className="vm-title-badge">
                        <KeyRound size={22} className="vm-title-icon" />
                    </div>
                    <div>
                        <h1 className="vm-title">Secrets Vault</h1>
                        <p className="vm-subtitle">
                            AES-256-GCM hardware-backed credential storage • Quick copy anywhere with <kbd>Alt+V</kbd>
                        </p>
                    </div>
                </div>

                <div className="vm-actions">
                    <button className="vm-btn-secondary" onClick={() => setGenModalOpen(true)}>
                        <Sparkles size={15} />
                        <span>Generator</span>
                    </button>
                    <button className="vm-btn-secondary" onClick={handleExportBackup} title="Export Encrypted Backup">
                        <Download size={15} />
                        <span>Export</span>
                    </button>
                    <button className="vm-btn-secondary" onClick={() => setImportModalOpen(true)} title="Import Backup">
                        <Upload size={15} />
                        <span>Import</span>
                    </button>
                    <button className="vm-btn-primary" onClick={openAddModal}>
                        <Plus size={16} />
                        <span>Add Secret</span>
                    </button>
                </div>
            </div>

            {/* Main Layout: Left Categories + Right Grid */}
            <div className="vm-body">
                {/* Left Category Sidebar */}
                <div className="vm-categories-sidebar">
                    <div className="vm-categories-header">Categories</div>
                    {CATEGORIES.map(cat => {
                        const Icon = cat.icon;
                        const count = cat.id === 'all'
                            ? items.length
                            : items.filter(i => i.category === cat.id).length;
                        const isActive = activeCategory === cat.id;

                        return (
                            <button
                                key={cat.id}
                                className={`vm-category-item ${isActive ? 'active' : ''}`}
                                onClick={() => setActiveCategory(cat.id)}
                            >
                                <div className="vm-cat-icon" style={{ color: cat.color }}>
                                    <Icon size={16} />
                                </div>
                                <span className="vm-cat-label">{cat.label}</span>
                                <span className="vm-cat-count">{count}</span>
                            </button>
                        );
                    })}
                </div>

                {/* Right Content Area */}
                <div className="vm-content">
                    {/* Search & Filter Bar */}
                    <div className="vm-search-bar">
                        <Search size={16} className="vm-search-icon" />
                        <input
                            type="text"
                            className="vm-search-input"
                            placeholder="Search secrets by title, username, host, or tags..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                        />
                        {searchQuery && (
                            <button className="vm-search-clear" onClick={() => setSearchQuery('')}>
                                <X size={14} />
                            </button>
                        )}
                    </div>

                    {/* Vault Items Grid */}
                    {loading ? (
                        <div className="vm-state-empty">Loading secure vault items...</div>
                    ) : filteredItems.length === 0 ? (
                        <div className="vm-state-empty">
                            <KeyRound size={44} className="vm-empty-icon" />
                            <h3>No secrets found</h3>
                            <p>
                                {searchQuery
                                    ? `No results matching "${searchQuery}".`
                                    : 'Store passwords, API keys, and SSH credentials with single-click copy.'}
                            </p>
                            <button className="vm-btn-primary" onClick={openAddModal}>
                                <Plus size={16} />
                                <span>Create First Secret</span>
                            </button>
                        </div>
                    ) : (
                        <div className="vm-grid">
                            {filteredItems.map(item => {
                                const isCopied = copiedId === item.id;
                                const isRevealed = revealedIds.has(item.id);
                                const catMeta = CATEGORIES.find(c => c.id === item.category) || CATEGORIES[1];
                                const CatIcon = catMeta.icon;

                                return (
                                    <div key={item.id} className="vm-card">
                                        {/* Card Header */}
                                        <div className="vm-card-header">
                                            <div className="vm-card-cat-badge" style={{ color: catMeta.color }}>
                                                <CatIcon size={15} />
                                                <span>{catMeta.label}</span>
                                            </div>
                                            <div className="vm-card-actions">
                                                <button
                                                    className="vm-icon-btn"
                                                    onClick={(e) => openEditModal(item, e)}
                                                    title="Edit secret"
                                                >
                                                    <Edit3 size={14} />
                                                </button>
                                                <button
                                                    className="vm-icon-btn danger"
                                                    onClick={(e) => handleDeleteItem(item, e)}
                                                    title="Delete secret"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </div>

                                        {/* Card Title & Subtitle */}
                                        <div className="vm-card-body">
                                            <h3 className="vm-card-title">{item.title}</h3>
                                            {(item.account || item.host) && (
                                                <div className="vm-card-meta">
                                                    {item.account && <span>User: <code>{item.account}</code></span>}
                                                    {item.host && <span>Host: <code>{item.host}</code></span>}
                                                </div>
                                            )}
                                        </div>

                                        {/* Secret Box & One-Click Copy */}
                                        <div className="vm-secret-box">
                                            <div className="vm-secret-text">
                                                {isRevealed ? item.secret : '••••••••••••••••••••'}
                                            </div>
                                            <div className="vm-secret-actions">
                                                <button
                                                    className="vm-icon-btn"
                                                    onClick={() => toggleReveal(item.id)}
                                                    title={isRevealed ? 'Hide secret' : 'Reveal secret'}
                                                >
                                                    {isRevealed ? <EyeOff size={14} /> : <Eye size={14} />}
                                                </button>
                                                <button
                                                    className={`vm-copy-pill ${isCopied ? 'success' : ''}`}
                                                    onClick={(e) => handleCopy(item, e)}
                                                    title="Click to copy secret to clipboard"
                                                >
                                                    {isCopied ? <Check size={14} /> : <Copy size={14} />}
                                                    <span>{isCopied ? 'Copied!' : 'Copy'}</span>
                                                </button>
                                            </div>
                                        </div>

                                        {/* Notes & Tags */}
                                        {item.notes && (
                                            <div className="vm-card-notes" title={item.notes}>
                                                {item.notes}
                                            </div>
                                        )}

                                        {Array.isArray(item.tags) && item.tags.length > 0 && (
                                            <div className="vm-card-tags">
                                                {item.tags.map(t => (
                                                    <span key={t} className="vm-tag">{t}</span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            {/* Add / Edit Secret Modal */}
            {editModalOpen && (
                <div className="vm-modal-backdrop" onClick={() => setEditModalOpen(false)}>
                    <div className="vm-modal" onClick={e => e.stopPropagation()}>
                        <div className="vm-modal-header">
                            <h2>{editingItem ? 'Edit Secret' : 'Add New Secret'}</h2>
                            <button className="vm-modal-close" onClick={() => setEditModalOpen(false)}>
                                <X size={18} />
                            </button>
                        </div>
                        <form onSubmit={handleSaveItem} className="vm-form">
                            <div className="vm-form-group">
                                <label>Title *</label>
                                <input
                                    type="text"
                                    required
                                    placeholder="e.g. AWS Production API Key, Root DB Password"
                                    value={formItem.title}
                                    onChange={e => setFormItem({ ...formItem, title: e.target.value })}
                                />
                            </div>

                            <div className="vm-form-row">
                                <div className="vm-form-group flex-1">
                                    <label>Category</label>
                                    <select
                                        value={formItem.category}
                                        onChange={e => setFormItem({ ...formItem, category: e.target.value })}
                                    >
                                        {CATEGORIES.filter(c => c.id !== 'all').map(c => (
                                            <option key={c.id} value={c.id}>{c.label}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="vm-form-group flex-1">
                                    <label>Username / Account (Optional)</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. root, ubuntu, admin"
                                        value={formItem.account}
                                        onChange={e => setFormItem({ ...formItem, account: e.target.value })}
                                    />
                                </div>
                            </div>

                            <div className="vm-form-group">
                                <label>Associated Host / IP / URL (Optional)</label>
                                <input
                                    type="text"
                                    placeholder="e.g. 192.168.1.100 or db.internal.cloud"
                                    value={formItem.host}
                                    onChange={e => setFormItem({ ...formItem, host: e.target.value })}
                                />
                            </div>

                            <div className="vm-form-group">
                                <div className="vm-label-row">
                                    <label>Secret Value *</label>
                                    <button
                                        type="button"
                                        className="vm-link-btn"
                                        onClick={() => setGenModalOpen(true)}
                                    >
                                        <Sparkles size={12} /> Generate
                                    </button>
                                </div>
                                <textarea
                                    required
                                    rows={4}
                                    className="vm-mono-input"
                                    placeholder="Paste sensitive password, private key, token, or secret here..."
                                    value={formItem.secret}
                                    onChange={e => setFormItem({ ...formItem, secret: e.target.value })}
                                />
                            </div>

                            <div className="vm-form-group">
                                <label>Tags (Comma-separated)</label>
                                <input
                                    type="text"
                                    placeholder="e.g. prod, database, aws, staging"
                                    value={formItem.tags}
                                    onChange={e => setFormItem({ ...formItem, tags: e.target.value })}
                                />
                            </div>

                            <div className="vm-form-group">
                                <label>Notes (Optional)</label>
                                <textarea
                                    rows={2}
                                    placeholder="Add any non-sensitive context or instructions..."
                                    value={formItem.notes}
                                    onChange={e => setFormItem({ ...formItem, notes: e.target.value })}
                                />
                            </div>

                            <div className="vm-modal-footer">
                                <button
                                    type="button"
                                    className="vm-btn-secondary"
                                    onClick={() => setEditModalOpen(false)}
                                >
                                    Cancel
                                </button>
                                <button type="submit" className="vm-btn-primary">
                                    {editingItem ? 'Update Secret' : 'Save to Vault'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Password Generator Modal */}
            {genModalOpen && (
                <div className="vm-modal-backdrop" onClick={() => setGenModalOpen(false)}>
                    <div className="vm-modal" onClick={e => e.stopPropagation()}>
                        <div className="vm-modal-header">
                            <h2>Password & Secret Generator</h2>
                            <button className="vm-modal-close" onClick={() => setGenModalOpen(false)}>
                                <X size={18} />
                            </button>
                        </div>
                        <div className="vm-generator-body">
                            <div className="vm-gen-preview-box">
                                <span className="vm-gen-preview">{generatedSecret}</span>
                                <button
                                    className="vm-icon-btn"
                                    onClick={generatePassword}
                                    title="Regenerate"
                                >
                                    <RefreshCw size={16} />
                                </button>
                            </div>

                            <div className="vm-gen-controls">
                                <div className="vm-gen-control-row">
                                    <label>Length: <strong>{genLength}</strong> chars</label>
                                    <input
                                        type="range"
                                        min="8"
                                        max="64"
                                        value={genLength}
                                        onChange={e => setGenLength(Number(e.target.value))}
                                    />
                                </div>

                                <div className="vm-gen-checkboxes">
                                    <label>
                                        <input
                                            type="checkbox"
                                            checked={genUpper}
                                            onChange={e => setGenUpper(e.target.checked)}
                                        />
                                        Uppercase (A-Z)
                                    </label>
                                    <label>
                                        <input
                                            type="checkbox"
                                            checked={genLower}
                                            onChange={e => setGenLower(e.target.checked)}
                                        />
                                        Lowercase (a-z)
                                    </label>
                                    <label>
                                        <input
                                            type="checkbox"
                                            checked={genNumbers}
                                            onChange={e => setGenNumbers(e.target.checked)}
                                        />
                                        Numbers (0-9)
                                    </label>
                                    <label>
                                        <input
                                            type="checkbox"
                                            checked={genSymbols}
                                            onChange={e => setGenSymbols(e.target.checked)}
                                        />
                                        Symbols (!@#$%)
                                    </label>
                                </div>
                            </div>

                            <div className="vm-modal-footer">
                                <button
                                    className={`vm-btn-secondary ${genCopied ? 'success' : ''}`}
                                    onClick={copyGenerated}
                                >
                                    {genCopied ? <Check size={15} /> : <Copy size={15} />}
                                    <span>{genCopied ? 'Copied!' : 'Copy Password'}</span>
                                </button>
                                <button className="vm-btn-primary" onClick={useGeneratedInForm}>
                                    Use in Secret
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Import Modal */}
            {importModalOpen && (
                <div className="vm-modal-backdrop" onClick={() => setImportModalOpen(false)}>
                    <div className="vm-modal" onClick={e => e.stopPropagation()}>
                        <div className="vm-modal-header">
                            <h2>Import Vault Backup</h2>
                            <button className="vm-modal-close" onClick={() => setImportModalOpen(false)}>
                                <X size={18} />
                            </button>
                        </div>
                        <form onSubmit={handleImportSubmit} className="vm-form">
                            <div className="vm-form-group">
                                <label>Paste JSON Backup Content</label>
                                <textarea
                                    rows={8}
                                    required
                                    className="vm-mono-input"
                                    placeholder='[{"id": "...", "title": "...", "secret": "..."}]'
                                    value={importData}
                                    onChange={e => setImportData(e.target.value)}
                                />
                            </div>
                            <div className="vm-modal-footer">
                                <button
                                    type="button"
                                    className="vm-btn-secondary"
                                    onClick={() => setImportModalOpen(false)}
                                >
                                    Cancel
                                </button>
                                <button type="submit" className="vm-btn-primary">
                                    Import Secrets
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Global Toast */}
            {toastMessage && (
                <div className="vm-toast">
                    <CheckCircle2 size={16} />
                    <span>{toastMessage}</span>
                </div>
            )}
        </div>
    );
}
