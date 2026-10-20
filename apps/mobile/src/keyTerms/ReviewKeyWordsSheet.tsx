// A key-word list a check links (decision 149; the agreed design's screen
// 5), opened by the reviewer: each of the list's words on the passage, the
// team's word to play, and whether the translator marked it in the version
// being checked, or that the team has no word for it yet. A word opens its
// meaning (the word sheet, without Add: a review changes no key words).
import { keyTermLinksFor, keyTermsFor, languageName, type KeyWordDoc } from '@langquest-next/core';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Text } from '../ui/text';
import type { Ctx } from '../shell/ctx';
import { t } from '../i18n';
import { HelpRow } from '../helpMode/helpBadge';
import { Badge, Group, Row, Sheet } from '../ui/kit';
import { txt } from '../ui/textStyles';
import { space } from '../ui/theme';
import { languageLabel } from '../admin/adminModel';
import { bookOf, verseRefs } from '../recording/model';
import { KeyWordSheet } from './KeyWordSheet';
import { OurWord } from './KeyWordRows';
import { shortName, type KeyWordList } from './listsModel';
import { reviewWords } from './reviewWordsModel';
import { usePassageKeyWords } from './usePassageKeyWords';

export function ReviewKeyWordsSheet(props: {
  ctx: Ctx;
  unitId: string;
  /** "Luke 13:31–35": the passage, for the sheet's line and the verses' book. */
  title: string;
  /** The list the check links. */
  itemId: string;
  /** The version being checked, its number and who recorded it. */
  takeId: string;
  version: number;
  translator: string;
  onClose: () => void;
}) {
  const { ctx } = props;
  const state = ctx.language.state;
  const passage = usePassageKeyWords(ctx, props.unitId, { includeOwn: true });
  const list = passage.lists.find((l) => l.itemId === props.itemId) ?? null;
  const own = useMemo(() => (state ? keyTermsFor(state) : []), [state]);
  const tied = useMemo(() => new Set(state ? keyTermLinksFor(state, props.takeId).map((l) => l.term.termId) : []), [state, props.takeId]);
  const rows = useMemo(() => reviewWords(passage.words.filter((w) => w.list.itemId === props.itemId), own, tied), [passage.words, props.itemId, own, tied]);
  const [open, setOpen] = useState<{ list: KeyWordList; word: KeyWordDoc } | null>(null);
  const language = languageName(ctx.org.state, ctx.language.languageId ?? '');
  const book = bookOf(props.title);
  const name = list ? shortName(list) : '';
  if (open) return <KeyWordSheet ctx={ctx} list={open.list} word={open.word} onClose={() => setOpen(null)} />;
  return (
    <Sheet visible title={list ? t('keyTerms.review.title', { name }) : t('keyTerms.review.titlePlain')}
      sub={[props.title, list ? languageLabel(list.language) : ''].filter(Boolean).join(' · ')} onClose={props.onClose}>
      <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>
        {list ? t('keyTerms.review.intro', { n: props.version, name }) : passage.loading ? t('common.loading') : t('keyTerms.review.gone')}
      </Text>
      {list && rows.length === 0 && !passage.loading ? <Text style={[txt.sm, { paddingHorizontal: space.xs }]}>{t('keyTerms.review.none', { name })}</Text> : null}
      {rows.length ? (
        <Group>
          {rows.map((r, i) => (
            <HelpRow key={r.here.word.id} of="keyTerms.reviewWord">
              <Row label={r.here.word.term} sub={r.here.verses.length ? `${book} ${verseRefs(r.here.verses)}` : t('keyTerms.lists.inPassage')}
                help={t('keyTerms.review.openHelp', { name })} onPress={() => setOpen({ list: r.here.list, word: r.here.word })} last={i === rows.length - 1}
                below={(
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm }}>
                    {r.own && r.voice ? <OurWord ctx={ctx} hash={r.voice} term={r.own.term} language={language} /> : null}
                    {r.status === 'used' ? <Badge label={t('keyTerms.review.used', { name: props.translator })} tone="green" />
                      : r.status === 'notMarked' ? <Badge label={t('keyTerms.review.notMarked', { n: props.version })} tone="amber" />
                      : <Badge label={t('keyTerms.review.noWord', { language })} />}
                  </View>
                )} />
            </HelpRow>
          ))}
        </Group>
      ) : null}
    </Sheet>
  );
}
