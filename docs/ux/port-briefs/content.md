# Brief: content templates

Read `_common.md` first.

## You own
- `apps/mobile/src/screens/content.tsx`: `TemplatesHome` (`templates_home`), `TemplatePicker` (`template_picker`), `TemplateEditor` (`template_editor`), `BookStructure` (`book_structure`)

## Demo sources
`src/screens/content.tsx`, `src/content.ts`, `src/domain/boundaries.ts`. Requirements TPL-1..9. ADR-025, 026, 027. The old templates screen: `git show main:apps/mobile/src/screens/config.tsx` (`TemplatesHome`: lane template selection with core `instantiateTemplate`).

## Build
- TemplatesHome: at org/project level the library (core `contentTemplates()`) with Suggest toggles (`v1.CatalogItemToggled` kind `template`); at language level the language's template (from `state.laneTemplates`), its levels, "Change" (-> `template_picker`), the books to divide (-> `book_structure` with bookId) for shapers.
- TemplatePicker: suggested templates first, then others; "Use for this language" emits the selection and its units as the old screen did, then back.
- TemplateEditor: name, description, levels and the whole outline, read-only for catalog templates.
- BookStructure: a book read like a Bible (verse structure from `BIBLE_BOOKS` counts, text from `readingsFor` when available), passages shown as cards where they start (the lane's units in that book via core `unitPlace`), FIA's breaks as suggestions. Editing boundaries needs events that do not exist yet: show the structure read-only and say editing is coming.
