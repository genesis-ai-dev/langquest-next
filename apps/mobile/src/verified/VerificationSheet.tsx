// Asking for an organization's blue check (decisions.md 172), from the grey
// check after its name on its Manage page: an admin names the organization's
// website and an address at it, types the code LangQuest emails there, and
// the request waits for the LangQuest team. Once granted, the blue check
// opens what it means, for every member (VerifiedSheet).
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { t } from '../i18n';
import { formatDay } from '../i18n/format';
import type { SendRefusal } from '../server/verification';
import { Banner, Field, LinkBtn, PrimaryBtn, Sheet } from '../ui/kit';
import { Text } from '../ui/text';
import { txt } from '../ui/textStyles';
import { C, space } from '../ui/theme';
import { codeOf, domainProblem, emailProblem, maskedEmail, normalizeDomain, normalizeEmail, stageOf, suggestedEmail } from './model';
import type { OrgBadge } from './useOrgBadges';
import { useVerificationRequest } from './useVerificationRequest';
import { Seal } from './VerifiedSeal';

/** The blue check, its website and since when, and what it means. */
function Verified(props: { badge: OrgBadge }) {
  return (
    <View style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <Seal size={52} badge={props.badge} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={txt.title}>{t('verified.done.title')}</Text>
          <Text style={txt.smMuted}>{t('verified.done.sub', { domain: props.badge.domain, date: formatDay(props.badge.grantedAt) })}</Text>
        </View>
      </View>
      <Text style={txt.body}>{t('verified.meaning')}</Text>
    </View>
  );
}

/** What an organization's blue check means, for anyone who taps it on its Manage page. */
export function VerifiedSheet(props: { visible: boolean; onClose: () => void; orgName: string; badge: OrgBadge }) {
  return (
    <Sheet visible={props.visible} title={t('verified.title')} sub={props.orgName} onClose={props.onClose}>
      <Verified badge={props.badge} />
    </Sheet>
  );
}

/** What a refusal or a problem with the form says, in the language showing. */
function problemText(reason: SendRefusal | 'wrong' | 'expired' | 'too_many_codes' | 'no_code', org: string, domain: string): string {
  switch (reason) {
    case 'not_allowed': return t('verified.problem.notAllowed');
    case 'bad_domain': return t('verified.problem.badDomain');
    case 'public_domain': return t('verified.problem.publicDomain');
    case 'bad_email': return t('verified.problem.badEmail');
    case 'email_not_at_domain': return t('verified.problem.emailNotAtDomain', { domain });
    case 'already_verified': return t('verified.problem.alreadyVerified', { org });
    case 'waiting': return t('verified.problem.waiting');
    case 'too_soon': return t('verified.problem.tooSoon');
    case 'too_many': return t('verified.problem.tooMany');
    case 'no_email': return t('verified.problem.noEmail');
    case 'offline': return t('verified.problem.offline');
    case 'wrong': return t('verified.code.wrong');
    case 'expired': case 'no_code': return t('verified.code.expired');
    case 'too_many_codes': return t('verified.code.tooManyWrong');
    default: return t('verified.problem.sendFailed');
  }
}

export function VerificationSheet(props: { visible: boolean; onClose: () => void; orgId: string; orgName: string; signInEmail: string | null }) {
  const req = useVerificationRequest(props.orgId, props.visible);
  const { state, loading } = req;
  const [domain, setDomain] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [changing, setChanging] = useState(false);
  const [now, setNow] = useState(Date.now());

  // Each time it opens: the request's own website and address, else empty for the admin to fill.
  useEffect(() => {
    if (!props.visible) return;
    setProblem(null); setCode(''); setChanging(false);
  }, [props.visible]);
  useEffect(() => {
    if (state?.request && !domain) { setDomain(state.request.domain); setEmail(state.request.email); }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only to fill an empty form from the request
  }, [state?.request]);
  useEffect(() => { if (req.offline) setProblem(t('verified.problem.offline')); }, [req.offline]);
  // "Send a new code" waits a minute after the last one; the clock moves it along.
  useEffect(() => {
    if (!props.visible) return;
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, [props.visible]);

  const stage = changing ? 'ask' : stageOf(state, now);
  const cleanDomain = normalizeDomain(domain);
  const cleanEmail = normalizeEmail(email);

  async function send() {
    const d = domainProblem(cleanDomain) ?? emailProblem(cleanEmail, cleanDomain);
    if (d) { setProblem(problemText(d, props.orgName, cleanDomain)); return; }
    setBusy(true); setProblem(null);
    try {
      const r = await req.send(cleanDomain, cleanEmail);
      if (!r.sent) { setProblem(problemText(r.reason, props.orgName, cleanDomain)); return; }
      setChanging(false); setCode('');
    } finally { setBusy(false); }
  }

  async function confirm() {
    const c = codeOf(code);
    if (!c) { setProblem(t('verified.code.sixDigits')); return; }
    setBusy(true); setProblem(null);
    try {
      const answer = await req.confirm(c);
      if (answer !== 'waiting') setProblem(problemText(answer === 'too_many' ? 'too_many_codes' : answer, props.orgName, cleanDomain));
    } finally { setBusy(false); }
  }

  async function withdraw() {
    setBusy(true); setProblem(null);
    try {
      if (await req.withdraw()) { setDomain(''); setEmail(''); } else setProblem(t('verified.problem.offline'));
    } finally { setBusy(false); }
  }

  const r = state?.request;
  const canSendAgain = !r?.canSendAgainAt || Date.parse(r.canSendAgainAt) <= now;
  const footer = loading ? undefined
    : stage === 'ask' || stage === 'declined'
      ? <PrimaryBtn label={t('verified.ask.send')} icon="send" busy={busy} help={t('verified.ask.sendHelp')} onPress={() => void send()} />
      : stage === 'code'
        ? <PrimaryBtn label={t('verified.code.confirm')} icon="check" busy={busy} help={t('verified.code.confirmHelp')} onPress={() => void confirm()} />
        : undefined;

  return (
    <Sheet visible={props.visible} title={t('verified.title')} sub={props.orgName} onClose={props.onClose} footer={footer}
      {...(changing ? { onBack: () => setChanging(false) } : {})}>
      {loading ? <Text style={txt.smMuted}>{t('common.loading')}</Text> : null}

      {!loading && stage === 'verified' && state?.verified ? <Verified badge={state.verified} /> : null}

      {!loading && (stage === 'ask' || stage === 'declined') ? (
        <View style={{ gap: space.md }}>
          {stage === 'declined' && !changing ? <Banner icon="flag" tone="amber" title={t('verified.declined.title')} body={t('verified.declined.body')} /> : null}
          <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start' }}>
            <Seal size={28} />
            <Text style={[txt.body, { flex: 1 }]}>{t('verified.meaning')}</Text>
          </View>
          <Field label={t('verified.ask.domain')} value={domain} placeholder={t('verified.ask.domainPlaceholder')} autoCapitalize="none"
            keyboardType="default" help={t('verified.ask.domainHelp')}
            onChangeText={(v) => { setDomain(v); setProblem(null); if (!email) setEmail(suggestedEmail(props.signInEmail, normalizeDomain(v))); }} />
          <Field label={t('verified.ask.email')} value={email} placeholder={t('verified.ask.emailPlaceholder', { domain: cleanDomain || t('verified.ask.domainPlaceholder') })}
            autoCapitalize="none" keyboardType="email-address" help={t('verified.ask.emailHelp')} onSubmit={() => void send()}
            onChangeText={(v) => { setEmail(v); setProblem(null); }} />
        </View>
      ) : null}

      {!loading && stage === 'code' && r ? (
        <View style={{ gap: space.md }}>
          <Text style={txt.body}>{t('verified.code.sentTo', { email: maskedEmail(r.email) })}</Text>
          <Field label={t('verified.code.label')} value={code} keyboardType="number-pad" autoCapitalize="none" help={t('verified.code.help')}
            onSubmit={() => void confirm()} onChangeText={(v) => { setCode(v); setProblem(null); }} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.lg }}>
            <LinkBtn label={t('verified.code.again')} help={canSendAgain ? t('verified.code.againHelp') : t('verified.problem.tooSoon')}
              color={canSendAgain ? C.primary : C.faint} onPress={() => { if (canSendAgain) void send(); else setProblem(t('verified.problem.tooSoon')); }} />
            <LinkBtn label={t('verified.code.change')} help={t('verified.code.changeHelp')} onPress={() => { setChanging(true); setProblem(null); }} />
          </View>
        </View>
      ) : null}

      {!loading && stage === 'waiting' && r ? (
        <View style={{ gap: space.md }}>
          <Banner icon="clock" tone="brand" title={t('verified.waiting.title')} body={t('verified.waiting.body', { email: maskedEmail(r.email), domain: r.domain })} />
          <LinkBtn label={t('verified.waiting.withdraw')} help={t('verified.waiting.withdrawHelp')} onPress={() => void withdraw()} />
        </View>
      ) : null}

      {problem ? <Text accessibilityRole="alert" style={[txt.sm, { color: C.red, fontWeight: '700' }]}>{problem}</Text> : null}
    </Sheet>
  );
}
