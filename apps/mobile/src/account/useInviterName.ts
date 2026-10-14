import { useEffect, useState } from 'react';
import type { Ctx } from '../ctx';
import { noteExpected } from '../report';
import { accountSteward, profileName } from '../server/account';
import { useDisplayNames } from '../useAccount';

/**
 * Who invited this person: the one to ask on a new phone (decisions.md 59).
 * The invite in the organization log names them when this phone has it. The
 * steward row is that same person, and the account can read its own row
 * when the log's issuer has not arrived. A color-and-shape stand-in is not
 * a name, so the screen uses "the person who invited you" until a real one
 * is known. Who helped onto this device is a separate line (`readHelp`).
 */
export function useInviterName(ctx: Ctx): string | undefined {
  const me = ctx.session.actorId;
  const names = useDisplayNames(me);
  const managed = ctx.session.isManaged;
  const invite = Object.values(ctx.org.state?.invites ?? {}).find((i) => i.redeemedBy === me);
  const fromInvite = invite?.issuedBy && invite.issuedBy !== me ? invite.issuedBy : undefined;
  const [stewardId, setStewardId] = useState<string | undefined>();
  const [fetchedName, setFetchedName] = useState('');
  useEffect(() => {
    if (!managed || me === 'guest') return;
    let active = true;
    void (async () => {
      try {
        const { data, error } = await accountSteward(me);
        if (!active) return;
        if (error) { noteExpected('who invited you', error); return; }
        const id = typeof data?.steward_id === 'string' ? data.steward_id : '';
        if (id && id !== me) setStewardId(id);
      } catch (e) {
        if (active) noteExpected('who invited you', e);
      }
    })();
    return () => { active = false; };
  }, [managed, me]);
  const id = fromInvite ?? stewardId;
  const known = (id && names[id]?.trim()) || '';
  useEffect(() => {
    if (!id || known) return;
    let active = true;
    void (async () => {
      for (let attempt = 0; attempt < 4 && active; attempt++) {
        try {
          const { data, error } = await profileName(id);
          if (error) throw error;
          const name = typeof data?.display_name === 'string' ? data.display_name.trim() : '';
          if (name) { if (active) setFetchedName(name); return; }
        } catch (e) {
          if (attempt === 3 && active) noteExpected('inviter name', e);
        }
        await new Promise((done) => setTimeout(done, 300 * (attempt + 1)));
      }
    })();
    return () => { active = false; };
  }, [id, known]);
  return known || fetchedName || undefined;
}
