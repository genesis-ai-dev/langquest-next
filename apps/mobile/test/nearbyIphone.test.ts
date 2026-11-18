import { join } from 'node:path';
import { iphoneFiles } from './iphoneBundle';

// What an iPhone build carries of nearby sync (docs/nearby-sync-plan.md section 7, phase 5): the
// exchange, through `.native` files Metro gives Android and iPhones alike, and an iPhone's own
// permission prompt; not joining offline, the install file or the disguise, which stay in `.android`
// files with a plain stub beside each. disguiseIphone.test.ts holds the disguise apart by name too.

const ROOT = join(import.meta.dirname, '..');

describe('Share nearby on an iPhone', () => {
  const files = iphoneFiles(ROOT);

  it('carries the exchange: the screen\'s row, the hook, the radio, the identity, the key and delivery', () => {
    expect(files).toEqual(expect.arrayContaining([
      'src/shell/NearbyRow.native.tsx', 'src/nearby/useNearby.native.ts', 'src/nearby/nearbyRun.native.ts', 'src/nearby/nearbyLink.native.ts',
      'src/nearby/nearbyPhone.native.ts', 'src/nearby/useNearbyIdentity.native.ts', 'src/nearby/nearbyIdentity.native.ts', 'src/nearby/holdChoice.native.ts',
      'src/nearby/nearbyCarry.native.ts', 'src/nearby/useNearbyHistory.native.ts', 'src/nearby/useDeliveryRefusals.native.ts',
      'src/server/nearbyKey.native.ts', 'src/server/nearbyRelay.native.ts', 'src/nearby/nearbyPermissions.ios.ts'
    ]));
    // Not the web's stubs in their place.
    for (const stub of ['src/shell/NearbyRow.tsx', 'src/nearby/useNearby.ts', 'src/nearby/nearbyLink.ts', 'src/server/nearbyKey.ts', 'src/nearby/nearbyPermissions.ts']) {
      expect(files).not.toContain(stub);
    }
  });

  it('carries no .android file: joining offline, the install file and the disguise are their plain stubs', () => {
    expect(files.filter((f) => /\.android\.[jt]sx?$/.test(f))).toEqual([]);
    expect(files).toEqual(expect.arrayContaining([
      'src/nearby/useLetIn.ts', 'src/nearby/useJoinOffline.ts', 'src/nearby/useCarriedApk.ts', 'src/nearby/nearbyCopySource.ts', 'src/nearby/useChainMembership.ts',
      'src/sync/firstContactGate.ts', 'src/shell/useAppCovered.ts', 'src/shell/NearbyCoverNotes.tsx'
    ]));
  });
});
