// Hidden engine renderer: captures the mic, downsamples to 16 kHz PCM16, streams it
// to the stt-stream edge function over a WebSocket, and forwards partial/final to main.
import { downsampleTo16k, int16ToBase64 } from './resample.js';

let ws: WebSocket | null = null;
let audioCtx: AudioContext | null = null;
let stream: MediaStream | null = null;
let processor: ScriptProcessorNode | null = null;
let source: MediaStreamAudioSourceNode | null = null;

function wsUrl(supabaseUrl: string, jwt: string): string {
  return `${supabaseUrl.replace(/^http/, 'ws')}/functions/v1/stt-stream?jwt=${encodeURIComponent(jwt)}`;
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

async function start(jwt: string, supabaseUrl: string): Promise<void> {
  cleanupAudio();
  closeWs();

  ws = new WebSocket(wsUrl(supabaseUrl, jwt));
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
      window.wisopen.send('engine:final', { text: m.text ?? '', audioSeconds: m.audioSeconds ?? 0 });
      cleanupAudio();
      closeWs();
    } else if (m.t === 'error') {
      window.wisopen.send('engine:error', { message: m.message ?? 'stt error' });
      cleanupAudio();
      closeWs();
    }
  };
  ws.onerror = () => window.wisopen.send('engine:error', { message: 'stt connection error' });

  await new Promise<void>((resolve, reject) => {
    if (!ws) return reject(new Error('no ws'));
    ws.onopen = () => resolve();
    setTimeout(() => reject(new Error('ws open timeout')), 8000);
  });
  ws.send(JSON.stringify({ t: 'config', sampleRate: 16000 }));

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
  // server emits 'final' which triggers cleanup; mic tracks stop now to clear the indicator
  stream?.getTracks().forEach((t) => t.stop());
}

window.wisopen.on('engine:command', (payload) => {
  const p = payload as { cmd: 'start' | 'stop'; jwt: string; supabaseUrl: string };
  if (p.cmd === 'start') {
    start(p.jwt, p.supabaseUrl).catch((e) =>
      window.wisopen.send('engine:error', { message: e instanceof Error ? e.message : String(e) }),
    );
  } else {
    stop();
  }
});
