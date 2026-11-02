import { geminiDollars, summary } from './gemini-usage.mjs';

/** What a night's job counted, and what Gemini bills for it (gemini-usage.mjs). */

describe("the summary of what Gemini and Claude counted", () => {
  const night = [
    { model: 'gemini-3.8-flash-tts', requests: 100, in: 600_000, out: 1_000_000, thinking: 0 },
    { model: 'gemini-3.8-flash-tts', requests: 20, in: 400_000, out: 1_000_000, thinking: 0 },
    { model: 'gemini-pro-latest', requests: 3, in: 1_000_000, out: 500_000, thinking: 500_000 },
    { model: 'claude-sonnet-5-5', plan: true, requests: 1, in: 60_000, out: 1_800, thinking: 1_500, usd: 0.1 },
    { model: 'claude-sonnet-5-5', plan: true, requests: 1, in: 40_000, out: 1_200, thinking: 1_000, usd: 0.08 }
  ];

  it("prices Gemini's batch jobs at the list price, and Claude's looks as not billed", () => {
    const lines = summary(night, new Date('2026-11-01'));
    expect(lines).toContain('- gemini-3.8-flash-tts: 120 requests in 2 batch jobs; 1,000,000 tokens in, 2,000,000 out (about 1333.3 minutes of speech), 0 thinking: about US$9.25');
    expect(lines).toContain('- gemini-pro-latest: 3 requests in 1 batch jobs; 1,000,000 tokens in, 500,000 out, 500,000 thinking: about US$7.00');
    expect(lines).toContain("- claude-sonnet-5-5 (the frame check, on the Claude plan, not billed): 2 films; 100,000 tokens in, 3,000 out (2,500 of them thinking); US$0.18 at the API's list price");
    expect(lines.at(-1)).toBe('Gemini bills about US$16 for this job, at its batch list price.');
  });

  it('doubles the 3.8 models from 2027, and says when a model has no price', () => {
    expect(geminiDollars('gemini-3.8-flash-tts', { in: 1_000_000, out: 2_000_000, thinking: 0 }, new Date('2027-01-02'))).toBe(18.5);
    expect(geminiDollars('gemini-pro-latest', { in: 1_000_000, out: 0, thinking: 0 }, new Date('2027-01-02'))).toBe(1);
    expect(summary([{ model: 'gemini-9-ultra', requests: 1, in: 1, out: 1, thinking: 0 }]).at(-1)).toMatch(/not counting the models without a price/);
    expect(summary([])).toContain('Nothing was sent to Gemini or Claude.');
  });
});
