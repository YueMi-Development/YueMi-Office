//! Tests for the model catalogue.
//!
//! The catalogue as models.dev serves it is one document for every provider,
//! and what the app wants is a model looked up by name. These tests use a
//! small catalogue of the same shape, so a change in how the document is
//! read shows up here rather than in a download.

use std::collections::BTreeMap;

use crate::models_catalog::{
    Catalogue, ModelSize, RawCatalogue, flatten, is_fresh, lookup, now_seconds, read_cache,
};

/// The catalogue as it arrives from models.dev.
fn raw(text: &str) -> BTreeMap<String, RawCatalogue> {
    serde_json::from_str(text).expect("the catalogue as JSON")
}

#[test]
fn the_catalogue_is_flattened_into_the_providers_and_their_models() {
    let catalogue = flatten(&raw(r#"{
          "anthropic": {
            "models": {
              "claude-sonnet-4-5": { "limit": { "context": 200000, "output": 64000 } }
            }
          },
          "openai": {
            "models": {
              "gpt-4.1": { "limit": { "context": 1047576, "output": 32768 } }
            }
          }
        }"#));

    let anthropic = catalogue
        .providers
        .get("anthropic")
        .expect("the anthropic provider");
    assert_eq!(
        anthropic.get("claude-sonnet-4-5"),
        Some(&ModelSize {
            context: 200000,
            output: Some(64000),
        })
    );

    let openai = catalogue
        .providers
        .get("openai")
        .expect("the openai provider");
    assert_eq!(
        openai.get("gpt-4.1"),
        Some(&ModelSize {
            context: 1047576,
            output: Some(32768),
        })
    );
}

#[test]
fn a_model_with_no_size_is_left_out() {
    let catalogue = flatten(&raw(r#"{
          "openai": {
            "models": {
              "gpt-4.1": { "limit": { "context": 1047576 } },
              "mystery": { "name": "Mystery" }
            }
          }
        }"#));

    let openai = catalogue
        .providers
        .get("openai")
        .expect("the openai provider");
    assert_eq!(openai.len(), 1);
    assert!(!openai.contains_key("mystery"));
}

#[test]
fn a_model_is_found_under_the_provider_that_offers_it() {
    let catalogue = flatten(&raw(r#"{
          "anthropic": {
            "models": {
              "claude-sonnet-4-5": { "limit": { "context": 200000 } }
            }
          }
        }"#));

    let found = lookup(&catalogue, "anthropic", "claude-sonnet-4-5").expect("the model");

    assert_eq!(found.provider_id, "anthropic");
    assert_eq!(found.model, "claude-sonnet-4-5");
    assert_eq!(found.context_tokens, 200000);
    assert_eq!(found.output_tokens, None);
}

#[test]
fn a_model_of_a_provider_the_catalogue_does_not_know_is_found_by_its_name() {
    let catalogue = flatten(&raw(r#"{
          "openai": {
            "models": {
              "gpt-4.1": { "limit": { "context": 1047576 } }
            }
          }
        }"#));

    // The provider the user added by hand is one the catalogue knows nothing
    // about, but the model it offers is the same one.
    let found = lookup(&catalogue, "my-openrouter", "gpt-4.1").expect("the model");

    assert_eq!(found.provider_id, "openai");
    assert_eq!(found.context_tokens, 1047576);
}

#[test]
fn a_model_that_is_not_in_the_catalogue_has_no_size() {
    let catalogue = flatten(&raw(r#"{
          "openai": {
            "models": {
              "gpt-4.1": { "limit": { "context": 1047576 } }
            }
          }
        }"#));

    assert!(lookup(&catalogue, "openai", "a-model-nobody-knows").is_none());
    assert!(lookup(&catalogue, "openai", "  ").is_none());
}

#[test]
fn a_catalogue_that_was_just_fetched_is_fresh() {
    let catalogue = Catalogue {
        fetched_at: now_seconds(),
        providers: BTreeMap::new(),
    };

    assert!(is_fresh(&catalogue));
}

#[test]
fn a_catalogue_that_is_older_than_a_day_is_not_fresh() {
    let catalogue = Catalogue {
        fetched_at: 1_000,
        providers: BTreeMap::new(),
    };

    assert!(!is_fresh(&catalogue));
}

#[test]
fn a_catalogue_that_is_not_there_is_nothing_to_read() {
    let directory = tempfile::TempDir::new().expect("a temporary folder");

    assert!(read_cache(directory.path()).is_none());
}
