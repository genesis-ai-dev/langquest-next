import { supabase } from './supabase';
import { api, tokenOf } from './worker';

/**
 * Review links (decisions.md 72, 158): the Worker makes a `/r/<code>` link
 * to one version of a passage, for one check, that anyone holding it opens
 * without an account and answers under any name they type there.
 * apps/web/worker/agent/links.ts keeps the link and checks who may share it.
 */

export interface ReviewLinkSpec {
  orgId: string;
  languageId: string;
  unitId: string;
  kindId: string;
  /** Answers count toward the step (true) or are feedback only (false). */
  counts: boolean;
  /** Who it is for, as the sharer sees it in the link's list. Never shown to the person who opens it. */
  label?: string;
  /** Days until it closes: the server's 14 when not given. */
  expiresInDays?: number;
}

export interface ReviewLink { url: string; expiresAt: string }

/** The Worker's refusal: its code (such as `links_off` or `too_many_links`) and its own words. */
export interface ReviewLinkError { status: number; code: string; message: string }

/** Make a review link as the signed-in person. A lost connection is status 0. */
export async function makeReviewLink(spec: ReviewLinkSpec): Promise<{ data: ReviewLink | null; error: ReviewLinkError | null }> {
  try {
    const res = await fetch(`${api()}/api/v1/session/review-links`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await tokenOf(supabase)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(spec)
    });
    const body = (await res.json().catch(() => ({}))) as { url?: string; expiresAt?: string; code?: string; error?: string };
    if (res.ok && body.url && body.expiresAt) return { data: { url: body.url, expiresAt: body.expiresAt }, error: null };
    return { data: null, error: { status: res.status, code: body.code ?? 'unknown', message: body.error ?? `HTTP ${res.status}` } };
  } catch (e) {
    return { data: null, error: { status: 0, code: 'offline', message: e instanceof Error ? e.message : String(e) } };
  }
}
