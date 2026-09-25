import { OBT_GUIDANCE, type ObtGuidanceKey } from '../obtGuidance';
import { ObtPromptRecorder } from '../obtPromptRecorder';
import { contractsFor } from '../screenContracts';
// Avatar P. Configure stage responsibility and deliver source-free workspaces.
import { deriveObt, OBT_LABELS, type Role } from '@langquest-next/core';
import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { Check, Download, Headphones, Send } from 'lucide-react-native';
import type { Ctx } from '../ctx';
import { collectObtWorkspace, openObtWorkspace } from '../obtWorkspace';
import { Header, Note, Row, Screen, Section } from '../pui';
import { ActionButton, text } from '../ui';
import { space, colors } from '../theme';

export function ObtManage(ctx: Ctx) {
  const laneId = ctx.params.laneId ?? Object.keys(ctx.project.state?.lanes ?? {})[0] ?? '';
  const unitId = ctx.params.unitId ?? '';
  const policy = ctx.project.state?.obt.policies[laneId]?.value;
  const [consultantRole,setConsultantRole] = useState<Role>(policy?.consultantRole ?? 'coordinator');
  const [finalRole,setFinalRole] = useState<Role>(policy?.finalRole ?? 'owner');
  const [minimum,setMinimum] = useState(String(policy?.minimumInteractions ?? 1));
  const [promptStage,setPromptStage] = useState<ObtGuidanceKey>('first_draft');
  const [email,setEmail] = useState('');
  const [language,setLanguage] = useState('');
  const [clean,setClean] = useState(false);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState('');
  const j = ctx.project.state && unitId ? deriveObt(ctx.project.state,unitId,laneId) : null;
  const revision = j?.steps.revision?.eventId;
  const can = ['owner','coordinator'].includes(ctx.session.role ?? '');
  async function run(action: () => Promise<void>) {
    if (busy || !can) return;
    setBusy(true); setMessage('');
    try { await action(); } catch(e) { setMessage((e as Error).message); }
    finally { setBusy(false); }
  }
  return <Screen footer={<ActionButton icon={Check} label="Save stage policy" accessibilityLabel="Save stage policy"
    disabled={busy || !can} onPress={() => void run(async () => {
      const n=Number(minimum);
      if (!Number.isInteger(n) || n<1 || n>100) throw new Error('Choose between 1 and 100 community interactions.');
      await ctx.project.append('v1.ObtPolicySet',{ laneId,consultantRole,finalRole,minimumInteractions:n });
      setMessage('Policy saved on this device.');
    })} />}>
    <Header title="Spoken Worldwide workflow" onBack={ctx.back} />
    {j ? <Text style={text.h4}>{OBT_LABELS[j.stage]}</Text> : null}
    {revision ? <Section label="Back translation">
      <Note>Use a separate account and device that have not accessed this project's source material. Setup and collection require a connection.</Note>
      <TextInput accessibilityLabel="Back translator email" placeholder="Back translator email" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} style={{ padding:space.md }} />
      <TextInput accessibilityLabel="Back translation language" placeholder="Back translation language" value={language} onChangeText={setLanguage} style={{ padding:space.md }} />
      <Row icon={clean ? Check : Headphones} label="Separate source-free account and device confirmed" onPress={() => setClean(!clean)} />
      <ActionButton icon={Send} variant="outline" label="Deliver draft" accessibilityLabel="Create workspace and deliver selected draft"
        disabled={busy || !clean || !email.trim() || !language.trim() || !can || j?.stage!=='back_translation'}
        onPress={() => void run(async () => {
          await openObtWorkspace(ctx.project,revision,email,language);
          setMessage('Draft delivered. The back translator can open it from the organization switcher.');
        })} />
      <ActionButton icon={Download} variant="outline" label="Collect back translation" accessibilityLabel="Collect submitted back translation"
        disabled={busy || !can || j?.stage!=='back_translation'} onPress={() => void run(async () => {
          await collectObtWorkspace(ctx.project,revision); setMessage('Back translation collected for consultant review.');
        })} />
    </Section> : null}
    <Section label="Required community interactions">
      <TextInput value={minimum} onChangeText={setMinimum} keyboardType="number-pad" accessibilityLabel="Required community interactions" style={{ padding:space.md,borderColor:colors.border,borderWidth:1 }} />
    </Section>
    {(['consultant','final'] as const).map(kind => <Section key={kind} label={kind==='consultant' ? 'Consultant role' : 'Final audio approver'}>
      {(['reviewer','coordinator','owner'] as Role[]).map(role => <Row key={role} label={role}
        icon={(kind==='consultant' ? consultantRole : finalRole)===role ? Check : undefined}
        onPress={() => kind==='consultant' ? setConsultantRole(role) : setFinalRole(role)} />)}
    </Section>)}
    <Note>Each configured approval requires one decision. Changing draft content requires a new back translation and consultant review.</Note>
    <Section label="Spoken instructions">
      <Note>Choose a stage, then hold the microphone to record guidance in your participants' language.</Note>
      {(Object.keys(OBT_GUIDANCE) as ObtGuidanceKey[]).map(stage => <Row key={stage} label={OBT_GUIDANCE[stage]}
        icon={stage===promptStage ? Check : undefined} onPress={() => setPromptStage(stage)} />)}
      <ObtPromptRecorder key={promptStage} ctx={ctx} laneId={laneId} stage={promptStage} />
    </Section>
    {message ? <Text style={text.body}>{message}</Text> : null}
  </Screen>;
}

export const contracts = contractsFor('obt_manage');
