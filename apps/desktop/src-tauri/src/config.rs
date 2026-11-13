//! The application's own configuration, kept in the user's home folder.
//!
//! The app keeps two files under `~/.yuemi-office/`:
//!
//! - `config.json` holds everything that is not a secret.
//! - `credentials.json` holds the API keys, one per provider.
//!
//! The keys are kept apart from the configuration because the configuration
//! is the file a user would paste into an issue, and a key in it would be
//! a leak. The webview never sees a key: it asks for the providers and gets
//! back a flag saying whether a key is there, never the key itself.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// The wire format a provider speaks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProviderProtocol {
    /// Anthropic's Messages API.
    Anthropic,
    /// OpenAI's Chat Completions API.
    Openai,
    /// Any server that speaks OpenAI's Chat Completions API.
    OpenaiCompatible,
}

/// One provider the assistant can talk to.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
    /// Identifier used to match a key to this provider.
    pub id: String,
    /// The name the user gave it.
    pub name: String,
    /// The wire format it speaks.
    pub protocol: ProviderProtocol,
    /// Where the requests go.
    pub base_url: String,
    /// The model used for requests.
    #[serde(default)]
    pub model: String,
    /// The models the user offers for this provider.
    #[serde(default)]
    pub models: Vec<String>,
    /// Whether the model takes page images.
    #[serde(default)]
    pub supports_images: bool,
    /// Whether the provider needs a key. A local server usually does not.
    #[serde(default = "default_true")]
    pub requires_key: bool,
}

/// Whether a provider needs a key.
fn default_true() -> bool {
    true
}

/// Everything the app knows about the providers.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    /// The providers the user has set up.
    #[serde(default)]
    pub providers: Vec<ProviderConfig>,
    /// Which provider the assistant uses.
    #[serde(default)]
    pub active_provider_id: Option<String>,
    /// Which model the assistant uses.
    #[serde(default)]
    pub active_model: Option<String>,
    /// Whether the assistant is allowed to run at all.
    ///
    /// Document content is sent to a provider when the assistant is used, and
    /// the PRD asks for a setting that turns that off entirely.
    #[serde(default = "default_true")]
    pub ai_enabled: bool,
}

/// The default configuration, used when there is no file yet.
impl Default for AppConfig {
    fn default() -> Self {
        Self {
            providers: vec![anthropic_provider(), openai_provider()],
            active_provider_id: None,
            active_model: None,
            ai_enabled: true,
        }
    }
}

/// The Anthropic provider, ready to use once a key is set.
fn anthropic_provider() -> ProviderConfig {
    ProviderConfig {
        id: "anthropic".to_string(),
        name: "Anthropic (Claude)".to_string(),
        protocol: ProviderProtocol::Anthropic,
        base_url: "https://api.anthropic.com".to_string(),
        model: "claude-sonnet-4-5".to_string(),
        models: vec![
            "claude-sonnet-4-5".to_string(),
            "claude-opus-4-1".to_string(),
            "claude-haiku-4-5".to_string(),
        ],
        supports_images: true,
        requires_key: true,
    }
}

/// The OpenAI provider, ready to use once a key is set.
fn openai_provider() -> ProviderConfig {
    ProviderConfig {
        id: "openai".to_string(),
        name: "OpenAI".to_string(),
        protocol: ProviderProtocol::Openai,
        base_url: "https://api.openai.com/v1".to_string(),
        model: "gpt-4.1".to_string(),
        models: vec!["gpt-4.1".to_string(), "gpt-4.1-mini".to_string()],
        supports_images: true,
        requires_key: true,
    }
}

/// The name of the folder the configuration lives in.
const FOLDER_NAME: &str = ".yuemi-office";

/// The environment variable that says where the configuration lives.
///
/// It is there so the app can be run from a folder of its own, and so the
/// tests can keep their settings out of the user's home folder.
const DIRECTORY_VARIABLE: &str = "YUEMI_CONFIG_DIR";

/// The file holding the configuration.
const CONFIG_FILE: &str = "config.json";

/// The file holding the API keys.
const CREDENTIALS_FILE: &str = "credentials.json";

/// The folder the configuration lives in.
///
/// It is in the user's home folder rather than beside the app, so it is the
/// same on a development machine and on an installed copy. The environment
/// variable takes the place of the home folder when it is set, which is
/// what lets the app be run from a folder of its own.
pub fn config_directory() -> Result<PathBuf, String> {
    if let Some(directory) = std::env::var_os(DIRECTORY_VARIABLE) {
        let directory = PathBuf::from(directory);
        if !directory.as_os_str().is_empty() {
            return Ok(directory);
        }
    }

    let home = dirs::home_dir().ok_or_else(|| "There is no home folder.".to_string())?;
    Ok(home.join(FOLDER_NAME))
}

/// Creates the configuration folder if it is not there.
fn ensure_directory(directory: &Path) -> Result<(), String> {
    fs::create_dir_all(directory)
        .map_err(|error| format!("Cannot create {}: {error}", directory.display()))
}

/// Reads the configuration file from a folder.
///
/// A file that is missing gives the default configuration, and a file that
/// cannot be parsed is an error the user has to fix rather than something
/// to work around: a silently reset configuration would lose the providers
/// they set up.
pub fn read_config_from(directory: &Path) -> Result<AppConfig, String> {
    let path = directory.join(CONFIG_FILE);
    if !path.is_file() {
        return Ok(AppConfig::default());
    }

    let text = fs::read_to_string(&path)
        .map_err(|error| format!("Cannot read {}: {error}", path.display()))?;
    serde_json::from_str(&text)
        .map_err(|error| format!("{} is not valid: {error}", path.display()))
}

/// Writes the configuration file to a folder.
pub fn write_config_to(directory: &Path, config: &AppConfig) -> Result<(), String> {
    ensure_directory(directory)?;
    let path = directory.join(CONFIG_FILE);
    let serialized = serde_json::to_string_pretty(config)
        .map_err(|error| format!("Cannot serialize the configuration: {error}"))?;
    fs::write(&path, format!("{serialized}\n"))
        .map_err(|error| format!("Cannot write {}: {error}", path.display()))
}

/// Reads the API keys from a folder, keyed by provider.
pub fn read_credentials_from(directory: &Path) -> BTreeMap<String, String> {
    let path = directory.join(CREDENTIALS_FILE);
    if !path.is_file() {
        return BTreeMap::new();
    }

    let Ok(text) = fs::read_to_string(&path) else {
        return BTreeMap::new();
    };

    serde_json::from_str(&text).unwrap_or_default()
}

/// Writes the API keys to a folder, keyed by provider.
pub fn write_credentials_to(
    directory: &Path,
    credentials: &BTreeMap<String, String>,
) -> Result<(), String> {
    ensure_directory(directory)?;
    let path = directory.join(CREDENTIALS_FILE);
    let serialized = serde_json::to_string_pretty(credentials)
        .map_err(|error| format!("Cannot serialize the keys: {error}"))?;
    fs::write(&path, format!("{serialized}\n"))
        .map_err(|error| format!("Cannot write {}: {error}", path.display()))?;

    restrict_permissions(&path);
    Ok(())
}

/// Makes a file readable only by its owner.
///
/// The keys are a secret, and a file that anyone on the machine can read is
/// not much of a secret. The permission is not set on Windows, where the
/// file inherits the permissions of the user's profile folder.
fn restrict_permissions(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
}

/// Sets or clears the key of one provider.
///
/// An empty key clears it, so the frontend does not need a second command
/// for removing a key.
pub fn set_provider_key_in(
    directory: &Path,
    provider_id: &str,
    key: Option<&str>,
) -> Result<(), String> {
    let mut credentials = read_credentials_from(directory);

    match key.map(str::trim).filter(|value| !value.is_empty()) {
        Some(value) => {
            credentials.insert(provider_id.to_string(), value.to_string());
        }
        None => {
            credentials.remove(provider_id);
        }
    }

    write_credentials_to(directory, &credentials)
}

/// The key of one provider, if it has one.
pub fn provider_key_in(directory: &Path, provider_id: &str) -> Option<String> {
    read_credentials_from(directory)
        .get(provider_id)
        .cloned()
}

/// A provider as the webview sees it.
///
/// The key is not part of it: the webview gets `hasKey`, which says whether
/// a key is there, and never the key itself.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderView {
    /// The provider's own fields.
    #[serde(flatten)]
    pub provider: ProviderConfig,
    /// Whether a key is set for this provider.
    pub has_key: bool,
}

/// The configuration as the webview sees it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfigView {
    /// The providers, each with whether it has a key.
    pub providers: Vec<ProviderView>,
    /// Which provider the assistant uses.
    pub active_provider_id: Option<String>,
    /// Which model the assistant uses.
    pub active_model: Option<String>,
    /// Whether the assistant is allowed to run at all.
    pub ai_enabled: bool,
    /// Where the configuration lives.
    pub directory: String,
}

/// Builds the view of the configuration the webview sees.
pub fn config_view_from(directory: &Path) -> Result<AppConfigView, String> {
    let config = read_config_from(directory)?;
    let credentials = read_credentials_from(directory);

    let providers = config
        .providers
        .iter()
        .map(|provider| ProviderView {
            has_key: credentials.contains_key(&provider.id),
            provider: provider.clone(),
        })
        .collect();

    Ok(AppConfigView {
        providers,
        active_provider_id: config.active_provider_id,
        active_model: config.active_model,
        ai_enabled: config.ai_enabled,
        directory: directory.display().to_string(),
    })
}

/// Reads the configuration from the user's folder.
pub fn read_config() -> Result<AppConfig, String> {
    read_config_from(&config_directory()?)
}

/// Writes the configuration to the user's folder.
pub fn write_config(config: &AppConfig) -> Result<(), String> {
    write_config_to(&config_directory()?, config)
}

/// Reads the API keys from the user's folder.
pub fn read_credentials() -> BTreeMap<String, String> {
    read_credentials_from(&config_directory().unwrap_or_default())
}

/// Sets or clears the key of one provider in the user's folder.
pub fn set_provider_key(provider_id: &str, key: Option<&str>) -> Result<(), String> {
    set_provider_key_in(&config_directory()?, provider_id, key)
}

/// The key of one provider in the user's folder.
pub fn provider_key(provider_id: &str) -> Option<String> {
    provider_key_in(&config_directory().unwrap_or_default(), provider_id)
}

/// Reads the configuration the webview sees.
#[tauri::command(rename = "load_app_config")]
pub fn command_load_app_config() -> Result<AppConfigView, String> {
    config_view_from(&config_directory()?)
}

/// Writes the configuration.
///
/// The providers come with their keys flagged rather than with the keys
/// themselves, so a save from the webview cannot write a key into the
/// configuration file by accident.
#[tauri::command(rename = "save_app_config")]
pub fn command_save_app_config(config: AppConfig) -> Result<(), String> {
    write_config(&config)
}

/// Sets or clears the key of one provider.
#[tauri::command(rename = "set_provider_key")]
pub fn command_set_provider_key(provider_id: String, key: Option<String>) -> Result<(), String> {
    set_provider_key(&provider_id, key.as_deref())
}

/// Reports where the configuration lives.
#[tauri::command(rename = "config_directory")]
pub fn command_config_directory() -> Result<String, String> {
    Ok(config_directory()?.display().to_string())
}
