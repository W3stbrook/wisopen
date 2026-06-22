import type { AppSettings, AuthStatus } from '@wisopen/shared';

const STEPS = ['welcome', 'auth', 'mic', 'access', 'hotkey', 'try'] as const;
type StepId = (typeof STEPS)[number];

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const w = window.wisopen;

let stepIndex = 0;
let authMode: 'signup' | 'signin' = 'signup';
let signedIn = false;
let permPoll: ReturnType<typeof setInterval> | null = null;

function toast(msg: string): void {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

function currentStep(): StepId {
  return STEPS[stepIndex]!;
}

function renderProgress(): void {
  const bar = $('progress');
  bar.innerHTML = '';
  STEPS.forEach((_, i) => {
    const dot = document.createElement('span');
    dot.className = 'dot' + (i === stepIndex ? ' active' : i < stepIndex ? ' done' : '');
    bar.appendChild(dot);
  });
}

function showStep(index: number): void {
  stepIndex = Math.max(0, Math.min(index, STEPS.length - 1));
  const id = currentStep();
  document.querySelectorAll('.onboarding-step').forEach((el) => {
    el.classList.toggle('active', (el as HTMLElement).dataset.step === id);
  });
  renderProgress();
  updateFooter();
  if (id === 'mic' || id === 'access') startPermPoll();
  else stopPermPoll();
  if (id === 'hotkey') syncHotkeyPreview();
}

function updateFooter(): void {
  const id = currentStep();
  $('back').classList.toggle('hidden', stepIndex === 0);
  $('skip').classList.toggle('hidden', !signedIn || id === 'welcome' || id === 'auth' || id === 'try');
  $('finish').classList.toggle('hidden', id !== 'try');
  $('next').classList.toggle('hidden', id === 'try');

  const next = $('next');
  if (id === 'welcome') next.textContent = 'Get started';
  else if (id === 'auth') next.textContent = authMode === 'signup' ? 'Create account' : 'Sign in';
  else if (id === 'mic') next.textContent = 'Continue';
  else if (id === 'access') next.textContent = 'Continue';
  else if (id === 'hotkey') next.textContent = 'Save & continue';
  else next.textContent = 'Continue';
}

function setAuthMode(mode: 'signup' | 'signin'): void {
  authMode = mode;
  const h1 = document.querySelector('[data-step="auth"] h1');
  const lead = document.querySelector('[data-step="auth"] .lead');
  if (h1) h1.textContent = mode === 'signup' ? 'Create your account' : 'Welcome back';
  if (lead) {
    lead.innerHTML =
      mode === 'signup'
        ? 'Sync snippets, dictionary, and history across devices. Takes 10 seconds.'
        : 'Sign in to pick up where you left off.';
  }
  $('authToggleLabel').textContent = mode === 'signup' ? 'Already have an account?' : "Don't have an account?";
  $('authToggle').textContent = mode === 'signup' ? 'Sign in' : 'Create account';
  ($('password') as HTMLInputElement).autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
  updateFooter();
}

function showAuthSuccess(email: string | null): void {
  signedIn = true;
  const msg = $('authMsg');
  msg.textContent = email ? `Signed in as ${email}` : 'Signed in';
  msg.classList.remove('hidden');
  $('authErr').textContent = '';
  updateFooter();
}

function showAuthError(message: string): void {
  $('authErr').textContent = message;
  $('authMsg').classList.add('hidden');
}

async function runAuth(): Promise<boolean> {
  const email = ($('email') as HTMLInputElement).value.trim();
  const password = ($('password') as HTMLInputElement).value;
  if (!email || !password) {
    showAuthError('Enter your email and password.');
    return false;
  }
  if (password.length < 8) {
    showAuthError('Password must be at least 8 characters.');
    return false;
  }
  $('authErr').textContent = '';
  $('next').disabled = true;
  try {
    if (authMode === 'signup') {
      await w.invoke('auth:signUpPassword', { email, password });
      toast('Account created');
    } else {
      await w.invoke('auth:signInPassword', { email, password });
      toast('Signed in');
    }
    const s = await w.invoke<AuthStatus>('auth:status');
    showAuthSuccess(s.email);
    return true;
  } catch (e) {
    showAuthError(e instanceof Error ? e.message : 'Authentication failed');
    return false;
  } finally {
    $('next').disabled = false;
  }
}

type PermState = 'granted' | 'denied' | 'needed';

/**
 * Reflect one permission row. The right column holds a single element (matching the
 * design): a green "granted" pill once the permission is set, otherwise the action
 * button that opens the OS prompt / Settings pane.
 */
function setPermRow(rowId: string, statId: string, btnId: string, status: PermState): void {
  const granted = status === 'granted';
  $(rowId).classList.toggle('granted', granted);
  const stat = $(statId);
  stat.textContent = 'granted';
  stat.className = 'pill-badge ok';
  stat.classList.toggle('hidden', !granted);
  $(btnId).classList.toggle('hidden', granted);
}

async function refreshPerms(): Promise<void> {
  const p = await w.invoke<{ microphone: string; accessibility: boolean }>('perms:status');
  const micStatus: PermState = p.microphone === 'granted' ? 'granted' : p.microphone === 'denied' ? 'denied' : 'needed';
  setPermRow('micRow', 'micStat', 'micBtn', micStatus);
  $('micBars').classList.toggle('live', p.microphone === 'granted');

  // perms:status reports microphone + accessibility; input-monitoring tracks accessibility.
  const sysStatus: PermState = p.accessibility ? 'granted' : 'needed';
  setPermRow('axRow', 'axStat', 'axBtn', sysStatus);
  setPermRow('imRow', 'imStat', 'imBtn', sysStatus);
}

function startPermPoll(): void {
  stopPermPoll();
  void refreshPerms();
  permPoll = setInterval(() => void refreshPerms(), 1200);
}

function stopPermPoll(): void {
  if (permPoll) {
    clearInterval(permPoll);
    permPoll = null;
  }
}

function displayHotkey(spec: string): string {
  return spec
    .split('+')
    .map((p) => {
      if (p === 'Cmd') return '⌘';
      if (p === 'Ctrl') return '⌃';
      if (p === 'Alt') return '⌥';
      if (p === 'Shift') return '⇧';
      return p;
    })
    .join(' ');
}

function syncHotkeyPreview(): void {
  const key = ($('hotkey') as HTMLInputElement).value.trim() || 'F13';
  $('hotkeyPreview').textContent = displayHotkey(key);
}

async function saveHotkey(): Promise<void> {
  const pttKey = ($('hotkey') as HTMLInputElement).value.trim() || 'F13';
  await w.invoke('settings:set', { pttKey });
  syncHotkeyPreview();
  toast('Hotkey saved');
}

async function advance(): Promise<void> {
  const id = currentStep();
  if (id === 'auth') {
    const ok = await runAuth();
    if (!ok) return;
  }
  if (id === 'hotkey') await saveHotkey();
  if (stepIndex < STEPS.length - 1) showStep(stepIndex + 1);
}

// Hidden buttons for e2e / programmatic triggers
$('signup').addEventListener('click', async () => {
  authMode = 'signup';
  setAuthMode('signup');
  await runAuth();
});
$('signin').addEventListener('click', async () => {
  authMode = 'signin';
  setAuthMode('signin');
  await runAuth();
});

$('authToggle').addEventListener('click', () => {
  setAuthMode(authMode === 'signup' ? 'signin' : 'signup');
});

$('next').addEventListener('click', () => void advance());
$('back').addEventListener('click', () => showStep(stepIndex - 1));
$('skip').addEventListener('click', () => window.close());
$('finish').addEventListener('click', async () => {
  await w.invoke('app:showSettings', { view: 'home' });
  window.close();
});

$('micBtn').addEventListener('click', async () => {
  await w.invoke('perms:requestMicrophone');
  await refreshPerms();
});
$('axBtn').addEventListener('click', () => w.invoke('perms:openSettingsPane', 'accessibility'));
$('imBtn').addEventListener('click', () => w.invoke('perms:openSettingsPane', 'input-monitoring'));

$('saveHotkey').addEventListener('click', () => void saveHotkey());

$('captureHotkey').addEventListener('click', async () => {
  const btn = $<HTMLButtonElement>('captureHotkey');
  const box = $('hotkeyCaptureBox');
  const lbl = $('captureLabel');
  btn.disabled = true;
  lbl.textContent = 'Press your shortcut now…';
  btn.classList.add('recording');
  box.classList.add('listening');
  try {
    const { combo } = await w.invoke<{ combo: string }>('hotkey:capture');
    ($('hotkey') as HTMLInputElement).value = combo;
    syncHotkeyPreview();
    toast('Shortcut recorded');
  } catch (e) {
    toast(e instanceof Error ? e.message : 'Capture failed');
  } finally {
    btn.disabled = false;
    lbl.textContent = 'Press to record shortcut';
    btn.classList.remove('recording');
    box.classList.remove('listening');
  }
});

$('micTest').addEventListener('click', async () => {
  const box = $('micMsg');
  const text = $('micMsgText');
  text.textContent = 'Listening… speak now (auto-stops in 4 seconds)';
  box.classList.add('active');
  await w.invoke('dictation:start');
  setTimeout(async () => {
    await w.invoke('dictation:stop');
    text.textContent = 'Done — check the overlay for your polished text.';
    box.classList.remove('active');
  }, 4000);
});

window.wisopen.on('auth:changed', (payload) => {
  const s = payload as AuthStatus;
  signedIn = s.signedIn;
  if (s.signedIn) showAuthSuccess(s.email);
  else {
    $('authMsg').classList.add('hidden');
    signedIn = false;
  }
  updateFooter();
});

(async () => {
  const s = await w.invoke<AuthStatus>('auth:status');
  if (s.signedIn) {
    showAuthSuccess(s.email);
    stepIndex = 2; // skip welcome + auth
  }
  await refreshPerms();
  const settings = await w.invoke<AppSettings>('settings:get');
  ($('hotkey') as HTMLInputElement).value = settings.pttKey;
  syncHotkeyPreview();
  setAuthMode('signup');
  showStep(stepIndex);
})().catch(() => undefined);
