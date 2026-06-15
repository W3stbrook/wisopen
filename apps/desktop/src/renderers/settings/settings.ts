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

// live auto-update status (updates the Advanced tab if it's open)
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

const TABS = ['Account', 'Hotkeys', 'Modes', 'Shortcuts', 'Dictionary', 'History', 'Language', 'Advanced'] as const;
type Tab = (typeof TABS)[number];

const renderers: Record<Tab, () => Promise<void>> = {
  Account: renderAccount,
  Hotkeys: renderHotkeys,
  Modes: renderModes,
  Shortcuts: renderShortcuts,
  Dictionary: renderDictionary,
  History: renderHistory,
  Language: renderLanguage,
  Advanced: renderAdvanced,
};

let current: Tab = 'Account';

function buildNav(): void {
  for (const tab of TABS) {
    const b = document.createElement('button');
    b.textContent = tab;
    b.dataset.tab = tab;
    b.addEventListener('click', () => select(tab));
    nav.appendChild(b);
  }
}

async function select(tab: Tab): Promise<void> {
  current = tab;
  for (const b of nav.querySelectorAll('button')) {
    (b as HTMLElement).classList.toggle('active', (b as HTMLElement).dataset.tab === tab);
  }
  main.innerHTML = '<p class="muted">Loading…</p>';
  await renderers[tab]();
}

async function getSettings(): Promise<AppSettings> {
  return w.invoke<AppSettings>('settings:get');
}
async function setSettings(patch: Partial<AppSettings>): Promise<void> {
  await w.invoke('settings:set', patch);
  toast('Saved');
}

async function renderAccount(): Promise<void> {
  const s = await w.invoke<AuthStatus>('auth:status');
  main.innerHTML = `
    <h1>Account</h1>
    <div class="card stack">
      <div>${s.signedIn ? `Signed in as <b>${esc(s.email ?? '')}</b>` : 'Not signed in'}</div>
      <div><button id="signout" class="danger">Sign out</button></div>
    </div>`;
  document.getElementById('signout')?.addEventListener('click', async () => {
    await w.invoke('auth:signOut');
    void select('Account');
  });
}

async function renderHotkeys(): Promise<void> {
  const s = await getSettings();
  main.innerHTML = `
    <h1>Hotkeys</h1>
    <div class="card">
      <label class="field"><span>Push-to-talk key (uiohook name, e.g. F13, or Ctrl+Space). Fn is not supported.</span>
        <input id="ptt" value="${esc(s.pttKey)}" /></label>
      <label class="field"><span>Mode</span>
        <select id="mode">
          <option value="hold" ${s.pttMode === 'hold' ? 'selected' : ''}>Hold to talk</option>
          <option value="toggle" ${s.pttMode === 'toggle' ? 'selected' : ''}>Toggle (hands-free)</option>
        </select></label>
      <button class="primary" id="save">Save</button>
      <p class="muted" style="margin-top:10px">Changing the hotkey takes effect on next app launch.</p>
    </div>`;
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
    <h1>Modes</h1>
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
    void select('Modes');
  });
  for (const b of main.querySelectorAll('.delmode')) {
    b.addEventListener('click', async () => {
      await w.invoke('data:deleteMode', (b as HTMLElement).dataset.id);
      void select('Modes');
    });
  }
}

async function renderShortcuts(): Promise<void> {
  const snippets = await w.invoke<Snippet[]>('data:listSnippets');
  main.innerHTML = `
    <h1>Shortcuts</h1>
    <p class="muted">Say the trigger; it expands to the text. e.g. "my linkedin" → your URL.</p>
    <div class="card">
      <table id="tbl"><tr><th>Trigger</th><th>Expands to</th><th>Match</th><th></th></tr>
        ${snippets
          .map(
            (s) => `<tr><td>${esc(s.trigger)}</td><td>${esc(s.expansion)}</td><td><span class="pill-badge">${esc(s.match_mode)}</span></td>
              <td><button class="danger del" data-id="${esc(s.id)}">Delete</button></td></tr>`,
          )
          .join('')}
      </table>
      <div class="add-row">
        <label class="field"><span>Trigger</span><input id="trg" placeholder="my linkedin" /></label>
        <label class="field"><span>Expansion</span><input id="exp" placeholder="https://linkedin.com/in/you" /></label>
        <label class="field"><span>Match</span><select id="mm"><option value="phrase">phrase</option><option value="exact">exact</option><option value="regex">regex</option></select></label>
        <button class="primary" id="add">Add</button>
      </div>
    </div>`;
  document.getElementById('add')?.addEventListener('click', async () => {
    const trigger = (document.getElementById('trg') as HTMLInputElement).value.trim();
    const expansion = (document.getElementById('exp') as HTMLInputElement).value;
    const match_mode = (document.getElementById('mm') as HTMLSelectElement).value as Snippet['match_mode'];
    if (!trigger || !expansion) return;
    await w.invoke('data:upsertSnippet', { trigger, expansion, match_mode });
    void select('Shortcuts');
  });
  for (const b of main.querySelectorAll('.del')) {
    b.addEventListener('click', async () => {
      await w.invoke('data:deleteSnippet', (b as HTMLElement).dataset.id);
      void select('Shortcuts');
    });
  }
}

async function renderDictionary(): Promise<void> {
  const terms = await w.invoke<DictionaryTerm[]>('data:listDictionary');
  main.innerHTML = `
    <h1>Dictionary</h1>
    <p class="muted">Names/jargon the transcriber should spell correctly.</p>
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
    void select('Dictionary');
  });
  for (const b of main.querySelectorAll('.del')) {
    b.addEventListener('click', async () => {
      await w.invoke('data:deleteTerm', (b as HTMLElement).dataset.id);
      void select('Dictionary');
    });
  }
}

async function renderHistory(): Promise<void> {
  const items = await w.invoke<HistoryItem[]>('data:listHistory', { limit: 100 });
  main.innerHTML = `
    <h1>History</h1>
    <div class="card"><table><tr><th>When</th><th>Text</th></tr>
      ${items
        .map((i) => `<tr><td class="muted">${new Date(i.created_at).toLocaleString()}</td><td>${esc(i.final)}</td></tr>`)
        .join('') || '<tr><td colspan="2" class="muted">No dictations yet.</td></tr>'}
    </table></div>`;
}

async function renderLanguage(): Promise<void> {
  const s = await getSettings();
  main.innerHTML = `
    <h1>Language</h1>
    <div class="card">
      <label class="field"><span>Interface & dictation language</span>
        <select id="lang">
          <option value="en" ${s.uiLanguage === 'en' ? 'selected' : ''}>English</option>
          <option value="it" ${s.uiLanguage === 'it' ? 'selected' : ''}>Italiano</option>
        </select></label>
      <button class="primary" id="save">Save</button>
    </div>`;
  document.getElementById('save')?.addEventListener('click', async () => {
    await setSettings({ uiLanguage: (document.getElementById('lang') as HTMLSelectElement).value as AppSettings['uiLanguage'] });
  });
}

async function renderAdvanced(): Promise<void> {
  const [s, jwt] = await Promise.all([
    getSettings(),
    w.invoke<{ supabaseUrl: string }>('auth:getJwt'),
  ]);
  main.innerHTML = `
    <h1>Advanced</h1>
    <div class="card stack">
      <label class="field"><span>Text insertion</span>
        <select id="inj">
          <option value="paste" ${s.injectionMode === 'paste' ? 'selected' : ''}>Clipboard paste (fast)</option>
          <option value="keystroke" ${s.injectionMode === 'keystroke' ? 'selected' : ''}>Simulate keystrokes</option>
        </select></label>
      <label class="row"><input type="checkbox" id="hist" ${s.saveHistory ? 'checked' : ''} style="width:auto" /> &nbsp;Save dictation history locally</label>
      <button class="primary" id="save">Save</button>
      <p class="muted">Backend: ${esc(jwt.supabaseUrl)}</p>
    </div>
    <h2 style="margin-top:18px">Updates</h2>
    <div class="card stack">
      <div id="updstatus" class="muted">${esc(latestUpdate)}</div>
      <div class="row">
        <button id="updcheck">Check for updates</button>
        <button class="primary" id="updinstall" style="display:none">Restart &amp; update</button>
      </div>
      <p class="muted">Updates download automatically and install on quit; "Restart &amp; update" applies one now.</p>
    </div>`;
  document.getElementById('save')?.addEventListener('click', async () => {
    await setSettings({
      injectionMode: (document.getElementById('inj') as HTMLSelectElement).value as AppSettings['injectionMode'],
      saveHistory: (document.getElementById('hist') as HTMLInputElement).checked,
    });
  });
  document.getElementById('updcheck')?.addEventListener('click', () => w.invoke('update:check'));
  document.getElementById('updinstall')?.addEventListener('click', () => w.invoke('update:install'));
}

buildNav();
void select('Account');
