/** Generate SQL that tests screen permissions against the real server rule. */
import { writeFileSync } from 'node:fs';
import { foldOrg, privilegeFor, SEED_ROLES, type AnyEvent } from '@langquest-next/core';
import { buildFixture, buildOrgFixture } from '../packages/core/test/fixtures';
import { SCREEN_CONTRACTS, screenMayEmit } from '../apps/mobile/src/screenContracts';
import { SCREEN_IDS } from '../apps/mobile/src/flow';
import { deriveSession } from '../apps/mobile/src/session';
const sql = (value: unknown) => `'${JSON.stringify(value).replaceAll("'","''")}'::jsonb`;
const fixture=[...buildFixture(),...buildOrgFixture()];
const rows: unknown[]=[];
const lines=['begin;'];
let seq=0;
// The same organization on both sides: every seed role, and a person holding each at org scope.
const orgEvents=SEED_ROLES.flatMap((role) => [
  { type:'v1.RoleDefined',payload:{ roleId:role.roleId,name:role.name,privileges:role.privileges } },
  { type:'v1.MemberAdded',payload:{ profileId:`contract-${role.fixed}`,roleId:role.roleId,scope:{ level:'org' } } }
]).map((e) => ({ ...e,id:`contract-${++seq}`,orgId:'contract-org',streamId:'_org',actorId:'contract',deviceId:'test',
  hlc:`${String(seq).padStart(15,'0')}:000000:test` }) as AnyEvent);
for (const e of orgEvents) {
  lines.push(`select public._apply_org_event('contract-org','${e.id}','${e.type}',${sql(e.payload)},'${e.hlc}','contract');`);
}
const org=foldOrg(orgEvents);
for (const role of SEED_ROLES) {
  const profileId=`contract-${role.fixed}`;
  const session=deriveSession(profileId,null,true,org,'L1');
  for(const screen of SCREEN_IDS) for(const event of fixture) {
    if(!SCREEN_CONTRACTS[screen].emits.includes(event.type) || privilegeFor(event)==='bootstrap')continue;
    rows.push({screen,profileId,stream:event.streamId,type:event.type,payload:event.payload,allowed:screenMayEmit(screen,session,event)});
  }
}
lines.push(`do $$ declare r jsonb; actual boolean; begin
  for r in select * from jsonb_array_elements(${sql(rows)}) loop
    actual := public.may_emit('contract-org',r->>'stream',r->>'profileId',r->>'type',r->'payload');
    if actual is distinct from (r->>'allowed')::boolean then
      raise exception 'screen/server permission mismatch: %', r;
    end if;
  end loop;
end $$;`);
lines.push(`select ${rows.length} as screen_permission_checks;rollback;`);
writeFileSync(process.argv[2] ?? '/tmp/langquest-screen-contracts.sql',lines.join('\n'));
