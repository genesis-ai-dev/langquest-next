// Upload your own Bible (LAN-229, decision 252), from Setup → Reference
// Material on the web: an admin picks USFM files (or a zip of them), the app
// checks each one and says in plain words what is wrong, then the admin names
// the Bible and its language and publishes it as an organization library item.
// Showing the text beside a passage waits on LAN-230.
// Not in the partner demo: an organization-library upload has no demo screen, so it
// follows the Import sheet's look (imports/ImportSheet.tsx) and the guide editor's uploads.
import { checkUsfmFiles, orgLicense, type UsfmCheck } from '@langquest-next/core';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { CheckRow } from '../admin/admin';
import { HelpRow } from '../helpMode/helpBadge';
import { licenseText } from '../i18n/coreText';
import { t } from '../i18n';
import { useSharedItems, type useLibrary } from '../library/useLibrary';
import type { Ctx } from '../shell/ctx';
import { LanguageField } from '../reference/LanguageField';
import { Banner, Chip, ChipRow, Field, Group, PrimaryBtn, Row, SectionLabel, Sheet, SmallBtn } from '../ui/kit';
import { Text } from '../ui/text';
import { txt } from '../ui/textStyles';
import { C, space } from '../ui/theme';
import { pickUsfmFiles } from './files';
import { emptyDetails, missingDetail, readyBooks, suggestAbbreviation, type UsfmDetails } from './model';
import { pickFailureText, problemText } from './problemText';
import { publishUsfmBible, type UsfmEntry } from './publishUsfm';

type RawFile = { name: string; text: string };

export function UsfmSheet(props: { visible: boolean; onClose: () => void; ctx: Ctx; lib: ReturnType<typeof useLibrary>; orgName: string }) {
  const { ctx, lib } = props;
  const [raw, setRaw] = useState<RawFile[]>([]);
  const [details, setDetails] = useState<UsfmDetails>(emptyDetails);
  const [named, setNamed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const versifications = useSharedItems('versification', lib.orgId);
  const license = orgLicense(ctx.org.state);

  useEffect(() => { if (props.visible) { setRaw([]); setDetails(emptyDetails()); setNamed(false); setProblem(null); setDone(false); } }, [props.visible]);

  const checks = useMemo(() => checkUsfmFiles(raw), [raw]);
  const entries: UsfmEntry[] = useMemo(() => checks.map((check, i) => ({ check, text: raw[i]!.text })), [checks, raw]);
  const ready = useMemo(() => readyBooks(checks), [checks]);
  const missing = missingDetail(checks, details);
  const numberings = useMemo(() => versifications.rows.filter((r) => r.org_id === 'langquest' && r.item_id.startsWith('langquest.versification.'))
    .map((r) => ({ code: r.item_id.slice('langquest.versification.'.length), name: r.name })), [versifications.rows]);
  const set = (patch: Partial<UsfmDetails>) => setDetails((d) => ({ ...d, ...patch }));

  async function choose() {
    setProblem(null);
    const picked = await pickUsfmFiles();
    if (typeof picked === 'string') { setProblem(pickFailureText(picked)); return; }
    // A file picked twice replaces the earlier one.
    setRaw((cur) => [...cur.filter((c) => !picked.some((p) => p.name === c.name)), ...picked]);
  }

  async function publish() {
    setBusy(true); setProblem(null);
    try {
      await publishUsfmBible(lib, { entries, details, license, versifications: versifications.rows });
      setDone(true);
    } catch (e) {
      setProblem(e instanceof Error && e.message ? e.message : t('usfm.failed'));
    } finally { setBusy(false); }
  }

  const hint = missing ? t(`usfm.missing.${missing}`) : null;
  const footer = done ? undefined : (
    <View style={{ gap: space.xs }}>
      {hint && raw.length ? <Text style={[txt.smMuted, { textAlign: 'center' }]}>{hint}</Text> : null}
      <PrimaryBtn label={t('usfm.publish')} icon="check" busy={busy} disabled={!!missing} help={t('usfm.publishHelp')} onPress={() => void publish()} />
    </View>
  );

  return (
    <Sheet visible={props.visible} title={t('usfm.title')} sub={props.orgName} onClose={props.onClose} footer={footer}>
      {done ? (
        <View style={{ gap: space.md }}>
          <Banner icon="check" tone="green" title={t('usfm.done.title', { name: details.name.trim() })} body={t('usfm.done.body')} />
          <Banner icon="clock" tone="amber" title={t('usfm.done.waitTitle')} body={t('usfm.done.waitBody')} />
        </View>
      ) : (
        <View style={{ gap: space.md }}>
          <Text style={txt.body}>{t('usfm.intro')}</Text>
          <SmallBtn label={raw.length ? t('usfm.addMore') : t('usfm.choose')} icon="plus" tone="primary" help={t('usfm.chooseHelp')} onPress={() => void choose()} />
          {problem ? <Text accessibilityRole="alert" style={[txt.sm, { color: C.red, fontWeight: '700' }]}>{problem}</Text> : null}

          {raw.length ? (
            <>
              <SectionLabel label={t('usfm.files', { count: raw.length })} />
              <Group>
                {checks.map((c, i) => (
                  <HelpRow key={c.fileName} of="usfm.file">
                    <FileRow check={c} last={i === checks.length - 1} onRemove={() => setRaw((cur) => cur.filter((r) => r.name !== c.fileName))} />
                  </HelpRow>
                ))}
              </Group>
              <Text style={txt.smMuted}>{t('usfm.summary', { ready: ready.length, problems: checks.length - ready.length })}</Text>
            </>
          ) : null}

          {ready.length ? (
            <>
              <SectionLabel label={t('usfm.about')} />
              <Field label={t('usfm.name')} value={details.name} placeholder={t('usfm.namePlaceholder')} testID="usfm-name" help={t('usfm.nameHelp')}
                onChangeText={(v) => set({ name: v, ...(named ? {} : { abbreviation: suggestAbbreviation(v) }) })} />
              <Field label={t('usfm.abbreviation')} value={details.abbreviation} testID="usfm-abbreviation" help={t('usfm.abbreviationHelp')} autoCapitalize="none"
                onChangeText={(v) => { setNamed(true); set({ abbreviation: v }); }} />
              <LanguageField label={t('usfm.language')} value={details.language} onChange={(language) => set({ language })} />
              <View style={{ gap: space.xs }}>
                <Text style={txt.xsStrong}>{t('usfm.numbering')}</Text>
                <ChipRow>
                  {(numberings.length ? numberings : [{ code: 'eng', name: t('usfm.numberingEnglish') }]).map((n) => (
                    <HelpRow key={n.code} of="usfm.numbering">
                      <Chip label={n.name} on={details.numbering === n.code} help={t('usfm.numberingHelp')} onPress={() => set({ numbering: n.code })} />
                    </HelpRow>
                  ))}
                </ChipRow>
                <Text style={txt.smMuted}>{t('usfm.numberingHelp')}</Text>
              </View>
              <Field label={t('usfm.copyright')} value={details.copyright} placeholder={t('usfm.copyrightPlaceholder')} testID="usfm-copyright" help={t('usfm.copyrightHelp')}
                onChangeText={(v) => set({ copyright: v })} />
              <Text style={txt.smMuted}>{t('usfm.license', { license: licenseText(license).name })}</Text>
              <Group>
                <HelpRow of="usfm.rights">
                  <CheckRow label={t('usfm.rights')} sub={t('usfm.rightsSub')} checked={details.rights} detail={t('usfm.rightsHelp')} onToggle={() => set({ rights: !details.rights })} last={false} />
                </HelpRow>
                <HelpRow of="usfm.share">
                  <Row label={t('usfm.share')} sub={t('usfm.shareSub')} role="switch" checked={details.share} help={t('usfm.shareHelp')} onPress={() => set({ share: !details.share })} last />
                </HelpRow>
              </Group>
            </>
          ) : null}
        </View>
      )}
    </Sheet>
  );
}

function FileRow(props: { check: UsfmCheck; last: boolean; onRemove: () => void }) {
  const { check } = props;
  const ok = !!check.book && !check.errors.length;
  const lines = [...check.errors, ...check.warnings].map(problemText);
  return (
    <Row icon={ok ? 'check' : 'flag'} label={ok ? check.name : check.fileName} last={props.last}
      sub={ok ? `${check.fileName} · ${t('usfm.counts', { chapters: check.chapters.length, verses: check.verseCount })}${lines.length ? `\n${lines.join('\n')}` : ''}` : lines.join('\n')}
      badge={ok ? t('usfm.ok') : t('usfm.fix')} badgeTone={ok ? 'green' : 'amber'} help={t('usfm.fileHelp')} onPress={props.onRemove} />
  );
}
