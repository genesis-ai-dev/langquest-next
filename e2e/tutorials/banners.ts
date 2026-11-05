// Each tutorial channel's banner (docs/tutorial-videos.md, server/youtube.ts
// brandChannel): the app's mark and name, white on black as in the stores
// (decisions.md 52), over "Tutorial videos" in the channel's language, all
// inside the middle 1235 × 338 that YouTube shows on every screen. Drawn by
// the browser, so every script is shaped as it should be; the PNGs are kept
// in the web app (apps/mobile/public/youtube), where the publish job reads them.
//
//   npx tsx e2e/tutorials/banners.ts
//
// Needs Noto Sans for each script and a Chinese font (WenQuanYi Zen Hei on Linux).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { UI_LANGUAGES } from '@langquest-next/core';
import { bannerPath, CHANNELS, WORDS, type ChannelLanguage } from '../../server/youtube';

const mark = readFileSync(path.join('apps', 'mobile', 'assets', 'icon.png')).toString('base64');
const FONTS = "'Noto Sans','Noto Sans Arabic','Noto Sans Myanmar','Noto Sans Ethiopic','Noto Sans Bengali','Noto Sans Devanagari','Noto Sans Thai','WenQuanYi Zen Hei','Noto Sans CJK SC',sans-serif";
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 2560, height: 1440 } });
for (const language of Object.keys(CHANNELS) as ChannelLanguage[]) {
  const dir = UI_LANGUAGES.find((l) => l.code === language)?.dir ?? 'ltr';
  await page.setContent(`<!doctype html><html lang="${language}" dir="${dir}"><body style="margin:0;width:2560px;height:1440px;background:#000;display:flex;align-items:center;justify-content:center;font-family:${FONTS}">
  <div style="display:flex;align-items:center;gap:40px;max-width:1235px;height:338px">
    <img src="data:image/png;base64,${mark}" style="width:300px;height:300px">
    <div style="color:#fff">
      <div dir="ltr" style="font-size:150px;font-weight:700;line-height:1.05;letter-spacing:-2px">LangQuest</div>
      <div style="font-size:64px;color:#bdbdbd;line-height:1.3">${escape(WORDS[language].tagline)}</div>
    </div>
  </div></body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join('apps', 'mobile', 'public', ...bannerPath(language).split('/').filter(Boolean)) });
}
await browser.close();
