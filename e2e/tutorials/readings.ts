// What the people in the videos say: what the speaker reads into the
// microphone (a tutorial's `speech`) and the recordings the filmed world
// already holds (voices.ts). make-readings.ts says them into WAV files.
//
// French (Louis Segond 1910) stands in for the made-up language in every
// film. What someone says in their own words (Ruth's feedback, her back
// translations) is said in the film's language, translated with the
// narration (translate-lines.ts).
//
// A reading is parts with a long pause after each (the recorder makes each a
// part); a part's pieces have a short breath between them.

export type Reading = {
  /** Grace reads Lumari; Ruth speaks the film's language. */
  who: 'grace' | 'ruth';
  parts: string[][];
  /** Quicker or slower than she speaks (1.45: too fast, the feedback's point). */
  speed?: number;
  /** Seconds of quiet before the first part, between parts, and after the last. */
  lead?: number;
  gap?: number;
  tail?: number;
};

// Luke 13:31-35.
const V31 = "Ce même jour, quelques pharisiens vinrent lui dire : Va-t'en, pars d'ici, car Hérode veut te faire mourir.";
const V32A = 'Il leur répondit : Allez, et dites à ce renard :';
const V32B = "Voici, je chasse les démons et je fais des guérisons aujourd'hui et demain, et le troisième jour j'aurai fini.";
const V33 = "Mais il faut que je marche aujourd'hui, demain, et le jour suivant ; car il ne convient pas qu'un prophète périsse hors de Jérusalem.";
const V34 = "Jérusalem, Jérusalem, qui tues les prophètes et qui lapides ceux qui te sont envoyés, combien de fois ai-je voulu rassembler tes enfants, comme une poule rassemble sa couvée sous ses ailes, et vous ne l'avez pas voulu !";
const V35 = 'Voici, votre maison vous sera laissée ; mais, je vous le dis, vous ne me verrez plus, jusqu\'à ce que vous disiez : Béni soit celui qui vient au nom du Seigneur !';
const OOPS = 'Euh… pardon, je recommence.';
// Luke 14:17-18, said too fast in Version 1 and again more slowly in Version 2.
const NEEDS_2 = ["À l'heure du souper, il envoya son serviteur dire aux conviés : Venez, car tout est déjà prêt.", "Mais tous unanimement se mirent à s'excuser. Le premier lui dit : J'ai acheté un champ, et je suis obligé d'aller le voir ; excuse-moi, je te prie."];

/** A recording of one part, as the world holds it. */
const part = (who: Reading['who'], pieces: string[], speed?: number): Reading => ({ who, parts: [pieces], speed, lead: 0.3, tail: 0.5 });

export const READINGS: Record<string, Reading> = {
  // Read into the microphone.
  // Luke 13:31-33, a verse a part (Record a passage, Key words, Finish and ask for a check).
  passage: { who: 'grace', parts: [[V31], [V32A + ' ' + V32B], [V33]], gap: 2.2 },
  // Give each part its verse: 31 | 32 (first half) | 32 (second half) | 33 | 34 and 35 as one part.
  verses: { who: 'grace', parts: [[V31], [V32A], [V32B], [V33], [V34, V35]] },
  // Hear, move and delete parts: 31 | 33 said too soon | 32 | a false start.
  fix: { who: 'grace', parts: [[V31], [V33], [V32A + ' ' + V32B], [OOPS]] },
  // Part 1 said again, a little slower.
  again: { who: 'grace', parts: [[V31]], speed: 0.92 },
  // Grace's word for "fox" (Luke 13:32).
  fox: part('grace', ['le renard']),
  // Grace's voice note on Luke 13:1-9: she is away this week.
  'away-note': part('grace', ["Je ne peux pas l'enregistrer cette semaine.", 'Je reviens lundi.']),
  // The group's answer to a study question about John 3:1-8.
  'study-answer': part('grace', ['Nicodème vient voir Jésus la nuit.', 'Il veut comprendre, mais il a peur des autres.']),
  // Luke 14:17-18 again, slower: the fix for Ruth's feedback.
  'needs-2-again': part('grace', NEEDS_2, 0.95),
  // Ruth's feedback in Do a check.
  'check-feedback': part('ruth', ['Verse twelve is a little fast. Please slow down there, so people can follow who is speaking.']),
  // Ruth says each part of Luke 14:25-35 again in her own language.
  'bt-said-1': part('ruth', ['Big crowds were walking with Jesus. He turned and said:', 'If someone comes to me and does not hate his father, his mother, his wife, his children, his brothers and sisters, and even his own life, he cannot be my disciple.']),
  'bt-said-2': part('ruth', ['Whoever does not carry his cross and follow me cannot be my disciple.', 'If one of you wants to build a tower, does he not first sit down and count the cost?']),
  'bt-said-3': part('ruth', ['Salt is good. But if salt loses its taste, how can it be salty again?', 'It is no good for the field, or for the manure pile. People throw it out. Whoever has ears, listen.']),

  // Held by the world (voices.ts).
  // Luke 15:11-16, the Peer check Ruth is asked for.
  'submitted-1': part('grace', ['Il dit encore : Un homme avait deux fils.', 'Le plus jeune dit à son père : Mon père, donne-moi la part de bien qui doit me revenir. Et le père leur partagea son bien.']),
  'submitted-2': part('grace', ['Peu de jours après, le plus jeune fils, ayant tout ramassé, partit pour un pays éloigné, où il dissipa son bien en vivant dans la débauche.', "Lorsqu'il eut tout dépensé, une grande famine survint dans ce pays, et il commença à se trouver dans le besoin."]),
  'submitted-3': part('grace', ["Il alla se mettre au service d'un des habitants du pays, qui l'envoya dans ses champs garder les pourceaux.", 'Il aurait bien voulu se rassasier des carouges que mangeaient les pourceaux, mais personne ne lui en donnait.']),
  // Luke 14:15-20, with verses 17-18 said too fast, and Ruth's feedback.
  'needs-1': part('grace', ['Un de ceux qui étaient à table, après avoir entendu ces paroles, dit à Jésus : Heureux celui qui prendra son repas dans le royaume de Dieu !', 'Et Jésus lui répondit : Un homme donna un grand souper, et il invita beaucoup de gens.']),
  'needs-2': part('grace', NEEDS_2, 1.45),
  'needs-3': part('grace', ["Un autre dit : J'ai acheté cinq paires de bœufs, et je vais les essayer ; excuse-moi, je te prie.", "Un autre dit : Je viens de me marier, et c'est pourquoi je ne puis aller."]),
  'needs-note': part('ruth', ['Verse eighteen is too fast. Please slow down there, so people can follow.']),
  // Luke 14:1-4, two parts kept as a draft.
  'draft-1': part('grace', ["Jésus étant entré, un jour de sabbat, dans la maison d'un des chefs des pharisiens, pour prendre un repas, les pharisiens l'observaient.", 'Et voici, un homme hydropique était devant lui.']),
  'draft-2': part('grace', ['Jésus prit la parole, et dit aux docteurs de la loi et aux pharisiens : Est-il permis, ou non, de faire une guérison le jour du sabbat ?', 'Ils gardèrent le silence. Alors Jésus avança la main sur ce malade, le guérit, et le renvoya.']),
  // Luke 14:25-35, Version 1, which Ruth back-translates.
  'bt-src-1': part('grace', ['De grandes foules faisaient route avec Jésus. Il se retourna, et leur dit :', "Si quelqu'un vient à moi, et s'il ne hait pas son père, sa mère, sa femme, ses enfants, ses frères, et ses sœurs, et même sa propre vie, il ne peut être mon disciple."]),
  'bt-src-2': part('grace', ['Et quiconque ne porte pas sa croix, et ne me suit pas, ne peut être mon disciple.', "Car, lequel de vous, s'il veut bâtir une tour, ne s'assied d'abord pour calculer la dépense et voir s'il a de quoi la terminer ?"]),
  'bt-src-3': part('grace', ["Le sel est une bonne chose ; mais si le sel perd sa saveur, avec quoi l'assaisonnera-t-on ?", "Il n'est bon ni pour la terre, ni pour le fumier ; on le jette dehors. Que celui qui a des oreilles pour entendre entende."]),
  // Luke 15:1-10, at the Consultant check, and Ruth's back translation of it.
  'check-1': part('grace', ["Tous les publicains et les gens de mauvaise vie s'approchaient de Jésus pour l'entendre.", 'Et les pharisiens et les scribes murmuraient, disant : Cet homme accueille des gens de mauvaise vie, et mange avec eux. Mais il leur dit cette parabole :']),
  'check-2': part('grace', ["Quel homme d'entre vous, s'il a cent brebis, et qu'il en perde une, ne laisse les quatre-vingt-dix-neuf autres dans le désert pour aller après celle qui est perdue, jusqu'à ce qu'il la retrouve ?", "Lorsqu'il l'a retrouvée, il la met avec joie sur ses épaules."]),
  'check-3': part('grace', ["Ou quelle femme, si elle a dix drachmes, et qu'elle en perde une, n'allume une lampe, ne balaie la maison, et ne cherche avec soin, jusqu'à ce qu'elle la retrouve ?", "De même, je vous le dis, il y a de la joie devant les anges de Dieu pour un seul pécheur qui se repent."]),
  'check-bt-1': part('ruth', ['All the tax collectors and bad people came close to Jesus to hear him. The Pharisees and the teachers grumbled: This man welcomes bad people and eats with them.', 'So he told them this story: If one of you has a hundred sheep and loses one, will you not leave the ninety-nine, and go after the lost one until you find it?']),
  'check-bt-2': part('ruth', ['Or if a woman has ten silver coins and loses one, will she not light a lamp, sweep the house, and look hard until she finds it?', 'In the same way, the angels of God are happy over one bad person who turns back.'])
};

/** What Ruth says, in English: translated with the narration for the other languages. */
export const RUTHS_WORDS: string[] = [...new Set(Object.values(READINGS).filter((r) => r.who === 'ruth').flatMap((r) => r.parts.flat()))];
