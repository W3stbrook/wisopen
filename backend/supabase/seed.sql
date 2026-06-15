-- System formatting modes (spec §7.2). Readable by all users; not editable.
-- Stable UUIDs so the default-mode reference survives `supabase db reset`.
-- prompt_template is the mode-specific SYSTEM instruction; the format function
-- appends the dictionary + language directives and the transcript as the user turn.
-- The "Raw" mode is special-cased in code to skip the LLM entirely.

insert into public.modes (id, user_id, name, description, prompt_template, is_system, is_default) values
  (
    '00000000-0000-0000-0000-000000000001', null, 'Raw',
    'Insert the transcript as-is (no AI rewrite). Lowest latency.',
    'RAW_PASSTHROUGH',
    true, false
  ),
  (
    '00000000-0000-0000-0000-000000000002', null, 'Clean',
    'Fix grammar, punctuation and filler words while keeping your wording.',
    'You reformat dictated speech into clean written text. Fix grammar, punctuation, capitalization and paragraph breaks. Remove filler words (um, uh, you know), false starts and repetitions. Apply spoken commands literally (e.g. "new line", "new paragraph", "bullet point", "comma"). Preserve the speaker''s meaning and wording — do NOT add, answer, or summarize. Output only the reformatted text.',
    true, true
  ),
  (
    '00000000-0000-0000-0000-000000000003', null, 'Email',
    'Format as a clear, professional email.',
    'You turn dictated speech into a clear, professional email. Fix grammar and punctuation, structure into greeting, body paragraphs and a sign-off when appropriate, and keep a polite professional tone. Remove filler and false starts. Do NOT invent recipient names or facts. Output only the email text.',
    true, false
  ),
  (
    '00000000-0000-0000-0000-000000000004', null, 'Slack',
    'Format as a concise, casual chat message.',
    'You turn dictated speech into a concise, casual chat/Slack message. Keep it short and friendly, fix grammar and punctuation, remove filler. Preserve meaning; do not add content. Output only the message text.',
    true, false
  ),
  (
    '00000000-0000-0000-0000-000000000005', null, 'Notes',
    'Format as clean bulleted notes.',
    'You turn dictated speech into clean, well-structured bulleted notes. Group related points, use concise bullet points, fix grammar and punctuation, remove filler. Preserve all information; do not add content. Output only the notes (markdown bullets).',
    true, false
  );
