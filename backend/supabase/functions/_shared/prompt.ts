// Builds the LLM polish prompt (spec §7.1) from a mode template + dictionary + language.

export const RAW_PASSTHROUGH = 'RAW_PASSTHROUGH';

export interface PolishPrompt {
  system: string;
  user: string;
}

export function buildPolishPrompt(
  promptTemplate: string,
  transcript: string,
  dictionary: string[] = [],
  lang?: string | null,
): PolishPrompt {
  let system = promptTemplate;
  if (dictionary.length > 0) {
    system += `\n\nCustom vocabulary — if you hear any of these, spell them exactly: ${dictionary.join(', ')}.`;
  }
  system += lang
    ? `\n\nThe text is in language code "${lang}". Keep the same language; never translate.`
    : `\n\nKeep the same language as the input; never translate.`;
  system += `\n\nPreserve any shortcut trigger phrases verbatim (do not expand or alter them).`;
  const user = `Transcript: ${transcript}`;
  return { system, user };
}
