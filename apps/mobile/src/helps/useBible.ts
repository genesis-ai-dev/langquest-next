// The Bible text the reference panel shows (helps/reference.tsx).
import { useMemo } from 'react';
import type { Ctx } from '../shell/ctx';
import { t } from '../i18n';
import type { ListenHooks } from '../recording/useListenLoop';
import { choiceKey } from '../sources/sourceText';
import { useChoice, useOffer } from '../sources/useSourceChoice';
import { emptyBibleText, offersFor, type SourceOption } from '../sources/model';
import { PlayError } from '../sources/player';
import { usePassagePlayer } from '../sources/usePassagePlayer';
import type { Usage } from '../sources/useUsage';
import { usePassageSource, useSources } from '../sources/useSources';
import { mmss, passageClock } from '../recording/model';

/**
 * The passage's Bibles and one player for them, held by the screen so the
 * Bible card, the one-line bar and the dock all play the same thing, and a
 * key word can play its verse. The version chosen last for the language is
 * shared with every other reader on this device (SourceReader.tsx).
 */
export function useBible(ctx: Ctx, unitId: string | null, languageId: string | null, opts: {
  listen?: ListenHooks; usage?: Usage; hidden?: boolean;
  /** What the step shows (decisions.md 129): only Bibles with audio when it is heard and not read, with text when read and not heard. */
  shows?: { audio: boolean; text: boolean };
}) {
  const all = useSources(ctx, unitId, languageId);
  const need = opts.shows;
  const book = all.range?.book;
  const only = !need || (need.audio && need.text) || !book ? null : need.text ? 'text' : 'audio';
  const options = useMemo(() => (only && book ? all.options.filter((o) => offersFor(o, book, o.kind === 'builtin')[only]) : all.options), [all.options, only, book]);
  const passage = useMemo(() => (options === all.options ? all : { ...all, options }), [all, options]);
  const [chosen, setChosen] = useChoice(choiceKey(ctx.session.actorId, ctx.language.orgId, languageId ?? ''));
  const option = passage.options.find((o) => o.itemId === chosen) ?? passage.options[0];
  const usage = opts.usage;
  useOffer(usage, passage);
  const src = usePassageSource(ctx, option, passage);
  const plan = src?.plan ?? null;
  const rows = src?.rows ?? null;
  const player = usePassagePlayer({
    plan, rows, signature: `${option?.itemId ?? ''}:${passage.ref}:${plan?.parts.length ?? 0}`, disabled: opts.hidden,
    resolve: (i) => {
      const part = plan?.parts[i];
      const ch = src?.chapters.find((c) => c.chapter === part?.chapter);
      if (!ch) return Promise.reject(new PlayError(t('sources.reader.noAudioForChapter')));
      return ch.resolve();
    },
    ...(opts.listen ? { listen: opts.listen } : {}),
    onPlayed: () => { if (option) usage?.open(option.itemId); }
  });
  const clock = plan ? passageClock(plan.parts, player.part, player.ms) : null;
  const timed = !!plan && plan.parts.some((p) => p.timing);
  // Offline, audio that was never downloaded is not a Bible with nothing to play.
  const audioAbsent = !!src?.audioNotHere || (ctx.language.online === false && !!src && src.chapters.length > 0 && src.chapters.every((c) => !c.local));
  return {
    passage, option, src, plan, rows, player, clock, timed, audioAbsent,
    /** Has verses at all: an outline item has none, so no Bible chip and no dock. */
    hasVerses: !!passage.range,
    hasAudio: !!plan && !audioAbsent,
    choose: (o: SourceOption) => { setChosen(o.itemId); usage?.open(o.itemId); },
    /** "0:42 / 1:18", or why there is nothing to play. */
    time: (): string => {
      if (!option) return '';
      if (!plan) return src?.loading ? t('common.loading') : t('reference.bible.noAudio');
      const total = clock?.total;
      if (player.started) return `${mmss((clock?.elapsed ?? 0) * 1000)}${total ? ` / ${mmss(total * 1000)}` : ''}`;
      return total ? mmss(total * 1000) : '';
    },
    /** "World English Bible · 0:42 / 1:18" */
    line: (): string => {
      if (!option) return emptyBibleText({ loading: passage.loading, notOnDevice: passage.notOnDevice }, t('reference.bible.noBible'));
      if (audioAbsent) return t('recording.player.notOnDeviceYet');
      if (src?.loading && !plan) return t('reference.bible.nameLoading', { name: option.name });
      if (!plan) return t('reference.bible.nameNoAudio', { name: option.name });
      const total = clock?.total;
      if (player.started) return `${option.name} · ${mmss((clock?.elapsed ?? 0) * 1000)}${total ? ` / ${mmss(total * 1000)}` : ''}`;
      return total ? `${option.name} · ${mmss(total * 1000)}` : option.name;
    },
    /** Play from the first verse that holds a word; false when it cannot (no timed audio). */
    playVerse: (key: string) => {
      const row = rows?.find((r) => r.key === key);
      return !!row && !!plan && !audioAbsent && timed && player.playFrom(row);
    }
  };
}
