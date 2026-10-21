// What a review noted, beside its feedback (decisions.md 149): the notes sent
// with it, each saying what it is on ("Part 2 · 0:04", a verse, a help, a key
// word), with Reply. A note on a moment names the part it falls in, so the
// translator knows which part to record over.
import { reviewNotesFor, type PassageNote } from '@langquest-next/core';
import { useState } from 'react';
import { View } from 'react-native';
import type { Ctx } from '../shell/ctx';
import { t } from '../i18n';
import { SectionLabel } from '../ui/kit';
import { checkName } from '../admin/adminModel';
import { useCheckHelpRows } from '../checks/useCheckHelpRows';
import { noteAnchorText, replyAnchor, summaryLine, type AnchorLook } from '../reviewing/capture';
import { NotesUnder, NotingSheet, type Noting } from '../reviewing/notesOn';
import type { PassageView } from './passageView';
import { space } from '../ui/theme';

export function CheckNotes(props: { ctx: Ctx; v: PassageView; reviewId: string; kindId: string }) {
  const { ctx, v } = props;
  const helps = useCheckHelpRows(ctx, v.state, props.kindId);
  const [noting, setNoting] = useState<Noting | null>(null);
  const notes = reviewNotesFor(v.p, props.reviewId);
  if (notes.length === 0) return null;
  const look: AnchorLook = {
    term: (id) => v.state.keyTerms[id]?.term,
    versionN: (id) => v.p.versions.find((x) => x.takeId === id)?.n,
    partN: (id, hash) => { const at = v.p.versions.find((x) => x.takeId === id)?.cardHashes.indexOf(hash) ?? -1; return at >= 0 ? at + 1 : undefined; },
    help: (key) => helps.find((h) => h.help === key)?.name,
    author: (id) => { const n = v.p.notes.find((x) => x.id === id); return n ? ctx.name(n.by).split(' ')[0] : undefined; }
  };
  const label = (n: PassageNote) => noteAnchorText(n.anchor, look);
  const reply = (n: PassageNote) => setNoting({
    anchor: replyAnchor(n), title: t('review.notesOn.replyTitle', { name: ctx.name(n.by).split(' ')[0] ?? ctx.name(n.by) }),
    where: summaryLine([v.title, label(n)])
  });
  return (
    <View style={{ gap: space.sm }}>
      <SectionLabel label={t('passage.checkNotes.title', { check: checkName(props.kindId, v.kinds) })} />
      <NotesUnder ctx={ctx} p={v.p} notes={notes} label={label} onReply={reply} />
      <NotingSheet ctx={ctx} v={v} noting={noting} onClose={() => setNoting(null)} />
    </View>
  );
}
