/**
 * LangQuest's tutorial videos on YouTube (docs/tutorial-videos.md,
 * decisions.md 180): one channel per app language, each connected once from
 * the ops dashboard, and the calls that put a video on its channel. Plain
 * fetch, given in, so the app's Worker (Connect, apps/web/worker/opsActions.ts)
 * and the publish job (server/tutorialPublish.ts, Node) share it, and tests
 * answer by URL. Nothing here reads or writes the database.
 *
 * YouTube cannot swap a published video's file, so a new version is a new
 * video: it takes the old one's place in its playlist, and the old one is
 * unlisted with a line pointing to the new one, so its comments stay
 * readable (the plan's "What YouTube allows").
 */

/** Each app language's channel (Caleb made them on 2026-10-28; handles @LangQuestApp and @LangQuestApp-<code>). */
export const CHANNELS = {
  en: 'UC8Ry8oFIPWzDygngMwvkBLQ',
  es: 'UCpZYy6RO9gLD__QuUDVaEYg',
  pt: 'UC3fNrhsqaoobh4DlhXVOOng',
  fr: 'UCDdH4nGZOzkE4cAsk43qhog',
  ar: 'UCnCrrbjvsprh_mKVt-x6JvQ',
  sw: 'UCybnGwMt3PQNA0wLDNx32XQ',
  ha: 'UCQ_S7XCFJ9Tf1MNK1K1dK0A',
  am: 'UCwjdgIMi_JdDeygxSompRMQ',
  hi: 'UCI8rH6T2l9KM51QwCTqwrgw',
  bn: 'UCAE5sX0WK2ELy8YXyC7JkxA',
  ne: 'UCr2OQtO9OYtX_PtAqxMrM6g',
  id: 'UC-f8cdUejSCRyPhQHZ0hEhQ',
  th: 'UC2FEow8Ygqhjtsc2ypLmiMg',
  my: 'UCRkSFyWmZ9Ogr9Te3bpNMzA',
  'zh-Hans': 'UCMqJheVuxJt1Qwt9VWmj0Bg'
} as const;

export type ChannelLanguage = keyof typeof CHANNELS;

/** The app language a channel is for, or null when it is not one of LangQuest's. */
export function languageOfChannel(channelId: string): ChannelLanguage | null {
  return (Object.keys(CHANNELS) as ChannelLanguage[]).find((l) => CHANNELS[l] === channelId) ?? null;
}

/**
 * What LangQuest writes on YouTube itself, in each channel's language: the
 * list of the other channels on a channel's home page, the first line of a
 * video a newer one replaced, the line under the name on the channel's
 * banner (e2e/tutorials/banners.ts), the channel's description, and the
 * lines that lead to a video's download and to the page of all of them
 * (decisions.md 187). Machine translations, like the app's catalogs
 * (decisions.md 81).
 */
export const WORDS: Record<ChannelLanguage, { otherChannels: string; replacedBy: string; tagline: string; about: string; download: string; allVideos: string }> = {
  en: {
    otherChannels: 'Other LangQuest channels', replacedBy: 'Replaced by a newer video:', tagline: 'Tutorial videos',
    about: 'Short videos on how to use LangQuest, the free app for recording a Bible translation, checking it together and following its progress. One video for each task, kept up to date with the app.',
    download: 'Download this video:', allVideos: 'Watch or download every video:'
  },
  es: {
    otherChannels: 'Otros canales de LangQuest', replacedBy: 'Reemplazado por un video más nuevo:', tagline: 'Videotutoriales',
    about: 'Videos cortos sobre cómo usar LangQuest, la app gratuita para grabar una traducción de la Biblia, revisarla en equipo y seguir su avance. Un video para cada tarea, siempre al día con la app.',
    download: 'Descargar este video:', allVideos: 'Ver o descargar todos los videos:'
  },
  pt: {
    otherChannels: 'Outros canais do LangQuest', replacedBy: 'Substituído por um vídeo mais recente:', tagline: 'Vídeos tutoriais',
    about: 'Vídeos curtos sobre como usar o LangQuest, o app gratuito para gravar uma tradução da Bíblia, revisá-la em equipe e acompanhar o progresso. Um vídeo para cada tarefa, sempre atualizado com o app.',
    download: 'Baixar este vídeo:', allVideos: 'Assistir ou baixar todos os vídeos:'
  },
  fr: {
    otherChannels: 'Autres chaînes LangQuest', replacedBy: 'Remplacée par une vidéo plus récente :', tagline: 'Tutoriels vidéo',
    about: 'Courtes vidéos pour apprendre à utiliser LangQuest, l\'application gratuite pour enregistrer une traduction de la Bible, la vérifier ensemble et suivre son avancement. Une vidéo par tâche, toujours à jour avec l\'application.',
    download: 'Télécharger cette vidéo :', allVideos: 'Regarder ou télécharger toutes les vidéos :'
  },
  ar: {
    otherChannels: 'قنوات LangQuest الأخرى', replacedBy: 'حلّ محله فيديو أحدث:', tagline: 'فيديوهات تعليمية',
    about: 'فيديوهات قصيرة تشرح كيفية استخدام LangQuest، التطبيق المجاني لتسجيل ترجمة الكتاب المقدس ومراجعتها معًا ومتابعة تقدّمها. فيديو لكل مهمة، يُحدَّث دائمًا مع التطبيق.',
    download: 'تنزيل هذا الفيديو:', allVideos: 'شاهد أو نزّل كل الفيديوهات:'
  },
  sw: {
    otherChannels: 'Chaneli nyingine za LangQuest', replacedBy: 'Imebadilishwa na video mpya zaidi:', tagline: 'Video za mafunzo',
    about: 'Video fupi kuhusu jinsi ya kutumia LangQuest, programu ya bure ya kurekodi tafsiri ya Biblia, kuikagua pamoja na kufuatilia maendeleo yake. Video moja kwa kila kazi, inayosasishwa pamoja na programu.',
    download: 'Pakua video hii:', allVideos: 'Tazama au pakua video zote:'
  },
  ha: {
    otherChannels: 'Sauran tashoshin LangQuest', replacedBy: 'An maye gurbinsa da sabon bidiyo:', tagline: 'Bidiyoyin koyarwa',
    about: 'Gajerun bidiyoyi kan yadda ake amfani da LangQuest, manhaja kyauta don naɗar fassarar Littafi Mai Tsarki, duba ta tare da bin diddigin cigabanta. Bidiyo ɗaya ga kowane aiki, ana sabunta su tare da manhajar.',
    download: 'Sauke wannan bidiyon:', allVideos: 'Kalla ko sauke dukkan bidiyoyin:'
  },
  am: {
    otherChannels: 'ሌሎች የLangQuest ቻናሎች', replacedBy: 'በአዲስ ቪዲዮ ተተክቷል፦', tagline: 'የማስተማሪያ ቪዲዮዎች',
    about: 'LangQuestን እንዴት መጠቀም እንደሚቻል የሚያሳዩ አጫጭር ቪዲዮዎች። LangQuest የመጽሐፍ ቅዱስ ትርጉምን ለመቅዳት፣ በጋራ ለመገምገም እና ሂደቱን ለመከታተል የሚያገለግል ነፃ መተግበሪያ ነው። ለእያንዳንዱ ተግባር አንድ ቪዲዮ፣ ከመተግበሪያው ጋር ሁልጊዜ የተዘመነ።',
    download: 'ይህን ቪዲዮ ያውርዱ፦', allVideos: 'ሁሉንም ቪዲዮዎች ይመልከቱ ወይም ያውርዱ፦'
  },
  hi: {
    otherChannels: 'LangQuest के अन्य चैनल', replacedBy: 'इसकी जगह एक नया वीडियो आ गया है:', tagline: 'ट्यूटोरियल वीडियो',
    about: 'LangQuest इस्तेमाल करने के छोटे वीडियो। LangQuest बाइबल अनुवाद रिकॉर्ड करने, उसे मिलकर जाँचने और उसकी प्रगति देखने का मुफ़्त ऐप है। हर काम के लिए एक वीडियो, जो ऐप के साथ हमेशा अपडेट रहता है।',
    download: 'यह वीडियो डाउनलोड करें:', allVideos: 'सभी वीडियो देखें या डाउनलोड करें:'
  },
  bn: {
    otherChannels: 'LangQuest-এর অন্যান্য চ্যানেল', replacedBy: 'এর জায়গায় একটি নতুন ভিডিও এসেছে:', tagline: 'টিউটোরিয়াল ভিডিও',
    about: 'LangQuest কীভাবে ব্যবহার করতে হয় তার ছোট ভিডিও। LangQuest হলো বাইবেল অনুবাদ রেকর্ড করা, একসাথে যাচাই করা এবং তার অগ্রগতি দেখার একটি বিনামূল্যের অ্যাপ। প্রতিটি কাজের জন্য একটি ভিডিও, অ্যাপের সাথে সবসময় হালনাগাদ।',
    download: 'এই ভিডিওটি ডাউনলোড করুন:', allVideos: 'সব ভিডিও দেখুন বা ডাউনলোড করুন:'
  },
  ne: {
    otherChannels: 'LangQuest का अन्य च्यानलहरू', replacedBy: 'यसको सट्टा नयाँ भिडियो आएको छ:', tagline: 'ट्युटोरियल भिडियोहरू',
    about: 'LangQuest कसरी प्रयोग गर्ने भन्ने छोटा भिडियोहरू। LangQuest बाइबल अनुवाद रेकर्ड गर्न, सँगै जाँच गर्न र यसको प्रगति हेर्न प्रयोग हुने निःशुल्क एप हो। हरेक कामका लागि एउटा भिडियो, एपसँगै सधैं अद्यावधिक।',
    download: 'यो भिडियो डाउनलोड गर्नुहोस्:', allVideos: 'सबै भिडियोहरू हेर्नुहोस् वा डाउनलोड गर्नुहोस्:'
  },
  id: {
    otherChannels: 'Saluran LangQuest lainnya', replacedBy: 'Diganti dengan video yang lebih baru:', tagline: 'Video tutorial',
    about: 'Video singkat tentang cara memakai LangQuest, aplikasi gratis untuk merekam terjemahan Alkitab, memeriksanya bersama, dan mengikuti kemajuannya. Satu video untuk setiap tugas, selalu diperbarui bersama aplikasinya.',
    download: 'Unduh video ini:', allVideos: 'Tonton atau unduh semua video:'
  },
  th: {
    otherChannels: 'ช่อง LangQuest อื่นๆ', replacedBy: 'มีวิดีโอใหม่มาแทนแล้ว:', tagline: 'วิดีโอสอนการใช้งาน',
    about: 'วิดีโอสั้นสอนการใช้ LangQuest แอปฟรีสำหรับบันทึกเสียงงานแปลพระคัมภีร์ ตรวจทานร่วมกัน และติดตามความคืบหน้า หนึ่งวิดีโอต่อหนึ่งงาน อัปเดตตามแอปเสมอ',
    download: 'ดาวน์โหลดวิดีโอนี้:', allVideos: 'ดูหรือดาวน์โหลดวิดีโอทั้งหมด:'
  },
  my: {
    otherChannels: 'အခြား LangQuest ချန်နယ်များ', replacedBy: 'ဗီဒီယိုအသစ်ဖြင့် အစားထိုးထားသည်-', tagline: 'သင်ခန်းစာ ဗီဒီယိုများ',
    about: 'LangQuest ကို အသုံးပြုနည်း ဗီဒီယိုတိုများ။ LangQuest သည် သမ္မာကျမ်းစာ ဘာသာပြန်ကို အသံသွင်းရန်၊ အတူတကွ စစ်ဆေးရန်နှင့် တိုးတက်မှုကို ကြည့်ရှုရန် အခမဲ့ အက်ပ်ဖြစ်သည်။ လုပ်ငန်းတစ်ခုစီအတွက် ဗီဒီယိုတစ်ခု၊ အက်ပ်နှင့်အတူ အမြဲ နောက်ဆုံးအခြေအနေ။',
    download: 'ဤဗီဒီယိုကို ဒေါင်းလုဒ်လုပ်ရန်-', allVideos: 'ဗီဒီယိုအားလုံးကို ကြည့်ရန် သို့မဟုတ် ဒေါင်းလုဒ်လုပ်ရန်-'
  },
  'zh-Hans': {
    otherChannels: '其他 LangQuest 频道', replacedBy: '已由新视频取代：', tagline: '教程视频',
    about: 'LangQuest 使用教程短视频。LangQuest 是一款免费应用，用于录制圣经译文、一起审核并跟进进度。每项任务一个视频，随应用一同更新。',
    download: '下载本视频：', allVideos: '观看或下载全部视频：'
  }
};

/**
 * What Connect asks Google for: to upload, and to manage what was uploaded
 * (playlists, the old version's line, the channel's list of the others).
 */
export const SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.force-ssl'];

/** Where Google sends the person back (the OAuth client's redirect address, docs/tutorial-videos.md). */
export const CALLBACK_PATH = '/ops/api/youtube/callback';

/** How long a Connect may take, from the press to Google sending the person back. */
export const STATE_MS = 15 * 60_000;

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface Client { clientId: string; clientSecret: string }

/** A call YouTube or Google refused: its status and YouTube's reason (`quotaExceeded`, `uploadLimitExceeded`, `forbidden`). */
export class YouTubeError extends Error {
  constructor(readonly status: number, readonly reason: string) {
    super(`YouTube ${status} ${reason}`);
    this.name = 'YouTubeError';
  }
  /** For a job run's error class: a fixed code, never YouTube's message. */
  get code(): string { return `youtube_${this.reason.replace(/[^A-Za-z0-9_]/g, '').slice(0, 60) || this.status}`; }
}

/** Out of the project's units for today: nothing more is done until midnight Pacific. */
export const outOfQuota = (e: unknown) => e instanceof YouTubeError && /quota|rateLimit/i.test(e.reason);

/**
 * The channel has put up as many videos as YouTube lets it in a day (its own
 * limit, lower for a new channel, counted over the last 24 hours): only that
 * channel waits, the others go on.
 */
export const channelFull = (e: unknown) => e instanceof YouTubeError && e.reason === 'uploadLimitExceeded';

async function answer<T>(response: Response): Promise<T> {
  if (response.ok) return (response.status === 204 ? undefined : await response.json()) as T;
  const body = (await response.json().catch(() => null)) as { error?: string | { errors?: { reason?: string }[]; status?: string } } | null;
  const error = body?.error;
  const reason = typeof error === 'string' ? error : error?.errors?.[0]?.reason ?? error?.status ?? 'unknown';
  throw new YouTubeError(response.status, reason);
}

const API = 'https://www.googleapis.com/youtube/v3';
const json = (token: string) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=UTF-8' });

// ---- Connect -------------------------------------------------------------------------------------

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const text = new TextEncoder();

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', text.encode(`youtube-connect\n${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, text.encode(message))));
}

/**
 * The `state` a Connect carries through Google: who pressed it and until
 * when, signed with the OAuth client's secret, so the answer is taken only
 * from the person who asked, within STATE_MS, and nothing is stored meanwhile.
 */
export async function signState(secret: string, profileId: string, now: number): Promise<string> {
  const message = `${profileId}.${now + STATE_MS}`;
  return `${message}.${await hmac(secret, message)}`;
}

/** The profile a state was signed for, or null when it is forged, garbled or late. */
export async function readState(secret: string, state: string, now: number): Promise<string | null> {
  const m = /^([0-9a-f-]{36})\.(\d{13})\.([A-Za-z0-9_-]{43})$/.exec(state);
  if (!m || Number(m[2]) < now) return null;
  const expected = await hmac(secret, `${m[1]}.${m[2]}`);
  // Compared whole and at the same pace whatever the first difference.
  let diff = expected.length ^ m[3]!.length;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ (m[3]!.charCodeAt(i) || 0);
  return diff === 0 ? m[1]! : null;
}

/** Google's page that asks which channel and whether to allow. `prompt=consent` makes Google give a refresh token every time. */
export function consentUrl(client: Client, redirectUri: string, state: string): string {
  const q = new URLSearchParams({
    client_id: client.clientId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPES.join(' '),
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

/** The code Google sent back, traded for the channel's refresh token. */
export async function exchangeCode(fetcher: Fetch, client: Client, redirectUri: string, code: string): Promise<{ refreshToken: string; accessToken: string }> {
  const got = await answer<{ refresh_token?: string; access_token: string }>(await fetcher('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: client.clientId, client_secret: client.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }).toString()
  }));
  if (!got.refresh_token) throw new YouTubeError(400, 'no_refresh_token');
  return { refreshToken: got.refresh_token, accessToken: got.access_token };
}

/** An hour's access from a channel's refresh token. A token Google took back answers `invalid_grant`: connect that channel again. */
export async function accessToken(fetcher: Fetch, client: Client, refreshToken: string): Promise<string> {
  const got = await answer<{ access_token: string }>(await fetcher('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ refresh_token: refreshToken, client_id: client.clientId, client_secret: client.clientSecret, grant_type: 'refresh_token' }).toString()
  }));
  return got.access_token;
}

/** The channel the person chose on Google's page. */
export async function myChannel(fetcher: Fetch, token: string): Promise<{ id: string; title: string }> {
  const got = await answer<{ items?: { id: string; snippet: { title: string } }[] }>(await fetcher(`${API}/channels?part=snippet&mine=true`, { headers: json(token) }));
  const channel = got.items?.[0];
  if (!channel) throw new YouTubeError(404, 'no_channel');
  return { id: channel.id, title: channel.snippet.title };
}

/** A token given for a channel that is not one of LangQuest's, handed back so Google forgets it. */
export async function revoke(fetcher: Fetch, token: string): Promise<void> {
  await fetcher('https://oauth2.googleapis.com/revoke', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }).toString()
  });
}

/**
 * "Other LangQuest channels" on a channel's home page, as BibleProject's
 * channels list theirs: a section of the other 14, made once and brought up
 * to date on each Connect. 50 or 51 units of the day's 10,000.
 */
export async function setOtherChannels(fetcher: Fetch, token: string, language: ChannelLanguage): Promise<'made' | 'updated'> {
  const title = WORDS[language].otherChannels;
  const channels = (Object.keys(CHANNELS) as ChannelLanguage[]).filter((l) => l !== language).map((l) => CHANNELS[l]);
  const have = await answer<{ items?: { id: string; snippet: { type: string; title?: string } }[] }>(
    await fetcher(`${API}/channelSections?part=snippet&mine=true`, { headers: json(token) }));
  const mine = have.items?.find((s) => s.snippet.type === 'multipleChannels' && s.snippet.title === title);
  const body = { ...(mine ? { id: mine.id } : {}), snippet: { type: 'multipleChannels', title }, contentDetails: { channels } };
  await answer(await fetcher(`${API}/channelSections?part=snippet,contentDetails`, { method: mine ? 'PUT' : 'POST', headers: json(token), body: JSON.stringify(body) }));
  return mine ? 'updated' : 'made';
}

// ---- The channel itself ---------------------------------------------------------------------------

/** The app, which opens on the web too. */
export const APP_LINK = 'https://next.langquest.org';

/** The page of a language's videos, each to watch or download (apps/web/worker/videosPage.ts, decisions.md 187). */
export const videosPath = (language: string) => `/videos?lang=${language}`;

/** A video's newest chosen version as a file to keep, by a link that lasts (apps/web/worker/tutorialVideos.ts `handleDownload`). */
export const downloadLink = (language: string, tutorial: string) => `${APP_LINK}/v/${language}/${tutorial}.mp4`;

/** A channel's description: what its videos are, where to download them, and where the app is. YouTube takes 1,000 characters. */
export const channelAbout = (language: ChannelLanguage) =>
  `${WORDS[language].about}\n\n${WORDS[language].allVideos} ${APP_LINK}${videosPath(language)}\nLangQuest: ${APP_LINK}`;

/** Where the publish job finds a channel's banner: the web app's file (apps/mobile/public/youtube, made by e2e/tutorials/banners.ts). */
export const bannerPath = (language: ChannelLanguage) => `/youtube/${language}.png`;

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * How a channel should look, as one hash: its description, its language, its
 * banner's bytes and its list of the others. The database keeps the last one
 * put on the channel, so a channel is changed again only when one of them is.
 */
export async function brandOf(language: ChannelLanguage, banner: Uint8Array<ArrayBuffer>): Promise<string> {
  const what = JSON.stringify([language, channelAbout(language), WORDS[language].otherChannels, hex(await crypto.subtle.digest('SHA-256', banner))]);
  return hex(await crypto.subtle.digest('SHA-256', text.encode(what)));
}

/**
 * A channel made to look like LangQuest's in its own language: its
 * description, its language (so YouTube shows it to people who read that
 * language), its banner (the app's mark on black with "Tutorial videos"), and
 * the list of the other channels. About 150 of the day's 10,000 units. A
 * token for any other channel than the language's is refused. The channel's
 * picture cannot be set this way (docs/admin.md).
 */
export async function brandChannel(fetcher: Fetch, token: string, language: ChannelLanguage, banner: Uint8Array<ArrayBuffer>): Promise<void> {
  const got = await answer<{ items?: { id: string; brandingSettings?: { channel?: Record<string, unknown> } }[] }>(
    await fetcher(`${API}/channels?part=brandingSettings&mine=true`, { headers: json(token) }));
  const channel = got.items?.[0];
  if (!channel) throw new YouTubeError(404, 'no_channel');
  if (channel.id !== CHANNELS[language]) throw new YouTubeError(409, 'wrong_channel');
  const uploaded = await answer<{ url: string }>(await fetcher('https://www.googleapis.com/upload/youtube/v3/channelBanners/insert?uploadType=media', {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'image/png' }, body: banner
  }));
  // The channel's other settings (its keywords, its country) are sent back as they were, since an update
  // replaces them all; its name is left out, which only Google's account pages change.
  const kept = { ...channel.brandingSettings?.channel };
  delete kept['title'];
  delete kept['defaultLanguage'];
  const put = (settings: Record<string, unknown>) => fetcher(`${API}/channels?part=brandingSettings`, {
    method: 'PUT', headers: json(token),
    body: JSON.stringify({ id: channel.id, brandingSettings: { channel: settings, image: { bannerExternalUrl: uploaded.url } } })
  });
  const settings = { ...kept, description: channelAbout(language) };
  try {
    await answer(await put({ ...settings, defaultLanguage: language }));
  } catch (e) {
    // YouTube refused Hausa's channel (brandingValidationError, 2026-10-29), and a language it does not
    // offer is the likeliest cause: the description and banner go on without saying the language.
    if (!(e instanceof YouTubeError && e.reason === 'brandingValidationError')) throw e;
    await answer(await put(settings));
  }
  await setOtherChannels(fetcher, token, language);
}

/** At most this many held comments are counted on a channel; more read as this many. */
export const HELD_MAX = 500;

/**
 * How many comments on the channel's videos YouTube holds for a person to
 * approve or remove (Studio's "Held for review"; the channels hold what may
 * be inappropriate, docs/admin.md). A unit for each 100 counted.
 */
export async function heldComments(fetcher: Fetch, token: string, channelId: string): Promise<number> {
  let held = 0;
  let page = '';
  do {
    const q = new URLSearchParams({ part: 'id', allThreadsRelatedToChannelId: channelId, moderationStatus: 'heldForReview', maxResults: '100', ...(page ? { pageToken: page } : {}) });
    const got = await answer<{ items?: unknown[]; nextPageToken?: string }>(await fetcher(`${API}/commentThreads?${q}`, { headers: json(token) }));
    held += got.items?.length ?? 0;
    page = got.nextPageToken ?? '';
  } while (page && held < HELD_MAX);
  return Math.min(held, HELD_MAX);
}

/** A comment someone left on one of a channel's videos, as the comments job reads it (server/tutorialCommentsModel.ts). */
export interface VideoComment {
  /** The thread's id, which is its first comment's. */
  id: string;
  /** The video it is on; null for one left on the channel itself. */
  videoId: string | null;
  /** The words as YouTube shows them, in plain text; never who wrote them. */
  text: string;
  publishedAt: string;
  /** Replies under it so far, the channel's own among them. */
  replies: number;
}

/** At most this many comments are read from a channel in a run, newest first. */
export const COMMENTS_MAX = 500;

/**
 * The comments people can see on the channel's videos (not those held for
 * review), newest first, until one `known` says was read before or one
 * older than `since`: so a run reads only what came since the last, and
 * nothing the job no longer keeps. The channel's own are left out. A unit
 * for each 100 read.
 */
export async function newComments(fetcher: Fetch, token: string, channelId: string, known: (ids: string[]) => Promise<Set<string>>, since: string): Promise<VideoComment[]> {
  type Thread = { id: string; snippet?: { videoId?: string; totalReplyCount?: number; topLevelComment?: { snippet?: {
    textDisplay?: string; publishedAt?: string; authorChannelId?: { value?: string } } } } };
  const out: VideoComment[] = [];
  let page = '';
  do {
    const q = new URLSearchParams({ part: 'snippet', allThreadsRelatedToChannelId: channelId, order: 'time', textFormat: 'plainText', maxResults: '100', ...(page ? { pageToken: page } : {}) });
    const got = await answer<{ items?: Thread[]; nextPageToken?: string }>(await fetcher(`${API}/commentThreads?${q}`, { headers: json(token) }));
    const items = got.items ?? [];
    const seen = await known(items.map((t) => t.id));
    for (const t of items) {
      const c = t.snippet?.topLevelComment?.snippet;
      if (seen.has(t.id) || (c?.publishedAt && c.publishedAt < since)) return out;
      if (!c?.textDisplay?.trim() || !c.publishedAt || c.authorChannelId?.value === channelId) continue;
      out.push({ id: t.id, videoId: t.snippet?.videoId ?? null, text: c.textDisplay.trim(), publishedAt: c.publishedAt, replies: t.snippet?.totalReplyCount ?? 0 });
      if (out.length >= COMMENTS_MAX) return out;
    }
    page = got.nextPageToken ?? '';
  } while (page);
  return out;
}

// ---- Publish -------------------------------------------------------------------------------------

export interface NewVideo {
  title: string;
  description: string;
  language: ChannelLanguage;
  /** The MP4: its bytes as they arrive, and how many there are. */
  file: { body: ReadableStream<Uint8Array> | Uint8Array; bytes: number };
  /** A new version of a video already up: its subscribers were told about the first. */
  replacing: boolean;
}

/**
 * Uploads a video, public, as made for everyone and not for kids (so it can
 * take comments), with YouTube's "altered or synthetic content" set because
 * the voice is a computer's. Answers its id.
 */
export async function uploadVideo(fetcher: Fetch, token: string, video: NewVideo): Promise<string> {
  const q = new URLSearchParams({ uploadType: 'resumable', part: 'snippet,status', notifySubscribers: String(!video.replacing) });
  const start = await fetcher(`https://www.googleapis.com/upload/youtube/v3/videos?${q}`, {
    method: 'POST',
    headers: { ...json(token), 'x-upload-content-type': 'video/mp4', 'x-upload-content-length': String(video.file.bytes) },
    body: JSON.stringify({
      snippet: { title: video.title, description: video.description, categoryId: '27', defaultLanguage: video.language, defaultAudioLanguage: video.language },
      status: { privacyStatus: 'public', selfDeclaredMadeForKids: false, containsSyntheticMedia: true, embeddable: true, license: 'youtube' }
    })
  });
  if (!start.ok) await answer(start);
  const session = start.headers.get('location');
  if (!session) throw new YouTubeError(start.status, 'no_upload_session');
  // Node's fetch sends a stream only when told it goes one way.
  const done = await answer<{ id: string }>(await fetcher(session, {
    method: 'PUT', headers: { 'content-type': 'video/mp4', 'content-length': String(video.file.bytes) }, body: video.file.body, duplex: 'half'
  } as RequestInit));
  return done.id;
}

/** The channel's playlist with this title, made when there is none. */
export async function playlistFor(fetcher: Fetch, token: string, title: string, language: ChannelLanguage): Promise<string> {
  let page = '';
  do {
    const got = await answer<{ items?: { id: string; snippet: { title: string } }[]; nextPageToken?: string }>(
      await fetcher(`${API}/playlists?part=snippet&mine=true&maxResults=50${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`, { headers: json(token) }));
    const found = got.items?.find((p) => p.snippet.title === title);
    if (found) return found.id;
    page = got.nextPageToken ?? '';
  } while (page);
  const made = await answer<{ id: string }>(await fetcher(`${API}/playlists?part=snippet,status`, {
    method: 'POST', headers: json(token),
    body: JSON.stringify({ snippet: { title, defaultLanguage: language }, status: { privacyStatus: 'public' } })
  }));
  return made.id;
}

/**
 * Puts a video in its playlist: in the old version's place when it replaces
 * one there (the old one's entry goes), at the end otherwise.
 */
export async function placeInPlaylist(fetcher: Fetch, token: string, playlistId: string, videoId: string, replacing?: string): Promise<void> {
  let old: { id: string; snippet: { position: number } } | undefined;
  if (replacing) {
    const got = await answer<{ items?: { id: string; snippet: { position: number } }[] }>(
      await fetcher(`${API}/playlistItems?part=snippet&playlistId=${encodeURIComponent(playlistId)}&videoId=${encodeURIComponent(replacing)}`, { headers: json(token) }));
    old = got.items?.[0];
  }
  await answer(await fetcher(`${API}/playlistItems?part=snippet`, {
    method: 'POST', headers: json(token),
    body: JSON.stringify({ snippet: { playlistId, resourceId: { kind: 'youtube#video', videoId }, ...(old ? { position: old.snippet.position } : {}) } })
  }));
  if (old) await answer(await fetcher(`${API}/playlistItems?id=${encodeURIComponent(old.id)}`, { method: 'DELETE', headers: json(token) }));
}

/**
 * The old version, once the new one is up: unlisted, so it leaves search and
 * the channel's page but its link and comments still work, with a first line
 * pointing to the new one. A video already gone is left alone.
 */
export async function retire(fetcher: Fetch, token: string, oldId: string, newId: string, language: ChannelLanguage): Promise<'unlisted' | 'gone'> {
  const got = await answer<{ items?: { id: string; snippet: Record<string, unknown> & { description?: string }; status: Record<string, unknown> }[] }>(
    await fetcher(`${API}/videos?part=snippet,status&id=${encodeURIComponent(oldId)}`, { headers: json(token) }));
  const video = got.items?.[0];
  if (!video) return 'gone';
  const line = `${WORDS[language].replacedBy} https://youtu.be/${newId}`;
  const description = (video.snippet.description ?? '').startsWith(WORDS[language].replacedBy) ? (video.snippet.description ?? '').replace(/^[^\n]*/, line) : `${line}\n\n${video.snippet.description ?? ''}`;
  const { title, categoryId, defaultLanguage, defaultAudioLanguage, tags } = video.snippet;
  const { embeddable, license, publicStatsViewable, selfDeclaredMadeForKids, containsSyntheticMedia } = video.status;
  await answer(await fetcher(`${API}/videos?part=snippet,status`, {
    method: 'PUT', headers: json(token),
    body: JSON.stringify({
      id: oldId,
      snippet: { title, categoryId, defaultLanguage, defaultAudioLanguage, tags, description: description.slice(0, 5000) },
      status: { privacyStatus: 'unlisted', embeddable, license, publicStatsViewable, selfDeclaredMadeForKids, containsSyntheticMedia }
    })
  }));
  return 'unlisted';
}
