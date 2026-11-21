import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { annotation, errorsOf, readingOf, TITLE } from './claude-plan.mjs';
import { parsePlan } from '../apps/admin/src/sources/claudePlan';

const NOW = new Date('2026-11-21T02:00:00Z');
const event = (info: unknown) => JSON.stringify({ type: 'rate_limit_event', rate_limit_info: info, uuid: 'u', session_id: 's' });

describe('the Claude plan reading (claude-plan.mjs)', () => {
  it('keeps the week and the five hours from the newest event', () => {
    const lines = [
      JSON.stringify({ type: 'system', subtype: 'init' }),
      event({ status: 'allowed', rateLimitType: 'seven_day', unifiedWindows: { seven_day: { utilization: 0.3, resetsAt: 1795651200 } } }),
      'not json',
      event({ status: 'allowed', rateLimitType: 'seven_day', unifiedWindows: { seven_day: { utilization: 0.35, resetsAt: 1795651200 }, five_hour: { utilization: 0.1, resetsAt: 1795600000 } } }),
      JSON.stringify({ type: 'result', subtype: 'success' })
    ];
    expect(readingOf(lines, NOW)).toEqual({
      week: { used: 0.35, resetsAt: new Date(1795651200 * 1000).toISOString() },
      fiveHour: { used: 0.1, resetsAt: new Date(1795600000 * 1000).toISOString() },
      status: 'allowed', readAt: NOW.toISOString()
    });
  });

  it('reads the event wherever it sits, and the older shape with only the window that binds', () => {
    const wrapped = JSON.stringify({ rate_limit_event: { internal_anthropic_catchall: { rate_limit_info: { rateLimitType: 'seven_day', utilization: 0.5, resetsAt: 1795651200, status: 'allowed' } } } });
    expect(readingOf([wrapped], NOW)?.week?.used).toBe(0.5);
  });

  it('gives no reading without the event or its numbers, never a zero', () => {
    expect(readingOf([JSON.stringify({ type: 'result' })], NOW)).toBeNull();
    expect(readingOf([event({ status: 'allowed', unifiedWindows: {} })], NOW)).toBeNull();
  });

  it('leaves one line of JSON the dashboard parses back, and says why when it has none', () => {
    const reading = readingOf([event({ unifiedWindows: { seven_day: { utilization: 0.35, resetsAt: 1795651200 } } })], NOW)!;
    const line = annotation(reading);
    const [, title, message] = /^::notice title=([^:]+)::(.*)$/.exec(line)!;
    expect(title).toBe(TITLE);
    expect(parsePlan(title!, message!)).toEqual({ week: reading.week, fiveHour: null, readAt: NOW.toISOString(), said: null });
    const none = annotation(null, 'Claude Code stopped (exit 1):\n100% refused');
    expect(none).toBe('::warning title=Claude plan::No reading: Claude Code stopped (exit 1): 100 refused');
    expect(parsePlan(TITLE, none.split('::')[2]!)).toMatchObject({ week: null, said: 'Claude Code stopped (exit 1): 100 refused' });
  });

  it('says Claude Code\'s own error when there is no reading', () => {
    expect(errorsOf([JSON.stringify({ type: 'result', is_error: true, errors: ['Invalid token.'] }), 'x'])).toBe('Invalid token.');
    expect(errorsOf([JSON.stringify({ type: 'result', is_error: false })])).toBe('');
  });

  it('passes the token to Claude Code only in its environment', () => {
    const workflow = readFileSync(new URL('../.github/workflows/claude-plan.yml', import.meta.url), 'utf8');
    expect(workflow).toContain('CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.AGENT_TEAM_CLAUDE_TOKEN }}');
    expect(workflow.match(/secrets\.\w+/g)).toEqual(['secrets.AGENT_TEAM_CLAUDE_TOKEN']);
    expect(readFileSync(new URL('./claude-plan.mjs', import.meta.url), 'utf8')).not.toMatch(/args[^\n]*OAUTH/);
  });
});
