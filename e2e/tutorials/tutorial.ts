// What a tutorial video is made of (the plan: "Tutorial videos: what to make
// and how to keep them current"): the made-up world it is filmed in, who is
// signed in, and its steps. Each step names the screen it is on, the part of
// the screen it lights (as help mode lights a part), what the voice says, and
// what the finger does. film.ts plays the steps against the web export.
import type { Locator, Page } from 'playwright';
import type { AccountKey, LanguageKey, UiWorld, WorldNames } from '../ui/fixture';

export interface Step {
  /** The app's screen, by its id in apps/mobile/src/shell/flow.ts. */
  screen: string;
  /** The part of the screen to light: one locator, or several lit as one box. The light follows them if they move. */
  part?: (page: Page) => Locator | Locator[];
  /** What the voice says. Where it comes from a help line, `help` names the line. */
  say?: string;
  /** The help line (catalog key in apps/mobile/src/i18n/en.json) that the words follow. */
  help?: string;
  /** Wait until the speaker's last recording has played this many seconds (a step said while they speak). */
  atSpeech?: number;
  /** The finger taps the lit part. */
  tap?: boolean;
  /** Where on the part the finger lands or starts a drag, when not its middle; `box` is the part as it shows, cut by the screen and what holds it. */
  tapAt?: (box: Box) => { x: number; y: number };
  /** The finger presses the lit part and holds it until this shows. */
  press?: (page: Page) => Locator;
  /** The finger drags the lit part: by so many points, or onto another part's place. */
  drag?: { by: { x: number; y: number } } | { to: (page: Page) => Locator };
  /** The finger taps the lit part, then types these words into it, a key at a time. */
  type?: string | ((world: UiWorld) => string);
  /** What is typed takes the place of what the box had. */
  replace?: boolean;
  /** The finger taps the lit part, then pastes these words into it at once (a link). */
  paste?: string | ((world: UiWorld) => string);
  /** Off camera, before the step: what changes around the phone (the internet goes, a teammate does something). */
  first?: (page: Page) => Promise<unknown>;
  /** The speaker starts saying their recording number n (in `speech`) into the microphone after the finger's action. */
  speak?: number;
  /** Wait until the screen shows what the step leads to. */
  until?: (page: Page) => Promise<unknown>;
  /** Seconds to stay on the result before the next step. */
  stay?: number;
  /** After the step, a wait the video leaves out (the server building something): it cuts to what the wait led to. */
  offCamera?: (page: Page) => Promise<unknown>;
}

export interface Box { x: number; y: number; width: number; height: number }

/** The microphone, off camera: says the speaker's recording number n and resolves once it has played to the end. */
export interface Mic { say(n: number): Promise<void> }

export interface Tutorial {
  id: string;
  title: string;
  /** Who is signed in, from the UI tests' world. */
  as: AccountKey;
  /** The language the app opens in (A, the world's first, when not said). */
  language?: LanguageKey;
  /** App languages the video is not made in (it shows switching to that language). */
  notIn?: string[];
  /** Nobody is signed in when the app opens: the video signs in, or makes an account. */
  signedOut?: boolean;
  /** The window, when it is not a phone's (430 by 932): a computer's, for what is done on the web. */
  viewport?: { width: number; height: number };
  names: WorldNames;
  /** The speaker's recordings that the microphone hears (WAV files in TUTORIAL_SPEECH). */
  speech?: string[];
  /** What is added to the world before the app opens (a guide, a Bible). */
  prepare?: (world: UiWorld) => Promise<void>;
  /** What happens off camera before filming starts: the work that the video starts from. */
  before?: (page: Page, mic: Mic, world: UiWorld) => Promise<void>;
  steps: Step[];
}
