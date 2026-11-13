import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AiToolName, AiToolResult, ModelWindow, ProposedEdit } from '@yuemi/protocol';

import { ContextDonut } from './ContextDonut';
import { ModeSwitcher } from './ModeSwitcher';
import { ModelPicker } from './ModelPicker';
import { cancelAssistant, runAssistant } from '../../lib/chat';
import { modelContextWindow } from '../../lib/models';
import { reasonOf } from '../../lib/tauri';
import { useAssistantStore } from '../../state/assistantStore';
import { useChatStore, usageOf } from '../../state/chatStore';
import { useConfigStore, providerInUse } from '../../state/configStore';
import { useSettingsStore } from '../../state/settingsStore';

/**
 * The chat with the assistant.
 *
 * The assistant's answer arrives piece by piece, so the text of the answer
 * grows as it is written. The changes it proposes are shown as differences
 * below the conversation, and each hunk can be accepted or rejected on its
 * own.
 *
 * The toolbar at the top says how the assistant is running, which model is
 * answering, and how much of the model's context the conversation takes up.
 */
export function ChatPanel() {
  const messages = useChatStore((state) => state.messages);
  const status = useChatStore((state) => state.status);
  const error = useChatStore((state) => state.error);
  const mode = useChatStore((state) => state.mode);
  const setMode = useChatStore((state) => state.setMode);
  const clear = useChatStore((state) => state.clear);
  const addUserMessage = useChatStore((state) => state.addUserMessage);
  const beginRun = useChatStore((state) => state.beginRun);
  const handleEvent = useChatStore((state) => state.handleEvent);
  const endRun = useChatStore((state) => state.endRun);
  const failRun = useChatStore((state) => state.failRun);

  const setPending = useAssistantStore((state) => state.setPending);
  const setToolCalls = useAssistantStore((state) => state.setToolCalls);

  const config = useConfigStore((state) => state.config);
  const loadConfig = useConfigStore((state) => state.load);

  const serviceUrl = useSettingsStore((state) => state.serviceUrl);

  const [draft, setDraft] = useState('');
  const [modelWindow, setModelWindow] = useState<ModelWindow | null>(null);
  const bottom = useRef<HTMLDivElement | null>(null);

  const provider = useMemo(() => providerInUse(config), [config]);
  const reported = useChatStore((state) => state.usage);
  const transcript = useChatStore((state) => state.transcript);
  const usage = useMemo(() => usageOf(reported, transcript), [reported, transcript]);

  useEffect(() => {
    if (!config) {
      void loadConfig();
    }
  }, [config, loadConfig]);

  // The size of the model's context is looked up when the model changes.
  // The catalogue is kept by the shell, so this is a lookup and not a
  // download.
  useEffect(() => {
    let cancelled = false;

    if (!provider?.id || !provider.model) {
      setModelWindow(null);
      return;
    }

    void modelContextWindow(provider.id, provider.model).then((found) => {
      if (!cancelled) {
        setModelWindow(found);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [provider?.id, provider?.model]);

  useEffect(() => {
    // Not every environment has the method, so it is checked rather than
    // assumed: the chat still works without it, it just does not follow
    // the answer.
    bottom.current?.scrollIntoView?.({ block: 'end' });
  }, [messages]);

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || status === 'running') {
      return;
    }

    addUserMessage(text);
    setDraft('');
    beginRun();

    // The user's message is already in the transcript, so the conversation
    // that is sent is the transcript as it stands.
    const conversation = useChatStore.getState().transcript;

    const provider = providerInUse(config);

    // The changes and the tool results are collected as the run goes and
    // handed to the store at the end, so a run that proposes several changes
    // shows all of them rather than only the last.
    const edits: ProposedEdit[] = [];
    const calls: AiToolResult[] = [];
    const argumentsOf = new Map<string, Record<string, unknown>>();

    try {
      await runAssistant({
        messages: conversation,
        serviceUrl,
        providerId: provider?.id,
        model: provider?.model,
        mode: useChatStore.getState().mode,
        onEvent: (event) => {
          if (event.type === 'toolCall') {
            argumentsOf.set(event.id, event.arguments);
          }
          if (event.type === 'edit') {
            edits.push(event.edit);
          }
          if (event.type === 'toolResult') {
            calls.push({
              id: event.id,
              name: event.name as AiToolName,
              arguments: argumentsOf.get(event.id) ?? {},
              ok: event.ok,
              result: event.result,
              error: event.error,
            });
          }
          handleEvent(event);
        },
      });

      if (edits.length > 0) {
        setPending(edits);
      }
      if (calls.length > 0) {
        setToolCalls(calls);
      }

      endRun();
    } catch (caught) {
      failRun(reasonOf(caught, 'The assistant could not be reached.'));
    }
  }, [
    draft,
    status,
    addUserMessage,
    beginRun,
    config,
    serviceUrl,
    setPending,
    setToolCalls,
    handleEvent,
    endRun,
    failRun,
  ]);

  const handleStop = useCallback(async () => {
    await cancelAssistant();
    endRun();
  }, [endRun]);

  const disabled = status === 'running' || !config?.aiEnabled;

  return (
    <div className="chat-panel">
      <div className="chat-toolbar">
        <ModeSwitcher mode={mode} onChange={setMode} />

        <ModelPicker
          providers={config?.providers ?? []}
          activeProviderId={config?.activeProviderId ?? null}
          activeModel={config?.activeModel ?? null}
        />

        <ContextDonut
          used={usage?.tokens ?? 0}
          window={modelWindow?.contextTokens ?? null}
          estimated={usage?.estimated ?? false}
        />

        <button
          type="button"
          className="chat-new"
          onClick={clear}
          disabled={messages.length === 0}
        >
          New chat
        </button>
      </div>

      <div className="chat-messages">
        {messages.length === 0 && (
          <p className="chat-empty">
            Ask the assistant about the document. It can read the document, propose changes
            and check how they look.
          </p>
        )}

        {messages.map((message) => (
          <article
            key={message.id}
            className={`chat-message chat-message-${message.role}`}
          >
            <p className="chat-text">{message.text}</p>

            {message.tools.length > 0 && (
              <ul className="chat-tools">
                {message.tools.map((tool, index) => (
                  <li key={`${tool.name}-${index}`} className="chat-tool">
                    <span className="chat-tool-name">{tool.name}</span>
                    {tool.pending ? (
                      <span className="chat-tool-running">running…</span>
                    ) : tool.ok ? (
                      <span className="chat-tool-ok">ok</span>
                    ) : (
                      <span className="chat-tool-failed">{tool.error}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </article>
        ))}

        <div ref={bottom} />
      </div>

      {error && (
        <p className="settings-problem" role="alert">
          {error}
        </p>
      )}

      <div className="chat-composer">
        <textarea
          className="chat-input"
          rows={3}
          value={draft}
          spellCheck
          disabled={disabled}
          placeholder="Ask for a change to the document…"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void handleSend();
            }
          }}
        />

        <div className="assistant-actions">
          <button
            type="button"
            onClick={handleSend}
            disabled={disabled || draft.trim().length === 0}
          >
            {status === 'running' ? 'Thinking…' : 'Send'}
          </button>
          {status === 'running' && (
            <button type="button" onClick={handleStop}>
              Stop
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
