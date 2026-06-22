// `format` — LLM polish proxy (HTTP POST). Self-verifies the caller JWT, loads the
// mode, runs the LLM polish pass (or passes through for Raw), logs usage. Secret keys
// live only here. (spec §6.2, amendments 3 & 5)
import { getLlmProvider } from '../_shared/providers/index.ts';
import { buildPolishPrompt, RAW_PASSTHROUGH } from '../_shared/prompt.ts';
import { needsLlmPolish, quickPolish } from '../_shared/polish.ts';
import { verifyJwt, userClient, adminClient } from '../_shared/auth.ts';
import { logUsage } from '../_shared/usage.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(obj: unknown, status: number): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  try {
    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    const user = await verifyJwt(token);
    if (!user) return json({ error: 'unauthorized' }, 401);

    let body: Record<string, unknown>;
    try {
      body = await req.json();
      if (typeof body !== 'object' || body === null) throw new Error('not an object');
    } catch {
      return json({ error: 'invalid JSON body' }, 400);
    }
    const transcript: string = (body.transcript ?? '').toString();
    const MAX_TRANSCRIPT = 50_000;
    if (transcript.length === 0 || transcript.length > MAX_TRANSCRIPT) {
      return json({ error: 'transcript must be a non-empty string under 50k chars' }, 400);
    }
    const modeId: string | null = (body.mode_id as string | null) ?? null;
    const lang: string | null = (body.lang as string | null) ?? null;
    const dictionary: string[] = Array.isArray(body.dictionary) ? (body.dictionary as string[]) : [];

    const uc = userClient(token);
    type ModeRow = { name: string; prompt_template: string };
    let mode: ModeRow | null = null;
    if (modeId) {
      const { data } = await uc.from('modes').select('name,prompt_template').eq('id', modeId).maybeSingle();
      mode = (data as ModeRow | null) ?? null;
    }
    if (!mode) {
      const { data } = await uc
        .from('modes')
        .select('name,prompt_template')
        .eq('is_default', true)
        .eq('is_system', true)
        .maybeSingle();
      mode = (data as ModeRow | null) ?? null;
    }

    const template = mode?.prompt_template ?? RAW_PASSTHROUGH;
    let finalText = transcript;
    let tokensIn = 0;
    let tokensOut = 0;
    let providerId = 'raw';
    let model: string | null = null;

    if (template !== RAW_PASSTHROUGH) {
      if (needsLlmPolish(transcript)) {
        const llm = await getLlmProvider();
        const { system, user: userTurn } = buildPolishPrompt(template, transcript, dictionary, lang);
        const r = await llm.complete(system, userTurn);
        finalText = r.text || transcript;
        tokensIn = r.tokensIn;
        tokensOut = r.tokensOut;
        providerId = llm.id;
        model = r.model;
      } else {
        finalText = quickPolish(transcript);
        providerId = 'heuristic';
      }
    }

    // Raw passthrough makes no LLM call — nothing to meter.
    if (providerId !== 'raw') {
      const admin = adminClient();
      await logUsage(
        (table, row) => admin.from(table).insert(row).then(({ error }) => ({ error })),
        {
          user_id: user.userId,
          kind: 'llm',
          provider: providerId,
          model,
          tokens_in: tokensIn,
          tokens_out: tokensOut,
        },
      );
    }

    return json(
      { final_text: finalText, tokens_in: tokensIn, tokens_out: tokensOut, provider: providerId, model },
      200,
    );
  } catch (e) {
    console.error('format error', e); // detail stays server-side
    return json({ error: 'internal error' }, 500);
  }
});
