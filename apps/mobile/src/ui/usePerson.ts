// A person's name and picture, for the chip (ui/UserChip.tsx).
import { createContext, useContext } from 'react';
import { personLook, type PersonLook } from './people';

/** profileId -> display name. Provided once per workspace (App.tsx). */
export const PeopleContext = createContext<Record<string, string>>({});

export function usePerson(): (id: string) => PersonLook {
  const names = useContext(PeopleContext);
  return (id) => personLook(id, names[id]);
}
