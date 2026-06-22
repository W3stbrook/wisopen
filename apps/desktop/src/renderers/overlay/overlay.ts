// Overlay pill: reflects dictation state ('overlay:state') and mic level ('overlay:level').

type State = 'idle' | 'listening' | 'transcribing' | 'polishing' | 'inserting' | 'done' | 'cancelled' | 'error';
interface StatePayload {
  state: State;
  partial?: string;
  message?: string;
}

const labels: Record<State, string> = {
  idle: '',
  listening: 'Listening…',
  transcribing: 'Transcribing…',
  polishing: 'Polishing…',
  inserting: 'Inserting…',
  done: 'Done',
  cancelled: 'No speech detected',
  error: 'Error',
};

const label = document.getElementById('label') as HTMLElement;
const meterFill = document.querySelector('.meter > i') as HTMLElement;

window.wisopen.on('overlay:state', (payload) => {
  const p = payload as StatePayload;
  document.body.dataset.state = p.state;
  if (p.state === 'transcribing' && p.partial) {
    label.textContent = p.partial;
  } else if (p.state === 'listening' && p.message) {
    label.textContent = p.message;
  } else if (p.state === 'error') {
    label.textContent = p.message ?? 'Error';
  } else if (p.state === 'idle') {
    label.textContent = '';
    meterFill.style.width = '0%';
  } else {
    label.textContent = labels[p.state] ?? '';
  }
});

window.wisopen.on('overlay:level', (payload) => {
  const { level } = payload as { level: number };
  meterFill.style.width = `${Math.min(100, Math.round(level * 300))}%`;
});
