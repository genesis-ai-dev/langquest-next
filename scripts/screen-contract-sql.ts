/** Generate SQL that tests screen permissions against the real server rule. */
import { writeFileSync } from 'node:fs';
import { fold, privilegesOfFixedRole, privilegeFor, type Role } from '@langquest-next/core';
import { buildFixture } from '../packages/core/test/fixtures';
import { SCREEN_CONTRACTS, screenMayEmit } from '../apps/mobile/src/screenContracts';
import { SCREEN_IDS } from '../apps/mobile/src/flow';
import { deriveSession } from '../apps/mobile/src/session';
const sql = (value: unknown) => `'${JSON.stringify(value).replaceAll("'","''")}'::jsonb`;
const fixture=buildFixture();
const state=fold(fixture);
const rows: unknown[]=[];
const lines=['begin;'];
for (const role of ['owner','coordinator','translator','reviewer','viewer'] as Role[]) {
  const profileId=`contract-${role}`;
  const privileges=[...privilegesOfFixedRole(role)];
  lines.push(`select public._apply_org_event('contract-org','v1.RoleDefined',${sql({roleId:role,name:role,privileges})},'999:1:test');`);
  lines.push(`select public._apply_org_event('contract-org','v1.OrgMemberAdded',${sql({profileId,roleId:role,scope:{level:'org'}})},'999:1:test');`);
  const session=deriveSession(profileId,null,{ ...state,members:{
    ...state.members,[profileId]:{role:{value:role,hlc:'',eventId:''},removed:{value:false,hlc:'',eventId:''}}
  } },true);
  for(const screen of SCREEN_IDS) for(const event of fixture) {
    if(!SCREEN_CONTRACTS[screen].emits.includes(event.type) || privilegeFor(event)==='bootstrap')continue;
    rows.push({screen,profileId,type:event.type,payload:event.payload,allowed:screenMayEmit(screen,session,event)});
  }
}
lines.push(`do $$ declare r jsonb; actual boolean; begin
  for r in select * from jsonb_array_elements(${sql(rows)}) loop
    actual := public.may_emit('contract-org','p',r->>'profileId',r->>'type',r->'payload');
    if actual is distinct from (r->>'allowed')::boolean then
      raise exception 'screen/server permission mismatch: %', r;
    end if;
  end loop;
end $$;`);
lines.push(`select ${rows.length} as screen_permission_checks;rollback;`);
writeFileSync(process.argv[2] ?? '/tmp/langquest-screen-contracts.sql',lines.join('\n'));
