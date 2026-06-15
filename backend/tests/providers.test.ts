import { describe, it, expect } from 'vitest';
import { MockLlm, mockPolish } from '../supabase/functions/_shared/providers/llm/mock.ts';
import { MockStt } from '../supabase/functions/_shared/providers/stt/mock.ts';
import { OpenAiCompatibleLlm } from '../supabase/functions/_shared/providers/llm/openai-compatible.ts';
import { BedrockLlm } from '../supabase/functions/_shared/providers/llm/bedrock.ts';
import {
  AwsTranscribeStt,
  type StartTranscription,
} from '../supabase/functions/_shared/providers/stt/aws-transcribe.ts';
import { OpenAiStt } from '../supabase/functions/_shared/providers/stt/openai.ts';
import { buildPolishPrompt } from '../supabase/functions/_shared/prompt.ts';
import {
  normalizeOpenAiChatUsage,
  normalizeOpenAiResponsesUsage,
  normalizeBedrockUsage,
  estimateCost,
} from '../supabase/functions/_shared/usage.ts';
import { pcm16ToWav } from '../supabase/functions/_shared/util.ts';
import type { SttEvent, SttSession } from '../supabase/functions/_shared/providers/types.ts';

async function collect(session: SttSession): Promise<SttEvent[]> {
  const evs: SttEvent[] = [];
  for await (const e of session.events()) evs.push(e);
  return evs;
}

const frame = () => new Uint8Array(3200); // 0.1s @16k PCM16

describe('mock LLM', () => {
  it('polishes: strips filler, capitalizes, terminal punctuation', () => {
    expect(mockPolish('um hello there you know')).toBe('Hello there.');
  });
  it('returns text + token counts', async () => {
    const r = await new MockLlm().complete('sys', 'Transcript: um hello world');
    expect(r.text).toBe('Hello world.');
    expect(r.tokensIn).toBeGreaterThan(0);
    expect(r.tokensOut).toBeGreaterThan(0);
    expect(r.model).toBe('mock-polish-1');
  });
});

describe('mock STT (streaming)', () => {
  it('emits partials then a final with audioSeconds', async () => {
    const s = new MockStt().openSession({ sampleRate: 16000 });
    for (let i = 0; i < 9; i++) s.pushAudio(frame());
    s.end();
    const evs = await collect(s);
    expect(evs.some((e) => e.kind === 'partial')).toBe(true);
    const final = evs.at(-1)!;
    expect(final.kind).toBe('final');
    expect(final.text.length).toBeGreaterThan(0);
    expect(final.audioSeconds).toBeCloseTo(0.9, 1);
  });
});

describe('OpenAiCompatibleLlm (chat completions, DI)', () => {
  it('reads choices[0].message.content and normalizes usage', async () => {
    const llm = new OpenAiCompatibleLlm(
      async (args) => {
        expect(args.model).toBe('z-ai/glm-5.1');
        expect(args.messages[0]!.role).toBe('system');
        return {
          choices: [{ message: { content: 'polished text' } }],
          usage: { prompt_tokens: 11, completion_tokens: 7 },
        };
      },
      'z-ai/glm-5.1',
    );
    const r = await llm.complete('sys', 'Transcript: hi');
    expect(r).toEqual({ text: 'polished text', tokensIn: 11, tokensOut: 7, model: 'z-ai/glm-5.1' });
  });
  it('handles null content + missing usage', async () => {
    const llm = new OpenAiCompatibleLlm(async () => ({ choices: [{ message: { content: null } }] }), 'm');
    const r = await llm.complete('s', 'u');
    expect(r.text).toBe('');
    expect(r.tokensIn).toBe(0);
  });
});

describe('BedrockLlm (converse, DI)', () => {
  it('reads output.message.content[0].text and normalizes usage', async () => {
    const llm = new BedrockLlm(
      async (input) => {
        expect(input.system?.[0]!.text).toBe('sys');
        expect(input.messages[0]!.content[0]!.text).toContain('Transcript');
        return {
          output: { message: { content: [{ text: 'bedrock polished' }] } },
          usage: { inputTokens: 30, outputTokens: 12 },
        };
      },
      'us.anthropic.claude-3-5-sonnet-20240620-v1:0',
    );
    const r = await llm.complete('sys', 'Transcript: hi');
    expect(r.text).toBe('bedrock polished');
    expect(r.tokensIn).toBe(30);
    expect(r.tokensOut).toBe(12);
  });
});

describe('AwsTranscribeStt (streaming, DI)', () => {
  it('emits growing partials then final aggregated text', async () => {
    const start: StartTranscription = async function* () {
      yield { TranscriptEvent: { Transcript: { Results: [{ ResultId: 'r1', IsPartial: true, Alternatives: [{ Transcript: 'hello' }] }] } } };
      yield { TranscriptEvent: { Transcript: { Results: [{ ResultId: 'r1', IsPartial: false, Alternatives: [{ Transcript: 'hello world' }] }] } } };
    };
    const s = new AwsTranscribeStt(start).openSession({ sampleRate: 16000 });
    s.pushAudio(frame());
    s.end();
    const evs = await collect(s);
    const final = evs.at(-1)!;
    expect(final.kind).toBe('final');
    expect(final.text).toBe('hello world');
    expect(typeof final.audioSeconds).toBe('number');
  });
});

describe('OpenAiStt (buffered, DI)', () => {
  it('wraps PCM, calls transcribe, emits one final', async () => {
    let gotWav: Uint8Array | null = null;
    const s = new OpenAiStt(async (wav) => {
      gotWav = wav;
      return { text: 'buffered result' };
    }).openSession({ sampleRate: 16000 });
    s.pushAudio(frame());
    s.end();
    const evs = await collect(s);
    expect(evs).toHaveLength(1);
    expect(evs[0]!.kind).toBe('final');
    expect(evs[0]!.text).toBe('buffered result');
    // wav header present
    expect(gotWav!.byteLength).toBe(44 + 3200);
    expect(String.fromCharCode(...gotWav!.slice(0, 4))).toBe('RIFF');
  });
});

describe('buildPolishPrompt', () => {
  it('embeds template, dictionary, language and the preserve-trigger directive', () => {
    const { system, user } = buildPolishPrompt('TEMPLATE', 'hello world', ['Wisopen'], 'en');
    expect(system).toContain('TEMPLATE');
    expect(system).toContain('Wisopen');
    expect(system).toContain('"en"');
    expect(system).toContain('Preserve any shortcut trigger phrases verbatim');
    expect(user).toBe('Transcript: hello world');
  });
});

describe('usage normalization (3 shapes)', () => {
  it('chat', () => expect(normalizeOpenAiChatUsage({ prompt_tokens: 5, completion_tokens: 9 })).toEqual({ tokensIn: 5, tokensOut: 9 }));
  it('responses', () => expect(normalizeOpenAiResponsesUsage({ input_tokens: 5, output_tokens: 9 })).toEqual({ tokensIn: 5, tokensOut: 9 }));
  it('bedrock', () => expect(normalizeBedrockUsage({ inputTokens: 5, outputTokens: 9 })).toEqual({ tokensIn: 5, tokensOut: 9 }));
  it('undefined -> zeros', () => expect(normalizeOpenAiChatUsage(undefined)).toEqual({ tokensIn: 0, tokensOut: 0 }));
});

describe('estimateCost', () => {
  it('prices LLM tokens and STT audio seconds; zero for mock/raw', () => {
    expect(estimateCost({ user_id: 'u', kind: 'llm', provider: 'openai-compatible', model: 'm', tokens_in: 1000, tokens_out: 1000 })).toBeCloseTo(0.00075, 6);
    expect(estimateCost({ user_id: 'u', kind: 'stt', provider: 'aws-transcribe', model: null, audio_seconds: 10 })).toBeCloseTo(0.004, 6);
    expect(estimateCost({ user_id: 'u', kind: 'llm', provider: 'mock', model: 'm', tokens_in: 999, tokens_out: 999 })).toBe(0);
  });
});

describe('pcm16ToWav', () => {
  it('prepends a valid 44-byte WAV header', () => {
    const wav = pcm16ToWav(new Uint8Array(100), 16000);
    expect(wav.byteLength).toBe(144);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...wav.slice(8, 12))).toBe('WAVE');
  });
});
