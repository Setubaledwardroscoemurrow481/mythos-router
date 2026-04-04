// ─────────────────────────────────────────────────────────────
//  mythos-router :: client.ts
//  Anthropic SDK client with adaptive thinking
// ─────────────────────────────────────────────────────────────

import Anthropic from '@anthropic-ai/sdk';
import {
  MODEL_ID,
  CAPYBARA_SYSTEM_PROMPT,
  validateApiKey,
  type EffortLevel,
} from './config.js';
import { c } from './utils.js';

// ── Stream delta types (SDK doesn't export narrow types) ─────
interface ThinkingDelta {
  type: 'thinking_delta';
  thinking: string;
}

interface TextDelta {
  type: 'text_delta';
  text: string;
}

type ContentDelta = ThinkingDelta | TextDelta;

// ── Types ────────────────────────────────────────────────────
export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface MythosResponse {
  thinking: string;
  text: string;
  inputTokens: number;
  outputTokens: number;
}

// ── Client Factory ───────────────────────────────────────────
let _client: Anthropic | null = null;

export function getClient(): Anthropic {
  if (!_client) {
    const apiKey = validateApiKey();
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

// ── Input Validation ─────────────────────────────────────────
function sanitizeMessages(messages: Message[]): Message[] {
  return messages.map((m, i) => {
    if (m.role !== 'user' && m.role !== 'assistant') {
      throw new Error(`Invalid role at message[${i}]: ${String(m.role)}`);
    }
    if (typeof m.content !== 'string') {
      throw new Error(`Message[${i}] content must be a string`);
    }
    const trimmed = m.content.trim();
    if (trimmed.length === 0) {
      throw new Error(`Empty message content at message[${i}]`);
    }
    return { role: m.role, content: trimmed };
  });
}

// ── Streaming Message ────────────────────────────────────────
export async function streamMessage(
  messages: Message[],
  effort: EffortLevel = 'high',
  onThinkingDelta?: (text: string) => void,
  onTextDelta?: (text: string) => void,
): Promise<MythosResponse> {
  const client = getClient();
  const apiMessages = sanitizeMessages(messages);

  let thinkingText = '';
  let responseText = '';
  let inputTokens = 0;
  let outputTokens = 0;

  let stream;
  try {
    stream = await client.messages.stream({
      model: MODEL_ID,
      max_tokens: 16384,
      thinking: { type: 'adaptive' },
      output_config: { effort },
      system: CAPYBARA_SYSTEM_PROMPT,
      messages: apiMessages,
    });
  } catch (err) {
    throw new Error(`Failed to start stream: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        const delta = event.delta as ContentDelta;

        if (delta.type === 'thinking_delta') {
          thinkingText += delta.thinking;
          onThinkingDelta?.(delta.thinking);
        } else if (delta.type === 'text_delta') {
          responseText += delta.text;
          onTextDelta?.(delta.text);
        }
      }
    }
  } catch (err) {
    throw new Error(`Stream interrupted: ${err instanceof Error ? err.message : String(err)}`);
  }

  const finalMessage = await stream.finalMessage();
  inputTokens = finalMessage.usage?.input_tokens ?? 0;
  outputTokens = finalMessage.usage?.output_tokens ?? 0;

  return {
    thinking: thinkingText,
    text: responseText,
    inputTokens,
    outputTokens,
  };
}

// ── Non-streaming Message (for Dream/Verify) ─────────────────
export async function sendMessage(
  messages: Message[],
  effort: EffortLevel = 'low',
  systemOverride?: string,
): Promise<MythosResponse> {
  const client = getClient();
  const apiMessages = sanitizeMessages(messages);

  let response;
  try {
    response = await client.messages.create({
      model: MODEL_ID,
      max_tokens: 8192,
      thinking: { type: 'adaptive' },
      output_config: { effort },
      system: systemOverride ?? CAPYBARA_SYSTEM_PROMPT,
      messages: apiMessages,
    });
  } catch (err) {
    throw new Error(`API request failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  let thinkingText = '';
  let responseText = '';

  for (const block of response.content) {
    if (block.type === 'thinking') {
      const thinkingBlock = block as { type: 'thinking'; thinking: string };
      thinkingText += thinkingBlock.thinking ?? '';
    } else if (block.type === 'text') {
      responseText += block.text;
    }
  }

  return {
    thinking: thinkingText,
    text: responseText,
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
  };
}

// ── Token cost display ───────────────────────────────────────
export function formatTokenUsage(resp: MythosResponse): string {
  const total = resp.inputTokens + resp.outputTokens;
  return (
    `${c.dim}tokens: ${c.cyan}${resp.inputTokens.toLocaleString()}${c.dim} in · ` +
    `${c.cyan}${resp.outputTokens.toLocaleString()}${c.dim} out · ` +
    `${c.yellow}${total.toLocaleString()}${c.dim} total${c.reset}`
  );
}
