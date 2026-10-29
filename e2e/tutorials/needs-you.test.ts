import { annotations, geminiNeedsYou } from './needs-you.mjs';

describe('what only a person can fix, for the ops dashboard', () => {
  it("knows Gemini's refusals that need a person from those that pass", () => {
    // What Gemini answered when the prepaid credit ran out, on 2026-10-29.
    const depleted = '{"error":{"code":402,"message":"Your prepayment credits are depleted. Please go to AI Studio at https://ai.studio/projects to manage your project and billing.","status":"RESOURCE_EXHAUSTED"}}';
    expect(geminiNeedsYou(402, depleted)?.title).toBe('Gemini credit');
    expect(geminiNeedsYou(429, 'RESOURCE_EXHAUSTED: Your prepayment credits are depleted.')?.title).toBe('Gemini credit');
    expect(geminiNeedsYou(400, '{"error":{"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT","details":[{"reason":"API_KEY_INVALID"}]}}')?.title).toBe('Gemini key');
    // A request without a key, as when the workflow has no GEMINI_API_KEY.
    expect(geminiNeedsYou(403, "Method doesn't allow unregistered callers (callers without established identity).")?.title).toBe('Gemini key');
    expect(geminiNeedsYou(429, 'RESOURCE_EXHAUSTED: Quota exceeded for requests per minute')).toBeNull();
    expect(geminiNeedsYou(400, '{"error":{"message":"Precondition check failed."}}')).toBeNull();
  });

  it('says each once, as an annotation whose title and link the dashboard reads', () => {
    const credit = JSON.stringify(geminiNeedsYou(402, ''));
    const out = annotations([credit, credit]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/^::error title=Needs you%3A Gemini credit::.+ https:\/\/aistudio\.google\.com\/projects$/);
    // A message cannot end the command early: % and line breaks are escaped as the runner reads them.
    expect(annotations([JSON.stringify({ title: 'a, b', text: '100%\nsure', link: 'https://x.test' })])[0]).toBe('::error title=Needs you%3A a%2C b::100%25%0Asure https://x.test');
  });
});
