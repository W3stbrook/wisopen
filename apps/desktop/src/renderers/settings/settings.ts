import type { AppSettings, AuthStatus, Snippet, DictionaryTerm, Mode, HistoryItem } from '@wisopen/shared';

const w = window.wisopen;
const main = document.getElementById('main') as HTMLElement;
const nav = document.getElementById('nav') as HTMLElement;

function toast(msg: string): void {
  const t = document.getElementById('toast') as HTMLElement;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1800);
}
const esc = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );

let latestUpdate = 'Up to date.';
function fmtUpdate(s: { state: string; version?: string; percent?: number; message?: string }): string {
  switch (s.state) {
    case 'checking': return 'Checking for updates…';
    case 'available': return `Downloading v${s.version}…`;
    case 'downloading': return `Downloading… ${s.percent ?? 0}%`;
    case 'ready': return `Update v${s.version} ready — restart to apply.`;
    case 'error': return `Update error: ${s.message ?? 'unknown'}`;
    default: return 'Up to date.';
  }
}
window.wisopen.on('update:status', (payload) => {
  const s = payload as { state: string; version?: string; percent?: number; message?: string };
  latestUpdate = fmtUpdate(s);
  const el = document.getElementById('updstatus');
  if (el) el.textContent = latestUpdate;
  const btn = document.getElementById('updinstall') as HTMLButtonElement | null;
  if (btn) btn.style.display = s.state === 'ready' ? 'inline-block' : 'none';
});

const VIEWS = [
  'home',
  'dictionary',
  'snippets',
  'history',
  'dictation',
  'modes',
  'general',
  'privacy',
  'account',
] as const;
type View = (typeof VIEWS)[number];

const NAV_SECTIONS: { label: string; items: { id: View; label: string; icon: string }[] }[] = [
  {
    label: 'App',
    items: [
      { id: 'home', label: 'Home', icon: '⌂' },
      { id: 'dictionary', label: 'Dictionary', icon: '◈' },
      { id: 'snippets', label: 'Snippets', icon: '⚡' },
      { id: 'history', label: 'History', icon: '◷' },
    ],
  },
  {
    label: 'Settings',
    items: [
      { id: 'dictation', label: 'Dictation', icon: '●' },
      { id: 'modes', label: 'Modes', icon: '◇' },
      { id: 'general', label: 'General', icon: '⚙' },
      { id: 'privacy', label: 'Privacy', icon: '⛨' },
      { id: 'account', label: 'Account', icon: '◎' },
    ],
  },
];

const renderers: Record<View, () => Promise<void>> = {
  home: renderHome,
  dictionary: renderDictionary,
  snippets: renderSnippets,
  history: renderHistory,
  dictation: renderDictation,
  modes: renderModes,
  general: renderGeneral,
  privacy: renderPrivacy,
  account: renderAccount,
};

let current: View = 'home';

function buildNav(): void {
  nav.innerHTML = `
    <div class="shell-brand">
      <div class="shell-brand-mark">W</div>
      <span class="shell-brand-name">Wisopen</span>
    </div>`;
  for (const section of NAV_SECTIONS) {
    const sec = document.createElement('div');
    sec.className = 'nav-section';
    sec.innerHTML = `<div class="nav-section-label">${section.label}</div>`;
    for (const item of section.items) {
      const b = document.createElement('button');
      b.className = 'nav-item';
      b.dataset.view = item.id;
      b.innerHTML = `<span class="icon">${item.icon}</span>${item.label}`;
      b.addEventListener('click', () => void select(item.id));
      sec.appendChild(b);
    }
    nav.appendChild(sec);
  }
}

async function select(view: View): Promise<void> {
  current = view;
  for (const b of nav.querySelectorAll('.nav-item')) {
    (b as HTMLElement).classList.toggle('active', (b as HTMLElement).dataset.view === view);
  }
  main.innerHTML = '<p class="muted">Loading…</p>';
  await renderers[view]();
}

async function getSettings(): Promise<AppSettings> {
  return w.invoke<AppSettings>('settings:get');
}
async function setSettings(patch: Partial<AppSettings>): Promise<void> {
  await w.invoke('settings:set', patch);
  toast('Saved');
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

async function wireHotkeyCapture(initial: string, onCaptured: (combo: string) => void): Promise<void> {
  const display = document.getElementById('pttDisplay') as HTMLElement;
  const box = document.getElementById('pttCaptureBox') as HTMLElement;
  const btn = document.getElementById('captureBtn') as HTMLButtonElement;
  const hidden = document.getElementById('ptt') as HTMLInputElement;
  hidden.value = initial;
  display.textContent = displayHotkey(initial);

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Press your shortcut now…';
    box.classList.add('listening');
    try {
      const { combo } = await w.invoke<{ combo: string }>('hotkey:capture');
      hidden.value = combo;
      display.textContent = displayHotkey(combo);
      onCaptured(combo);
      toast('Shortcut recorded');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Capture failed');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Press to record shortcut';
      box.classList.remove('listening');
    }
  });
}

async function renderHome(): Promise<void> {
  const [s, auth, perms, history] = await Promise.all([
    getSettings(),
    w.invoke<AuthStatus>('auth:status'),
    w.invoke<{ microphone: string; accessibility: boolean }>('perms:status'),
    w.invoke<HistoryItem[]>('data:listHistory', { limit: 5 }),
  ]);

  const micOk = perms.microphone === 'granted';
  const axOk = perms.accessibility;
  const signedIn = auth.signedIn;

  main.innerHTML = `
    <div class="page-header">
      <h1>Home</h1>
      <p>Hold your hotkey to dictate anywhere. Double-tap for hands-free.</p>
    </div>

    <div class="hero-hotkey">
      <div class="muted" style="font-size:12px;text-transform:uppercase;letter-spacing:.06em">Your shortcut</div>
      <kbd>${esc(displayHotkey(s.pttKey))}</kbd>
      <p class="muted" style="margin:0;font-size:13px">Works in any app — text is inserted where your cursor is.</p>
      <button class="primary" id="testDict" style="margin-top:14px">Test dictation</button>
    </div>

    <div class="status-grid">
      <div class="status-card ${micOk ? 'ok' : 'warn'}">
        <div class="status-icon">🎙</div>
        <div>
          <h3>Microphone</h3>
          <p>${micOk ? 'Ready to capture your voice.' : 'Permission needed for dictation.'}</p>
          ${micOk ? '' : '<button id="micFix">Grant access</button>'}
        </div>
      </div>
      <div class="status-card ${axOk ? 'ok' : 'warn'}">
        <div class="status-icon">⌨</div>
        <div>
          <h3>Accessibility</h3>
          <p>${axOk ? 'Global hotkey is active.' : 'Required for the push-to-talk shortcut.'}</p>
          ${axOk ? '' : '<button id="axFix">Open Settings</button>'}
        </div>
      </div>
      <div class="status-card ${signedIn ? 'ok' : ''}">
        <div class="status-icon">◎</div>
        <div>
          <h3>Account</h3>
          <p>${signedIn ? `Signed in as ${esc(auth.email ?? '')}` : 'Optional — sync snippets and history.'}</p>
          ${signedIn ? '' : '<button id="acctGo">Sign in</button>'}
        </div>
      </div>
    </div>

    <div class="panel">
      <h2>Recent dictations</h2>
      <ul class="recent-list">
        ${
          history.length
            ? history
                .map(
                  (i) =>
                    `<li><span class="time">${new Date(i.created_at).toLocaleString()}</span>${esc(i.final)}</li>`,
                )
                .join('')
            : '<li class="muted">No dictations yet — try the button above.</li>'
        }
      </ul>
    </div>`;

  document.getElementById('testDict')?.addEventListener('click', () => w.invoke('dictation:start'));
  document.getElementById('micFix')?.addEventListener('click', async () => {
    await w.invoke('perms:requestMicrophone');
    void select('home');
  });
  document.getElementById('axFix')?.addEventListener('click', () => w.invoke('perms:openSettingsPane', 'accessibility'));
  document.getElementById('acctGo')?.addEventListener('click', () => void select('account'));
}

async function renderAccount(): Promise<void> {
  const s = await w.invoke<AuthStatus>('auth:status');
  main.innerHTML = `<div class="page-header"><h1>Account</h1><p>Sync snippets, dictionary, and history across devices.</p></div>`;
  if (s.signedIn) {
    main.innerHTML += `
      <div class="card stack">
        <div>Signed in as <b>${esc(s.email ?? '')}</b></div>
        <div><button id="signout" class="danger">Sign out</button></div>
      </div>`;
    document.getElementById('signout')?.addEventListener('click', async () => {
      try {
        await w.invoke('auth:signOut');
        toast('Signed out');
        void select('account');
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Sign out failed');
      }
    });
    return;
  }

  main.innerHTML += `
    <div class="card stack">
      <label class="field"><span>Email</span><input id="acctEmail" type="email" autocomplete="email" placeholder="you@example.com" /></label>
      <label class="field"><span>Password</span><input id="acctPass" type="password" autocomplete="current-password" placeholder="Your password" /></label>
      <p id="acctErr" style="color:var(--danger);font-size:13px;min-height:1.2em;margin:0"></p>
      <div class="row">
        <button class="primary" id="acctSignin">Sign in</button>
        <button id="acctSignup">Create account</button>
      </div>
      <button class="ghost" id="acctOnboard" style="margin-top:4px">Open setup wizard…</button>
    </div>`;

  const runAuth = async (mode: 'signin' | 'signup'): Promise<void> => {
    const email = (document.getElementById('acctEmail') as HTMLInputElement).value.trim();
    const password = (document.getElementById('acctPass') as HTMLInputElement).value;
    const err = document.getElementById('acctErr') as HTMLElement;
    err.textContent = '';
    if (!email || !password) {
      err.textContent = 'Enter email and password.';
      return;
    }
    try {
      if (mode === 'signup') await w.invoke('auth:signUpPassword', { email, password });
      else await w.invoke('auth:signInPassword', { email, password });
      toast(mode === 'signup' ? 'Account created' : 'Signed in');
      void select('account');
    } catch (e) {
      err.textContent = e instanceof Error ? e.message : 'Authentication failed';
    }
  };

  document.getElementById('acctSignin')?.addEventListener('click', () => void runAuth('signin'));
  document.getElementById('acctSignup')?.addEventListener('click', () => void runAuth('signup'));
  document.getElementById('acctOnboard')?.addEventListener('click', () => w.invoke('app:showOnboarding'));
}

async function renderDictation(): Promise<void> {
  const s = await getSettings();
  main.innerHTML = `
    <div class="page-header">
      <h1>Dictation</h1>
      <p>Configure how you activate voice input on your Mac.</p>
    </div>
    <div class="card">
      <label class="field"><span>Push-to-talk shortcut</span>
        <div class="hotkey-capture-box">
          <div class="hotkey-display" id="pttCaptureBox"><kbd id="pttDisplay">${esc(displayHotkey(s.pttKey))}</kbd></div>
          <button type="button" id="captureBtn">Press to record shortcut</button>
          <input type="hidden" id="ptt" value="${esc(s.pttKey)}" />
          <p class="hotkey-hint">Fn is not supported. F13 works well on many Mac keyboards.</p>
        </div>
      </label>
      <label class="field"><span>Activation</span>
        <select id="mode">
          <option value="hybrid" ${s.pttMode === 'hybrid' ? 'selected' : ''}>Hold to talk + double-tap hands-free</option>
          <option value="hold" ${s.pttMode === 'hold' ? 'selected' : ''}>Hold to talk only</option>
          <option value="toggle" ${s.pttMode === 'toggle' ? 'selected' : ''}>Single press toggles hands-free</option>
        </select></label>
      <p class="hotkey-hint">Default: <strong>hold</strong> for a quick phrase; <strong>double-tap</strong> for continuous listening, press once to finish.</p>
      <button class="primary" id="save">Save</button>
      <p class="muted" style="margin-top:10px">Changes apply immediately.</p>
    </div>`;
  await wireHotkeyCapture(s.pttKey, () => undefined);
  document.getElementById('save')?.addEventListener('click', async () => {
    await setSettings({
      pttKey: (document.getElementById('ptt') as HTMLInputElement).value.trim() || 'F13',
      pttMode: (document.getElementById('mode') as HTMLSelectElement).value as AppSettings['pttMode'],
    });
  });
}

async function renderModes(): Promise<void> {
  const [modes, s] = await Promise.all([w.invoke<Mode[]>('data:listModes'), getSettings()]);
  const opts = modes
    .map((m) => `<option value="${m.id}" ${s.defaultModeId === m.id ? 'selected' : ''}>${esc(m.name)}${m.is_system ? '' : ' (custom)'}</option>`)
    .join('');
  main.innerHTML = `
    <div class="page-header"><h1>Modes</h1><p>Choose how Wisopen formats your dictation before inserting it.</p></div>
    <div class="card">
      <label class="field"><span>Default formatting mode</span>
        <select id="defmode"><option value="">— Use server default (Clean) —</option>${opts}</select></label>
      <button class="primary" id="save">Save</button>
    </div>
    <h2 style="margin-top:18px">Available modes</h2>
    <div class="card"><table><tr><th>Name</th><th>Description</th><th></th></tr>
      ${modes
        .map(
          (m) => `<tr><td>${esc(m.name)}${m.is_system ? '' : ' <span class="pill-badge">custom</span>'}</td>
            <td class="muted">${esc(m.description ?? '')}</td>
            <td>${m.is_system ? '' : `<button class="danger delmode" data-id="${esc(m.id)}">Delete</button>`}</td></tr>`,
        )
        .join('')}
    </table></div>
    <h2 style="margin-top:18px">Add a custom mode</h2>
    <div class="card stack">
      <label class="field"><span>Name</span><input id="mname" placeholder="Tweet" /></label>
      <label class="field"><span>Instruction (how to format)</span>
        <textarea id="mprompt" rows="3" placeholder="Rewrite as a punchy tweet under 280 chars; keep the meaning."></textarea></label>
      <button class="primary" id="addmode">Add mode</button>
    </div>`;
  document.getElementById('save')?.addEventListener('click', async () => {
    const v = (document.getElementById('defmode') as HTMLSelectElement).value;
    await setSettings({ defaultModeId: v || null });
  });
  document.getElementById('addmode')?.addEventListener('click', async () => {
    const name = (document.getElementById('mname') as HTMLInputElement).value.trim();
    const prompt_template = (document.getElementById('mprompt') as HTMLTextAreaElement).value.trim();
    if (!name || !prompt_template) return;
    await w.invoke('data:upsertMode', { name, prompt_template });
    void select('modes');
  });
  for (const b of main.querySelectorAll('.delmode')) {
    b.addEventListener('click', async () => {
      await w.invoke('data:deleteMode', (b as HTMLElement).dataset.id);
      void select('modes');
    });
  }
}

async function renderSnippets(): Promise<void> {
  const snippets = await w.invoke<Snippet[]>('data:listSnippets');
  main.innerHTML = `
    <div class="page-header"><h1>Snippets</h1><p>Say the trigger; it expands to the text. e.g. "my linkedin" → your URL.</p></div>
    <div class="card">
      <table id="tbl"><tr><th>Trigger</th><th>Expands to</th><th>Match</th><th></th></tr>
        ${snippets
          .map(
            (s) => `<tr><td>${esc(s.trigger)}</td><td>${esc(s.expansion)}</td><td><span class="pill-badge">${esc(s.match_mode)}</span></td>
              <td><button class="danger del" data-id="${esc(s.id)}">Delete</button></td></tr>`,
          )
          .join('')}
      </table>
      <div class="add-row" style="margin-top:14px;display:grid;gap:10px">
        <label class="field"><span>Trigger</span><input id="trg" placeholder="my linkedin" /></label>
        <label class="field"><span>Expansion</span><input id="exp" placeholder="https://linkedin.com/in/you" /></label>
        <label class="field"><span>Match</span><select id="mm"><option value="phrase">phrase</option><option value="exact">exact</option><option value="regex">regex</option></select></label>
        <button class="primary" id="add">Add snippet</button>
      </div>
    </div>`;
  document.getElementById('add')?.addEventListener('click', async () => {
    const trigger = (document.getElementById('trg') as HTMLInputElement).value.trim();
    const expansion = (document.getElementById('exp') as HTMLInputElement).value;
    const match_mode = (document.getElementById('mm') as HTMLSelectElement).value as Snippet['match_mode'];
    if (!trigger || !expansion) return;
    await w.invoke('data:upsertSnippet', { trigger, expansion, match_mode });
    void select('snippets');
  });
  for (const b of main.querySelectorAll('.del')) {
    b.addEventListener('click', async () => {
      await w.invoke('data:deleteSnippet', (b as HTMLElement).dataset.id);
      void select('snippets');
    });
  }
}

async function renderDictionary(): Promise<void> {
  const terms = await w.invoke<DictionaryTerm[]>('data:listDictionary');
  main.innerHTML = `
    <div class="page-header"><h1>Dictionary</h1><p>Names and jargon the transcriber should spell correctly.</p></div>
    <div class="card">
      <table>${terms
        .map((t) => `<tr><td>${esc(t.term)}</td><td><button class="danger del" data-id="${esc(t.id)}">Delete</button></td></tr>`)
        .join('')}</table>
      <div class="row" style="margin-top:10px">
        <input id="term" placeholder="Wisopen" /><button class="primary" id="add">Add</button>
      </div>
    </div>`;
  document.getElementById('add')?.addEventListener('click', async () => {
    const term = (document.getElementById('term') as HTMLInputElement).value.trim();
    if (!term) return;
    await w.invoke('data:upsertTerm', { term });
    void select('dictionary');
  });
  for (const b of main.querySelectorAll('.del')) {
    b.addEventListener('click', async () => {
      await w.invoke('data:deleteTerm', (b as HTMLElement).dataset.id);
      void select('dictionary');
    });
  }
}

async function renderHistory(): Promise<void> {
  const items = await w.invoke<HistoryItem[]>('data:listHistory', { limit: 100 });
  main.innerHTML = `
    <div class="page-header"><h1>History</h1><p>Your recent dictations stored locally on this Mac.</p></div>
    <div class="card"><table><tr><th>When</th><th>Text</th></tr>
      ${items
        .map((i) => `<tr><td class="muted">${new Date(i.created_at).toLocaleString()}</td><td>${esc(i.final)}</td></tr>`)
        .join('') || '<tr><td colspan="2" class="muted">No dictations yet.</td></tr>'}
    </table></div>`;
}

async function renderGeneral(): Promise<void> {
  const s = await getSettings();
  main.innerHTML = `
    <div class="page-header"><h1>General</h1><p>Language, text insertion, and app updates.</p></div>
    <div class="card stack">
      <label class="field"><span>Interface & dictation language</span>
        <select id="lang">
          <option value="en" ${s.uiLanguage === 'en' ? 'selected' : ''}>English</option>
          <option value="it" ${s.uiLanguage === 'it' ? 'selected' : ''}>Italiano</option>
        </select></label>
      <label class="field"><span>Text insertion</span>
        <select id="inj">
          <option value="paste" ${s.injectionMode === 'paste' ? 'selected' : ''}>Clipboard paste (fast)</option>
          <option value="keystroke" ${s.injectionMode === 'keystroke' ? 'selected' : ''}>Simulate keystrokes</option>
        </select></label>
      <button class="primary" id="save">Save</button>
    </div>
    <h2 style="margin-top:18px">Updates</h2>
    <div class="card stack">
      <div id="updstatus" class="muted">${esc(latestUpdate)}</div>
      <div class="row">
        <button id="updcheck">Check for updates</button>
        <button class="primary" id="updinstall" style="display:none">Restart &amp; update</button>
      </div>
      <p class="muted">Updates download automatically and install on quit.</p>
    </div>`;
  document.getElementById('save')?.addEventListener('click', async () => {
    await setSettings({
      uiLanguage: (document.getElementById('lang') as HTMLSelectElement).value as AppSettings['uiLanguage'],
      injectionMode: (document.getElementById('inj') as HTMLSelectElement).value as AppSettings['injectionMode'],
    });
  });
  document.getElementById('updcheck')?.addEventListener('click', () => w.invoke('update:check'));
  document.getElementById('updinstall')?.addEventListener('click', () => w.invoke('update:install'));
}

async function renderPrivacy(): Promise<void> {
  const [s, jwt] = await Promise.all([getSettings(), w.invoke<{ supabaseUrl: string }>('auth:getJwt')]);
  main.innerHTML = `
    <div class="page-header"><h1>Privacy</h1><p>Control what Wisopen stores on your device.</p></div>
    <div class="card stack">
      <div class="toggle-row">
        <label>Save dictation history locally
          <span class="hint">Keeps recent dictations on this Mac only. Never uploaded unless you sign in and sync.</span>
        </label>
        <input type="checkbox" id="hist" ${s.saveHistory ? 'checked' : ''} style="width:auto" />
      </div>
      <button class="primary" id="save">Save</button>
      <p class="muted" style="margin-top:8px">Backend endpoint: ${esc(jwt.supabaseUrl)}</p>
    </div>`;
  document.getElementById('save')?.addEventListener('click', async () => {
    await setSettings({ saveHistory: (document.getElementById('hist') as HTMLInputElement).checked });
  });
}

buildNav();
window.wisopen.on('auth:changed', () => {
  if (current === 'account' || current === 'home') void select(current);
});
window.wisopen.on('settings:navigate', (payload) => {
  const view = (payload as { view: string }).view;
  if ((VIEWS as readonly string[]).includes(view)) void select(view as View);
});
void select('home');
