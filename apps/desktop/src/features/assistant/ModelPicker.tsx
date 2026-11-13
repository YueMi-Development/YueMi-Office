import { useCallback } from 'react';
import type { ProviderView } from '@yuemi/protocol';

import { useConfigStore } from '../../state/configStore';

/**
 * Choosing the model that answers.
 *
 * The models of every provider are in one list, grouped by the provider
 * they belong to, so that a model can be picked without going to the
 * settings and without first choosing a provider. Choosing a model also
 * chooses its provider, because that is the pair the request needs.
 *
 * The choice is written to the configuration, so it is still the one in use
 * the next time the app is opened.
 */

export interface ModelPickerProps {
  /** The providers the user has set up. */
  providers: ProviderView[];
  /** Which provider is in use. */
  activeProviderId: string | null;
  /** Which model is in use. */
  activeModel: string | null;
}

/**
 * The models of one provider, without repeats.
 *
 * A provider has a model of its own and a list of the models it offers, and
 * the model of its own is usually one of them.
 */
function modelsOf(provider: ProviderView): string[] {
  const models = [...provider.models];

  if (provider.model.trim().length > 0 && !models.includes(provider.model)) {
    models.unshift(provider.model);
  }

  return models;
}

/**
 * The value of the option for a model of a provider.
 *
 * The provider and the model are one string, so that the two are always
 * chosen together.
 */
export function modelValue(providerId: string, model: string): string {
  return `${providerId}::${model}`;
}

/**
 * The provider and the model of a value.
 */
export function parseModelValue(
  value: string,
): { providerId: string; model: string } | null {
  const separator = value.indexOf('::');
  if (separator < 0) {
    return null;
  }

  return {
    providerId: value.slice(0, separator),
    model: value.slice(separator + 2),
  };
}

export function ModelPicker({
  providers,
  activeProviderId,
  activeModel,
}: ModelPickerProps) {
  const config = useConfigStore((state) => state.config);
  const save = useConfigStore((state) => state.save);

  const handleChange = useCallback(
    async (value: string) => {
      const chosen = parseModelValue(value);
      if (!chosen || !config) {
        return;
      }

      await save({
        providers: config.providers.map(({ hasKey: _hasKey, ...provider }) => provider),
        activeProviderId: chosen.providerId,
        activeModel: chosen.model,
        aiEnabled: config.aiEnabled,
      });
    },
    [config, save],
  );

  // The value of the selection is the pair the request needs. When the
  // provider is not the one that was chosen — the settings named a model
  // but no provider — the provider that offers the model is used, so the
  // selection shows what is really in use.
  const owner =
    providers.find((provider) => provider.id === activeProviderId) ??
    providers.find((provider) => modelsOf(provider).includes(activeModel ?? ''));

  const value = activeModel && owner ? modelValue(owner.id, activeModel) : '';

  return (
    <label className="chat-picker">
      <span className="chat-picker-label">Model</span>
      <select
        className="chat-picker-select"
        value={value}
        onChange={(event) => {
          void handleChange(event.target.value);
        }}
      >
        <option value="">
          {activeModel ? 'The model in the settings' : 'The provider’s own model'}
        </option>
        {providers.map((provider) => {
          const models = modelsOf(provider);
          if (models.length === 0) {
            return null;
          }

          return (
            <optgroup key={provider.id} label={provider.name}>
              {models.map((model) => (
                <option key={model} value={modelValue(provider.id, model)}>
                  {model}
                </option>
              ))}
            </optgroup>
          );
        })}
      </select>
    </label>
  );
}
