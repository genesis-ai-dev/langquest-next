import { useDisguise } from '../disguise/useDisguise';

/** None while the phone wears its disguise, since each would show LangQuest's name (decisions.md 171). */
export function useNotificationsOffered(): boolean {
  return useDisguise().look === null;
}
