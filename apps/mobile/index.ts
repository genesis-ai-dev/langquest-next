// The app's words are chosen first, so the first screen draws in the
// person's language (src/i18n/start.ts).
import './src/i18n/boot';

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
