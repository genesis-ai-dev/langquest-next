-- How someone joined is the server's to say (decisions.md 112).
--
-- v1.InviteIssued and v1.JoinDecided were open to any invite_members holder
-- through append_events, though only issue_invite_v3 and
-- decide_join_request append them (as the server, through
-- _append_event_as, which does not ask event_privilege). An accepted
-- JoinDecided is what _joined_by_consent counts as a person's consent, and
-- may_help_sign_in lets a helper issue a sign-in code for a looked-after
-- account that joined by consent, so a forged one could stand in for it.
-- Both are server-only now, as v1.InviteRedeemed already was.
--
-- event_privilege is restated whole, as `create or replace`, from
-- 20261014200000_clusters.sql's, with those two rules made null.
-- scripts/record-parity-sql.ts holds it to core's EVENT_PRIVILEGE.

create or replace function public.event_privilege(p_type text, p jsonb)
returns text language sql immutable as $$
  select case p_type
    -- organization stream
    when 'v1.OrgCreated' then 'bootstrap'
    when 'v1.OrgRenamed' then 'manage_roles'
    when 'v1.RoleDefined' then 'manage_roles'
    when 'v1.RoleRetired' then 'manage_roles'
    when 'v1.MemberAdded' then 'invite_members'
    when 'v1.MemberRemoved' then 'invite_members'
    when 'v1.InviteIssued' then null
    when 'v1.InviteRedeemed' then null
    when 'v1.JoinDecided' then null
    when 'v1.LicenseSet' then 'manage_roles'
    when 'v1.LanguageAdded' then 'manage_structure'
    when 'v1.LanguageRenamed' then 'manage_structure'
    when 'v1.LanguageCodeSet' then 'manage_structure'
    when 'v1.LanguageCountrySet' then 'manage_structure'
    when 'v1.LanguageTargetSet' then 'manage_structure'
    when 'v1.ClusterNamed' then 'manage_structure'
    when 'v1.LanguageClusterSet' then 'manage_structure'
    when 'v1.ReferenceRecommended' then 'manage_reference'
    when 'v1.LibraryItemDefined' then public._library_privilege(p->>'kind')
    when 'v1.LibraryVersionPublished' then public._library_privilege(p->>'kind')
    when 'v1.LibrarySharingSet' then public._library_privilege(p->>'kind')
    when 'v1.LibraryItemArchived' then public._library_privilege(p->>'kind')
    when 'v1.LibrarySubscribed' then public._library_privilege(p->>'kind')
    when 'v1.LibraryPinned' then public._library_privilege(p->>'kind')
    -- either stream
    when 'v1.Redacted' then 'manage_structure'
    -- language stream
    when 'v1.TemplateSelected' then 'manage_templates'
    when 'v1.UnitAdded' then 'manage_templates'
    when 'v1.UnitHidden' then 'manage_templates,shape_templates'
    when 'v1.BookNameSet' then 'manage_templates'
    when 'v1.FlowSelected' then 'manage_flows'
    when 'v1.FlowStepSet' then 'manage_flows'
    when 'v1.FlowStepRemoved' then 'manage_flows'
    when 'v1.ReviewKindDefined' then 'manage_flows'
    when 'v1.ReviewTeamDefined' then 'manage_teams'
    when 'v1.ReviewTeamMemberSet' then 'manage_teams'
    when 'v1.ReviewTeamKindSet' then 'manage_teams'
    when 'v1.FlowStepLinksSet' then 'manage_flows'
    when 'v1.CheckHelpSet' then 'manage_flows'
    when 'v1.VersionReleased' then 'assign_work'
    when 'v1.RecordingAdded' then 'translate'
    when 'v1.TakeComposed' then 'translate'
    when 'v1.TakeArchived' then 'translate'
    when 'v1.CardVerseSet' then 'translate'
    when 'v1.TakeSubmitted' then 'translate'
    when 'v1.ResponseRecorded' then 'translate'
    when 'v1.AudioFormatSet' then 'translate,review,assign_work,send_to_reviewers,override_checkpoints,fill_reference'
    when 'v1.ExternalValueSet' then 'translate,review,fill_reference'
    when 'v1.ReviewRecorded' then case when p->>'via' in ('logged', 'link') then 'review,translate' else 'review' end
    when 'v1.DepartureRecorded' then case p->>'type'
      when 'override' then 'override_checkpoints' when 'keep' then 'translate' else 'translate,review,assign_work' end
    when 'v1.DepartureUndone' then 'translate,review,assign_work,override_checkpoints'
    when 'v1.RequestMade' then 'send_to_reviewers,assign_work'
    when 'v1.RequestWithdrawn' then 'send_to_reviewers,assign_work'
    when 'v1.NoteAdded' then 'translate,review,fill_reference'
    when 'v1.StudyStepMarked' then 'translate'
    when 'v1.MaterialDefined' then case when p->>'kind' = 'questions' then 'fill_reference' else 'manage_reference' end
    when 'v1.MaterialFieldSet' then 'fill_reference'
    when 'v1.MaterialLocked' then 'manage_reference'
    when 'v1.KeyTermDefined' then 'fill_reference'
    when 'v1.KeyTermRenderingAdded' then 'fill_reference'
    when 'v1.KeyTermAdjusted' then 'fill_reference'
    when 'v1.KeyTermLinked' then 'fill_reference'
    when 'v1.ReferenceSet' then 'manage_reference'
    when 'v1.ReferenceLanguageSet' then 'manage_reference'
    when 'v1.PassageReferenceLinked' then 'manage_reference'
    when 'v1.ReferencesUsed' then 'translate,review'
    else null
  end;
$$;
