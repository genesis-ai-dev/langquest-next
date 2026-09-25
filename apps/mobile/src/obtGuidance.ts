import { OBT_LABELS } from '@langquest-next/core';

/** Material fields for recorded guidance; never generated or required as text. */
export const OBT_GUIDANCE = {
  ...OBT_LABELS,
  community_name: 'Community participant name',
  community_listen: 'Play the draft for the participant',
  community_record: 'Record the conversation',
  community_comments: 'Optional community comments',
  community_photo: 'Optional participant photo'
};
export type ObtGuidanceKey = keyof typeof OBT_GUIDANCE;
export const COMMUNITY_GUIDANCE: ObtGuidanceKey[] = [
  'community_name', 'community_listen', 'community_record',
  'community_comments', 'community_photo'
];
