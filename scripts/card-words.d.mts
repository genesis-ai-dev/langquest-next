// Types for scripts/card-words.mjs, which is plain Node so that workflows run it before `npm ci`.
export declare const LIMITS: { sentence: number; line: number };
export declare const JARGON: string[];
export declare const CARD_FIELDS: string[];
export declare function sentencesOf(text: string | null | undefined): string[];
export declare function cardWordProblems(text: string | null | undefined, opts?: { max?: number }): string[];
export declare function plainEnough(text: string | null | undefined, opts?: { max?: number }): boolean;
export type WhyStopped = 'needsChoice' | 'needsApp' | 'needsSetup' | 'notSeen' | 'unclear' | 'checksFailed' | 'tooSlow' | 'safety' | 'noAccess' | 'broke' | 'unknown';
export interface WhyWords { label: string; says: string; youCan: string; act: 'tell' | 'retry' | 'app' }
export declare const WHY_STOPPED: Record<WhyStopped, WhyWords>;
export declare const CLAUDE_WHY: WhyStopped[];
export declare function fixNote(why: string, plain: string | null | undefined, technical: string | null | undefined): string;
export declare function fixNoteParts(note: string | null | undefined, app?: boolean): { why: WhyStopped; plain: string; technical: string };
export declare function whyOfNote(note: string | null | undefined, app?: boolean): WhyStopped;
export declare function cardTexts(value: unknown, fields?: string[], at?: string): { where: string; text: string; max: number }[];
export declare function fileProblems(value: unknown, fields?: string[]): string[];
