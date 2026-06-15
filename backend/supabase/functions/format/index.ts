// `format` — LLM polish proxy (HTTP POST). Self-verifies the caller JWT, loads the
// mode, runs the LLM polish pass (or passes through for Raw), logs usage. Secret keys
// live only here. (spec §6.2, amendments 3 & 5)
import { getLlmProvider } from '../_shared/providers/index.ts';
import { buildPolishPrompt, RAW_PASSTHROUGH } from '../_shared/prompt.ts';
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

    const body = await req.json();
    const transcript: string = (body.transcript ?? '').toString();
    const modeId: string | null = body.mode_id ?? null;
    const lang: string | null = body.lang ?? null;
    const dictionary: string[] = Array.isArray(body.dictionary) ? body.dictionary : [];

    const uc = userClient(token);
    let mode: { name: string; prompt_template: string } | null = null;
    if (modeId) {
      const { data } = await uc.from('modes').select('name,prompt_template').eq('id', modeId).maybeSingle();
      mode = data as typeof mode;
    }
    if (!mode) {
      const { data } = await uc
        .from('modes')
        .select('name,prompt_template')
        .eq('is_default', true)
        .eq('is_system', true)
        .maybeSingle();
      mode = data as typeof mode;
    }

    const template = mode?.prompt_template ?? RAW_PASSTHROUGH;
    let finalText = transcript;
    let tokensIn = 0;
    let tokensOut = 0;
    let providerId = 'raw';
    let model: string | null = null;

    if (template !== RAW_PASSTHROUGH) {
      const llm = await getLlmProvider();
      const { system, user: userTurn } = buildPolishPrompt(template, transcript, dictionary, lang);
      const r = await llm.complete(system, userTurn);
      finalText = r.text || transcript;
      tokensIn = r.tokensIn;
      tokensOut = r.tokensOut;
      providerId = llm.id;
      model = r.model;
    }

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

    return json(
      { final_text: finalText, tokens_in: tokensIn, tokens_out: tokensOut, provider: providerId, model },
      200,
    );
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
