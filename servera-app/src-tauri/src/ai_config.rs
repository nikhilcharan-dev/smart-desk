use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/* =========================
   PROVIDER ENUM
   ========================= */

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AiProvider {
    Ollama,
    Openai,
    Gemini,
    Bedrock,
}

/* =========================
   PROVIDER-SPECIFIC SETTINGS
   ========================= */

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct OllamaSettings {
    pub endpoint: String,
    pub model: String,
}

impl Default for OllamaSettings {
    fn default() -> Self {
        Self {
            endpoint: "http://127.0.0.1:11434".to_string(),
            model: "qwen2.5-coder:7b".to_string(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct OpenAiSettings {
    pub api_key: String,
    pub model: String,
    /// Optional custom endpoint (e.g. Azure OpenAI, compatible APIs)
    #[serde(default)]
    pub endpoint: Option<String>,
}

impl Default for OpenAiSettings {
    fn default() -> Self {
        Self {
            api_key: String::new(),
            model: "gpt-4o".to_string(),
            endpoint: None,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GeminiSettings {
    pub api_key: String,
    pub model: String,
}

impl Default for GeminiSettings {
    fn default() -> Self {
        Self {
            api_key: String::new(),
            model: "gemini-1.5-flash".to_string(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct BedrockSettings {
    pub region: String,
    pub access_key_id: String,
    pub secret_access_key: String,
    pub model_id: String,
}

impl Default for BedrockSettings {
    fn default() -> Self {
        Self {
            region: "us-east-1".to_string(),
            access_key_id: String::new(),
            secret_access_key: String::new(),
            model_id: "anthropic.claude-3-sonnet-20240229-v1:0".to_string(),
        }
    }
}

/* =========================
   MAIN AI CONFIG
   ========================= */

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AiConfig {
    pub enabled: bool,
    pub provider: AiProvider,
    pub system_prompt: String,
    #[serde(default)]
    pub ollama: OllamaSettings,
    #[serde(default)]
    pub openai: OpenAiSettings,
    #[serde(default)]
    pub gemini: GeminiSettings,
    #[serde(default)]
    pub bedrock: BedrockSettings,
}

impl Default for AiConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            provider: AiProvider::Ollama,
            system_prompt: r#"You are OpsPilot, an expert Linux/DevOps AI assistant embedded in an SSH terminal IDE.

## RESPONSE FORMAT RULES (MANDATORY)

When the user asks you to DO something (install, configure, debug, deploy, check, etc.), respond with a Command Plan as a single fenced JSON code block tagged opsplan:

```opsplan
[
  { "command": "sudo apt update", "description": "Refresh package index" },
  { "command": "sudo apt install -y nginx", "description": "Install Nginx web server" }
]
```

### STRICT RULES:
- The block must be valid JSON: an array of objects, each with exactly "command" and "description" string fields.
- "command" must contain ONLY the executable shell command — no comments, no prose, no "Run:"/"Execute:" prefixes.
- If a single task needs a multi-line script (heredoc, loop, if/else), put the ENTIRE script as one "command" string, using literal newlines inside the JSON string for line breaks.
- Do NOT add any text before or after the opsplan block when giving a command plan.
- Do NOT emit a plain bash code block for a task — only use the opsplan format.

## QUESTION MODE
If the user asks a general knowledge question (not a task), respond in clean markdown WITHOUT a command plan. You may include bash code blocks for illustrative snippets — these are never executed.

## ERROR RECOVERY
When a command fails or times out and you are given the terminal output, analyze the error and respond with a NEW opsplan block to fix it. Do NOT repeat the explanation of what went wrong outside the plan.

## CONTEXT
You receive the last 100 lines of terminal output with each message. Use this context to understand the current state (OS, directory, running services, errors)."#.to_string(),
            ollama: OllamaSettings::default(),
            openai: OpenAiSettings::default(),
            gemini: GeminiSettings::default(),
            bedrock: BedrockSettings::default(),
        }
    }
}

/* =========================
   CONFIG PERSISTENCE
   ========================= */

pub struct AiConfigManager {
    path: PathBuf,
}

impl AiConfigManager {
    pub fn new(app: &AppHandle) -> Self {
        let path = app
            .path()
            .app_data_dir()
            .unwrap()
            .join("ai_config.json");

        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }

        Self { path }
    }

    pub fn load(&self) -> AiConfig {
        let mut config = if !self.path.exists() {
            AiConfig::default()
        } else {
            match fs::read_to_string(&self.path) {
                Ok(data) => serde_json::from_str(&data).unwrap_or_default(),
                Err(_) => AiConfig::default(),
            }
        };
        // Rehydrate secrets from the OS keyring — they are never stored in the
        // JSON file. A key still present in the JSON (pre-migration config) is
        // left as-is and gets moved to the keyring on the next save.
        if let Ok(k) = crate::profile_manager::get_password(SVC_OPENAI, KEY_USER) {
            config.openai.api_key = k;
        }
        if let Ok(k) = crate::profile_manager::get_password(SVC_GEMINI, KEY_USER) {
            config.gemini.api_key = k;
        }
        if let Ok(k) = crate::profile_manager::get_password(SVC_BEDROCK, KEY_USER) {
            config.bedrock.secret_access_key = k;
        }
        config
    }

    pub fn save(&self, config: &AiConfig) -> Result<(), String> {
        // Secrets go to the OS keyring, never the plaintext JSON. An empty value
        // means the user cleared the key, so the keyring entry is removed too.
        let mut sanitized = config.clone();
        for (svc, val) in [
            (SVC_OPENAI, &mut sanitized.openai.api_key),
            (SVC_GEMINI, &mut sanitized.gemini.api_key),
            (SVC_BEDROCK, &mut sanitized.bedrock.secret_access_key),
        ] {
            if val.trim().is_empty() {
                let _ = crate::profile_manager::delete_password(svc, KEY_USER);
            } else {
                crate::profile_manager::save_password(svc, KEY_USER, val)?;
            }
            val.clear();
        }
        let data = serde_json::to_string_pretty(&sanitized).map_err(|e| e.to_string())?;
        fs::write(&self.path, data).map_err(|e| e.to_string())?;
        Ok(())
    }
}

// Keyring service names for AI provider secrets. Access key IDs and regions are
// non-secret and remain in the JSON; only the actual secret keys are moved here.
const SVC_OPENAI: &str = "servera-ai-openai";
const SVC_GEMINI: &str = "servera-ai-gemini";
const SVC_BEDROCK: &str = "servera-ai-bedrock";
const KEY_USER: &str = "default";
