// Choosing the license an organization's work is under (docs/licensing.md,
// docs/decisions.md 38). Not in the partner demo: one sheet serves Create
// Organization (any license, closed by default) and Organization Home
// (only more open than now, confirmed, since it cannot be undone).
import { LICENSE_INFO, licenseChoices, type License } from '@langquest-next/core';
import { useEffect, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { licenseText } from './coreText';
import { t } from './i18n';
import { Banner, GhostBtn, Ico, LinkBtn, PrimaryBtn, Row, Sheet, txt } from './kit';
import { C, space } from './theme';

type LicenseSheetMode = 'choose' | 'open' | 'view';

function subFor(mode: LicenseSheetMode): string {
  switch (mode) {
    case 'choose': return t('shell.license.subChoose');
    case 'open': return t('shell.license.subOpen');
    case 'view': return t('shell.license.subView');
  }
}

/**
 * `choose` offers every license, `open` only the current one and those above
 * it, `view` shows them without changing anything. `onConfirm` gets the
 * choice; in `open` mode only after a second, explicit tap.
 */
export function LicenseSheet(props: {
  visible: boolean;
  mode: LicenseSheetMode;
  current: License;
  onClose: () => void;
  onConfirm?: (license: License) => void;
  busy?: boolean;
}) {
  const [picked, setPicked] = useState<License>(props.current);
  const [confirming, setConfirming] = useState(false);
  // Opening again starts from where the organization stands now.
  useEffect(() => {
    if (props.visible) { setPicked(props.current); setConfirming(false); }
  }, [props.visible, props.current]);
  const floor = props.mode === 'open' ? props.current : 'all-rights-reserved';
  const info = LICENSE_INFO[picked];
  const words = licenseText(picked);
  const changed = picked !== props.current;

  let footer = null;
  if (props.mode === 'choose') {
    footer = <PrimaryBtn label={t('shell.license.use')} onPress={() => props.onConfirm?.(picked)} />;
  } else if (props.mode === 'open') {
    footer = confirming ? (
      <>
        <PrimaryBtn label={props.busy ? t('shell.license.opening') : t('shell.license.yesOpenTo', { name: words.name })} disabled={props.busy}
          onPress={() => props.onConfirm?.(picked)} />
        <GhostBtn label={t('common.back')} onPress={() => setConfirming(false)} />
      </>
    ) : (
      <PrimaryBtn label={changed ? t('shell.license.openTo', { name: words.name }) : t('shell.license.pickMoreOpen')} disabled={!changed}
        onPress={() => setConfirming(true)} />
    );
  }

  return (
    <Sheet visible={props.visible} title={t('shell.license.title')} sub={subFor(props.mode)} onClose={props.onClose} footer={footer}>
      {confirming ? (
        <Banner icon="flag" tone="amber" title={t('shell.license.cannotUndo')}
          body={`${words.means} ${t('shell.license.cannotClose')}`} />
      ) : (
        <View>
          {licenseChoices(floor).map(({ info: option, available }, i, all) => {
            const selected = option.license === picked;
            const locked = !available;
            const pickable = props.mode !== 'view' && !locked;
            return (
              <Row key={option.license} role="radio" selected={selected} last={i === all.length - 1}
                label={licenseText(option.license).name} muted={locked}
                sub={locked ? t('shell.license.alreadyMoreOpen') : licenseText(option.license).short}
                onPress={pickable ? () => setPicked(option.license) : undefined}
                right={locked ? <Ico name="lock" size={18} color={C.faint} />
                  : selected ? <Ico name="check" size={22} color={C.primary} /> : <View style={{ width: 22 }} />}
                below={selected ? <LicenseMeans license={option.license} /> : undefined} />
            );
          })}
        </View>
      )}
      {!confirming && info.terms.outsidersMayView ? (
        <Banner icon="people" tone="amber" title={t('shell.license.outsidersTitle')}
          body={t('shell.license.outsidersBody')} />
      ) : null}
      {props.mode === 'view' ? <Text style={txt.smMuted}>{t('shell.license.onlyAdmin')}</Text> : null}
    </Sheet>
  );
}

/** What a license allows, in a sentence, with its full text a tap away. */
function LicenseMeans(props: { license: License }) {
  const info = LICENSE_INFO[props.license];
  return (
    <View style={{ gap: space.xs, alignItems: 'flex-start' }}>
      <Text style={txt.sm}>{licenseText(props.license).means}</Text>
      {info.url ? <LinkBtn label={t('shell.license.read')} onPress={() => void Linking.openURL(info.url!)} /> : null}
    </View>
  );
}

/** The row that shows the license and opens the sheet. */
export function LicenseRow(props: { license: License; onPress: () => void; last?: boolean }) {
  const info = LICENSE_INFO[props.license];
  const words = licenseText(props.license);
  return (
    <Row icon={info.terms.outsidersMayView ? 'globe' : 'lock'} label={words.name} sub={words.short}
      onPress={props.onPress} last={props.last} accessibilityLabel={t('shell.license.rowLabel', { name: words.name, short: words.short })} />
  );
}
