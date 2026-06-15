import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { join } from 'node:path';

const appDir = process.cwd(); // apps/desktop (workspace script cwd)
const mainEntry = join(appDir, 'out', 'main', 'index.js');

async function windowByUrl(app: ElectronApplication, match: string): Promise<Page> {
  for (let i = 0; i < 60; i++) {
    for (const p of app.windows()) {
      if (p.url().includes(match)) return p;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`window not found: ${match}`);
}

const liveStack = Boolean(process.env.WISOPEN_SUPABASE_URL && process.env.WISOPEN_SUPABASE_ANON_KEY);

test.describe('Wisopen desktop smoke', () => {
  test.skip(!liveStack, 'requires a running local Supabase stack (WISOPEN_SUPABASE_URL/ANON)');

  let app: ElectronApplication;

  test.afterEach(async () => {
    await app?.close();
  });

  test('boots, signs up against the live stack, runs format+snippet loop', async () => {
    app = await electron.launch({
      args: [mainEntry],
      cwd: appDir,
      env: {
        ...process.env,
        WISOPEN_TEST_HOOKS: '1',
        NODE_ENV: 'production',
      },
    });

    // 1. app boots and opens the onboarding window (engine window opens first + hidden)
    await app.firstWindow();
    const win = await windowByUrl(app, 'onboarding');
    await expect(win.locator('h1')).toContainText('Welcome to Wisopen', { timeout: 20_000 });

    // 2. sign up a fresh user via the onboarding form (autoconfirm is on locally)
    const email = `e2e_${Date.now()}@wisopen.test`;
    await win.fill('#email', email);
    await win.fill('#password', 'password123!');
    await win.click('#signup');
    await expect(win.locator('#authMsg')).toContainText('Signed in as', { timeout: 20_000 });

    // 3. app-level format + snippet expansion against the live backend (mock LLM)
    const result = await app.evaluate(async (_electronApi, args) => {
      const hook = (globalThis as Record<string, unknown>).__wisopenTest as {
        formatLoop: (a: unknown) => Promise<string>;
      };
      return hook.formatLoop(args);
    }, {
      transcript: 'um my linkedin please you know',
      snippets: [
        {
          id: '1',
          user_id: 'u',
          trigger: 'my linkedin',
          expansion: 'https://linkedin.com/in/luca',
          enabled: true,
          match_mode: 'phrase',
          created_at: '',
        },
      ],
    });

    // mock LLM strips filler + capitalizes; snippet expands "my linkedin" -> URL
    expect(result).toContain('https://linkedin.com/in/luca');
    expect(result.toLowerCase()).not.toContain(' um ');
  });
});
