# Key-term evaluation sets

The bar for the key-term check (decision 207, LAN-228). A set is a folder of
short recordings from a partner language, with the truth written down. The
script measures each matcher against it; nothing here is app code.

```
eval/key-terms/<set>/
  manifest.json
  terms/<term>-1.wav        two or three recordings of the team saying each term
  passages/<passage>.wav    a passage take, a minute or two
```

`manifest.json`:

```json
{
  "language": "Dinka",
  "terms": [{ "termId": "logos", "examples": ["terms/logos-1.wav", "terms/logos-2.wav"] }],
  "passages": [{ "id": "luke1-take3", "file": "passages/luke1-take3.wav", "heard": ["logos"] }]
}
```

`heard` lists the terms said in that passage; every other term of the set is
known **not** to be there. A good set has each term in some passages and
absent from others, so both precision and recall can be measured. Files are
16-bit PCM WAV (the app's recorder makes them); real partner recordings stay
out of git until the partner agrees to share them (`.gitignore` skips every
set folder), so put them in the set's folder locally.

Run it: `npm run key-terms:eval -- eval/key-terms/<set>`. See
`scripts/key-term-eval.ts` for the options.
