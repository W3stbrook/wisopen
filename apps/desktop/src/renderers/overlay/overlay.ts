// Overlay pill: reflects dictation state ('overlay:state') and mic level ('overlay:level').

type State = 'idle' | 'listening' | 'transcribing' | 'polishing' | 'inserting' | 'done' | 'error';
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
  error: 'Error',
};

const label = document.getElementById('label') as HTMLElement;
const meterFill = document.querySelector('.meter > i') as HTMLElement;

window.wisopen.on('overlay:state', (payload) => {
  const p = payload as StatePayload;
  document.body.dataset.state = p.state;
  if (p.state === 'transcribing' && p.partial) {
    label.textContent = p.partial;
  } else if (p.state === 'error') {
    label.textContent = p.message ?? 'Error';
  } else {
    label.textContent = labels[p.state] ?? '';
  }
});

window.wisopen.on('overlay:level', (payload) => {
  const { level } = payload as { level: number };
  meterFill.style.width = `${Math.min(100, Math.round(level * 300))}%`;
});
