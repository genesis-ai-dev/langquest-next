// What a check said about the parts and helps, beside its feedback
// (decisions.md 149): the version's parts with the check's notes under each
// part they are on, then its other notes (a verse, a help, a key word), each
// saying what it is on, with Reply. A translator sees which part to fix and
// can answer there.
import { notePart, replyOf, type PassageNote, type Version } from '@langquest-next/core';
import { useState } from 'react';
import { View } from 'react-native';
import type { Ctx } from '../shell/ctx';
import { t } from '../i18n';
import { SectionLabel } from '../ui/kit';
import { checkName } from '../admin/adminModel';
import { useCheckHelpRows } from '../checks/useCheckHelpRows';
import { noteAnchorText, replyAnchor, summaryLine, type AnchorLook } from '../reviewing/capture';
import { NotesUnder, NotingSheet, type Noting } from '../reviewing/notesOn';
import { VersionParts } from './versionParts';
import type { PassageView } from './passageView';
import { space } from '../ui/theme';

export function CheckNotes(props: { ctx: Ctx; v: PassageView; kindId: string; version: Version | undefined }) {
  const { ctx, v, kindId, version } = props;
  const helps = useCheckHelpRows(ctx, v.state, kindId);
  const [noting, setNoting] = useState<Noting | null>(null);
  if (!version) return null;
  // The check's own notes on this version: on its parts, and on what it showed while this version was the one heard.
  const said = v.p.notes.filter((n) => n.kindId === kindId && !replyOf(n.anchor));
  const onParts = said.filter((n) => { const at = notePart(n.anchor); return !!at && version.cardHashes.includes(at.part); });
  const others = said.filter((n) => !notePart(n.anchor) && (n.onTakeId ?? version.takeId) === version.takeId);
  if (onParts.length === 0 && others.length === 0) return null;
  const look: AnchorLook = {
    term: (id) => v.state.keyTerms[id]?.term,
    versionN: (id) => v.p.versions.find((x) => x.takeId === id)?.n,
    partN: (id, hash) => { const at = v.p.versions.find((x) => x.takeId === id)?.cardHashes.indexOf(hash) ?? -1; return at >= 0 ? at + 1 : undefined; },
    help: (key) => helps.find((h) => h.help === key)?.name,
    author: (id) => { const n = v.p.notes.find((x) => x.id === id); return n ? ctx.name(n.by).split(' ')[0] : undefined; }
  };
  const reply = (n: PassageNote) => setNoting({
    anchor: replyAnchor(n), title: t('review.notesOn.replyTitle', { name: ctx.name(n.by).split(' ')[0] ?? ctx.name(n.by) }),
    where: summaryLine([v.title, noteAnchorText(n.anchor, look)])
  });
  return (
    <View style={{ gap: space.sm }}>
      <SectionLabel label={t('passage.checkNotes.title', { check: checkName(kindId, v.kinds) })} />
      {onParts.length ? (
        <VersionParts ctx={ctx} state={v.state} unitId={v.unitId} hashes={version.cardHashes}
          noting={{ notes: (hash) => (
            <NotesUnder ctx={ctx} p={v.p} notes={onParts.filter((n) => notePart(n.anchor)?.part === hash)} onReply={reply}
              label={(n) => { const at = notePart(n.anchor)?.at; return at ? t('review.notesOn.at', { time: at }) : undefined; }} />
          ) }} />
      ) : null}
      <NotesUnder ctx={ctx} p={v.p} notes={others} label={(n) => noteAnchorText(n.anchor, look)} onReply={reply} />
      <NotingSheet ctx={ctx} v={v} noting={noting} onClose={() => setNoting(null)} />
    </View>
  );
}
