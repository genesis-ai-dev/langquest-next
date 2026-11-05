/**
 * The license an organization's work is under (docs/licensing.md,
 * docs/decisions.md 38): the recordings and other content its members make.
 *
 * The licenses form a ladder from most closed to most open, and each rung
 * allows everything the one below it allows and more. An organization starts
 * at the bottom and may only climb: once work has been released under open
 * terms, anyone who took a copy keeps those terms, so closing it again would
 * promise something the app cannot keep. The fold enforces this by keeping
 * the most open license ever set (`v1.OrgLicenseSet`, org.ts), so two admins
 * opening it offline both land on the more open of their choices.
 */

/** Most closed first. The order is the merge rule; never reorder, only append above an equal or more open rung. */
export const LICENSES = [
  'all-rights-reserved',
  'CC-BY-NC-ND-4.0',
  'CC-BY-NC-SA-4.0',
  'CC-BY-SA-4.0',
  'CC-BY-4.0',
  'CC0-1.0'
] as const;
/** SPDX identifiers, except the closed default, which SPDX has no id for. */
export type License = (typeof LICENSES)[number];

/** Where an organization without a `v1.OrgLicenseSet` stands. */
export const DEFAULT_LICENSE: License = 'all-rights-reserved';

export function isLicense(v: unknown): v is License {
  return typeof v === 'string' && (LICENSES as readonly string[]).includes(v);
}

/** Position on the ladder; higher is more open. */
export function licenseRank(license: License): number {
  return LICENSES.indexOf(license);
}

/** Is `next` a step up from `current`? Staying put is not. */
export function isMoreOpen(next: License, current: License): boolean {
  return licenseRank(next) > licenseRank(current);
}

/**
 * What a license lets people outside the organization do. These are the
 * questions the app asks, so a feature checks a term rather than a license id.
 */
interface LicenseTerms {
  /** People outside the organization may look inside: listen to and read the work. */
  outsidersMayView: boolean;
  /** They may make something new from it (adapt, translate from it, re-record it). */
  mayAdapt: boolean;
  /** They may use it commercially. */
  mayCommercial: boolean;
  /** What they make from it must be shared under the same license. */
  shareAlike: boolean;
  /** They must credit the organization. */
  attribution: boolean;
}

interface LicenseInfo {
  license: License;
  /** The license's usual name. */
  name: string;
  /** A few words: what kind of sharing it is. */
  short: string;
  /** One or two plain sentences on what it allows, written for someone who has never heard of copyright licenses. */
  means: string;
  terms: LicenseTerms;
  /** The license text, for those who want it. */
  url: string | null;
}

const closed: LicenseTerms = { outsidersMayView: false, mayAdapt: false, mayCommercial: false, shareAlike: false, attribution: false };

export const LICENSE_INFO: Record<License, LicenseInfo> = {
  'all-rights-reserved': {
    license: 'all-rights-reserved', name: 'All rights reserved', short: 'Only your organization',
    means: 'Only your members can see and use your work. Nobody else may copy or share it.',
    terms: closed, url: null
  },
  'CC-BY-NC-ND-4.0': {
    license: 'CC-BY-NC-ND-4.0', name: 'CC BY-NC-ND 4.0', short: 'Share unchanged, not for sale',
    means: 'Anyone may see and pass on your work as it is, if they credit you. They may not change it or sell it.',
    terms: { outsidersMayView: true, mayAdapt: false, mayCommercial: false, shareAlike: false, attribution: true },
    url: 'https://creativecommons.org/licenses/by-nc-nd/4.0/'
  },
  'CC-BY-NC-SA-4.0': {
    license: 'CC-BY-NC-SA-4.0', name: 'CC BY-NC-SA 4.0', short: 'Share and adapt, not for sale',
    means: 'Anyone may see, pass on and adapt your work, if they credit you and share what they make the same way. They may not sell it.',
    terms: { outsidersMayView: true, mayAdapt: true, mayCommercial: false, shareAlike: true, attribution: true },
    url: 'https://creativecommons.org/licenses/by-nc-sa/4.0/'
  },
  'CC-BY-SA-4.0': {
    license: 'CC-BY-SA-4.0', name: 'CC BY-SA 4.0', short: 'Share and adapt, same terms',
    means: 'Anyone may use, adapt and even sell your work, if they credit you and share what they make the same way.',
    terms: { outsidersMayView: true, mayAdapt: true, mayCommercial: true, shareAlike: true, attribution: true },
    url: 'https://creativecommons.org/licenses/by-sa/4.0/'
  },
  'CC-BY-4.0': {
    license: 'CC-BY-4.0', name: 'CC BY 4.0', short: 'Any use, with credit',
    means: 'Anyone may use, adapt and sell your work for any purpose, as long as they credit you.',
    terms: { outsidersMayView: true, mayAdapt: true, mayCommercial: true, shareAlike: false, attribution: true },
    url: 'https://creativecommons.org/licenses/by/4.0/'
  },
  'CC0-1.0': {
    license: 'CC0-1.0', name: 'CC0 (public domain)', short: 'No conditions',
    means: 'You give up your rights. Anyone may use your work for anything, without asking or crediting you.',
    terms: { outsidersMayView: true, mayAdapt: true, mayCommercial: true, shareAlike: false, attribution: false },
    url: 'https://creativecommons.org/publicdomain/zero/1.0/'
  }
};

/** Licenses someone may move to from `current`: itself and everything more open, in ladder order. */
export function licenseChoices(current: License): { info: LicenseInfo; available: boolean; current: boolean }[] {
  return LICENSES.map((l) => ({ info: LICENSE_INFO[l], available: licenseRank(l) >= licenseRank(current), current: l === current }));
}
