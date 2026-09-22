import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Clock, Plus, Trash2, RefreshCw, AlertCircle, Save } from "lucide-react";
import { MAIN_SESSION_ID } from "../../../utils/terminal";
import { formatRemoteError } from "../../../utils/errors";
import "./SettingsPanels.css";

export default function CronJobs() {
    const [jobs, setJobs] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [isCreating, setIsCreating] = useState(false);

    // New job form state
    const [newJob, setNewJob] = useState({
        minute: "*",
        hour: "*",
        dayOfMonth: "*",
        month: "*",
        dayOfWeek: "*",
        command: ""
    });

    const fetchJobs = async () => {
        setLoading(true);
        setError(null);
        try {
            // crontab -l exits with 1 if no crontab for user, we handle that gracefully by ORing with echo ""
            const rawCron = await invoke("exec_ssh_command", {
                sessionId: MAIN_SESSION_ID,
                command: "crontab -l 2>/dev/null || echo ''"
            });

            const parsed = rawCron.split('\n')
                .filter(line => line.trim() && !line.trim().startsWith('#'))
                .map((line, index) => {
                    // Match standard 5-part cron syntax plus the rest as command
                    // Example: "0 5 * * * /backup.sh"
                    const parts = line.trim().split(/\s+/);
                    if (parts.length >= 6 && !line.startsWith('@')) {
                        return {
                            id: index,
                            raw: line,
                            minute: parts[0],
                            hour: parts[1],
                            dayOfMonth: parts[2],
                            month: parts[3],
                            dayOfWeek: parts[4],
                            command: parts.slice(5).join(' ')
                        };
                    } else {
                        // Handle @reboot, @daily, etc.
                        return {
                            id: index,
                            raw: line,
                            special: parts[0],
                            command: parts.slice(1).join(' ')
                        };
                    }
                });

            setJobs(parsed);
        } catch (err) {
            setError(formatRemoteError(err, "Reading the crontab"));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchJobs();
    }, []);

    const handleAddJob = async () => {
        if (!newJob.command.trim()) return;
        setLoading(true);
        try {
            const cronString = `${newJob.minute} ${newJob.hour} ${newJob.dayOfMonth} ${newJob.month} ${newJob.dayOfWeek} ${newJob.command}`;
            // Extract current crontab, append new job, and load it back
            const safeCron = cronString.replace(/'/g, "'\\''");
            await invoke("exec_ssh_command", {
                sessionId: MAIN_SESSION_ID,
                command: `(crontab -l 2>/dev/null; echo '${safeCron}') | crontab -`
            });

            setIsCreating(false);
            setNewJob({ minute: "*", hour: "*", dayOfMonth: "*", month: "*", dayOfWeek: "*", command: "" });
            fetchJobs();
        } catch (err) {
            setError(formatRemoteError(err, "Adding the cron job"));
            setLoading(false);
        }
    };

    const handleRemoveJob = async (rawLine) => {
        if (!confirm("Are you sure you want to remove this cron job?")) return;

        setLoading(true);
        try {
            // `grep -F` matches a literal string, so the only escaping needed is
            // for the surrounding shell quotes. Regex-escaping it as well (the
            // previous behaviour) inserted backslashes that are part of the
            // literal being searched for, so no line ever matched and the job
            // silently stayed in the crontab.
            const safeLine = rawLine.replace(/'/g, "'\\''");
            await invoke("exec_ssh_command", {
                sessionId: MAIN_SESSION_ID,
                command: `crontab -l | grep -vxF '${safeLine}' | crontab -`
            });
            fetchJobs();
        } catch (err) {
            setError(formatRemoteError(err, "Removing the cron job"));
            setLoading(false);
        }
    };

    return (
        <div className="sh-panel">
            <div className="sh-panel-header">
                <div>
                    <h2>Cron Job Manager</h2>
                    <p className="sh-panel-subtitle">Manage scheduled automated tasks (crontab)</p>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button className={`sh-action-btn ${isCreating ? 'active' : ''}`} onClick={() => setIsCreating(!isCreating)}>
                        <Plus size={14} /> New Job
                    </button>
                    <button className="sh-action-btn" onClick={fetchJobs} disabled={loading}>
                        <RefreshCw size={14} className={loading && !isCreating ? "animate-spin" : ""} />
                        Refresh
                    </button>
                </div>
            </div>

            {error && (
                <div className="sh-alert error">
                    <AlertCircle size={16} />
                    <span>{error}</span>
                </div>
            )}

            {isCreating && (
                <div className="sh-card new-cron-card" style={{ borderLeft: '3px solid #3b82f6' }}>
                    <h3>Create New Cron Job</h3>

                    <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                        <div className="sh-input-group" style={{ flex: 1 }}>
                            <label style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '-4px' }}>Minute</label>
                            <input className="sh-input" value={newJob.minute} onChange={e => setNewJob({ ...newJob, minute: e.target.value })} placeholder="0-59, *" />
                        </div>
                        <div className="sh-input-group" style={{ flex: 1 }}>
                            <label style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '-4px' }}>Hour</label>
                            <input className="sh-input" value={newJob.hour} onChange={e => setNewJob({ ...newJob, hour: e.target.value })} placeholder="0-23, *" />
                        </div>
                        <div className="sh-input-group" style={{ flex: 1 }}>
                            <label style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '-4px' }}>Day of Month</label>
                            <input className="sh-input" value={newJob.dayOfMonth} onChange={e => setNewJob({ ...newJob, dayOfMonth: e.target.value })} placeholder="1-31, *" />
                        </div>
                        <div className="sh-input-group" style={{ flex: 1 }}>
                            <label style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '-4px' }}>Month</label>
                            <input className="sh-input" value={newJob.month} onChange={e => setNewJob({ ...newJob, month: e.target.value })} placeholder="1-12, *" />
                        </div>
                        <div className="sh-input-group" style={{ flex: 1 }}>
                            <label style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '-4px' }}>Day of Week</label>
                            <input className="sh-input" value={newJob.dayOfWeek} onChange={e => setNewJob({ ...newJob, dayOfWeek: e.target.value })} placeholder="0-6, *" />
                        </div>
                    </div>

                    <div className="sh-input-group">
                        <label style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '-4px' }}>Command to Execute</label>
                        <input
                            className="sh-input"
                            style={{ fontFamily: 'monospace' }}
                            value={newJob.command}
                            onChange={e => setNewJob({ ...newJob, command: e.target.value })}
                            placeholder="/usr/bin/python3 /path/to/script.py"
                        />
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
                        <button className="sh-btn" onClick={() => setIsCreating(false)}>Cancel</button>
                        <button className="sh-btn primary" onClick={handleAddJob} disabled={!newJob.command.trim() || loading}>
                            <Save size={14} /> Save Job
                        </button>
                    </div>
                </div>
            )}

            <div className="sh-card">
                <div className="sh-card-header">
                    <h3>Active Jobs ({jobs.length})</h3>
                </div>

                {jobs.length === 0 && !loading ? (
                    <div className="sh-empty-state">
                        <Clock size={32} opacity={0.5} />
                        <p>No cron jobs found for the current user.</p>
                    </div>
                ) : (
                    <div className="sh-list">
                        {jobs.map((job) => (
                            <div key={job.id} className="sh-list-item">
                                <div className="sh-list-icon">
                                    <Clock size={16} />
                                </div>
                                <div className="sh-list-content">
                                    <div className="sh-list-title" style={{ fontFamily: 'monospace', color: '#4af626', fontSize: '13px' }}>
                                        {job.command}
                                    </div>
                                    <div className="sh-list-desc">
                                        <span className="sh-badge">
                                            {job.special ? job.special : `${job.minute} ${job.hour} ${job.dayOfMonth} ${job.month} ${job.dayOfWeek}`}
                                        </span>
                                    </div>
                                </div>
                                <div className="sh-list-actions">
                                    <button className="sh-icon-btn danger" title="Remove Job" onClick={() => handleRemoveJob(job.raw)}>
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
