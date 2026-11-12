// Whether the Bible's text shows the team's word after each key word (LAN-233,
// decisions.md 208): one choice for every passage, kept on the device and
// there after a restart, as the Bible chosen last is (sources/useSourceChoice.ts).
import { useChoice } from '../sources/useSourceChoice';

const KEY = 'key-words:ours-in-bible';

export function useOurWordsInBible(): [boolean, (on: boolean) => void] {
  const [chosen, choose] = useChoice(KEY);
  return [chosen === 'on', (on) => choose(on ? 'on' : 'off')];
}
