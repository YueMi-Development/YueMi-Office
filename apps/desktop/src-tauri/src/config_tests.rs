//! Tests for the configuration store.

use std::collections::BTreeMap;

use crate::testing::{
    config_view_from, provider_key_in, read_config_from, read_credentials_from,
    set_provider_key_in, write_config_to, AppConfig, ProviderConfig, ProviderProtocol,
};

use tempfile::TempDir;

/// A folder to keep the configuration in.
fn folder() -> TempDir {
    TempDir::new().expect("a temporary folder")
}

/// A provider to put in the configuration.
fn provider(id: &str) -> ProviderConfig {
    ProviderConfig {
        id: id.to_string(),
        name: format!("Provider {id}"),
        protocol: ProviderProtocol::OpenaiCompatible,
        base_url: "http://127.0.0.1:1234/v1".to_string(),
        model: "a-model".to_string(),
        models: vec!["a-model".to_string()],
        supports_images: false,
        requires_key: false,
    }
}

#[test]
fn a_folder_with_no_configuration_gives_the_default_one() {
    let directory = folder();

    let config = read_config_from(directory.path()).expect("the default configuration");

    assert!(config.ai_enabled);
    assert!(
        config
            .providers
            .iter()
            .any(|provider| provider.protocol == ProviderProtocol::Anthropic)
    );
    assert!(
        config
            .providers
            .iter()
            .any(|provider| provider.protocol == ProviderProtocol::Openai)
    );
}

#[test]
fn the_configuration_survives_a_write_and_a_read() {
    let directory = folder();

    let mut config = AppConfig::default();
    config.providers = vec![provider("local")];
    config.active_provider_id = Some("local".to_string());
    config.active_model = Some("a-model".to_string());
    config.ai_enabled = false;

    write_config_to(directory.path(), &config).expect("the configuration is written");

    let read = read_config_from(directory.path()).expect("the configuration is read");

    assert_eq!(read.providers.len(), 1);
    assert_eq!(read.providers[0].id, "local");
    assert_eq!(read.active_provider_id.as_deref(), Some("local"));
    assert_eq!(read.active_model.as_deref(), Some("a-model"));
    assert!(!read.ai_enabled);
}

#[test]
fn a_key_is_kept_out_of_the_configuration_file() {
    let directory = folder();

    set_provider_key_in(directory.path(), "local", Some("sk-secret")).expect("the key is set");

    let text = std::fs::read_to_string(directory.path().join("config.json"))
        .unwrap_or_default();

    assert!(!text.contains("sk-secret"));
}

#[test]
fn a_key_is_kept_in_the_credentials_file() {
    let directory = folder();

    set_provider_key_in(directory.path(), "local", Some("sk-secret")).expect("the key is set");

    let credentials = read_credentials_from(directory.path());

    assert_eq!(credentials.get("local").map(String::as_str), Some("sk-secret"));
}

#[test]
fn an_empty_key_clears_the_key() {
    let directory = folder();

    set_provider_key_in(directory.path(), "local", Some("sk-secret")).expect("the key is set");
    set_provider_key_in(directory.path(), "local", None).expect("the key is cleared");

    assert!(provider_key_in(directory.path(), "local").is_none());
}

#[test]
fn a_key_of_whitespace_clears_the_key() {
    let directory = folder();

    set_provider_key_in(directory.path(), "local", Some("sk-secret")).expect("the key is set");
    set_provider_key_in(directory.path(), "local", Some("   ")).expect("the key is cleared");

    assert!(provider_key_in(directory.path(), "local").is_none());
}

#[test]
fn the_view_says_whether_a_key_is_there_and_not_what_it_is() {
    let directory = folder();

    set_provider_key_in(directory.path(), "local", Some("sk-secret")).expect("the key is set");

    let mut config = AppConfig::default();
    config.providers = vec![provider("local"), provider("other")];
    write_config_to(directory.path(), &config).expect("the configuration is written");

    let view = config_view_from(directory.path()).expect("the view");

    assert_eq!(view.providers.len(), 2);
    assert!(view.providers[0].has_key);
    assert!(!view.providers[1].has_key);

    // The view is what the webview receives, so it must not carry the key.
    let serialized = serde_json::to_string(&view).expect("the view as JSON");
    assert!(!serialized.contains("sk-secret"));
}

#[test]
fn a_file_that_is_not_valid_configuration_is_an_error() {
    let directory = folder();
    std::fs::write(directory.path().join("config.json"), "not json").expect("the file is written");

    let result = read_config_from(directory.path());

    assert!(result.is_err());
}

#[test]
fn the_keys_of_several_providers_are_kept_apart() {
    let directory = folder();

    let mut credentials = BTreeMap::new();
    credentials.insert("one".to_string(), "first".to_string());
    credentials.insert("two".to_string(), "second".to_string());
    crate::testing::write_credentials_to(directory.path(), &credentials)
        .expect("the keys are written");

    assert_eq!(
        provider_key_in(directory.path(), "one").as_deref(),
        Some("first")
    );
    assert_eq!(
        provider_key_in(directory.path(), "two").as_deref(),
        Some("second")
    );
    assert!(provider_key_in(directory.path(), "three").is_none());
}

// The configuration the webview sends.
//
// The webview sends the configuration as JSON, and the fields it uses have to
// be the ones the shell reads. The two are written apart — one in the
// protocol package, one in Rust — so a difference between them is possible,
// and it would show up as settings that are never saved rather than as an
// error the user can see.
//
// So the exact payload the webview sends is written out here, and it has to
// survive the trip through the shell's own types.

/// The JSON the webview sends when the settings are saved.
const PAYLOAD: &str = r#"{
  "providers": [
    {
      "id": "anthropic",
      "name": "Anthropic (Claude)",
      "protocol": "anthropic",
      "baseUrl": "https://api.anthropic.com",
      "model": "claude-sonnet-4-5",
      "models": ["claude-sonnet-4-5"],
      "supportsImages": true,
      "requiresKey": true
    },
    {
      "id": "local",
      "name": "Ollama",
      "protocol": "openai-compatible",
      "baseUrl": "http://127.0.0.1:11434/v1",
      "model": "llama3",
      "models": ["llama3"],
      "supportsImages": false,
      "requiresKey": false
    }
  ],
  "activeProviderId": "local",
  "activeModel": "llama3",
  "aiEnabled": true
}"#;

#[test]
fn the_payload_the_webview_sends_is_read_the_way_it_means() {
    let config: AppConfig = serde_json::from_str(PAYLOAD).expect("the payload is read");

    assert_eq!(config.providers.len(), 2);

    let first = &config.providers[0];
    assert_eq!(first.id, "anthropic");
    assert_eq!(first.protocol, ProviderProtocol::Anthropic);
    assert_eq!(first.base_url, "https://api.anthropic.com");
    assert!(first.supports_images);
    assert!(first.requires_key);

    let second = &config.providers[1];
    assert_eq!(second.protocol, ProviderProtocol::OpenaiCompatible);
    assert_eq!(second.base_url, "http://127.0.0.1:11434/v1");
    assert!(!second.supports_images);
    assert!(!second.requires_key);

    assert_eq!(config.active_provider_id.as_deref(), Some("local"));
    assert_eq!(config.active_model.as_deref(), Some("llama3"));
    assert!(config.ai_enabled);
}

#[test]
fn the_payload_the_webview_sends_survives_a_write_and_a_read() {
    let directory = folder();

    let config: AppConfig = serde_json::from_str(PAYLOAD).expect("the payload is read");
    write_config_to(directory.path(), &config).expect("the configuration is written");

    let read = read_config_from(directory.path()).expect("the configuration is read");

    assert_eq!(read.providers.len(), 2);
    assert_eq!(read.providers[0].base_url, "https://api.anthropic.com");
    assert_eq!(
        read.providers[1].protocol,
        ProviderProtocol::OpenaiCompatible
    );
    assert_eq!(read.active_provider_id.as_deref(), Some("local"));
    assert_eq!(read.active_model.as_deref(), Some("llama3"));
}

// The write itself.
//
// The configuration is written to a temporary file and then renamed over the
// real one, so that a write that is interrupted leaves the old file rather
// than a half-written one. A configuration that cannot be read is an error
// the user has to fix by hand, so a truncated file is worse than a lost
// change.

#[test]
fn a_write_leaves_no_temporary_file_behind() {
    let directory = folder();

    write_config_to(directory.path(), &AppConfig::default()).expect("the configuration is written");

    let names: Vec<String> = std::fs::read_dir(directory.path())
        .expect("the folder is read")
        .map(|entry| entry.expect("an entry").file_name().to_string_lossy().into_owned())
        .collect();

    assert_eq!(names, vec!["config.json".to_string()]);
}

#[test]
fn a_second_write_replaces_the_first() {
    let directory = folder();

    let mut config = AppConfig::default();
    config.providers = vec![provider("local")];
    write_config_to(directory.path(), &config).expect("the configuration is written");

    let mut other = AppConfig::default();
    other.providers = vec![provider("other")];
    other.active_provider_id = Some("other".to_string());
    write_config_to(directory.path(), &other).expect("the configuration is written");

    let read = read_config_from(directory.path()).expect("the configuration is read");

    assert_eq!(read.providers.len(), 1);
    assert_eq!(read.providers[0].id, "other");
    assert_eq!(read.active_provider_id.as_deref(), Some("other"));
}

#[test]
fn a_write_that_fails_leaves_the_old_configuration_alone() {
    let directory = folder();

    let mut config = AppConfig::default();
    config.providers = vec![provider("local")];
    write_config_to(directory.path(), &config).expect("the configuration is written");

    // The configuration is written into a folder that does not exist and
    // cannot be made, so the write fails.
    let blocked = directory.path().join("blocked");
    std::fs::write(&blocked, "in the way").expect("the file is written");
    let nested = blocked.join("nested");

    let result = write_config_to(&nested, &AppConfig::default());

    assert!(result.is_err());

    // The old file is still there and still readable.
    let read = read_config_from(directory.path()).expect("the configuration is read");
    assert_eq!(read.providers.len(), 1);
    assert_eq!(read.providers[0].id, "local");
}

#[test]
fn the_keys_are_written_without_leaving_a_temporary_file_behind() {
    let directory = folder();

    set_provider_key_in(directory.path(), "local", Some("sk-secret")).expect("the key is set");

    let names: Vec<String> = std::fs::read_dir(directory.path())
        .expect("the folder is read")
        .map(|entry| entry.expect("an entry").file_name().to_string_lossy().into_owned())
        .collect();

    assert_eq!(names, vec!["credentials.json".to_string()]);
}

#[test]
fn the_configuration_file_holds_no_key() {
    let directory = folder();

    let mut config = AppConfig::default();
    config.providers = vec![provider("local")];
    write_config_to(directory.path(), &config).expect("the configuration is written");
    set_provider_key_in(directory.path(), "local", Some("sk-secret")).expect("the key is set");

    let text = std::fs::read_to_string(directory.path().join("config.json"))
        .expect("the file is read");

    assert!(!text.contains("sk-secret"));
}
