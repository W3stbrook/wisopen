// Deno-only provider factory: selects + constructs the configured provider from env,
// value-importing the real SDKs lazily via npm: specifiers. Node never imports this file.
import type { LlmProvider, SttProvider } from './types.ts';
import { MockLlm } from './llm/mock.ts';
import { MockStt } from './stt/mock.ts';
import { OpenAiCompatibleLlm } from './llm/openai-compatible.ts';
import { BedrockLlm } from './llm/bedrock.ts';
import { AwsTranscribeStt, type AwsTranscriptEvent } from './stt/aws-transcribe.ts';
import { OpenAiStt } from './stt/openai.ts';

const env = (k: string): string | undefined => Deno.env.get(k);

export async function getLlmProvider(): Promise<LlmProvider> {
  const p = env('LLM_PROVIDER') ?? 'mock';
  if (p === 'openai-compatible') {
    const { default: OpenAI } = await import('npm:openai@6.42.0');
    const client = new OpenAI({
      apiKey: env('OPENAI_COMPAT_API_KEY') ?? '',
      baseURL: env('OPENAI_COMPAT_BASE_URL') ?? 'https://api.openai.com/v1',
    });
    const model = env('OPENAI_COMPAT_MODEL') ?? 'gpt-4o-mini';
    // deno-lint-ignore no-explicit-any
    return new OpenAiCompatibleLlm((args) => client.chat.completions.create(args) as any, model);
  }
  if (p === 'bedrock') {
    const { BedrockRuntimeClient, ConverseCommand } = await import(
      'npm:@aws-sdk/client-bedrock-runtime@3.1068.0'
    );
    const client = new BedrockRuntimeClient({ region: env('AWS_REGION') ?? 'us-east-1' });
    const modelId = env('BEDROCK_MODEL_ID') ?? 'us.anthropic.claude-3-5-sonnet-20240620-v1:0';
    // deno-lint-ignore no-explicit-any
    return new BedrockLlm((input) => client.send(new ConverseCommand(input as any)) as any, modelId);
  }
  return new MockLlm();
}

export async function getSttProvider(): Promise<SttProvider> {
  const p = env('STT_PROVIDER') ?? 'mock';
  if (p === 'aws-transcribe') {
    const { TranscribeStreamingClient, StartStreamTranscriptionCommand } = await import(
      'npm:@aws-sdk/client-transcribe-streaming@3.1068.0'
    );
    const client = new TranscribeStreamingClient({ region: env('AWS_REGION') ?? 'us-east-1' });
    const start = (
      opts: { sampleRate: number; lang?: string | null },
      audio: AsyncIterable<Uint8Array>,
    ): AsyncIterable<AwsTranscriptEvent> => {
      async function* audioStream() {
        for await (const chunk of audio) yield { AudioEvent: { AudioChunk: chunk } };
      }
      const cmd = new StartStreamTranscriptionCommand({
        LanguageCode: opts.lang ?? 'en-US',
        MediaSampleRateHertz: opts.sampleRate,
        MediaEncoding: 'pcm',
        AudioStream: audioStream(),
        // deno-lint-ignore no-explicit-any
      } as unknown as ConstructorParameters<typeof StartStreamTranscriptionCommand>[0]);
      return (async function* () {
        const resp = await client.send(cmd);
        // deno-lint-ignore no-explicit-any
        for await (const ev of (resp as any).TranscriptResultStream ?? []) yield ev as AwsTranscriptEvent;
      })();
    };
    return new AwsTranscribeStt(start);
  }
  if (p === 'openai') {
    const { default: OpenAI, toFile } = await import('npm:openai@6.42.0');
    const client = new OpenAI({ apiKey: env('OPENAI_API_KEY') ?? '' });
    const transcribe = async (wav: Uint8Array, opts: { lang?: string | null }) => {
      const file = await toFile(wav, 'audio.wav', { type: 'audio/wav' });
      const res = await client.audio.transcriptions.create({
        file,
        model: env('OPENAI_STT_MODEL') ?? 'gpt-4o-transcribe',
        ...(opts.lang ? { language: opts.lang } : {}),
      });
      // deno-lint-ignore no-explicit-any
      return { text: (res as any).text ?? '' };
    };
    return new OpenAiStt(transcribe);
  }
  return new MockStt();
}
