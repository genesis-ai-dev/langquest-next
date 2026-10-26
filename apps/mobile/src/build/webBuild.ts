/**
 * The web build's id (the commit it was built from), set by
 * `npm run export:web` and written to `/version.json` beside the page; empty
 * in development. Phones identify their build through expo-updates instead.
 */
export const BUILD_ID: string = process.env.EXPO_PUBLIC_BUILD_ID ?? '';
