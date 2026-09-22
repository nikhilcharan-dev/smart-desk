import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { MAIN_SESSION_ID } from '../../utils/terminal';
import { formatRemoteError } from '../../utils/errors';
import { Code2, Plus, Play, Trash2, Edit3, Save, X, Copy, Check, FolderOpen, Tag, Shield } from 'lucide-react';
import './Snippets.css';

const DEFAULT_CATEGORIES = ['General', 'Monitoring', 'Deployment', 'Database', 'Network', 'Security'];

const DEFAULT_SNIPPETS = [
    // ── General ─────────────────────────────────────────────────────────────
    { id: 'g1', name: 'System Uptime & Load',      category: 'General',    description: 'Uptime and 1/5/15-min load averages',                         command: 'uptime' },
    { id: 'g2', name: 'OS & Kernel Info',           category: 'General',    description: 'Distro name, kernel version, architecture',                    command: "uname -a; grep PRETTY_NAME /etc/os-release 2>/dev/null | cut -d= -f2 | tr -d '\"'" },
    { id: 'g3', name: 'Current User & Groups',      category: 'General',    description: 'Effective UID, GID and group memberships',                     command: 'id; groups' },
    { id: 'g4', name: 'System Date & Timezone',     category: 'General',    description: 'Current datetime and configured timezone',                      command: 'date; timedatectl status 2>/dev/null || date -R' },
    { id: 'g5', name: 'Hardware Summary',           category: 'General',    description: 'CPU model, RAM, and root disk at a glance',                    command: "lscpu | grep 'Model name'; free -h | grep Mem; df -h / | tail -1" },
    { id: 'g6', name: 'Environment Variables',      category: 'General',    description: 'All exported environment variables, sorted',                   command: 'env | sort' },

    // ── Monitoring ──────────────────────────────────────────────────────────
    { id: 'm1', name: 'Disk Usage',                 category: 'Monitoring', description: 'Free/used space on every mounted filesystem',                  command: 'df -h' },
    { id: 'm2', name: 'Memory & Swap',              category: 'Monitoring', description: 'RAM and swap usage in human-readable form',                    command: 'free -h' },
    { id: 'm3', name: 'CPU Info & Cores',           category: 'Monitoring', description: 'CPU model, core count, thread count',                         command: "lscpu | grep -E 'Model name|^CPU\\(s\\)|Thread|Socket'" },
    { id: 'm4', name: 'Load Average & CPU Count',   category: 'Monitoring', description: '/proc/loadavg and number of CPUs for context',                 command: 'cat /proc/loadavg; echo "vCPUs: $(nproc)"' },
    { id: 'm5', name: 'Top 10 Large Files',         category: 'Monitoring', description: 'Find the 10 biggest files across the whole filesystem',        command: 'find / -type f -exec du -Sh {} + 2>/dev/null | sort -rh | head -10' },
    { id: 'm6', name: 'IO Stats',                   category: 'Monitoring', description: 'Disk I/O wait and throughput (iostat or vmstat fallback)',     command: 'iostat -xz 1 2 2>/dev/null || vmstat 1 3' },
    { id: 'm7', name: 'Zombie Processes',           category: 'Monitoring', description: 'Defunct processes that are consuming PID slots',               command: "ps aux | awk '$8==\"Z\"' | grep -v 'awk'" },
    { id: 'm8', name: 'Swap Usage Detail',          category: 'Monitoring', description: 'Active swap devices and current usage',                        command: 'swapon --show; free -h | grep -E "Swap|Mem"' },
    { id: 'm9', name: 'Recent Kernel Errors',       category: 'Monitoring', description: 'Error-level kernel messages from the last 24 hours',           command: 'journalctl -k -p err --since "24h ago" --no-pager 2>/dev/null | tail -30' },
    { id: 'm10', name: 'OOM Kills',                 category: 'Monitoring', description: 'Out-of-memory kill events from the kernel log',                command: 'journalctl -k 2>/dev/null | grep -i "oom\\|killed process" | tail -20' },

    // ── Network ─────────────────────────────────────────────────────────────
    { id: 'n1', name: 'Listening Ports',            category: 'Network',    description: 'All TCP/UDP ports with the owning process',                   command: 'ss -tlnp' },
    { id: 'n2', name: 'Active Connections',         category: 'Network',    description: 'Established TCP/UDP connections (top 30)',                    command: 'ss -tunap | head -30' },
    { id: 'n3', name: 'Network Interfaces & IPs',   category: 'Network',    description: 'All interfaces, MAC addresses and assigned IPs',              command: 'ip addr show' },
    { id: 'n4', name: 'Routing Table',              category: 'Network',    description: 'Kernel routing table — default gateway and routes',           command: 'ip route show' },
    { id: 'n5', name: 'DNS Nameservers',            category: 'Network',    description: 'Configured DNS resolvers from /etc/resolv.conf',              command: 'cat /etc/resolv.conf' },
    { id: 'n6', name: 'Public IP Address',          category: 'Network',    description: 'External/public IP via ifconfig.me',                          command: 'curl -s --max-time 5 ifconfig.me; echo' },
    { id: 'n7', name: 'Firewall Rules (iptables)',  category: 'Network',    description: 'Active iptables or nftables ruleset',                         command: 'iptables -L -n --line-numbers 2>/dev/null | head -50 || nft list ruleset 2>/dev/null | head -50 || echo "No iptables/nft"' },

    // ── Security ────────────────────────────────────────────────────────────
    { id: 's1', name: 'Active Sessions',            category: 'Security',   description: 'Users currently logged in to this host',                      command: 'who; w' },
    { id: 's2', name: 'Failed Login Attempts',      category: 'Security',   description: 'Last 10 failed SSH/login attempts',                           command: 'lastb -10 2>/dev/null || echo "Permission denied or no failed logins"' },
    { id: 's3', name: 'Auth Log (recent)',           category: 'Security',   description: 'Last 50 lines of auth/sshd log',                              command: 'tail -50 /var/log/auth.log 2>/dev/null || journalctl _COMM=sshd -n 50 --no-pager 2>/dev/null' },
    { id: 's4', name: 'SUID/SGID Binaries',         category: 'Security',   description: 'World-accessible setuid/setgid files (escalation risk)',      command: 'find / -type f \\( -perm /4000 -o -perm /2000 \\) 2>/dev/null | sort' },
    { id: 's5', name: 'Open Files by Network',      category: 'Security',   description: 'Processes with open network sockets (lsof)',                  command: 'lsof -i -n -P 2>/dev/null | head -30' },
    { id: 's6', name: 'Local User Accounts',        category: 'Security',   description: 'Users with a real login shell (not nologin/false)',            command: "grep -v 'nologin\\|/false\\|/sync' /etc/passwd | cut -d: -f1,3,6,7" },
    { id: 's7', name: 'Pending Security Updates',   category: 'Security',   description: 'Available patches on apt or yum-based systems',               command: 'apt list --upgradable 2>/dev/null | head -20 || yum check-update 2>/dev/null | head -20' },
    { id: 's8', name: 'Sudo Rules',                 category: 'Security',   description: 'Effective sudoers configuration (non-comment lines)',          command: "grep -v '^#\\|^$' /etc/sudoers 2>/dev/null || echo 'Access denied'" },

    // ── Deployment ──────────────────────────────────────────────────────────
    { id: 'd1', name: 'Running Systemd Services',   category: 'Deployment', description: 'All active/running systemd service units',                    command: 'systemctl list-units --type=service --state=running --no-pager 2>/dev/null | head -25' },
    { id: 'd2', name: 'Failed Systemd Services',    category: 'Deployment', description: 'Service units that have entered a failed state',              command: 'systemctl list-units --type=service --state=failed --no-pager 2>/dev/null' },
    { id: 'd3', name: 'Docker Containers',          category: 'Deployment', description: 'Running containers — name, status, and port mappings',        command: 'docker ps --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}" 2>/dev/null || echo "Docker not installed"' },
    { id: 'd4', name: 'Docker Disk Usage',          category: 'Deployment', description: 'Space used by images, containers, volumes, and build cache',  command: 'docker system df 2>/dev/null || echo "Docker not available"' },
    { id: 'd5', name: 'Nginx / Apache Status',      category: 'Deployment', description: 'Web server service status and config test',                   command: 'systemctl status nginx apache2 2>/dev/null; nginx -t 2>/dev/null || apache2ctl -t 2>/dev/null' },
    { id: 'd6', name: 'Recent Cron Jobs',           category: 'Deployment', description: "Current user's crontab and system-wide cron entries",          command: 'crontab -l 2>/dev/null; echo "---"; ls -la /etc/cron.d/ /etc/cron.daily/ 2>/dev/null' },

    // ── Database ────────────────────────────────────────────────────────────
    { id: 'db1', name: 'MySQL / MariaDB Status',    category: 'Database',   description: 'Server status and version (requires mysql client)',           command: 'mysqladmin status 2>/dev/null || mysql -e "SELECT VERSION();" 2>/dev/null || echo "MySQL/MariaDB not available"' },
    { id: 'db2', name: 'PostgreSQL Clusters',       category: 'Database',   description: 'pg_lsclusters summary or systemd status fallback',            command: 'pg_lsclusters 2>/dev/null || systemctl status postgresql --no-pager 2>/dev/null || echo "PostgreSQL not available"' },
    { id: 'db3', name: 'Redis Ping & Info',         category: 'Database',   description: 'Verify Redis is reachable and show server info',              command: 'redis-cli ping 2>/dev/null && redis-cli info server 2>/dev/null | head -15 || echo "Redis not available"' },
    { id: 'db4', name: 'MongoDB Status',            category: 'Database',   description: 'MongoDB systemd status or mongosh version check',             command: 'systemctl status mongod --no-pager 2>/dev/null || mongosh --quiet --eval "db.version()" 2>/dev/null || echo "MongoDB not available"' },
    { id: 'db5', name: 'DB Data Directory Sizes',   category: 'Database',   description: 'Disk footprint of common database data directories',          command: 'du -sh /var/lib/mysql /var/lib/postgresql /var/lib/mongodb /var/lib/redis 2>/dev/null | sort -rh' },
];

export default function Snippets() {
    const [snippets, setSnippets] = useState([]);
    const [activeSnippet, setActiveSnippet] = useState(null);
    const [editing, setEditing] = useState(null); // snippet being edited
    const [output, setOutput] = useState(null);
    const [running, setRunning] = useState(false);
    const [copied, setCopied] = useState(false);
    const [activeCategory, setActiveCategory] = useState('All');
    // When on, snippets run through the always-elevate backend command, using
    // the profile's stored sudo password (or passwordless sudo). Lets root-only
    // snippets (auth log, iptables, lsof, sudoers) return full output.
    const [useSudo, setUseSudo] = useState(false);

    // Form state for create/edit
    const [form, setForm] = useState({ name: '', command: '', description: '', category: 'General' });

    const saveSnippets = useCallback(async (data) => {
        try {
            await invoke('save_snippets', { content: JSON.stringify(data, null, 2) });
        } catch (err) {
            console.error('Failed to save snippets:', err);
        }
    }, []);

    const loadSnippets = useCallback(async () => {
        try {
            const raw = await invoke('load_snippets');
            const parsed = JSON.parse(raw || '[]');
            if (parsed.length > 0) {
                setSnippets(parsed);
            } else {
                setSnippets(DEFAULT_SNIPPETS);
                saveSnippets(DEFAULT_SNIPPETS);
            }
        } catch {
            setSnippets(DEFAULT_SNIPPETS);
            saveSnippets(DEFAULT_SNIPPETS);
        }
    }, [saveSnippets]);

    useEffect(() => {
        loadSnippets();
    }, [loadSnippets]);

    const runSnippet = async (snippet) => {
        setActiveSnippet(snippet);
        setOutput(null);
        setRunning(true);
        try {
            const result = await invoke(useSudo ? 'exec_ssh_command_sudo' : 'exec_ssh_command', {
                sessionId: MAIN_SESSION_ID,
                command: snippet.command
            });
            setOutput(result);
        } catch (err) {
            setOutput(formatRemoteError(err, `Running "${snippet.name}"`));
        } finally {
            setRunning(false);
        }
    };

    const copyOutput = () => {
        if (output) {
            navigator.clipboard.writeText(output);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    const startCreate = () => {
        setForm({ name: '', command: '', description: '', category: 'General' });
        setEditing({ isNew: true });
    };

    const startEdit = (snippet) => {
        setForm({ name: snippet.name, command: snippet.command, description: snippet.description || '', category: snippet.category || 'General' });
        setEditing({ isNew: false, id: snippet.id });
    };

    const saveForm = () => {
        if (!form.name.trim() || !form.command.trim()) return;

        let updated;
        if (editing.isNew) {
            const newSnippet = { ...form, id: Date.now().toString() };
            updated = [...snippets, newSnippet];
        } else {
            updated = snippets.map(s => s.id === editing.id ? { ...s, ...form } : s);
        }
        setSnippets(updated);
        saveSnippets(updated);
        setEditing(null);
    };

    const deleteSnippet = (id) => {
        const updated = snippets.filter(s => s.id !== id);
        setSnippets(updated);
        saveSnippets(updated);
        if (activeSnippet?.id === id) { setActiveSnippet(null); setOutput(null); }
    };

    const categories = ['All', ...new Set(snippets.map(s => s.category || 'General'))];
    const filtered = activeCategory === 'All' ? snippets : snippets.filter(s => (s.category || 'General') === activeCategory);

    return (
        <div className="sn-container">
            <div className="sn-sidebar">
                <div className="sn-sidebar-header">
                    <Code2 size={18} className="sn-icon" />
                    <h2 className="sn-sidebar-title">Snippets</h2>
                    <button className="sn-add-btn" onClick={startCreate} title="New Snippet">
                        <Plus size={16} />
                    </button>
                </div>

                <div className="sn-categories">
                    {categories.map(cat => (
                        <button
                            key={cat}
                            className={`sn-cat-btn ${activeCategory === cat ? 'active' : ''}`}
                            onClick={() => setActiveCategory(cat)}
                        >
                            {cat === 'All' ? <FolderOpen size={12} /> : <Tag size={12} />}
                            <span>{cat}</span>
                        </button>
                    ))}
                </div>

                <div className="sn-list">
                    {filtered.map(snippet => (
                        <div
                            key={snippet.id}
                            className={`sn-item ${activeSnippet?.id === snippet.id ? 'active' : ''}`}
                            onClick={() => { setActiveSnippet(snippet); setOutput(null); }}
                        >
                            <div className="sn-item-name">{snippet.name}</div>
                            <div className="sn-item-cmd">{snippet.command}</div>
                            <div className="sn-item-actions">
                                <button onClick={(e) => { e.stopPropagation(); runSnippet(snippet); }} title="Run">
                                    <Play size={12} />
                                </button>
                                <button onClick={(e) => { e.stopPropagation(); startEdit(snippet); }} title="Edit">
                                    <Edit3 size={12} />
                                </button>
                                <button className="danger" onClick={(e) => { e.stopPropagation(); deleteSnippet(snippet.id); }} title="Delete">
                                    <Trash2 size={12} />
                                </button>
                            </div>
                        </div>
                    ))}
                    {filtered.length === 0 && <div className="sn-empty-list">No snippets in this category</div>}
                </div>
            </div>

            <div className="sn-main">
                {editing ? (
                    <div className="sn-editor">
                        <div className="sn-editor-header">
                            <h3>{editing.isNew ? 'New Snippet' : 'Edit Snippet'}</h3>
                            <div className="sn-editor-actions">
                                <button className="sn-btn secondary" onClick={() => setEditing(null)}>
                                    <X size={14} /> Cancel
                                </button>
                                <button className="sn-btn primary" onClick={saveForm}>
                                    <Save size={14} /> Save
                                </button>
                            </div>
                        </div>
                        <div className="sn-form">
                            <label>Name</label>
                            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g., Check Disk Usage" />
                            <label>Command</label>
                            <textarea value={form.command} onChange={e => setForm({ ...form, command: e.target.value })} placeholder="e.g., df -h" rows={3} />
                            <label>Description</label>
                            <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Optional description..." />
                            <label>Category</label>
                            <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                                {DEFAULT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                    </div>
                ) : activeSnippet ? (
                    <div className="sn-detail">
                        <div className="sn-detail-header">
                            <div>
                                <h3 className="sn-detail-name">{activeSnippet.name}</h3>
                                {activeSnippet.description && <p className="sn-detail-desc">{activeSnippet.description}</p>}
                            </div>
                            <div className="sn-detail-actions">
                                <label
                                    className={`sn-sudo-toggle ${useSudo ? 'active' : ''}`}
                                    title="Run through sudo, using this profile's stored sudo password (or passwordless sudo). Needed for root-only output."
                                >
                                    <input
                                        type="checkbox"
                                        checked={useSudo}
                                        onChange={e => setUseSudo(e.target.checked)}
                                    />
                                    <Shield size={13} /> sudo
                                </label>
                                <button className="sn-btn primary" onClick={() => runSnippet(activeSnippet)} disabled={running}>
                                    <Play size={14} /> {running ? 'Running...' : useSudo ? 'Run as sudo' : 'Run'}
                                </button>
                            </div>
                        </div>
                        <div className="sn-command-block">
                            <div className="sn-command-label">Command</div>
                            <pre className="sn-command-pre">{activeSnippet.command}</pre>
                        </div>
                        {output !== null && (
                            <div className="sn-output-block">
                                <div className="sn-output-header">
                                    <span className="sn-output-label">Output</span>
                                    <button className="sn-copy-btn" onClick={copyOutput}>
                                        {copied ? <Check size={12} /> : <Copy size={12} />}
                                        {copied ? 'Copied' : 'Copy'}
                                    </button>
                                </div>
                                <pre className="sn-output-pre">{output}</pre>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="sn-placeholder">
                        <Code2 size={40} strokeWidth={1} />
                        <p>Select a snippet to view or run it</p>
                        <span>Press the <strong>+</strong> button to create a new one</span>
                    </div>
                )}
            </div>
        </div>
    );
}
