import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { BookOpen, Play, RefreshCw, AlertCircle, X, FileCode, Eye } from "lucide-react";
import { MAIN_SESSION_ID } from "../../utils/terminal";
import "./PlaybookRunner.css";

export default function PlaybookRunner() {
    const [ansibleVersion, setAnsibleVersion] = useState(null);
    const [terraformVersion, setTerraformVersion] = useState(null);
    const [playbooks, setPlaybooks] = useState([]);
    const [tfDirs, setTfDirs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [output, setOutput] = useState(null); // { title, text, running }
    const [customCmd, setCustomCmd] = useState("");

    const detect = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            // Detect Ansible
            const ansibleOut = await invoke("exec_ssh_command", {
                sessionId: MAIN_SESSION_ID,
                command: "ansible --version 2>/dev/null | head -1 || echo '__absent__'"
            });
            setAnsibleVersion(ansibleOut.includes('__absent__') ? null : ansibleOut.trim());

            // Detect Terraform
            const tfOut = await invoke("exec_ssh_command", {
                sessionId: MAIN_SESSION_ID,
                command: "terraform version 2>/dev/null | head -1 || echo '__absent__'"
            });
            setTerraformVersion(tfOut.includes('__absent__') ? null : tfOut.trim());

            // Find playbooks (*.yml in common locations)
            if (!ansibleOut.includes('__absent__')) {
                const pbOut = await invoke("exec_ssh_command", {
                    sessionId: MAIN_SESSION_ID,
                    command: "find /home /root /opt /etc/ansible -maxdepth 4 -name '*.yml' -path '*/playbook*' -o -name 'site.yml' -o -name 'main.yml' -path '*/ansible/*' 2>/dev/null | head -30"
                });
                const found = pbOut.split('\n').filter(l => l.trim()).map(path => {
                    const name = path.split('/').pop();
                    return { name, path };
                });
                setPlaybooks(found);
            }

            // Find Terraform directories
            if (!tfOut.includes('__absent__')) {
                const tfDirOut = await invoke("exec_ssh_command", {
                    sessionId: MAIN_SESSION_ID,
                    command: "find /home /root /opt -maxdepth 4 -name '*.tf' 2>/dev/null | sed 's|/[^/]*$||' | sort -u | head -20"
                });
                const dirs = tfDirOut.split('\n').filter(l => l.trim()).map(dir => ({
                    dir,
                    name: dir.split('/').filter(Boolean).pop() || dir,
                }));
                setTfDirs(dirs);
            }
        } catch (err) {
            setError(String(err));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { detect(); }, [detect]);

    const runPlaybook = async (path) => {
        setOutput({ title: `ansible-playbook ${path}`, text: '', running: true });
        try {
            const result = await invoke("exec_ssh_command", {
                sessionId: MAIN_SESSION_ID,
                command: `ansible-playbook ${path} 2>&1`
            });
            setOutput(prev => ({ ...prev, text: result, running: false }));
        } catch (err) {
            setOutput(prev => ({ ...prev, text: `Error: ${err}`, running: false }));
        }
    };

    const runDryRun = async (path) => {
        setOutput({ title: `ansible-playbook --check ${path}`, text: '', running: true });
        try {
            const result = await invoke("exec_ssh_command", {
                sessionId: MAIN_SESSION_ID,
                command: `ansible-playbook --check ${path} 2>&1`
            });
            setOutput(prev => ({ ...prev, text: result, running: false }));
        } catch (err) {
            setOutput(prev => ({ ...prev, text: `Error: ${err}`, running: false }));
        }
    };

    const runTerraform = async (dir, action) => {
        setOutput({ title: `terraform ${action} (${dir})`, text: '', running: true });
        try {
            const result = await invoke("exec_ssh_command", {
                sessionId: MAIN_SESSION_ID,
                command: `cd ${dir} && terraform ${action} 2>&1`
            });
            setOutput(prev => ({ ...prev, text: result, running: false }));
        } catch (err) {
            setOutput(prev => ({ ...prev, text: `Error: ${err}`, running: false }));
        }
    };

    const runCustom = async () => {
        if (!customCmd.trim()) return;
        setOutput({ title: customCmd, text: '', running: true });
        try {
            const result = await invoke("exec_ssh_command", {
                sessionId: MAIN_SESSION_ID,
                command: `${customCmd.trim()} 2>&1`
            });
            setOutput(prev => ({ ...prev, text: result, running: false }));
        } catch (err) {
            setOutput(prev => ({ ...prev, text: `Error: ${err}`, running: false }));
        }
    };

    return (
        <div className="pb-container">
            <div className="pb-header">
                <div>
                    <h2>Playbook Runner</h2>
                    <p className="pb-subtitle">Observe and trigger Ansible playbooks & Terraform plans</p>
                </div>
                <button className="pb-action-btn" onClick={detect} disabled={loading}>
                    <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
                    Detect
                </button>
            </div>

            {error && (
                <div className="pb-error">
                    <AlertCircle size={16} />
                    <span>{error}</span>
                    <button onClick={() => setError(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}>
                        <X size={14} />
                    </button>
                </div>
            )}

            {/* Tool detection */}
            <div className="pb-detect-grid">
                <div className="pb-detect-card">
                    <div className="pb-detect-header">
                        <div className={`pb-detect-icon ${ansibleVersion ? 'ansible' : 'absent'}`}>A</div>
                        <div>
                            <div className="pb-detect-title">Ansible</div>
                            <div className="pb-detect-version">{ansibleVersion || 'Not detected'}</div>
                        </div>
                        <span className={`pb-detect-badge ${ansibleVersion ? 'installed' : 'missing'}`} style={{ marginLeft: 'auto' }}>
                            {ansibleVersion ? 'INSTALLED' : 'MISSING'}
                        </span>
                    </div>
                </div>
                <div className="pb-detect-card">
                    <div className="pb-detect-header">
                        <div className={`pb-detect-icon ${terraformVersion ? 'terraform' : 'absent'}`}>T</div>
                        <div>
                            <div className="pb-detect-title">Terraform</div>
                            <div className="pb-detect-version">{terraformVersion || 'Not detected'}</div>
                        </div>
                        <span className={`pb-detect-badge ${terraformVersion ? 'installed' : 'missing'}`} style={{ marginLeft: 'auto' }}>
                            {terraformVersion ? 'INSTALLED' : 'MISSING'}
                        </span>
                    </div>
                </div>
            </div>

            {/* Ansible playbooks */}
            {ansibleVersion && (
                <div className="pb-section">
                    <h3><FileCode size={16} style={{ color: '#ef4444' }} /> Ansible Playbooks ({playbooks.length})</h3>
                    {playbooks.length === 0 ? (
                        <div className="pb-empty">
                            <span>No playbooks found in standard locations</span>
                            <span style={{ fontSize: 11 }}>Searched /home, /root, /opt, /etc/ansible</span>
                        </div>
                    ) : (
                        <div className="pb-playbook-list">
                            {playbooks.map((pb, i) => (
                                <div key={i} className="pb-playbook-item">
                                    <FileCode size={16} style={{ color: '#ef4444', flexShrink: 0 }} />
                                    <span className="pb-playbook-name">{pb.name}</span>
                                    <span className="pb-playbook-path">{pb.path}</span>
                                    <button className="pb-run-btn" onClick={() => runDryRun(pb.path)} disabled={output?.running}
                                        title="Dry run (--check)">
                                        <Eye size={12} /> Check
                                    </button>
                                    <button className="pb-run-btn" onClick={() => runPlaybook(pb.path)} disabled={output?.running}>
                                        <Play size={12} /> Run
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="pb-custom-bar">
                        <input
                            className="pb-custom-input"
                            placeholder="ansible-playbook /path/to/playbook.yml -i inventory ..."
                            value={customCmd}
                            onChange={e => setCustomCmd(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && runCustom()}
                            spellCheck={false}
                        />
                        <button className="pb-run-btn" onClick={runCustom} disabled={output?.running || !customCmd.trim()}>
                            <Play size={12} /> Run Custom
                        </button>
                    </div>
                </div>
            )}

            {/* Terraform directories */}
            {terraformVersion && (
                <div className="pb-section">
                    <h3><BookOpen size={16} style={{ color: '#8b5cf6' }} /> Terraform Projects ({tfDirs.length})</h3>
                    {tfDirs.length === 0 ? (
                        <div className="pb-empty">
                            <span>No Terraform projects found</span>
                        </div>
                    ) : (
                        <div className="pb-playbook-list">
                            {tfDirs.map((tf, i) => (
                                <div key={i} className="pb-playbook-item">
                                    <BookOpen size={16} style={{ color: '#8b5cf6', flexShrink: 0 }} />
                                    <span className="pb-playbook-name">{tf.name}</span>
                                    <span className="pb-playbook-path">{tf.dir}</span>
                                    <button className="pb-run-btn terraform" onClick={() => runTerraform(tf.dir, 'plan')}
                                        disabled={output?.running}>
                                        <Eye size={12} /> Plan
                                    </button>
                                    <button className="pb-run-btn terraform" onClick={() => runTerraform(tf.dir, 'apply -auto-approve')}
                                        disabled={output?.running}>
                                        <Play size={12} /> Apply
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Neither tool installed */}
            {!loading && !ansibleVersion && !terraformVersion && (
                <div className="pb-section">
                    <div className="pb-empty">
                        <BookOpen size={32} opacity={0.4} />
                        <span>No IaC tools detected on this server</span>
                        <span style={{ fontSize: 11, color: '#374151' }}>
                            Install Ansible or Terraform to unlock playbook management
                        </span>
                    </div>
                </div>
            )}

            {/* Output panel */}
            {output && (
                <div className="pb-output">
                    <div className="pb-output-header">
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {output.running && <RefreshCw size={12} className="animate-spin" />}
                            {output.title}
                        </span>
                        <button onClick={() => setOutput(null)}
                            style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer' }}>
                            <X size={14} />
                        </button>
                    </div>
                    <div className="pb-output-body">
                        {output.running && !output.text ? 'Executing...' : output.text || '(no output)'}
                    </div>
                </div>
            )}
        </div>
    );
}
