/**
 * AI pre-screen for community text — Llama Guard 3 8B on Workers AI.
 *
 * ADVISORY ONLY. Nothing is ever published or rejected by this call: every
 * post waits for a human approval regardless (MODERATION.md). The verdict is
 * stored on the row so the admin queue can sort the likely-nasty items to
 * the top, which is the whole benefit — triage, not judgement.
 *
 * Degrades like every optional dependency in this Worker: no AI binding
 * (local dev) → 'skipped'; the model erroring or timing out → 'error'. Both
 * land in the queue exactly like everything else.
 *
 * Cost note (infrastructure): Workers AI's free allowance is 10,000
 * neurons/day; a comment-sized check costs ~9, so ~1,100 checks/day are
 * free and the account is never billed past the allowance on the free tier —
 * it cuts off instead, which lands here as 'error'. Fine either way.
 */

interface GuardAi {
  run(
    model: string,
    input: { messages: { role: string; content: string }[]; max_tokens?: number },
  ): Promise<unknown>;
}

const MODEL = '@cf/meta/llama-guard-3-8b';

/** 'safe' | 'unsafe:S1,S10' | 'skipped' | 'error' — stored in posts.ai_verdict. */
export async function guardVerdict(ai: GuardAi | undefined, text: string): Promise<string> {
  if (!ai) return 'skipped';
  try {
    const raw = await Promise.race([
      ai.run(MODEL, { messages: [{ role: 'user', content: text }], max_tokens: 32 }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000)),
    ]);
    // Llama Guard answers as text: "safe" or "unsafe\nS1,S10". The response
    // envelope differs by model generation (the /api/ask lesson), so accept
    // both the OpenAI chat shape and the legacy { response } one.
    const r = raw as { response?: unknown; choices?: { message?: { content?: unknown } }[] };
    const textOut =
      typeof r?.response === 'string'
        ? r.response
        : typeof r?.choices?.[0]?.message?.content === 'string'
          ? r.choices[0].message.content
          : '';
    const flat = textOut.trim().toLowerCase();
    if (flat.startsWith('safe')) return 'safe';
    if (flat.startsWith('unsafe')) {
      const cats = textOut.match(/S\d+/gi)?.join(',') ?? '';
      return cats ? `unsafe:${cats}` : 'unsafe';
    }
    return 'error';
  } catch {
    return 'error';
  }
}
