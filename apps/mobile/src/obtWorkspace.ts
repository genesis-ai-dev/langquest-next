import type { Card } from '@langquest-next/core';
import { supabase } from './supabase';
import type { ProjectHandle } from './useProject';

async function copyCards(org: string, from: string, to: string, cards: Card[]) {
  for (const card of cards) {
    const file = `${card.hash}.${card.format ?? 'wav'}`;
    const target = `${org}/${to}/${file}`;
    const { data } = await supabase.storage.from('blobs').exists(target);
    if (data) continue;
    const { error } = await supabase.storage.from('blobs').copy(`${org}/${from}/${file}`, target);
    if (error) throw new Error(`Audio delivery: ${error.message}`);
  }
}
export async function openObtWorkspace(project: ProjectHandle, revision: string, email: string, language: string): Promise<string> {
  await project.sync();
  const { data, error } = await supabase.rpc('obt_open_workspace', {
    p_org: project.orgId, p_project: project.projectId,
    p_revision: revision, p_email: email.trim(), p_language: language.trim()
  });
  if (error) throw new Error(error.message);
  const packet = data as { workspaceId: string; cards: Card[] };
  // Retries reuse the same workspace and only copy missing immutable files.
  await copyCards(project.orgId, project.projectId, packet.workspaceId, packet.cards);
  return packet.workspaceId;
}
export async function collectObtWorkspace(project: ProjectHandle, revision: string): Promise<void> {
  const args = { p_org: project.orgId, p_project: project.projectId, p_revision: revision };
  const { data, error } = await supabase.rpc('obt_result_packet', args);
  if (error) throw new Error(error.message);
  const packet = data as { workspaceId: string; submissionId: string; cards: Card[] };
  await copyCards(project.orgId, packet.workspaceId, project.projectId, packet.cards);
  const result = await supabase.rpc('obt_collect_result', { ...args, p_submission: packet.submissionId });
  if (result.error) throw new Error(result.error.message);
  await project.sync();
}
