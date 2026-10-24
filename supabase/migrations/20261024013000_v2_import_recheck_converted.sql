-- v2's MP3 and WebM files were written down as missing: the import read
-- only WAV and M4A, though v2's storage has every one of them (573 files,
-- for 13 of Every Language's languages and 20 others, checked 2026-10-23).
-- It converts them to M4A now (decisions.md 94, amended 2026-10-24). A
-- missing file is looked for again for a week only, and these were written
-- down on 2026-10-14, so their marks are forgotten here: the next pass that
-- reads them, the whole read at 03:15 UTC at the latest, looks again. A
-- file still missing is written down again then.
delete from v2_import.files
where hash is null and name !~* '\.(wav|m4a)$';
