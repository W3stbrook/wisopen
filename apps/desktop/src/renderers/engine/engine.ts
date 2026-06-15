// Hidden engine renderer: captures the mic, downsamples to 16 kHz PCM16, streams it
// to the stt-stream edge function over a WebSocket, and forwards partial/final to main.
import { downsampleTo16k, int16ToBase64 } from './resample.js';

let ws: WebSocket | null = null;
let audioCtx: AudioContext | null = null;
let stream: MediaStream | null = null;
let processor: ScriptProcessorNode | null = null;
let source: MediaStreamAudioSourceNode | null = null;
let settled = false; // a final/error has resolved this run

function wsUrl(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/^http/, 'ws')}/functions/v1/stt-stream`;
}

function cleanupAudio(): void {
  if (processor) processor.onaudioprocess = null;
  processor?.disconnect();
  source?.disconnect();
  stream?.getTracks().forEach((t) => t.stop());
  void audioCtx?.close().catch(() => undefined);
  processor = source = null;
  stream = null;
  audioCtx = null;
}

function closeWs(): void {
  try {
    ws?.close();
  } catch {
    /* ignore */
  }
  ws = null;
}

function finish(): void {
  cleanupAudio();
  closeWs();
}

async function start(jwt: string, supabaseUrl: string, lang: string | null, dictionary: string[]): Promise<void> {
  finish();
  settled = false;

  // token via subprotocol (avoids leaking it into URLs/logs)
  ws = new WebSocket(wsUrl(supabaseUrl), ['jwt-' + jwt]);
  ws.onmessage = (e: MessageEvent) => {
    let m: { t: string; text?: string; audioSeconds?: number; message?: string };
    try {
      m = JSON.parse(typeof e.data === 'string' ? e.data : '');
    } catch {
      return;
    }
    if (m.t === 'partial') {
      window.wisopen.send('engine:partial', { text: m.text ?? '' });
    } else if (m.t === 'final') {
      settled = true;
      window.wisopen.send('engine:final', { text: m.text ?? '', audioSeconds: m.audioSeconds ?? 0 });
      finish();
    } else if (m.t === 'error') {
      settled = true;
      window.wisopen.send('engine:error', { message: m.message ?? 'stt error' });
      finish();
    }
  };
  ws.onerror = () => {
    if (!settled) {
      settled = true;
      window.wisopen.send('engine:error', { message: 'stt connection error' });
    }
    finish();
  };
  ws.onclose = () => {
    if (!settled) {
      settled = true;
      window.wisopen.send('engine:error', { message: 'stt connection closed' });
    }
    cleanupAudio();
  };

  try {
    await new Promise<void>((resolveOpen, reject) => {
      if (!ws) return reject(new Error('no ws'));
      ws.onopen = () => resolveOpen();
      setTimeout(() => reject(new Error('ws open timeout')), 8000);
    });
  } catch (err) {
    finish();
    throw err;
  }
  ws.send(JSON.stringify({ t: 'config', sampleRate: 16000, lang, dictionary }));

  stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  audioCtx = new AudioContext();
  source = audioCtx.createMediaStreamSource(stream);
  processor = audioCtx.createScriptProcessor(4096, 1, 1);
  source.connect(processor);
  processor.connect(audioCtx.destination); // outputs silence (we never write outputBuffer)
  processor.onaudioprocess = (ev: AudioProcessingEvent) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const input = ev.inputBuffer.getChannelData(0);
    let sum = 0;
    for (let i = 0; i < input.length; i++) sum += (input[i] as number) ** 2;
    window.wisopen.send('engine:level', { level: Math.sqrt(sum / input.length) });
    const pcm = downsampleTo16k(input, audioCtx!.sampleRate);
    ws.send(JSON.stringify({ t: 'audio', pcm: int16ToBase64(pcm) }));
  };
}

function stop(): void {
  if (processor) processor.onaudioprocess = null; // stop sending audio
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'end' }));
  // server emits 'final' which triggers cleanup; stop mic tracks now to clear the indicator
  stream?.getTracks().forEach((t) => t.stop());
}

window.wisopen.on('engine:command', (payload) => {
  const p = payload as {
    cmd: 'start' | 'stop';
    jwt: string;
    supabaseUrl: string;
    lang: string | null;
    dictionary: string[];
  };
  if (p.cmd === 'start') {
    start(p.jwt, p.supabaseUrl, p.lang, p.dictionary).catch((e) => {
      if (!settled) {
        settled = true;
        window.wisopen.send('engine:error', { message: e instanceof Error ? e.message : String(e) });
      }
    });
  } else {
    stop();
  }
});
