import { create } from 'zustand';
import type { AssistantEvent, AssistantMode, ChatMessage } from '@yuemi/protocol';

/**
 * The conversation with the assistant.
 *
 * The assistant's answer arrives as a series of events, so the text of the
 * answer grows a piece at a time and is shown as it arrives. The changes the
 * assistant proposes go to the assistant store, which is where the user
 * accepts or rejects them.
 *
 * The transcript holds the finished turns only. The answer being written is
 * kept apart, because it is not part of the conversation until the run is
 * over.
 */

export interface ChatToolEntry {
  /** The identifier the provider gave the call. */
  id: string;
  /** The name of the tool. */
  name: string;
  /** Whether it worked. */
  ok: boolean;
  /** Why it failed, when it did. */
  error?: string;
  /** Whether the tool is still running. */
  pending: boolean;
}

export interface ChatMessageEntry {
  /** The identifier of the message. */
  id: string;
  /** Who said it. */
  role: 'user' | 'assistant';
  /** What was said. */
  text: string;
  /** The tools the assistant called, in the order it called them. */
  tools: ChatToolEntry[];
}

export type ChatStatus = 'idle' | 'running' | 'error';

/**
 * How much of the model's context the conversation takes up.
 *
 * The provider is the only place that knows this, so the number comes from
 * what it reported. When a provider reports nothing — a local server that
 * ignores the request — the size is estimated from the text instead, and
 * the ring says that it is an estimate.
 */
export interface ChatUsage {
  /** The tokens the conversation takes up. */
  tokens: number;
  /** Whether the number came from the provider or was estimated. */
  estimated: boolean;
}

/** Roughly how many characters a token takes up. */
const CHARACTERS_PER_TOKEN = 4;

export interface ChatState {
  /** The conversation as it is shown, oldest first. */
  messages: ChatMessageEntry[];
  /** The finished turns, in the shape the assistant takes them. */
  transcript: ChatMessage[];
  /** Whether a run is going on. */
  status: ChatStatus;
  /** Why the last run failed. */
  error: string | null;
  /** How many pages the last rendered document had. */
  pageCount: number | null;
  /** How the assistant is running. */
  mode: AssistantMode;
  /** How much of the model's context the conversation takes up. */
  usage: ChatUsage | null;

  /** Adds what the user said. */
  addUserMessage: (text: string) => void;
  /** Starts a run. */
  beginRun: () => void;
  /** Reports one event of a run. */
  handleEvent: (event: AssistantEvent) => void;
  /** Ends a run, keeping what the assistant said. */
  endRun: () => void;
  /** Reports why a run failed. */
  failRun: (message: string) => void;
  /** Removes the whole conversation. */
  clear: () => void;
  /** Changes how the assistant is running. */
  setMode: (mode: AssistantMode) => void;
  /** The conversation in the shape the assistant takes it. */
  toChatMessages: () => ChatMessage[];
}

/**
 * Builds the identifier of a message.
 *
 * The counter is what keeps two messages apart even when they are said at
 * the same moment.
 */
let counter = 0;

function nextId(): string {
  counter += 1;
  return `message-${counter}`;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  transcript: [],
  status: 'idle',
  error: null,
  pageCount: null,
  mode: 'agent',
  usage: null,

  addUserMessage: (text) =>
    set((state) => ({
      messages: [
        ...state.messages,
        { id: nextId(), role: 'user', text, tools: [] },
      ],
      transcript: [...state.transcript, { role: 'user', content: [{ kind: 'text', text }] }],
    })),

  beginRun: () =>
    set((state) => ({
      status: 'running',
      error: null,
      messages: [
        ...state.messages,
        { id: nextId(), role: 'assistant', text: '', tools: [] },
      ],
    })),

  handleEvent: (event) => {
    switch (event.type) {
      case 'text': {
        set((state) => ({
          messages: state.messages.map((message, index) =>
            index === state.messages.length - 1
              ? { ...message, text: message.text + event.text }
              : message,
          ),
        }));
        break;
      }
      case 'toolCall': {
        // The call is shown as running, so the user can see what the
        // assistant is doing while it does it.
        set((state) => ({
          messages: state.messages.map((message, index) =>
            index === state.messages.length - 1
              ? {
                  ...message,
                  tools: [
                    ...message.tools,
                    { id: event.id, name: event.name, ok: true, pending: true },
                  ],
                }
              : message,
          ),
        }));
        break;
      }
      case 'toolResult': {
        set((state) => ({
          messages: state.messages.map((message, index) =>
            index === state.messages.length - 1
              ? {
                  ...message,
                  tools: message.tools.some((tool) => tool.id === event.id)
                    ? message.tools.map((tool) =>
                        tool.id === event.id
                          ? { ...tool, ok: event.ok, error: event.error, pending: false }
                          : tool,
                      )
                    : [
                        ...message.tools,
                        {
                          id: event.id,
                          name: event.name,
                          ok: event.ok,
                          error: event.error,
                          pending: false,
                        },
                      ],
                }
              : message,
          ),
        }));
        break;
      }
      case 'pages': {
        set({ pageCount: event.pageCount });
        break;
      }
      case 'usage': {
        // The provider says how much of the context the turn took up, and
        // the turn carried the whole conversation, so this is the size of
        // the conversation as it stands.
        set({
          usage: {
            tokens: event.usage.inputTokens + event.usage.outputTokens,
            estimated: false,
          },
        });
        break;
      }
      case 'error': {
        set({ error: event.message });
        break;
      }
      default:
        break;
    }
  },

  endRun: () =>
    set((state) => {
      const last = state.messages[state.messages.length - 1];
      const text = last?.role === 'assistant' ? last.text : '';

      // An answer of nothing but a tool call is not worth keeping, because
      // the conversation would start with an empty turn.
      if (text.trim().length === 0) {
        return { status: 'idle' };
      }

      return {
        status: 'idle',
        transcript: [
          ...state.transcript,
          { role: 'assistant', content: [{ kind: 'text', text }] },
        ],
      };
    }),

  failRun: (message) => set({ status: 'error', error: message }),

  clear: () =>
    set({
      messages: [],
      transcript: [],
      status: 'idle',
      error: null,
      pageCount: null,
      usage: null,
      mode: 'agent',
    }),

  setMode: (mode) => set({ mode }),

  toChatMessages: () => get().transcript,
}));

/**
 * How much of the model's context the conversation takes up.
 *
 * The number the provider reported is used when there is one. A provider
 * that says nothing — a local server that ignores the request — leaves the
 * size to be estimated from the text instead, and the estimate is marked as
 * one, so the ring can say so.
 */
export function usageOf(
  reported: ChatUsage | null,
  transcript: ChatMessage[],
): ChatUsage | null {
  if (reported) {
    return reported;
  }

  const characters = transcript.reduce((total, message) => {
    const text = message.content
      .filter((part): part is { kind: 'text'; text: string } => part.kind === 'text')
      .map((part) => part.text)
      .join('');

    return total + text.length;
  }, 0);

  if (characters === 0) {
    return null;
  }

  return {
    tokens: Math.ceil(characters / CHARACTERS_PER_TOKEN),
    estimated: true,
  };
}
