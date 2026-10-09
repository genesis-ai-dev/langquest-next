# Which language each v2 project really is

LangQuest v2 asked people for their project's "target language". Many didn't
see that it meant the language they translate into. They picked English (or
made their own copy of English, or picked their country's national language)
and named the real language in the project name. So a v2 project's language
can't be copied over as it is.

[`v2-project-languages.csv`](./v2-project-languages.csv) recommends a
language for every v2 project: 442 projects, built 2026-10-07 from v2
production (read with the publishable key). **Anyone who imports v2 records
into this app uses it** (AGENTS.md says so too). A person decides each row
before that project comes over. Nothing imports it automatically yet.

## Columns

| Column | Meaning |
| --- | --- |
| `v2_project_id` | v2 `project.id` |
| `project_name` | v2 name; left empty for private projects, because this repository is public |
| `active`, `private`, `assets` | v2 flags and the project's asset count |
| `current_target`, `current_source` | v2's `project_language_link` languages. `(legacy)` is v2's pre-Glottolog "English" row (`bd6027e5-…`), `(user-made)` a languoid a user created |
| `content_tagged` | the languages its `asset_content_link` rows carry, most common first |
| `recommended_target`, `_id`, `_glottocode` | the suggested language. The id is the languoid id here, which is v2's id for every Glottolog languoid v2 had (`docs/languoids.md`) |
| `recommended_source`, `_id` | the suggested source language; v2's legacy English becomes Glottolog English (`fd3b1f58-…`, `stan1293`) |
| `confidence` | see below |
| `reason` | why |
| `decision` | empty; whoever decides writes the final languoid id here |

| confidence | projects | assets | meaning |
| --- | --- | --- | --- |
| `keep` | 206 | 206,418 | the target is a Glottolog language, and the name names it, names nothing else, or names only the source |
| `high` | 1 | 45,463 | the target is English, and both the name and the content tags name the same other language |
| `medium` | 36 | 234,427 | the target is English, user-made, or no longer in Glottolog, and the name clearly names one language |
| `low` | 66 | 326,141 | a guess: the name matches several languages or only an alias, or a real target is contradicted by the name ("Dhimal" set to Nepali) |
| `review` | 133 | 46,965 | nothing to go on: mostly English targets on projects named "Test", "Dev test" and the like. English may be right |

Names were matched against Glottolog names, and against v2's aliases only
when the alias is English or has more than one word. This is why `low` is
noisy: "Lower assam deshi basha" matches an alias of a language in Canada.

## Records that follow the project's language

When a project's language changes, these v2 records change with it:

- `project_language_link` (target): becomes the decided language.
- `asset_content_link.languoid_id`: a row tagged with the project's old
  target (legacy English, a user-made language, or the wrong Glottolog
  language) is the project's own recorded content, so it takes the decided
  language. A row tagged with the project's source language stays as it is.
- `asset.source_language_id` points at v2's older `language` table and is
  not used.
- A source language of legacy English becomes Glottolog English.

## Refreshing it

The table is a snapshot from 2026-10-07, and v2 keeps changing. It was
built by one-off scripts, which are not kept in this repo. A project made in
v2 after that date has no row, so ask the developer about it. When the table
is rebuilt, keep every row's `decision`.
