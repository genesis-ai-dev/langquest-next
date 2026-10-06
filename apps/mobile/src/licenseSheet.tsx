// Choosing the license an organization's work is under (docs/licensing.md,
// docs/decisions.md 38). Not in the partner demo: one sheet serves Create
// Organization (any license, closed by default) and Organization Home
// (only more open than now, confirmed, since it cannot be undone).
import { LICENSE_INFO, licenseChoices, type License } from '@langquest-next/core';
import { useEffect, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { Banner, GhostBtn, Ico, LinkBtn, PrimaryBtn, Row, Sheet, txt } from './kit';
import { C, space } from './theme';

type LicenseSheetMode = 'choose' | 'open' | 'view';

const SUB: Record<LicenseSheetMode, string> = {
  choose: 'Who may use what your team records and writes. You can open it up later, but never close it again.',
  open: 'Opening up is permanent: anyone who copies your work keeps these terms.',
  view: 'The terms your organization shares its recordings and writing under.'
};

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
  const changed = picked !== props.current;

  let footer = null;
  if (props.mode === 'choose') {
    footer = <PrimaryBtn label="Use this license" onPress={() => props.onConfirm?.(picked)} />;
  } else if (props.mode === 'open') {
    footer = confirming ? (
      <>
        <PrimaryBtn label={props.busy ? 'Opening…' : `Yes, open to ${info.name}`} disabled={props.busy}
          onPress={() => props.onConfirm?.(picked)} />
        <GhostBtn label="Back" onPress={() => setConfirming(false)} />
      </>
    ) : (
      <PrimaryBtn label={changed ? `Open to ${info.name}` : 'Pick a more open license'} disabled={!changed}
        onPress={() => setConfirming(true)} />
    );
  }

  return (
    <Sheet visible={props.visible} title="Who may use your work" sub={SUB[props.mode]} onClose={props.onClose} footer={footer}>
      {confirming ? (
        <Banner icon="flag" tone="amber" title="This can't be undone"
          body={`${info.means} You will not be able to close it again.`} />
      ) : (
        <View>
          {licenseChoices(floor).map(({ info: option, available }, i, all) => {
            const selected = option.license === picked;
            const locked = !available;
            const pickable = props.mode !== 'view' && !locked;
            return (
              <Row key={option.license} role="radio" selected={selected} last={i === all.length - 1}
                label={option.name} muted={locked}
                sub={locked ? 'Your work is already more open than this' : option.short}
                onPress={pickable ? () => setPicked(option.license) : undefined}
                right={locked ? <Ico name="lock" size={18} color={C.faint} />
                  : selected ? <Ico name="check" size={22} color={C.primary} /> : <View style={{ width: 22 }} />}
                below={selected ? <LicenseMeans license={option.license} /> : undefined} />
            );
          })}
        </View>
      )}
      {!confirming && info.terms.outsidersMayView ? (
        <Banner icon="people" tone="amber" title="People outside can hear your team"
          body="Anyone will be able to listen to your recordings. If a voice could put someone at risk, keep your work closed." />
      ) : null}
      {props.mode === 'view' ? <Text style={txt.smMuted}>Only an organization admin can change this.</Text> : null}
    </Sheet>
  );
}

/** What a license allows, in a sentence, with its full text a tap away. */
function LicenseMeans(props: { license: License }) {
  const info = LICENSE_INFO[props.license];
  return (
    <View style={{ gap: space.xs, alignItems: 'flex-start' }}>
      <Text style={txt.sm}>{info.means}</Text>
      {info.url ? <LinkBtn label="Read the license" onPress={() => void Linking.openURL(info.url!)} /> : null}
    </View>
  );
}

/** The row that shows the license and opens the sheet. */
export function LicenseRow(props: { license: License; onPress: () => void; last?: boolean }) {
  const info = LICENSE_INFO[props.license];
  return (
    <Row icon={info.terms.outsidersMayView ? 'globe' : 'lock'} label={info.name} sub={info.short}
      onPress={props.onPress} last={props.last} accessibilityLabel={`License: ${info.name}. ${info.short}`} />
  );
}
