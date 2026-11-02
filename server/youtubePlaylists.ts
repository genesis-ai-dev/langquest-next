import type { ChannelLanguage } from './youtube';

/**
 * The tutorial videos' playlists on YouTube, one for each group of people
 * the videos are for (e2e/tutorials/all.ts GROUPS), by app language: the
 * nightly filming names each film's playlist (e2e/tutorials/playlists.ts),
 * and the publish job lays out each channel's home page with them
 * (youtube.ts `setHome`). Machine translations, like the app's catalogs
 * (decisions.md 81).
 */

/** Who a group of videos is for (e2e/tutorials/all.ts GROUPS). */
export type Who = 'everyone' | 'admins' | 'leads' | 'translators' | 'reviewers' | 'followers';

/** Each group's playlist title, by app language. */
export const PLAYLISTS: Record<ChannelLanguage, Record<Who, string>> = {
  en: {
    everyone: 'Everyone', admins: 'Organization heads and admins', leads: 'Team coordinators and language leads',
    translators: 'Translators', reviewers: 'Reviewers and consultants', followers: 'Followers, partners and staff'
  },
  es: {
    everyone: 'Todos', admins: 'Responsables y administradores de la organización', leads: 'Coordinadores de equipo y líderes de idioma',
    translators: 'Traductores', reviewers: 'Revisores y consultores', followers: 'Seguidores, socios y personal'
  },
  pt: {
    everyone: 'Todos', admins: 'Responsáveis e administradores da organização', leads: 'Coordenadores de equipe e líderes de idioma',
    translators: 'Tradutores', reviewers: 'Revisores e consultores', followers: 'Seguidores, parceiros e equipe'
  },
  fr: {
    everyone: 'Tout le monde', admins: "Responsables et administrateurs de l'organisation", leads: "Coordinateurs d'équipe et responsables de langue",
    translators: 'Traducteurs', reviewers: 'Réviseurs et consultants', followers: 'Abonnés, partenaires et personnel'
  },
  ar: {
    everyone: 'الجميع', admins: 'رؤساء المنظمة والمشرفون', leads: 'منسقو الفرق وقادة اللغات',
    translators: 'المترجمون', reviewers: 'المراجعون والمستشارون', followers: 'المتابعون والشركاء والموظفون'
  },
  sw: {
    everyone: 'Kila mtu', admins: 'Viongozi na wasimamizi wa shirika', leads: 'Waratibu wa timu na viongozi wa lugha',
    translators: 'Watafsiri', reviewers: 'Wahakiki na washauri', followers: 'Wafuasi, washirika na wafanyakazi'
  },
  ha: {
    everyone: 'Kowa da kowa', admins: 'Shugabannin ƙungiya da masu gudanarwa', leads: 'Masu tsara ƙungiya da shugabannin harshe',
    translators: 'Masu fassara', reviewers: 'Masu bita da masu ba da shawara', followers: "Mabiya, abokan hulɗa da ma'aikata"
  },
  am: {
    everyone: 'ሁሉም', admins: 'የድርጅት ኃላፊዎች እና አስተዳዳሪዎች', leads: 'የቡድን አስተባባሪዎች እና የቋንቋ መሪዎች',
    translators: 'ተርጓሚዎች', reviewers: 'ገምጋሚዎች እና አማካሪዎች', followers: 'ተከታዮች፣ አጋሮች እና ሠራተኞች'
  },
  hi: {
    everyone: 'सभी', admins: 'संगठन प्रमुख और व्यवस्थापक', leads: 'टीम समन्वयक और भाषा प्रमुख',
    translators: 'अनुवादक', reviewers: 'समीक्षक और सलाहकार', followers: 'अनुयायी, साझेदार और कर्मचारी'
  },
  bn: {
    everyone: 'সবাই', admins: 'সংস্থার প্রধান ও প্রশাসক', leads: 'দলের সমন্বয়কারী ও ভাষা প্রধান',
    translators: 'অনুবাদক', reviewers: 'পর্যালোচক ও পরামর্শদাতা', followers: 'অনুসারী, অংশীদার ও কর্মী'
  },
  ne: {
    everyone: 'सबै', admins: 'संस्थाका प्रमुख र प्रशासकहरू', leads: 'टोली संयोजक र भाषा प्रमुखहरू',
    translators: 'अनुवादकहरू', reviewers: 'समीक्षक र परामर्शदाताहरू', followers: 'अनुयायी, साझेदार र कर्मचारीहरू'
  },
  id: {
    everyone: 'Semua orang', admins: 'Pimpinan dan admin organisasi', leads: 'Koordinator tim dan pemimpin bahasa',
    translators: 'Penerjemah', reviewers: 'Peninjau dan konsultan', followers: 'Pengikut, mitra, dan staf'
  },
  th: {
    everyone: 'ทุกคน', admins: 'หัวหน้าองค์กรและผู้ดูแลระบบ', leads: 'ผู้ประสานงานทีมและหัวหน้าภาษา',
    translators: 'นักแปล', reviewers: 'ผู้ตรวจทานและที่ปรึกษา', followers: 'ผู้ติดตาม พันธมิตร และเจ้าหน้าที่'
  },
  my: {
    everyone: 'လူတိုင်း', admins: 'အဖွဲ့အစည်း ခေါင်းဆောင်များနှင့် စီမံခန့်ခွဲသူများ', leads: 'အဖွဲ့ ညှိနှိုင်းရေးမှူးများနှင့် ဘာသာစကား ခေါင်းဆောင်များ',
    translators: 'ဘာသာပြန်သူများ', reviewers: 'ပြန်လည်သုံးသပ်သူများနှင့် အတိုင်ပင်ခံများ', followers: 'နောက်လိုက်များ၊ မိတ်ဖက်များနှင့် ဝန်ထမ်းများ'
  },
  'zh-Hans': {
    everyone: '所有人', admins: '组织负责人和管理员', leads: '团队协调员和语言负责人',
    translators: '译者', reviewers: '审阅者和顾问', followers: '关注者、合作伙伴和工作人员'
  }
};

/** The order of the playlists' rows on a channel's home page: everyone's first, then those who do the most of the work. */
export const HOME_ORDER: readonly Who[] = ['everyone', 'translators', 'reviewers', 'leads', 'admins', 'followers'];
