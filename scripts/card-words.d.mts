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
export declare const ISSUE_CARD: { title: number; about: number; happened: number; known: number; ask: number; option: number; then: number; events: { min: number; max: number }; options: { min: number; max: number } };
export interface CardEvent { at: string; until: string; about: boolean; happened: string; bug: boolean }
export interface IssueCardWords { title: string; about: string; events: CardEvent[]; known: string; ask: string; options: { option: string; then: string }[] }
export declare function issueCardOf(raw: unknown): IssueCardWords | null;
export declare const NAIVE_CONTEXT: string;
export declare function eventTime(e: { at: string; until?: string; about?: boolean }, timeZone?: string, day?: { last: string }): string;
export declare function cardText(card: unknown, timeZone?: string): string;
export declare function naivePrompt(card: unknown): string;
export declare function cardsIn(value: unknown, at?: string): { where: string; card: IssueCardWords }[];
