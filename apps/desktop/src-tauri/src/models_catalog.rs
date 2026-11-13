//! The sizes of the models the assistant can talk to.
//!
//! The app has to know how large a model's context is to say how much of it
//! is used. The sizes are not in the app, because they change as providers
//! release models, so they are read from the models.dev catalogue and kept
//! in the configuration folder between runs.
//!
//! The catalogue is one document for every provider, and it is a few
//! megabytes, so it is fetched once and cached on disk rather than fetched
//! for every question.

use std::collections::BTreeMap;
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::config;
use crate::providers;

/// Where the catalogue lives.
const CATALOGUE_URL: &str = "https://models.dev/api.json";

/// The file the catalogue is cached in.
const CACHE_FILE: &str = "models-cache.json";

/// The file the catalogue is written to first.
const CACHE_TEMP_FILE: &str = "models-cache.json.new";

/// How long a cached catalogue is used before it is fetched again.
const CACHE_LIFETIME_SECONDS: u64 = 24 * 60 * 60;

/// How long the catalogue may take to arrive.
const FETCH_TIMEOUT: Duration = Duration::from_secs(20);

/// The size of one model's context.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelWindow {
    /// Which provider the model was found under.
    pub provider_id: String,
    /// The model's name.
    pub model: String,
    /// How many tokens the model can take at once.
    pub context_tokens: u64,
    /// How many tokens the model may answer with.
    pub output_tokens: Option<u64>,
}

/// The catalogue, flattened.
///
/// The catalogue as it arrives is a provider per provider, each with a model
/// per model. What the app wants is to look a model up by name, so it is
/// flattened into that shape.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalogue {
    /// When the catalogue was fetched, in seconds since the epoch.
    pub fetched_at: u64,
    /// The models of each provider, keyed by the provider and then the model.
    pub providers: BTreeMap<String, BTreeMap<String, ModelSize>>,
}

/// The size of one model.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelSize {
    /// How many tokens the model can take at once.
    pub context: u64,
    /// How many tokens the model may answer with.
    #[serde(default)]
    pub output: Option<u64>,
}

/// The catalogue as it arrives from models.dev.
#[derive(Debug, Deserialize)]
pub(crate) struct RawCatalogue {
    #[serde(default)]
    pub(crate) models: BTreeMap<String, RawModel>,
}

/// One model as it arrives from models.dev.
#[derive(Debug, Deserialize)]
pub(crate) struct RawModel {
    #[serde(default)]
    pub(crate) limit: Option<RawLimit>,
}

/// The limits of one model as they arrive from models.dev.
#[derive(Debug, Clone, Copy, Deserialize)]
pub(crate) struct RawLimit {
    #[serde(default)]
    pub(crate) context: Option<u64>,
    #[serde(default)]
    pub(crate) output: Option<u64>,
}

/// Flattens the catalogue as it arrives into the shape the app looks up.
///
/// The models with no context size are left out: a model the catalogue
/// knows nothing about the size of is one the app cannot say anything
/// honest about.
pub(crate) fn flatten(raw: &BTreeMap<String, RawCatalogue>) -> Catalogue {
    let mut providers: BTreeMap<String, BTreeMap<String, ModelSize>> = BTreeMap::new();

    for (provider_id, provider) in raw {
        let mut models = BTreeMap::new();

        for (model_id, model) in &provider.models {
            let Some(limit) = model.limit.as_ref() else {
                continue;
            };
            let Some(context) = limit.context else {
                continue;
            };

            models.insert(
                model_id.clone(),
                ModelSize {
                    context,
                    output: limit.output,
                },
            );
        }

        if !models.is_empty() {
            providers.insert(provider_id.clone(), models);
        }
    }

    Catalogue {
        fetched_at: now_seconds(),
        providers,
    }
}

/// The time now, in seconds since the epoch.
pub(crate) fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|since| since.as_secs())
        .unwrap_or(0)
}

/// Looks a model up in the catalogue.
///
/// The provider the model belongs to is used first, so a provider of the
/// app's own making is looked up under its own name. A model of a provider
/// the catalogue does not know — an OpenRouter address the user added by
/// hand, say — is looked up by its name under any provider, because the
/// model is the same one whoever serves it.
pub(crate) fn lookup(catalogue: &Catalogue, provider_id: &str, model: &str) -> Option<ModelWindow> {
    let model = model.trim();
    if model.is_empty() {
        return None;
    }

    if let Some(size) = catalogue
        .providers
        .get(provider_id)
        .and_then(|models| models.get(model))
    {
        return Some(ModelWindow {
            provider_id: provider_id.to_string(),
            model: model.to_string(),
            context_tokens: size.context,
            output_tokens: size.output,
        });
    }

    for (other_provider, models) in &catalogue.providers {
        if let Some(size) = models.get(model) {
            return Some(ModelWindow {
                provider_id: other_provider.clone(),
                model: model.to_string(),
                context_tokens: size.context,
                output_tokens: size.output,
            });
        }
    }

    None
}

/// Reads the cached catalogue from a folder.
///
/// A catalogue that is younger than its lifetime is used as it is. An older
/// one is still read, because it is better than nothing when the network
/// cannot be reached.
pub(crate) fn read_cache(directory: &Path) -> Option<Catalogue> {
    let path = directory.join(CACHE_FILE);
    if !path.is_file() {
        return None;
    }

    let text = std::fs::read_to_string(&path).ok()?;
    let catalogue: Catalogue = serde_json::from_str(&text).ok()?;

    Some(catalogue)
}

/// Whether a catalogue is young enough to be used without fetching again.
pub(crate) fn is_fresh(catalogue: &Catalogue) -> bool {
    let age = now_seconds().saturating_sub(catalogue.fetched_at);
    age < CACHE_LIFETIME_SECONDS
}

/// Writes the catalogue into a folder.
///
/// The file is written the same way the configuration is: into a temporary
/// file, then renamed over the real one, so an interrupted write leaves the
/// old catalogue whole.
pub fn write_cache(directory: &Path, catalogue: &Catalogue) -> Result<(), String> {
    let serialized = serde_json::to_string(catalogue)
        .map_err(|error| format!("Cannot serialize the catalogue: {error}"))?;

    config::write_file_atomically(
        directory,
        CACHE_FILE,
        CACHE_TEMP_FILE,
        &format!("{serialized}\n"),
        false,
    )
    .map(|_| ())
}

/// Fetches the catalogue from models.dev.
pub async fn fetch() -> Result<Catalogue, String> {
    let client = providers::client().map_err(|error| error.message)?;

    let request = client
        .get(CATALOGUE_URL)
        .timeout(FETCH_TIMEOUT)
        .send()
        .await
        .map_err(|error| {
            providers::describe_transport_failure("the model catalogue is not available", &error)
        })?;

    if !request.status().is_success() {
        return Err(format!(
            "The model catalogue answered with {}.",
            request.status().as_u16()
        ));
    }

    let body = request
        .text()
        .await
        .map_err(|error| format!("The model catalogue could not be read: {error}"))?;

    let raw: BTreeMap<String, RawCatalogue> = serde_json::from_str(&body)
        .map_err(|error| format!("The model catalogue is not readable: {error}"))?;

    Ok(flatten(&raw))
}

/// The catalogue to answer from: the cached one when it is fresh, otherwise
/// a fresh one, and the cached one when the catalogue cannot be reached.
pub async fn catalogue(directory: &Path) -> Option<Catalogue> {
    let cached = read_cache(directory);

    if let Some(catalogue) = &cached
        && is_fresh(catalogue)
    {
        return Some(catalogue.clone());
    }

    match fetch().await {
        Ok(fresh) => {
            // A catalogue that cannot be written is still worth answering
            // from; it is only read again next time.
            let _ = write_cache(directory, &fresh);
            Some(fresh)
        }
        Err(_) => cached,
    }
}

/// The size of a model's context.
///
/// The command the app asks when it wants to know how large a model's
/// context is. A model the catalogue does not know has no size, and the
/// answer says so rather than guessing one.
#[tauri::command(rename = "model_context_window")]
pub async fn command_model_context_window(
    provider_id: String,
    model: String,
) -> Result<Option<ModelWindow>, String> {
    let directory = config::config_directory()?;

    let catalogue = catalogue(&directory).await;

    Ok(catalogue
        .as_ref()
        .and_then(|catalogue| lookup(catalogue, &provider_id, &model)))
}
