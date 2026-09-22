use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const VAULT_SERVICE: &str = "com.servera.vault";
const VAULT_KEY_USER: &str = "master-key";

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct VaultItem {
    pub id: String,
    pub title: String,
    pub category: String, // 'api-key' | 'ssh-key' | 'database' | 'server' | 'token' | 'note'
    pub secret: String,
    #[serde(default)]
    pub account: Option<String>,
    #[serde(default)]
    pub host: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub created_at: i64,
    #[serde(default)]
    pub updated_at: i64,
    #[serde(default)]
    pub last_used_at: Option<i64>,
}

#[derive(Serialize, Deserialize, Default)]
struct VaultStore {
    items: Vec<VaultItem>,
}

pub struct VaultManager {
    vault_path: PathBuf,
    fallback_key_path: PathBuf,
}

impl VaultManager {
    pub fn new(app: &AppHandle) -> Self {
        let app_dir = app
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| PathBuf::from("."));

        if !app_dir.exists() {
            let _ = fs::create_dir_all(&app_dir);
        }

        Self {
            vault_path: app_dir.join("vault.enc"),
            fallback_key_path: app_dir.join(".vault.key"),
        }
    }

    /// Retrieve or securely initialize the 256-bit AES master key.
    /// Prefers OS Keyring (Windows Credential Manager / macOS Keychain / Secret Service).
    /// Gracefully falls back to a protected local key file if OS keyring is unavailable.
    fn get_or_create_master_key(&self) -> Result<[u8; 32], String> {
        // 1. Try OS Keyring
        if let Ok(entry) = keyring::Entry::new(VAULT_SERVICE, VAULT_KEY_USER) {
            if let Ok(b64_str) = entry.get_password() {
                if let Ok(key_bytes) = BASE64.decode(b64_str.trim()) {
                    if key_bytes.len() == 32 {
                        let mut key = [0u8; 32];
                        key.copy_from_slice(&key_bytes);
                        return Ok(key);
                    }
                }
            }

            // Key not found in keyring; generate a fresh one
            let mut key = [0u8; 32];
            rand::thread_rng().fill_bytes(&mut key);
            let b64_str = BASE64.encode(&key);

            if entry.set_password(&b64_str).is_ok() {
                return Ok(key);
            }
        }

        // 2. Fallback to local hidden key file if Keyring daemon is unavailable
        if self.fallback_key_path.exists() {
            if let Ok(content) = fs::read_to_string(&self.fallback_key_path) {
                if let Ok(key_bytes) = BASE64.decode(content.trim()) {
                    if key_bytes.len() == 32 {
                        let mut key = [0u8; 32];
                        key.copy_from_slice(&key_bytes);
                        return Ok(key);
                    }
                }
            }
        }

        let mut key = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut key);
        let b64_str = BASE64.encode(&key);
        let _ = fs::write(&self.fallback_key_path, &b64_str);
        Ok(key)
    }

    /// Load and decrypt all vault items from ~/.servera/vault.enc
    pub fn load_items(&self) -> Result<Vec<VaultItem>, String> {
        if !self.vault_path.exists() {
            return Ok(vec![]);
        }

        let data = fs::read(&self.vault_path).map_err(|e| format!("Failed to read vault file: {}", e))?;
        if data.len() < 12 {
            // File empty or corrupted
            return Ok(vec![]);
        }

        let key_bytes = self.get_or_create_master_key()?;
        let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
        let cipher = Aes256Gcm::new(key);

        let (nonce_bytes, ciphertext) = data.split_at(12);
        let nonce = Nonce::from_slice(nonce_bytes);

        let plaintext = cipher
            .decrypt(nonce, ciphertext)
            .map_err(|e| format!("Vault decryption failed: {:?}", e))?;

        let store: VaultStore = serde_json::from_slice(&plaintext)
            .map_err(|e| format!("Failed to deserialize vault data: {}", e))?;

        Ok(store.items)
    }

    /// Encrypt and atomically write all vault items to ~/.servera/vault.enc
    pub fn save_items(&self, items: &[VaultItem]) -> Result<(), String> {
        let store = VaultStore {
            items: items.to_vec(),
        };
        let plaintext = serde_json::to_vec(&store)
            .map_err(|e| format!("Failed to serialize vault items: {}", e))?;

        let key_bytes = self.get_or_create_master_key()?;
        let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
        let cipher = Aes256Gcm::new(key);

        let mut nonce_bytes = [0u8; 12];
        rand::thread_rng().fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ciphertext = cipher
            .encrypt(nonce, plaintext.as_ref())
            .map_err(|e| format!("Vault encryption failed: {:?}", e))?;

        let mut output = Vec::with_capacity(12 + ciphertext.len());
        output.extend_from_slice(&nonce_bytes);
        output.extend_from_slice(&ciphertext);

        // Atomic write via temporary file
        let tmp_path = self.vault_path.with_extension("tmp");
        fs::write(&tmp_path, output).map_err(|e| format!("Failed to write temp vault: {}", e))?;
        fs::rename(&tmp_path, &self.vault_path).map_err(|e| format!("Failed to commit vault: {}", e))?;

        Ok(())
    }

    /// Insert or update an item
    pub fn save_item(&self, mut item: VaultItem) -> Result<VaultItem, String> {
        let mut items = self.load_items()?;
        let now = chrono_now_ms();

        if item.created_at == 0 {
            item.created_at = now;
        }
        item.updated_at = now;

        if let Some(pos) = items.iter().position(|i| i.id == item.id) {
            items[pos] = item.clone();
        } else {
            items.push(item.clone());
        }

        self.save_items(&items)?;
        Ok(item)
    }

    /// Delete an item by ID
    pub fn delete_item(&self, id: &str) -> Result<(), String> {
        let mut items = self.load_items()?;
        let initial_len = items.len();
        items.retain(|i| i.id != id);

        if items.len() != initial_len {
            self.save_items(&items)?;
        }
        Ok(())
    }

    /// Record usage timestamp when an item is copied
    pub fn touch_item(&self, id: &str) -> Result<(), String> {
        let mut items = self.load_items()?;
        if let Some(item) = items.iter_mut().find(|i| i.id == id) {
            item.last_used_at = Some(chrono_now_ms());
            self.save_items(&items)?;
        }
        Ok(())
    }

    /// Export plain JSON backup for user backup
    pub fn export_backup(&self) -> Result<String, String> {
        let items = self.load_items()?;
        serde_json::to_string_pretty(&items).map_err(|e| e.to_string())
    }

    /// Import backup items (merges or replaces based on ID)
    pub fn import_backup(&self, json_data: &str) -> Result<usize, String> {
        let incoming: Vec<VaultItem> = serde_json::from_str(json_data)
            .map_err(|e| format!("Invalid backup format: {}", e))?;
        
        let mut items = self.load_items()?;
        let count = incoming.len();

        for item in incoming {
            if let Some(pos) = items.iter().position(|i| i.id == item.id) {
                items[pos] = item;
            } else {
                items.push(item);
            }
        }

        self.save_items(&items)?;
        Ok(count)
    }
}

fn chrono_now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
