use crate::ai_config::{AiConfig, AiProvider, OllamaSettings, OpenAiSettings, GeminiSettings, BedrockSettings};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/* =========================
   SHARED TYPES
   ========================= */

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ProviderMessage {
    pub role: String,
    pub content: String,
}

#[derive(Serialize)]
pub struct TestResult {
    pub ok: bool,
    pub message: String,
    pub models: Vec<String>,
}

/* =========================
   PUBLIC DISPATCH FUNCTIONS
   ========================= */

pub async fn stream_chat(
    app: &AppHandle,
    config: &AiConfig,
    messages: Vec<ProviderMessage>,
) -> Result<(), String> {
    match config.provider {
        AiProvider::Ollama  => ollama_stream(app, &config.ollama, &config.system_prompt, messages).await,
        AiProvider::Openai  => openai_stream(app, &config.openai, &config.system_prompt, messages).await,
        AiProvider::Gemini  => gemini_stream(app, &config.gemini, &config.system_prompt, messages).await,
        AiProvider::Bedrock => bedrock_stream(app, &config.bedrock, &config.system_prompt, messages).await,
    }
}

pub async fn query_chat(
    config: &AiConfig,
    messages: Vec<ProviderMessage>,
) -> Result<String, String> {
    match config.provider {
        AiProvider::Ollama  => ollama_query(&config.ollama, &config.system_prompt, messages).await,
        AiProvider::Openai  => openai_query(&config.openai, &config.system_prompt, messages).await,
        AiProvider::Gemini  => gemini_query(&config.gemini, &config.system_prompt, messages).await,
        AiProvider::Bedrock => bedrock_query(&config.bedrock, &config.system_prompt, messages).await,
    }
}

pub async fn test_connection(config: &AiConfig) -> Result<TestResult, String> {
    match config.provider {
        AiProvider::Ollama  => ollama_test(&config.ollama).await,
        AiProvider::Openai  => openai_test(&config.openai).await,
        AiProvider::Gemini  => gemini_test(&config.gemini).await,
        AiProvider::Bedrock => bedrock_test(&config.bedrock).await,
    }
}

/* =========================
   OLLAMA
   ========================= */

#[derive(Serialize)]
struct OllamaChatRequest {
    model: String,
    messages: Vec<ProviderMessage>,
    stream: bool,
}

#[derive(Deserialize)]
struct OllamaChatResponse {
    message: ProviderMessage,
    done: bool,
}

fn build_messages_with_system(system_prompt: &str, messages: Vec<ProviderMessage>) -> Vec<ProviderMessage> {
    let mut all = Vec::new();
    if !system_prompt.is_empty() {
        all.push(ProviderMessage { role: "system".into(), content: system_prompt.into() });
    }
    all.extend(messages);
    all
}

async fn ollama_stream(
    app: &AppHandle,
    settings: &OllamaSettings,
    system_prompt: &str,
    messages: Vec<ProviderMessage>,
) -> Result<(), String> {
    let client = Client::new();
    let url = format!("{}/api/chat", settings.endpoint.trim_end_matches('/'));
    let request = OllamaChatRequest {
        model: settings.model.clone(),
        messages: build_messages_with_system(system_prompt, messages),
        stream: true,
    };

    let mut res = client.post(&url)
        .json(&request)
        .timeout(Duration::from_secs(120))
        .send()
        .await
        .map_err(|e| format!("Failed to reach Ollama at {}: {}", url, e))?;

    if !res.status().is_success() {
        return Err(format!("Ollama API Error: {} from {}", res.status(), url));
    }

    while let Ok(Some(chunk)) = res.chunk().await {
        if let Ok(text) = String::from_utf8(chunk.to_vec()) {
            for line in text.lines() {
                if !line.trim().is_empty() {
                    if let Ok(response) = serde_json::from_str::<OllamaChatResponse>(line) {
                        if response.done {
                            let _ = app.emit("ai-response-done", ());
                        } else {
                            let _ = app.emit("ai-response-chunk", &response.message.content);
                        }
                    }
                }
            }
        }
    }
    Ok(())
}

async fn ollama_query(
    settings: &OllamaSettings,
    system_prompt: &str,
    messages: Vec<ProviderMessage>,
) -> Result<String, String> {
    let client = Client::new();
    let url = format!("{}/api/chat", settings.endpoint.trim_end_matches('/'));
    let request = OllamaChatRequest {
        model: settings.model.clone(),
        messages: build_messages_with_system(system_prompt, messages),
        stream: false,
    };

    let res = client.post(&url)
        .json(&request)
        .timeout(Duration::from_secs(60))
        .send()
        .await
        .map_err(|e| format!("Failed to reach Ollama at {}: {}", url, e))?;

    if res.status().is_success() {
        let body: OllamaChatResponse = res.json().await.map_err(|e| e.to_string())?;
        Ok(body.message.content)
    } else {
        Err(format!("Ollama API Error: {} from {}", res.status(), url))
    }
}

async fn ollama_test(settings: &OllamaSettings) -> Result<TestResult, String> {
    let client = Client::new();
    let url = format!("{}/api/tags", settings.endpoint.trim_end_matches('/'));

    let res = client.get(&url)
        .timeout(Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| format!("Cannot reach Ollama at {}: {}", settings.endpoint, e))?;

    if !res.status().is_success() {
        return Err(format!("Ollama returned status {}", res.status()));
    }

    let body: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let models: Vec<String> = body.get("models")
        .and_then(|m| m.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m.get("name").or(m.get("model")).and_then(|n| n.as_str()).map(String::from))
                .collect()
        })
        .unwrap_or_default();

    Ok(TestResult {
        ok: true,
        message: format!("Connected! Found {} model(s).", models.len()),
        models,
    })
}

/* =========================
   OPENAI
   ========================= */

async fn openai_stream(
    app: &AppHandle,
    settings: &OpenAiSettings,
    system_prompt: &str,
    messages: Vec<ProviderMessage>,
) -> Result<(), String> {
    let client = Client::new();
    let base = settings.endpoint.as_deref().unwrap_or("https://api.openai.com");
    let url = format!("{}/v1/chat/completions", base.trim_end_matches('/'));

    let api_messages = build_messages_with_system(system_prompt, messages);
    let body = serde_json::json!({
        "model": settings.model,
        "messages": api_messages,
        "stream": true,
    });

    let mut res = client.post(&url)
        .header("Authorization", format!("Bearer {}", settings.api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .timeout(Duration::from_secs(120))
        .send()
        .await
        .map_err(|e| format!("Failed to reach OpenAI at {}: {}", url, e))?;

    if !res.status().is_success() {
        let status = res.status();
        let err_body = res.text().await.unwrap_or_default();
        return Err(format!("OpenAI API Error {}: {}", status, err_body));
    }

    let mut buffer = String::new();

    while let Ok(Some(chunk)) = res.chunk().await {
        if let Ok(text) = String::from_utf8(chunk.to_vec()) {
            buffer.push_str(&text);

            while let Some(newline_pos) = buffer.find('\n') {
                let line = buffer[..newline_pos].trim().to_string();
                buffer = buffer[newline_pos + 1..].to_string();

                if line.is_empty() { continue; }
                if line == "data: [DONE]" {
                    let _ = app.emit("ai-response-done", ());
                    return Ok(());
                }
                if let Some(json_str) = line.strip_prefix("data: ") {
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(json_str) {
                        if let Some(content) = parsed.pointer("/choices/0/delta/content").and_then(|c| c.as_str()) {
                            let _ = app.emit("ai-response-chunk", content);
                        }
                    }
                }
            }
        }
    }

    let _ = app.emit("ai-response-done", ());
    Ok(())
}

async fn openai_query(
    settings: &OpenAiSettings,
    system_prompt: &str,
    messages: Vec<ProviderMessage>,
) -> Result<String, String> {
    let client = Client::new();
    let base = settings.endpoint.as_deref().unwrap_or("https://api.openai.com");
    let url = format!("{}/v1/chat/completions", base.trim_end_matches('/'));

    let api_messages = build_messages_with_system(system_prompt, messages);
    let body = serde_json::json!({
        "model": settings.model,
        "messages": api_messages,
        "stream": false,
    });

    let res = client.post(&url)
        .header("Authorization", format!("Bearer {}", settings.api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .timeout(Duration::from_secs(60))
        .send()
        .await
        .map_err(|e| format!("Failed to reach OpenAI at {}: {}", url, e))?;

    if !res.status().is_success() {
        let status = res.status();
        let err_body = res.text().await.unwrap_or_default();
        return Err(format!("OpenAI API Error {}: {}", status, err_body));
    }

    let parsed: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    parsed.pointer("/choices/0/message/content")
        .and_then(|c| c.as_str())
        .map(String::from)
        .ok_or_else(|| "Unexpected OpenAI response format".into())
}

async fn openai_test(settings: &OpenAiSettings) -> Result<TestResult, String> {
    let client = Client::new();
    let base = settings.endpoint.as_deref().unwrap_or("https://api.openai.com");
    let url = format!("{}/v1/models", base.trim_end_matches('/'));

    let res = client.get(&url)
        .header("Authorization", format!("Bearer {}", settings.api_key))
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("Cannot reach OpenAI at {}: {}", base, e))?;

    if !res.status().is_success() {
        let status = res.status();
        let err_body = res.text().await.unwrap_or_default();
        return Err(format!("OpenAI returned {}: {}", status, err_body));
    }

    let body: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let models: Vec<String> = body.get("data")
        .and_then(|d| d.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m.get("id").and_then(|id| id.as_str()).map(String::from))
                .filter(|id| id.starts_with("gpt-"))
                .collect()
        })
        .unwrap_or_default();

    Ok(TestResult {
        ok: true,
        message: format!("Connected! Found {} GPT model(s).", models.len()),
        models,
    })
}

/* =========================
   GEMINI
   ========================= */

fn build_gemini_contents(messages: &[ProviderMessage]) -> Vec<serde_json::Value> {
    messages.iter()
        .filter(|m| m.role != "system")
        .map(|m| {
            let role = if m.role == "assistant" { "model" } else { &m.role };
            serde_json::json!({
                "role": role,
                "parts": [{ "text": m.content }]
            })
        })
        .collect()
}

async fn gemini_stream(
    app: &AppHandle,
    settings: &GeminiSettings,
    system_prompt: &str,
    messages: Vec<ProviderMessage>,
) -> Result<(), String> {
    let client = Client::new();
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:streamGenerateContent?alt=sse&key={}",
        settings.model, settings.api_key
    );

    let contents = build_gemini_contents(&messages);
    let mut body = serde_json::json!({ "contents": contents });
    if !system_prompt.is_empty() {
        body["systemInstruction"] = serde_json::json!({
            "parts": [{ "text": system_prompt }]
        });
    }

    let mut res = client.post(&url)
        .header("Content-Type", "application/json")
        .json(&body)
        .timeout(Duration::from_secs(120))
        .send()
        .await
        .map_err(|e| format!("Failed to reach Gemini: {}", e))?;

    if !res.status().is_success() {
        let status = res.status();
        let err_body = res.text().await.unwrap_or_default();
        return Err(format!("Gemini API Error {}: {}", status, err_body));
    }

    let mut buffer = String::new();

    while let Ok(Some(chunk)) = res.chunk().await {
        if let Ok(text) = String::from_utf8(chunk.to_vec()) {
            buffer.push_str(&text);

            while let Some(newline_pos) = buffer.find('\n') {
                let line = buffer[..newline_pos].trim().to_string();
                buffer = buffer[newline_pos + 1..].to_string();

                if line.is_empty() { continue; }
                if let Some(json_str) = line.strip_prefix("data: ") {
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(json_str) {
                        if let Some(text_val) = parsed.pointer("/candidates/0/content/parts/0/text").and_then(|t| t.as_str()) {
                            let _ = app.emit("ai-response-chunk", text_val);
                        }
                    }
                }
            }
        }
    }

    let _ = app.emit("ai-response-done", ());
    Ok(())
}

async fn gemini_query(
    settings: &GeminiSettings,
    system_prompt: &str,
    messages: Vec<ProviderMessage>,
) -> Result<String, String> {
    let client = Client::new();
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
        settings.model, settings.api_key
    );

    let contents = build_gemini_contents(&messages);
    let mut body = serde_json::json!({ "contents": contents });
    if !system_prompt.is_empty() {
        body["systemInstruction"] = serde_json::json!({
            "parts": [{ "text": system_prompt }]
        });
    }

    let res = client.post(&url)
        .header("Content-Type", "application/json")
        .json(&body)
        .timeout(Duration::from_secs(60))
        .send()
        .await
        .map_err(|e| format!("Failed to reach Gemini: {}", e))?;

    if !res.status().is_success() {
        let status = res.status();
        let err_body = res.text().await.unwrap_or_default();
        return Err(format!("Gemini API Error {}: {}", status, err_body));
    }

    let parsed: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    parsed.pointer("/candidates/0/content/parts/0/text")
        .and_then(|t| t.as_str())
        .map(String::from)
        .ok_or_else(|| "Unexpected Gemini response format".into())
}

async fn gemini_test(settings: &GeminiSettings) -> Result<TestResult, String> {
    let client = Client::new();
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models?key={}",
        settings.api_key
    );

    let res = client.get(&url)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("Cannot reach Gemini API: {}", e))?;

    if !res.status().is_success() {
        let status = res.status();
        let err_body = res.text().await.unwrap_or_default();
        return Err(format!("Gemini returned {}: {}", status, err_body));
    }

    let body: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let models: Vec<String> = body.get("models")
        .and_then(|m| m.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|m| {
                    m.get("name")
                        .and_then(|n| n.as_str())
                        .map(|n| n.strip_prefix("models/").unwrap_or(n).to_string())
                })
                .filter(|n| n.starts_with("gemini"))
                .collect()
        })
        .unwrap_or_default();

    Ok(TestResult {
        ok: true,
        message: format!("Connected! Found {} Gemini model(s).", models.len()),
        models,
    })
}

/* =========================
   AMAZON BEDROCK
   ========================= */

async fn build_bedrock_client(settings: &BedrockSettings) -> aws_sdk_bedrockruntime::Client {
    let creds = aws_credential_types::Credentials::new(
        &settings.access_key_id,
        &settings.secret_access_key,
        None,
        None,
        "servera",
    );

    let config = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .region(aws_types::region::Region::new(settings.region.clone()))
        .credentials_provider(creds)
        .load()
        .await;

    aws_sdk_bedrockruntime::Client::new(&config)
}

fn build_bedrock_messages(messages: &[ProviderMessage]) -> Vec<aws_sdk_bedrockruntime::types::Message> {
    messages.iter()
        .filter(|m| m.role != "system")
        .filter_map(|m| {
            let role = match m.role.as_str() {
                "user" => aws_sdk_bedrockruntime::types::ConversationRole::User,
                "assistant" => aws_sdk_bedrockruntime::types::ConversationRole::Assistant,
                _ => return None,
            };
            aws_sdk_bedrockruntime::types::Message::builder()
                .role(role)
                .content(aws_sdk_bedrockruntime::types::ContentBlock::Text(m.content.clone()))
                .build()
                .ok()
        })
        .collect()
}

async fn bedrock_stream(
    app: &AppHandle,
    settings: &BedrockSettings,
    system_prompt: &str,
    messages: Vec<ProviderMessage>,
) -> Result<(), String> {
    let client = build_bedrock_client(settings).await;
    let sdk_messages = build_bedrock_messages(&messages);

    let mut request = client.converse_stream()
        .model_id(&settings.model_id)
        .set_messages(Some(sdk_messages));

    if !system_prompt.is_empty() {
        request = request.system(
            aws_sdk_bedrockruntime::types::SystemContentBlock::Text(system_prompt.to_string())
        );
    }

    let output = request.send()
        .await
        .map_err(|e| format!("Bedrock error: {}", e))?;

    let mut stream = output.stream;

    loop {
        match stream.recv().await {
            Ok(Some(event)) => {
                use aws_sdk_bedrockruntime::types::ConverseStreamOutput;
                match event {
                    ConverseStreamOutput::ContentBlockDelta(delta) => {
                        if let Some(d) = delta.delta() {
                            if let aws_sdk_bedrockruntime::types::ContentBlockDelta::Text(text) = d {
                                let _ = app.emit("ai-response-chunk", text);
                            }
                        }
                    }
                    ConverseStreamOutput::MessageStop(_) => {
                        let _ = app.emit("ai-response-done", ());
                        break;
                    }
                    _ => {}
                }
            }
            Ok(None) => {
                let _ = app.emit("ai-response-done", ());
                break;
            }
            Err(e) => {
                return Err(format!("Bedrock stream error: {}", e));
            }
        }
    }

    Ok(())
}

async fn bedrock_query(
    settings: &BedrockSettings,
    system_prompt: &str,
    messages: Vec<ProviderMessage>,
) -> Result<String, String> {
    let client = build_bedrock_client(settings).await;
    let sdk_messages = build_bedrock_messages(&messages);

    let mut request = client.converse()
        .model_id(&settings.model_id)
        .set_messages(Some(sdk_messages));

    if !system_prompt.is_empty() {
        request = request.system(
            aws_sdk_bedrockruntime::types::SystemContentBlock::Text(system_prompt.to_string())
        );
    }

    let output = request.send()
        .await
        .map_err(|e| format!("Bedrock error: {}", e))?;

    let content = output.output()
        .and_then(|o| {
            if let aws_sdk_bedrockruntime::types::ConverseOutput::Message(msg) = o {
                msg.content().first().and_then(|block| {
                    if let aws_sdk_bedrockruntime::types::ContentBlock::Text(text) = block {
                        Some(text.clone())
                    } else {
                        None
                    }
                })
            } else {
                None
            }
        })
        .ok_or_else(|| "Unexpected Bedrock response format".to_string())?;

    Ok(content)
}

async fn bedrock_test(settings: &BedrockSettings) -> Result<TestResult, String> {
    let client = build_bedrock_client(settings).await;

    // Test by sending a minimal converse request
    let test_msg = aws_sdk_bedrockruntime::types::Message::builder()
        .role(aws_sdk_bedrockruntime::types::ConversationRole::User)
        .content(aws_sdk_bedrockruntime::types::ContentBlock::Text("Hi".to_string()))
        .build()
        .map_err(|e| format!("Failed to build test message: {}", e))?;

    client.converse()
        .model_id(&settings.model_id)
        .messages(test_msg)
        .send()
        .await
        .map_err(|e| format!("Bedrock connection failed: {}", e))?;

    Ok(TestResult {
        ok: true,
        message: format!("Connected to Bedrock! Model: {}", settings.model_id),
        models: vec![settings.model_id.clone()],
    })
}
