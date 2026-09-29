/**
 * Bible book icons ported from the LangQuest v2 repo (`assets/book-icons`).
 * They are monochrome masks, so a caller tints them to whatever colour the
 * surrounding row already uses instead of shipping a per-theme variant.
 *
 * Filenames are USFM codes; a few differ from our catalog ids (catalogData.ts),
 * which the map below reconciles.
 */
import type { ImageSourcePropType } from 'react-native';
import { Image } from 'react-native';
import { C } from './theme';

/* eslint-disable @typescript-eslint/no-require-imports */
const BOOK_ICONS: Record<string, ImageSourcePropType> = {
  gen: require('../assets/book-icons/gen.webp') as ImageSourcePropType,
  exo: require('../assets/book-icons/exo.webp') as ImageSourcePropType,
  lev: require('../assets/book-icons/lev.webp') as ImageSourcePropType,
  num: require('../assets/book-icons/num.webp') as ImageSourcePropType,
  deu: require('../assets/book-icons/deu.webp') as ImageSourcePropType,
  jos: require('../assets/book-icons/jos.webp') as ImageSourcePropType,
  jdg: require('../assets/book-icons/jdg.webp') as ImageSourcePropType,
  rut: require('../assets/book-icons/rut.webp') as ImageSourcePropType,
  '1sa': require('../assets/book-icons/1sa.webp') as ImageSourcePropType,
  '2sa': require('../assets/book-icons/2sa.webp') as ImageSourcePropType,
  '1ki': require('../assets/book-icons/1ki.webp') as ImageSourcePropType,
  '2ki': require('../assets/book-icons/2ki.webp') as ImageSourcePropType,
  '1ch': require('../assets/book-icons/1ch.webp') as ImageSourcePropType,
  '2ch': require('../assets/book-icons/2ch.webp') as ImageSourcePropType,
  ezr: require('../assets/book-icons/ezr.webp') as ImageSourcePropType,
  neh: require('../assets/book-icons/neh.webp') as ImageSourcePropType,
  est: require('../assets/book-icons/est.webp') as ImageSourcePropType,
  job: require('../assets/book-icons/job.webp') as ImageSourcePropType,
  psa: require('../assets/book-icons/psa.webp') as ImageSourcePropType,
  pro: require('../assets/book-icons/pro.webp') as ImageSourcePropType,
  ecc: require('../assets/book-icons/ecc.webp') as ImageSourcePropType,
  sng: require('../assets/book-icons/sng.webp') as ImageSourcePropType,
  isa: require('../assets/book-icons/isa.webp') as ImageSourcePropType,
  jer: require('../assets/book-icons/jer.webp') as ImageSourcePropType,
  lam: require('../assets/book-icons/lam.webp') as ImageSourcePropType,
  ezk: require('../assets/book-icons/ezk.webp') as ImageSourcePropType,
  dan: require('../assets/book-icons/dan.webp') as ImageSourcePropType,
  hos: require('../assets/book-icons/hos.webp') as ImageSourcePropType,
  joe: require('../assets/book-icons/jol.webp') as ImageSourcePropType,
  amo: require('../assets/book-icons/amo.webp') as ImageSourcePropType,
  oba: require('../assets/book-icons/oba.webp') as ImageSourcePropType,
  jon: require('../assets/book-icons/jon.webp') as ImageSourcePropType,
  mic: require('../assets/book-icons/mic.webp') as ImageSourcePropType,
  nah: require('../assets/book-icons/nam.webp') as ImageSourcePropType,
  hab: require('../assets/book-icons/hab.webp') as ImageSourcePropType,
  zep: require('../assets/book-icons/zep.webp') as ImageSourcePropType,
  hag: require('../assets/book-icons/hag.webp') as ImageSourcePropType,
  zec: require('../assets/book-icons/zec.webp') as ImageSourcePropType,
  mal: require('../assets/book-icons/mal.webp') as ImageSourcePropType,
  mat: require('../assets/book-icons/mat.webp') as ImageSourcePropType,
  mar: require('../assets/book-icons/mrk.webp') as ImageSourcePropType,
  luk: require('../assets/book-icons/luk.webp') as ImageSourcePropType,
  joh: require('../assets/book-icons/jhn.webp') as ImageSourcePropType,
  act: require('../assets/book-icons/act.webp') as ImageSourcePropType,
  rom: require('../assets/book-icons/rom.webp') as ImageSourcePropType,
  '1co': require('../assets/book-icons/1co.webp') as ImageSourcePropType,
  '2co': require('../assets/book-icons/2co.webp') as ImageSourcePropType,
  gal: require('../assets/book-icons/gal.webp') as ImageSourcePropType,
  eph: require('../assets/book-icons/eph.webp') as ImageSourcePropType,
  phi: require('../assets/book-icons/php.webp') as ImageSourcePropType,
  col: require('../assets/book-icons/col.webp') as ImageSourcePropType,
  '1th': require('../assets/book-icons/1th.webp') as ImageSourcePropType,
  '2th': require('../assets/book-icons/2th.webp') as ImageSourcePropType,
  '1ti': require('../assets/book-icons/1ti.webp') as ImageSourcePropType,
  '2ti': require('../assets/book-icons/2ti.webp') as ImageSourcePropType,
  tit: require('../assets/book-icons/tit.webp') as ImageSourcePropType,
  phm: require('../assets/book-icons/phm.webp') as ImageSourcePropType,
  heb: require('../assets/book-icons/heb.webp') as ImageSourcePropType,
  jas: require('../assets/book-icons/jas.webp') as ImageSourcePropType,
  '1pe': require('../assets/book-icons/1pe.webp') as ImageSourcePropType,
  '2pe': require('../assets/book-icons/2pe.webp') as ImageSourcePropType,
  '1jn': require('../assets/book-icons/1jn.webp') as ImageSourcePropType,
  '2jn': require('../assets/book-icons/2jn.webp') as ImageSourcePropType,
  '3jn': require('../assets/book-icons/3jn.webp') as ImageSourcePropType,
  jud: require('../assets/book-icons/jud.webp') as ImageSourcePropType,
  rev: require('../assets/book-icons/rev.webp') as ImageSourcePropType
};
/* eslint-enable @typescript-eslint/no-require-imports */

export function bookIcon(bookId: string): ImageSourcePropType | undefined {
  return BOOK_ICONS[bookId];
}

/** Book icon sized for a pui `Row`; renders nothing for a non-book unit. */
export function BookIcon(props: { bookId: string; size?: number; color?: string }) {
  const source = bookIcon(props.bookId);
  if (!source) return null;
  const size = props.size ?? 22;
  return (
    <Image
      source={source}
      style={{ width: size, height: size, tintColor: props.color ?? C.primary }}
      resizeMode="contain"
    />
  );
}
