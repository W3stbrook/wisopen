import type { AppSettings, AuthStatus } from '@wisopen/shared';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const w = window.wisopen;

function toast(msg: string): void {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

async function refreshAuth(): Promise<void> {
  const s = await w.invoke<AuthStatus>('auth:status');
  $('authMsg').textContent = s.signedIn ? `Signed in as ${s.email}` : '';
}

$('signin').addEventListener('click', async () => {
  try {
    await w.invoke('auth:signInPassword', {
      email: ($('email') as HTMLInputElement).value,
      password: ($('password') as HTMLInputElement).value,
    });
    await refreshAuth();
    toast('Signed in');
  } catch (e) {
    $('authMsg').textContent = e instanceof Error ? e.message : 'Sign-in failed';
  }
});

$('signup').addEventListener('click', async () => {
  try {
    await w.invoke('auth:signUpPassword', {
      email: ($('email') as HTMLInputElement).value,
      password: ($('password') as HTMLInputElement).value,
    });
    await refreshAuth();
    toast('Account created');
  } catch (e) {
    $('authMsg').textContent = e instanceof Error ? e.message : 'Sign-up failed';
  }
});

async function refreshPerms(): Promise<void> {
  const p = await w.invoke<{ microphone: string; accessibility: boolean }>('perms:status');
  const mic = $('micStat');
  mic.textContent = p.microphone;
  mic.className = `pill-badge ${p.microphone === 'granted' ? 'ok' : 'bad'}`;
  const ax = $('axStat');
  ax.textContent = p.accessibility ? 'granted' : 'needed';
  ax.className = `pill-badge ${p.accessibility ? 'ok' : 'bad'}`;
}

$('micBtn').addEventListener('click', async () => {
  await w.invoke('perms:requestMicrophone');
  await refreshPerms();
});
$('axBtn').addEventListener('click', () => w.invoke('perms:openSettingsPane', 'accessibility'));
$('imBtn').addEventListener('click', () => w.invoke('perms:openSettingsPane', 'input-monitoring'));
$('finish').addEventListener('click', () => window.close());

// auth can change out-of-band (magic-link deep-link exchange in main) — reflect it
window.wisopen.on('auth:changed', (payload) => {
  const s = payload as AuthStatus;
  $('authMsg').textContent = s.signedIn ? `Signed in as ${s.email ?? ''}` : '';
});

(async () => {
  await refreshAuth();
  await refreshPerms();
  const settings = await w.invoke<AppSettings>('settings:get');
  $('hotkey').textContent = settings.pttKey;
})().catch(() => undefined);
