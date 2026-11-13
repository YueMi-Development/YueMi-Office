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
