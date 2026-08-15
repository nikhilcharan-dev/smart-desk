import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Sparkles, Save, RotateCcw, Wifi, WifiOff, Loader2, CheckCircle2, Eye, EyeOff, Server, Brain, Database } from "lucide-react";
import "./AppConfig.css";

const PROVIDERS = [
    { id: "ollama", label: "Ollama", icon: Server },
    { id: "openai", label: "OpenAI", icon: Brain },
    { id: "gemini", label: "Gemini", icon: Sparkles },
    { id: "bedrock", label: "Bedrock", icon: Database },
];

const OLLAMA_PRESETS = [
    { label: "Qwen 2.5 Coder", endpoint: "http://127.0.0.1:11434", model: "qwen2.5-coder:7b" },
    { label: "Llama 3", endpoint: "http://127.0.0.1:11434", model: "llama3:8b" },
    { label: "CodeGemma", endpoint: "http://127.0.0.1:11434", model: "codegemma:7b" },
];

const OPENAI_MODELS = ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-4", "gpt-3.5-turbo", "o1-preview", "o1-mini"];
const GEMINI_MODELS = ["gemini-1.5-flash", "gemini-1.5-pro", "gemini-pro", "gemini-2.0-flash"];

const BEDROCK_PRESETS = [
    { label: "Claude 3.5 Sonnet", model_id: "anthropic.claude-3-5-sonnet-20241022-v2:0" },
    { label: "Claude 3 Haiku", model_id: "anthropic.claude-3-haiku-20240307-v1:0" },
    { label: "Llama 3.1 70B", model_id: "meta.llama3-1-70b-instruct-v1:0" },
    { label: "Mistral Large", model_id: "mistral.mistral-large-2407-v1:0" },
];

const AWS_REGIONS = [
    "us-east-1", "us-west-2", "eu-west-1", "eu-central-1",
    "ap-southeast-1", "ap-northeast-1", "ap-south-1",
];

const DEFAULT_CONFIG = {
    enabled: true,
    provider: "ollama",
    system_prompt: "You are OpsPilot, an expert Linux/DevOps AI assistant embedded in an SSH terminal IDE.\n\n## RESPONSE FORMAT RULES (MANDATORY)\n\nWhen the user asks you to DO something (install, configure, debug, deploy, check, etc.), respond with a **Command Plan** using this EXACT format:\n\n## Command Plan\n1. `exact_shell_command_here` - One-line description\n2. `another_command` - One-line description\n\n### STRICT RULES:\n- Each line MUST start with a number, period, space, then the command in SINGLE backticks, then \" - \", then a SHORT description.\n- The backticks must contain ONLY the executable shell command. NO explanations, NO comments, NO prose inside backticks.\n- Do NOT add `# comments` inside the backtick command.\n- Do NOT prefix commands with words like \"Run:\", \"Execute:\", \"Then:\".\n- Do NOT wrap commands in ```bash code blocks when using the numbered plan format.\n- Do NOT add extra paragraphs, warnings, or explanations between the numbered commands.\n- Keep descriptions under 12 words.\n- If a single task needs a multi-line script (heredoc, loop), put the ENTIRE script as one command entry.\n\n### EXAMPLE (correct):\n## Command Plan\n1. `sudo apt update` - Refresh package index\n2. `sudo apt install -y nginx` - Install Nginx web server\n3. `sudo systemctl enable --now nginx` - Enable and start Nginx\n\n### EXAMPLE (WRONG — never do this):\n1. `sudo apt update # refresh packages` - Refresh package index\n1. `Run: sudo apt update` - Refresh package index\n1. First, update packages: `sudo apt update`\n\n## QUESTION MODE\nIf the user asks a general knowledge question (not a task), respond in clean markdown WITHOUT a command plan. You may include ```bash blocks for illustrative code snippets.\n\n## ERROR RECOVERY\nWhen a command fails and you are given the terminal output, analyze the error and respond with a NEW Command Plan to fix it. Do NOT repeat the explanation of what went wrong outside the plan.\n\n## CONTEXT\nYou receive the last 100 lines of terminal output with each message. Use this context to understand the current state (OS, directory, running services, errors).",
    ollama: { endpoint: "http://127.0.0.1:11434", model: "qwen2.5-coder:7b" },
    openai: { api_key: "", model: "gpt-4o", endpoint: null },
    gemini: { api_key: "", model: "gemini-1.5-flash" },
    bedrock: { region: "us-east-1", access_key_id: "", secret_access_key: "", model_id: "anthropic.claude-3-5-sonnet-20241022-v2:0" },
};

export default function AISettings() {
    const [config, setConfig] = useState(DEFAULT_CONFIG);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState(null);
    const [availableModels, setAvailableModels] = useState([]);
    const [showApiKey, setShowApiKey] = useState(false);
    const [showSecret, setShowSecret] = useState(false);

    useEffect(() => {
        invoke("load_ai_config").then(cfg => {
            setConfig(prev => ({ ...prev, ...cfg }));
        }).catch(console.error);
    }, []);

    const updateProvider = (key, field, value) => {
        setConfig(prev => ({
            ...prev,
            [key]: { ...prev[key], [field]: value },
        }));
    };

    const handleSave = async () => {
        setSaving(true);
        setSaved(false);
        try {
            await invoke("save_ai_config", { config });
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } catch (err) {
            alert("Failed to save: " + err);
        } finally {
            setSaving(false);
        }
    };

    const handleTest = async () => {
        setTesting(true);
        setTestResult(null);
        setAvailableModels([]);
        try {
            await invoke("save_ai_config", { config });
            const raw = await invoke("test_ai_connection");
            const data = JSON.parse(raw);
            setAvailableModels(data.models || []);
            setTestResult({ ok: data.ok, message: data.message });
        } catch (err) {
            setTestResult({ ok: false, message: String(err) });
        } finally {
            setTesting(false);
        }
    };

    const handleReset = () => {
        setConfig(DEFAULT_CONFIG);
        setAvailableModels([]);
        setTestResult(null);
    };

    const activeProvider = config.provider;

    return (
        <div className="ai-settings-container">
            <div className="ai-settings-header">
                <Sparkles size={24} color="#79c0ff" />
                <div>
                    <h2>AI Configuration</h2>
                    <p className="ai-settings-subtitle">Configure your AI provider, model, and system prompt</p>
                </div>
            </div>

            {/* Enable/Disable Toggle */}
            <div className="ai-settings-section">
                <label className="ai-settings-toggle">
                    <input
                        type="checkbox"
                        checked={config.enabled}
                        onChange={e => setConfig(prev => ({ ...prev, enabled: e.target.checked }))}
                    />
                    <span className="toggle-slider"></span>
                    <span className="toggle-label">AI Features Enabled</span>
                </label>
            </div>

            {/* Provider Selector */}
            <div className="ai-settings-section">
                <label className="ai-settings-label">Provider</label>
                <div className="ai-provider-tabs">
                    {PROVIDERS.map(p => {
                        const Icon = p.icon;
                        return (
                            <button
                                key={p.id}
                                className={`ai-provider-tab ${activeProvider === p.id ? "active" : ""}`}
                                onClick={() => {
                                    setConfig(prev => ({ ...prev, provider: p.id }));
                                    setAvailableModels([]);
                                    setTestResult(null);
                                }}
                            >
                                <Icon size={16} />
                                <span>{p.label}</span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Provider-Specific Configuration */}
            <div className="ai-provider-config">

                {/* OLLAMA */}
                {activeProvider === "ollama" && (
                    <>
                        <div className="ai-settings-section">
                            <label className="ai-settings-label">Quick Presets</label>
                            <div className="ai-presets-row">
                                {OLLAMA_PRESETS.map((preset, i) => (
                                    <button key={i} className="ai-preset-btn" onClick={() => {
                                        updateProvider("ollama", "endpoint", preset.endpoint);
                                        updateProvider("ollama", "model", preset.model);
                                    }}>
                                        {preset.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="ai-settings-section">
                            <label className="ai-settings-label">Endpoint URL</label>
                            <div className="ai-input-row">
                                <input
                                    className="ai-settings-input"
                                    value={config.ollama.endpoint}
                                    onChange={e => updateProvider("ollama", "endpoint", e.target.value)}
                                    placeholder="http://127.0.0.1:11434"
                                />
                                <button className="ai-test-btn" onClick={handleTest} disabled={testing}>
                                    {testing ? <Loader2 size={14} className="animate-spin" /> : <Wifi size={14} />}
                                    {testing ? "Testing..." : "Test"}
                                </button>
                            </div>
                            <p className="ai-settings-hint">Ollama-compatible API endpoint</p>
                        </div>
                        <div className="ai-settings-section">
                            <label className="ai-settings-label">Model</label>
                            {availableModels.length > 0 ? (
                                <select
                                    className="ai-settings-input"
                                    value={config.ollama.model}
                                    onChange={e => updateProvider("ollama", "model", e.target.value)}
                                >
                                    {!availableModels.includes(config.ollama.model) && (
                                        <option value={config.ollama.model}>{config.ollama.model} (current)</option>
                                    )}
                                    {availableModels.map(m => (
                                        <option key={m} value={m}>{m}</option>
                                    ))}
                                </select>
                            ) : (
                                <input
                                    className="ai-settings-input"
                                    value={config.ollama.model}
                                    onChange={e => updateProvider("ollama", "model", e.target.value)}
                                    placeholder="qwen2.5-coder:7b"
                                />
                            )}
                            <p className="ai-settings-hint">Click "Test" to auto-detect available models</p>
                        </div>
                    </>
                )}

                {/* OPENAI */}
                {activeProvider === "openai" && (
                    <>
                        <div className="ai-settings-section">
                            <label className="ai-settings-label">API Key</label>
                            <div className="ai-input-row">
                                <div className="ai-password-wrapper">
                                    <input
                                        className="ai-settings-input"
                                        type={showApiKey ? "text" : "password"}
                                        value={config.openai.api_key}
                                        onChange={e => updateProvider("openai", "api_key", e.target.value)}
                                        placeholder="sk-..."
                                    />
                                    <button className="ai-eye-btn" onClick={() => setShowApiKey(!showApiKey)} type="button">
                                        {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                                    </button>
                                </div>
                                <button className="ai-test-btn" onClick={handleTest} disabled={testing}>
                                    {testing ? <Loader2 size={14} className="animate-spin" /> : <Wifi size={14} />}
                                    {testing ? "Testing..." : "Test"}
                                </button>
                            </div>
                            <p className="ai-settings-hint">Get your API key from platform.openai.com</p>
                        </div>
                        <div className="ai-settings-section">
                            <label className="ai-settings-label">Model</label>
                            {availableModels.length > 0 ? (
                                <select
                                    className="ai-settings-input"
                                    value={config.openai.model}
                                    onChange={e => updateProvider("openai", "model", e.target.value)}
                                >
                                    {!availableModels.includes(config.openai.model) && (
                                        <option value={config.openai.model}>{config.openai.model} (current)</option>
                                    )}
                                    {availableModels.map(m => (
                                        <option key={m} value={m}>{m}</option>
                                    ))}
                                </select>
                            ) : (
                                <select
                                    className="ai-settings-input"
                                    value={config.openai.model}
                                    onChange={e => updateProvider("openai", "model", e.target.value)}
                                >
                                    {OPENAI_MODELS.map(m => (
                                        <option key={m} value={m}>{m}</option>
                                    ))}
                                </select>
                            )}
                        </div>
                        <div className="ai-settings-section">
                            <label className="ai-settings-label">Custom Endpoint (Optional)</label>
                            <input
                                className="ai-settings-input"
                                value={config.openai.endpoint || ""}
                                onChange={e => updateProvider("openai", "endpoint", e.target.value || null)}
                                placeholder="https://api.openai.com (default)"
                            />
                            <p className="ai-settings-hint">For Azure OpenAI or compatible APIs. Leave blank for default.</p>
                        </div>
                    </>
                )}

                {/* GEMINI */}
                {activeProvider === "gemini" && (
                    <>
                        <div className="ai-settings-section">
                            <label className="ai-settings-label">API Key</label>
                            <div className="ai-input-row">
                                <div className="ai-password-wrapper">
                                    <input
                                        className="ai-settings-input"
                                        type={showApiKey ? "text" : "password"}
                                        value={config.gemini.api_key}
                                        onChange={e => updateProvider("gemini", "api_key", e.target.value)}
                                        placeholder="AIza..."
                                    />
                                    <button className="ai-eye-btn" onClick={() => setShowApiKey(!showApiKey)} type="button">
                                        {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                                    </button>
                                </div>
                                <button className="ai-test-btn" onClick={handleTest} disabled={testing}>
                                    {testing ? <Loader2 size={14} className="animate-spin" /> : <Wifi size={14} />}
                                    {testing ? "Testing..." : "Test"}
                                </button>
                            </div>
                            <p className="ai-settings-hint">Get your API key from aistudio.google.com</p>
                        </div>
                        <div className="ai-settings-section">
                            <label className="ai-settings-label">Model</label>
                            {availableModels.length > 0 ? (
                                <select
                                    className="ai-settings-input"
                                    value={config.gemini.model}
                                    onChange={e => updateProvider("gemini", "model", e.target.value)}
                                >
                                    {!availableModels.includes(config.gemini.model) && (
                                        <option value={config.gemini.model}>{config.gemini.model} (current)</option>
                                    )}
                                    {availableModels.map(m => (
                                        <option key={m} value={m}>{m}</option>
                                    ))}
                                </select>
                            ) : (
                                <select
                                    className="ai-settings-input"
                                    value={config.gemini.model}
                                    onChange={e => updateProvider("gemini", "model", e.target.value)}
                                >
                                    {GEMINI_MODELS.map(m => (
                                        <option key={m} value={m}>{m}</option>
                                    ))}
                                </select>
                            )}
                        </div>
                    </>
                )}

                {/* BEDROCK */}
                {activeProvider === "bedrock" && (
                    <>
                        <div className="ai-settings-section">
                            <label className="ai-settings-label">Model Presets</label>
                            <div className="ai-presets-row">
                                {BEDROCK_PRESETS.map((preset, i) => (
                                    <button key={i} className="ai-preset-btn" onClick={() => {
                                        updateProvider("bedrock", "model_id", preset.model_id);
                                    }}>
                                        {preset.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="ai-settings-section">
                            <label className="ai-settings-label">AWS Region</label>
                            <select
                                className="ai-settings-input"
                                value={config.bedrock.region}
                                onChange={e => updateProvider("bedrock", "region", e.target.value)}
                            >
                                {AWS_REGIONS.map(r => (
                                    <option key={r} value={r}>{r}</option>
                                ))}
                            </select>
                        </div>
                        <div className="ai-settings-section">
                            <label className="ai-settings-label">Access Key ID</label>
                            <input
                                className="ai-settings-input"
                                value={config.bedrock.access_key_id}
                                onChange={e => updateProvider("bedrock", "access_key_id", e.target.value)}
                                placeholder="AKIA..."
                            />
                        </div>
                        <div className="ai-settings-section">
                            <label className="ai-settings-label">Secret Access Key</label>
                            <div className="ai-password-wrapper">
                                <input
                                    className="ai-settings-input"
                                    type={showSecret ? "text" : "password"}
                                    value={config.bedrock.secret_access_key}
                                    onChange={e => updateProvider("bedrock", "secret_access_key", e.target.value)}
                                    placeholder="Secret key..."
                                />
                                <button className="ai-eye-btn" onClick={() => setShowSecret(!showSecret)} type="button">
                                    {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
                                </button>
                            </div>
                        </div>
                        <div className="ai-settings-section">
                            <label className="ai-settings-label">Model ID</label>
                            <div className="ai-input-row">
                                <input
                                    className="ai-settings-input"
                                    value={config.bedrock.model_id}
                                    onChange={e => updateProvider("bedrock", "model_id", e.target.value)}
                                    placeholder="anthropic.claude-3-sonnet-20240229-v1:0"
                                />
                                <button className="ai-test-btn" onClick={handleTest} disabled={testing}>
                                    {testing ? <Loader2 size={14} className="animate-spin" /> : <Wifi size={14} />}
                                    {testing ? "Testing..." : "Test"}
                                </button>
                            </div>
                            <p className="ai-settings-hint">Enter the full Bedrock model ID (e.g. anthropic.claude-3-5-sonnet-20241022-v2:0)</p>
                        </div>
                    </>
                )}
            </div>

            {/* Test Result */}
            {testResult && (
                <div className={`ai-test-result ${testResult.ok ? "success" : "error"}`}>
                    {testResult.ok ? <CheckCircle2 size={14} /> : <WifiOff size={14} />}
                    <span>{testResult.message}</span>
                </div>
            )}

            {/* System Prompt */}
            <div className="ai-settings-section">
                <label className="ai-settings-label">System Prompt</label>
                <textarea
                    className="ai-settings-textarea"
                    value={config.system_prompt}
                    onChange={e => setConfig(prev => ({ ...prev, system_prompt: e.target.value }))}
                    rows={6}
                    placeholder="You are OpsPilot..."
                />
                <p className="ai-settings-hint">
                    Instructions given to the AI at the start of every conversation.
                </p>
            </div>

            {/* Actions */}
            <div className="ai-settings-actions">
                <button className="ai-action-btn secondary" onClick={handleReset}>
                    <RotateCcw size={14} /> Reset to Defaults
                </button>
                <button className="ai-action-btn primary" onClick={handleSave} disabled={saving}>
                    {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <CheckCircle2 size={14} /> : <Save size={14} />}
                    {saving ? "Saving..." : saved ? "Saved!" : "Save Configuration"}
                </button>
            </div>
        </div>
    );
}
