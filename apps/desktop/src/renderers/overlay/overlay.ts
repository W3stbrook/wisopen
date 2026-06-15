// Overlay pill: reflects dictation state pushed from main via 'overlay:state'.

interface OverlayPayload {
  state: 'idle' | 'listening' | 'transcribing' | 'polishing' | 'inserting' | 'done' | 'error';
  partial?: string;
  message?: string;
  level?: number;
}

const labels: Record<OverlayPayload['state'], string> = {
  idle: '',
  listening: 'Listening…',
  transcribing: 'Transcribing…',
  polishing: 'Polishing…',
  inserting: 'Inserting…',
  done: 'Done',
  error: 'Error',
};

const label = document.getElementById('label') as HTMLElement;
const meterFill = document.querySelector('.meter > i') as HTMLElement;

window.wisopen.on('overlay:state', (payload) => {
  const p = payload as OverlayPayload;
  document.body.dataset.state = p.state;
  if (p.state === 'transcribing' && p.partial) {
    label.textContent = p.partial;
  } else if (p.state === 'error') {
    label.textContent = p.message ?? 'Error';
  } else {
    label.textContent = labels[p.state] ?? '';
  }
  if (typeof p.level === 'number') {
    meterFill.style.width = `${Math.min(100, Math.round(p.level * 300))}%`;
  }
});
