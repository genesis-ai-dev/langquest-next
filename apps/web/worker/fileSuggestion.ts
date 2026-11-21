import type { SupabaseClient } from '@supabase/supabase-js';
import { UI_LANGUAGES } from '@langquest-next/core';
import { linearIssues } from '../../../server/linear';
import { issueOf, type Suggestion } from '../../../server/tutorialFeedback';

/**
 * A tutorial video's suggestion filed in Linear now: an accepted code change, or one an admin asked to fix in
 * the app (Fix it, or the video fix run's handover). Its issue is then known to the database, which hands the
 * instruction to the agent team (ops_suggestion_filed). Null without a Linear key, or when nothing waits.
 */
export async function fileSuggestion(db: SupabaseClient, linearKey: string | undefined, id: string): Promise<string | null> {
  if (!linearKey) return null;
  const { data, error } = await db.rpc('ops_suggestions_to_file', { p_limit: 1, p_id: id });
  if (error) throw new Error(`ops_suggestions_to_file: ${error.message}`);
  const suggestion = (data as Suggestion[])[0];
  if (!suggestion) return null;
  const { title, description } = issueOf(suggestion, (code) => UI_LANGUAGES.find((l) => l.code === code)?.english ?? code);
  const issue = await linearIssues((input, init) => fetch(input, init), linearKey).create(title, description);
  const filed = await db.rpc('ops_suggestion_filed', { p_id: id, p_issue: issue.identifier, p_url: issue.url });
  if (filed.error) throw new Error(`ops_suggestion_filed: ${filed.error.message}`);
  return issue.identifier;
}
