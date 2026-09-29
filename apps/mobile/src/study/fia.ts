// FIA study guides (the UX demo's src/fia.ts, STUDY-1, ADR-018, ADR-019).
// FIA (Familiarize, Internalize, Articulate, fia.bible) takes a team through
// six steps for every passage before anyone drafts. Its API sends each step
// as one markdown document with its own audio, plus the pictures, map and
// Master Glossary terms the text links to (`#m387`, `#c47`, `#t63`). That
// maps onto the general study-guide shape: `fiaGuideFromApi` is the adapter,
// and nothing in the screens knows about FIA.
//
// Genesis 2:4–25 is FIA's own material, straight from the API
// (fia-gen-p2.json). The Luke 15 and John 3 guides were written for the demo
// in FIA's format; their notes are the demo's, not FIA's.
import FIA_GEN_P2 from './fia-gen-p2.json';
import type { StudyGuide, StudyMedia, StudyResource, StudyStep } from './guides';

export const FIA_ABOUT =
  'FIA takes the team through six steps for each passage, in audio and text, before anyone drafts: Familiarize, then Internalize, then Articulate. Each step asks you to listen to the passage again. Answers and notes the team adds stay with the passage, so reviewers can see the study behind the draft.';

/** FIA's steps by their API identifier. The ids stay short because study records point at them. */
const FIA_STEPS: Record<string, { id: string; phase: string; purpose: string }> = {
  'hear-and-heart': { id: 'hear', phase: 'Familiarize', purpose: 'Hear the passage in more than one translation, then talk about it together.' },
  'setting-the-stage': { id: 'stage', phase: 'Familiarize', purpose: 'Where the passage sits in the bigger story, and its culture, history and places.' },
  'defining-the-scenes': { id: 'scenes', phase: 'Internalize', purpose: 'Frame the passage: its scenes, settings and people. Draw or build them.' },
  'embodying-the-text': { id: 'embody', phase: 'Internalize', purpose: 'Act the passage out twice: first straight through, then stopping to ask how people feel.' },
  'filling-the-gaps': { id: 'gaps', phase: 'Articulate', purpose: "The words to choose, with the key terms in FIA's Master Glossary." },
  'speaking-the-word': { id: 'speak', phase: 'Articulate', purpose: 'Tell it in your own language, together, until everyone agrees on a version.' }
};
const STEP_TITLES: Record<string, string> = {
  'hear-and-heart': 'Hear and Heart', 'setting-the-stage': 'Setting the Stage', 'defining-the-scenes': 'Defining the Scenes',
  'embodying-the-text': 'Embodying the Text', 'filling-the-gaps': 'Filling the Gaps', 'speaking-the-word': 'Speaking the Word'
};

/** About 140 words a minute, with room for the pauses FIA asks for. */
const secondsFor = (words: number) => Math.round(words / 2.2);
const wordsIn = (text: string) => text.split(/\s+/).filter(Boolean).length;

// ---- the API adapter -------------------------------------------------------------

type Edges<T> = { edges: { node: T }[] };
type ByLanguage = { language: { id: string } };
interface FiaPericope {
  pericopeTranslations: Edges<ByLanguage & {
    stepRenderings: Edges<{
      step: { uniqueIdentifier: string };
      stepTranslation: { title: string };
      textAsMarkdown: string;
      textWordCount: number;
      audioUrlVbr6?: string | null;
    }>;
  }>;
  mediaItems: Edges<{
    id: string;
    mediaItemTranslations: Edges<ByLanguage & { title: string; description: string | null }>;
    mediaAssets: Edges<{
      id: string;
      assetType: { id: string };
      attachment: { url500: string };
      mediaAssetTranslations: Edges<ByLanguage & { title: string; description: string | null }>;
    }>;
  }>;
  map: Edges<{ id: string; mapTranslations: Edges<ByLanguage & { title: string; imageUrl1500: string }> }>;
  terms: Edges<{
    id: string;
    termTranslations: Edges<ByLanguage & { translatedTerm: string; descriptionHint: string | null; textPlain: string | null; audioUrlVbr4?: string | null }>;
  }>;
}

const inLanguage = <T extends ByLanguage>(edges: Edges<T>, lang: string): T | undefined =>
  edges.edges.map((e) => e.node).find((n) => n.language.id === lang) ?? edges.edges[0]?.node;

/** A Master Glossary entry, shown when someone taps a glossary link. */
export interface GlossaryEntry {
  term: string;
  hint?: string;
  body?: string;
  audioUrl?: string;
}

/**
 * One FIA pericope, as the API sends it, in one of its gateway languages.
 * Audio is the smallest encoding, for field phones.
 */
export function fiaGuideFromApi(id: string, passage: string, pericope: FiaPericope, lang: string): StudyGuide {
  const rendering = inLanguage(pericope.pericopeTranslations, lang);
  const steps: StudyStep[] = (rendering?.stepRenderings.edges ?? []).map(({ node }) => {
    const info = FIA_STEPS[node.step.uniqueIdentifier];
    return {
      id: info?.id ?? node.step.uniqueIdentifier,
      title: node.stepTranslation.title,
      ...(info ? { phase: info.phase } : {}),
      purpose: info?.purpose ?? '',
      text: node.textAsMarkdown,
      audio: { ...(node.audioUrlVbr6 ? { url: node.audioUrlVbr6 } : {}), seconds: secondsFor(node.textWordCount) }
    };
  });
  const media: StudyResource[] = pericope.mediaItems.edges.map(({ node }) => {
    const t = inLanguage(node.mediaItemTranslations, lang);
    return {
      ref: `m${node.id}`, kind: 'media', title: t?.title ?? 'Pictures', ...(t?.description ? { description: t.description } : {}),
      media: node.mediaAssets.edges.map(({ node: a }): StudyMedia => {
        const at = inLanguage(a.mediaAssetTranslations, lang);
        return { id: a.id, kind: a.assetType.id === 'video' ? 'video' : 'photo', title: at?.title ?? '', caption: at?.description ?? '', url: a.attachment.url500 };
      })
    };
  });
  const maps: StudyResource[] = pericope.map.edges.map(({ node }) => {
    const t = inLanguage(node.mapTranslations, lang);
    const title = t?.title ?? 'Map';
    return { ref: `c${node.id}`, kind: 'map', title, media: [{ id: `c${node.id}`, kind: 'map', title, caption: '', ...(t?.imageUrl1500 ? { url: t.imageUrl1500 } : {}) }] };
  });
  const terms: StudyResource[] = pericope.terms.edges.map(({ node }) => {
    const t = inLanguage(node.termTranslations, lang);
    return { ref: `t${node.id}`, kind: 'term', title: t?.translatedTerm ?? '', ...(t?.descriptionHint ? { description: t.descriptionHint } : {}) };
  });
  return {
    id, pattern: 'FIA', about: FIA_ABOUT, source: `fia.bible · ${lang === 'eng' ? 'English' : lang}`, passage,
    steps, resources: [...media, ...maps, ...terms]
  };
}

/** Master Glossary entries from the API, by the link's ref ("t63"). */
export function fiaGlossaryFromApi(pericope: FiaPericope, lang: string): Record<string, GlossaryEntry> {
  return Object.fromEntries(pericope.terms.edges.map(({ node }) => {
    const t = inLanguage(node.termTranslations, lang);
    const entry: GlossaryEntry = {
      term: t?.translatedTerm ?? '',
      ...(t?.descriptionHint ? { hint: t.descriptionHint } : {}),
      ...(t?.textPlain ? { body: t.textPlain } : {}),
      ...(t?.audioUrlVbr4 ? { audioUrl: t.audioUrlVbr4 } : {})
    };
    return [`t${node.id}`, entry];
  }));
}

const GEN_P2 = (FIA_GEN_P2 as unknown as { pericope: FiaPericope }).pericope;

/** Genesis 2:4–25, FIA's own material. */
export const GENESIS2_GUIDE = fiaGuideFromApi('fia-gen-p2', 'Genesis 2:4–25', GEN_P2, 'eng');
export const GENESIS2_GLOSSARY = fiaGlossaryFromApi(GEN_P2, 'eng');

// ---- guides written for the demo in FIA's format ---------------------------------
// FIA's first and last steps read the same for every passage; the middle four
// are the passage's own.

const hearAndHeart = (passage: string) => `Hear ${passage} and put it in your heart. Listen to the text three times (in three different translations, if possible). Then as a team discuss the following questions:

1. What do you like in this story?
2. What do you not like or not understand?
3. What does this story tell us about Jesus?
4. What does this story tell us about people?
5. How does this story affect our daily life?
6. Who do you know who needs to hear this story?`;

const SPEAKING_THE_WORD = GENESIS2_GUIDE.steps.find((s) => s.id === 'speak')?.text ?? '';

function demoGuide(id: string, passage: string, middle: [string, string, string, string], resources: StudyResource[]): StudyGuide {
  const texts = [hearAndHeart(passage), ...middle, SPEAKING_THE_WORD];
  const steps = Object.entries(FIA_STEPS).map(([key, info], i): StudyStep => ({
    ...info, title: STEP_TITLES[key]!, text: texts[i]!, audio: { seconds: secondsFor(wordsIn(texts[i]!)) }
  }));
  return { id, pattern: 'FIA', about: FIA_ABOUT, source: "Written for the demo in FIA's format", passage, steps, resources };
}

/** A glossary link in a demo guide ("#t-kt9"); the entry is its description. */
const term = (id: string, title: string, description: string): StudyResource => ({ ref: `t-${id}`, kind: 'term', title, description });

export const LOST_SON_GUIDE = demoGuide("fia-luk-15-11-32", "Luke 15:11–32", [
  `Listen to an audio version of Luke 15:11-32 in the easiest-to-understand translation.

This passage is a parable, a story Jesus told to teach something. It is the third of three stories in Luke 15: a lost sheep, a lost coin, and a lost son. Tax collectors and sinners had come close to listen to Jesus, and the Pharisees and teachers of the law grumbled that he welcomed them and ate with them. Jesus tells these stories to both groups.

In that culture, a father divided his property among his sons near the end of his life. When the younger son asks for his share while his father is still alive, it is as if he said, "I wish you were dead." Selling family land to strangers brought shame on the whole family in front of the village.

> [!action]
> Stop here and discuss this question as a group: What would people in your community think of a son who asked for his inheritance while his father was still alive? Pause this audio here.

The younger son goes to a distant country, a land where the people are not Jews. He wastes everything he has. When a famine comes, he takes a job feeding pigs. For the Jews, pigs were unclean animals. A Jew would not raise them or eat them. Feeding pigs for a foreigner was as low as a Jewish son could fall. He is so hungry that he wants to eat the pods the pigs eat.

> [!action]
> Stop here and look at some pictures of [carob pods](#m1) as a group. Then look at a map of [Judea and the lands east of the Jordan River](#c1), where people raised pigs. Pause this audio here.

The son decides to go home and ask to be a hired servant. But his father sees him while he is still far away and runs to him. Older men of standing did not run. To run, the father had to lift his robe and show his legs. This was shameful. By running, the father takes the shame on himself, and reaches his son before the village can turn against him.

> [!action]
> Stop here and discuss this question as a group: Why do you think the father ran? What would people in your village say if an old man ran like this? Pause this audio here.

The father gives his son the best robe, a ring, and sandals. These show that he is a son, not a servant. Servants went barefoot.

> [!action]
> Stop here and look at a picture of [a robe, a ring and sandals](#m2). Pause this audio here.

The story ends with the older son outside, angry. We do not know if he goes in. Jesus leaves the question open for the listeners, especially for the Pharisees who were grumbling.

> [!action]
> Stop here and discuss this question as a group: Who in the crowd is like the younger son? Who is like the older son?`,

  `Listen to the text once in the easiest-to-understand version.

In this session, you will help the group visualize this story. You will help the group define the scenes, setting, and characters of the story.

This story has 5 scenes.

__First scene:__ At the father's house. The younger son asks for his share of the property. The father divides his property between his two sons. A few days later the younger son leaves with everything he owns.

__Second scene:__ In a distant country. The younger son wastes his money. A famine comes. He takes a job feeding pigs and is so hungry he wants to eat the pigs' food.

__Third scene:__ Still in the pig fields. The younger son comes to his senses. He talks to himself and plans what he will say to his father.

__Fourth scene:__ On the road near home. The father sees his son far away and runs to him. The son begins his speech, but the father calls to the servants to bring the robe, the ring, the sandals and the fattened calf. The feast begins.

__Fifth scene:__ Outside the house during the feast. The older son comes from the field and hears music. A servant tells him what happened. He is angry and will not go in. The father comes out and pleads with him.

The characters in this story include:

- The father
- The younger son
- The older son
- A citizen of the distant country
- The servants

In this session, have the group storyboard, draw out, or use some sort of manipulatives to visualize the story and the action in it.

> [!action]
> Stop here and discuss this question as a group: Which scene is the turning point of the story? Why? Pause this audio here.

Notice that the story does not end with the feast. It ends with the older son outside and the father pleading with him. The last words belong to the father.

> [!action]
> Stop here and discuss this question as a group: How do you show that a statement is the most important point in a story?`,

  `Listen to the text once again in the easiest-to-understand version.

In this session, the team will dramatize the story.

This story has 5 scenes.

Have the team act out the story twice. They should act it out in the language they are translating into. First, have the team act out the story without stopping. The second time the team acts out the story, stop them at different points in the story.

As the team acts out the story the first time, pay attention to the dialogue, flow, plotline, and chronology of the story.

The younger son stands before his father and asks for his share. The father divides what he has. The older son is there too.

> [!action]
> Stop the action: Ask the father how he feels. You may hear, "Hurt" or "Ashamed in front of the village." Ask the older son what he thinks of his brother.

The younger son goes far away and spends everything. Have someone play the citizen who sends him to feed the pigs. The son sits among the pigs, hungry.

> [!action]
> Stop the action: Ask the younger son what he is thinking. You may hear, "Even my father's servants eat better than I do."

The father sees his son far off and runs to him. Make sure the father runs before the son can finish his speech.

> [!action]
> Stop the action: Ask the father why he ran. Ask the son how he feels when his father kisses him. You may hear, "I don't deserve this."

The older son comes near the house and hears music. He will not go in.

> [!action]
> Stop the action: Ask the older son how he feels. You may hear, "Angry" or "It isn't fair." Ask the father what he wants the older son to do.`,

  `Listen to the text once in the easiest-to-understand version.

The younger son asks for his __share of the estate__. This is the part of the family's property that a son would receive when his father died. See [inheritance](#t-kt9) in the Master Glossary.

The son __squandered__ his wealth. This means he wasted it carelessly until nothing was left. Use a word or phrase that shows the money is gone because of the son's own choices.

The son says, "I have __sinned__ against heaven and against you." [Sin](#t-kt6) means doing wrong against God and against people. Here the son names both.

__Heaven__ here is a respectful way to say "God." The son does not say God's name. It does not mean the sky. Many languages need to say God directly, or have their own respectful way to speak of God. See [heaven](#t-kt7) in the Master Glossary.

> [!action]
> Stop here and discuss this question as a group: How do people in your language speak of God respectfully without saying his name? Pause this audio here.

The father was filled with __compassion__. This is a strong feeling of pity that moves a person to act. See [compassion](#t-kt8) in the Master Glossary.

The __fattened calf__ was a young cow fed and kept for a special feast. Use the name of an animal your community would kill for a big celebration, if it doesn't change the meaning.

The father says, "This son of mine was dead and is alive again. He was lost and is found." The father is not talking about physical death. Keep the pairs, so that listeners hear the echo of the lost sheep and the lost coin earlier in the chapter.

> [!action]
> Stop here and discuss this question as a group: Which words or ideas in this story don't have an easy match in your language?`,
], [
  { ref: "m1", kind: "media", title: "Carob pods", description: "The pods the younger son longed to eat.",
    media: [{ id: "m1a", kind: "photo", title: "Carob pods", caption: "Food for pigs, eaten only by the poorest in a famine." }] },
  { ref: "m2", kind: "media", title: "Robe, ring and sandals", description: "What the father gives back.",
    media: [{ id: "m2a", kind: "illustration", title: "Robe, ring and sandals", caption: "Honor, authority, and a son's place. Servants went barefoot." }] },
  { ref: "c1", kind: "map", title: "Judea and the lands east of the Jordan",
    media: [{ id: "c1a", kind: "map", title: "Judea and the lands east of the Jordan", caption: "Gentile country across the Jordan, where pigs were kept." }] },
  term("kt6", "sin", "doing wrong against God and against people"),
  term("kt7", "heaven", "the visible sky or the place where God lives"),
  term("kt8", "compassion", "pity felt deep inside that moves someone to act"),
  term("kt9", "inheritance", "a child's part of the family property"),
]);

export const JOHN3_GUIDE = demoGuide("fia-joh-3-1-21", "John 3:1–21", [
  `Listen to an audio version of John 3:1-21 in the easiest-to-understand translation.

Nicodemus was a Pharisee and a member of the ruling council, a respected teacher of Israel. He comes to Jesus at night. He may not want to be seen. In John's Gospel, night is also a picture of not yet understanding.

> [!action]
> Stop here and discuss this question as a group: Who in your community would come to a teacher secretly, at night? Why? Pause this audio here.

Jesus tells Nicodemus that he must be born again. The word Jesus uses means both "again" and "from above." Nicodemus hears "again" and asks how an old man can go back into his mother's womb. Jesus means "from above," from God.

Jesus reminds Nicodemus of a story from Numbers 21. Poisonous snakes bit the people of Israel in the wilderness. Moses lifted up a bronze snake on a pole, and whoever looked at it lived. Jesus says the Son of Man will be lifted up in the same way.

> [!action]
> Stop here and look at a picture of [the bronze snake on a pole](#m1) as a group. Pause this audio here.`,

  `Listen to the text once in the easiest-to-understand version.

This story has 4 scenes.

__First scene:__ At night, in Jerusalem. Nicodemus comes to Jesus and says that Jesus must be a teacher from God.

__Second scene:__ Jesus tells him that no one can see the kingdom of God unless he is born from above. Nicodemus doesn't understand.

__Third scene:__ Nicodemus asks, "How can this be?" Jesus answers with the story of the snake in the wilderness.

__Fourth scene:__ God so loved the world. There is no setting here: it is teaching. The text doesn't say whether Jesus is still speaking or John is explaining.

The characters in this story include:

- Nicodemus
- Jesus

> [!action]
> Stop here and discuss this question as a group: Where does Jesus stop speaking and John start explaining? What will you do with that when you tell it?`,

  `Listen to the text once again in the easiest-to-understand version.

Have the team act out the conversation twice: first straight through, then stopping at different points.

> [!action]
> Stop the action: Ask Nicodemus how he feels when Jesus says he must be born again. You may hear, "Confused" or "That's impossible."

> [!action]
> Stop the action: Ask Jesus what he wants Nicodemus to understand.`,

  `Listen to the text once in the easiest-to-understand version.

The word for __Spirit__ also means wind and breath. In verse 8 Jesus plays on both meanings. If your language has a word that carries both, this is the place for it. See [Spirit](#t-kt2) in the Master Glossary.

__Flesh__ here means ordinary human life, not something sinful. See [flesh](#t-kt3) in the Master Glossary.

__Perish__ and __eternal life__ are opposites: being destroyed for good, or having the life that doesn't end. See [life](#t-kt4) in the Master Glossary.

> [!action]
> Stop here and discuss this question as a group: Which words or ideas in this story don't have an easy match in your language?`,
], [
  { ref: "m1", kind: "media", title: "The bronze snake on a pole", description: "Numbers 21:8–9.",
    media: [{ id: "m1a", kind: "illustration", title: "The bronze snake on a pole", caption: "Whoever looked at the snake Moses lifted up lived." }] },
  term("kt2", "Spirit", "God's Spirit; also wind or breath"),
  term("kt3", "flesh", "the body, or human life"),
  term("kt4", "life", "God's kind of life, which doesn't end"),
]);
