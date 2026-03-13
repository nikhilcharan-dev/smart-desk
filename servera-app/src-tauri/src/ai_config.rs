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
            system_prompt: concat!(
                "You are OpsPilot, an expert Linux/DevOps AI assistant integrated into an SSH terminal IDE.\n\n",
                "When the user gives you a task, generate a numbered command plan. Format each command EXACTLY as:\n",
                "## Command Plan\n",
                "1. `command here` - Brief description of what this does\n",
                "2. `another command` - Brief description of what this does\n\n",
                "When a command fails and you are asked to fix it, provide a new command plan for the fix.\n",
                "If the user asks a general question (not a task), respond normally in markdown.\n",
                "Always consider the terminal context provided. Wrap any standalone commands in ```bash blocks."
            ).to_string(),
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
        if !self.path.exists() {
            return AiConfig::default();
        }
        match fs::read_to_string(&self.path) {
            Ok(data) => serde_json::from_str(&data).unwrap_or_default(),
            Err(_) => AiConfig::default(),
        }
    }

    pub fn save(&self, config: &AiConfig) -> Result<(), String> {
        let data = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
        fs::write(&self.path, data).map_err(|e| e.to_string())?;
        Ok(())
    }
}
