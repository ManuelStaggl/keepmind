# Memory evaluation

Measures the thing keepmind sells: does a question return the record that
answers it? `evals/swebench` measures whether a coding agent can patch a
repository, which is a different question and was the only one being asked.

```bash
npm run eval:memory                                  # both channels
npm run eval:memory -- --no-vector                   # keyword only, fast
npm run eval:memory -- --out run.json                # save a run
npm run eval:memory -- --compare baseline-4.0.0.json # diff against a saved run
npm run eval:memory -- --project steuerstand         # default
```

No Docker. It runs the real search code against the real database.

## What the numbers mean

| Set | Question shape | Metric |
|---|---|---|
| **B** | A paraphrase of one record's content, in different words | hit@1, hit@10, MRR |
| **C** | "Was gilt zu X?" — several records are correct | hit@1, hit@10, MRR |
| **D** | The same term in both German spellings | agreement between the two result lists |

Set D scores agreement, not relevance. Two spellings that both find nothing
score 0, not a vacuous 1 — equally blind is not equally good.

There is **no pass/fail verdict**. No threshold makes retrieval "good", and
inventing one here would repeat the mistake B8 forbids for ranking: real hits
sit at a median similarity of 0.901 and the highest false hit at 0.900.

## Reading a run honestly

- **The numbers describe the corpus in the database at the time of the run.**
  A run is comparable to another run over the same corpus, and to nothing else.
  The header prints the record count for that reason.
- **Questions are paraphrases only.** A question quoting a record's own title
  measures string equality and reports it as retrieval quality — it cannot
  fail, so it cannot inform.
- **Rows from ordinary observation capture share the database.** They are
  counted in what a channel returns but never score. That noise is present when
  a real question is asked, so removing it would flatter every number.
- **These figures are not comparable to `WISSEN-Aehnlichkeitssuche.md`.** That
  measurement used a different question set against 126 records; set C here is
  easier, because several records count as correct.

## Baselines in this directory

`baseline-4.0.0.json` — keepmind 4.0.0 as shipped, before the FTS query fix:

| Channel | B @1/@10 | C @1/@10 | D agreement |
|---|---|---|---|
| fts | 0% / 0% | 0% / 0% | 0% (0/9 identical) |
| vector | 67% / 100% | 80% / 100% | 31% (0/9) |

The keyword channel retrieved **nothing at all** — every question is multi-word,
and the query builder wrapped each one in a single pair of quotes, making it an
exact phrase search. The vector channel had been covering for it, which is why
it went unnoticed. `fts_hit_count = 0` across every row was read as "search is
unused"; it was two separate faults reading as one.

`nach-b7.json` — after `src/services/sqlite/fts-query.ts`:

| Channel | B @1/@10 | C @1/@10 | D agreement |
|---|---|---|---|
| fts | 58% / 75% | 70% / 90% | 100% (9/9 identical) |
| vector | unchanged | unchanged | 31% (0/9) |

The vector channel is untouched — only the keyword path changed. Its 31%
spelling agreement is a real remaining gap: the multilingual embedder bridges
German spellings only partly, and nothing in this change addresses that.

## Adding questions

Append to `questions.jsonl`. Keep `herkunft` honest — if a question reuses the
record's own wording, say so, and expect its score to mean less.

Set D terms were harvested from the corpus by frequency rather than invented;
`korpus` records how often each appeared. Terms that do not occur measure
nothing.
