// The other languages' catalogs, loaded only when someone picks one: Metro
// bundles them all, but a `require` inside a function runs only when called,
// so a phone showing English never builds the others in memory.
import type { UiLanguage } from './languages';

export function loadCatalog(code: Exclude<UiLanguage, 'en'>): object {
  switch (code) {
    case 'es': return require('./es.json');
    case 'pt': return require('./pt.json');
    case 'fr': return require('./fr.json');
    case 'ar': return require('./ar.json');
    case 'sw': return require('./sw.json');
    case 'ha': return require('./ha.json');
    case 'am': return require('./am.json');
    case 'hi': return require('./hi.json');
    case 'bn': return require('./bn.json');
    case 'ne': return require('./ne.json');
    case 'id': return require('./id.json');
    case 'zh-Hans': return require('./zh-Hans.json');
    case 'th': return require('./th.json');
    case 'my': return require('./my.json');
  }
}
