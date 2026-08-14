# Memory evaluation

Measures the thing keepmind sells: does a question return the record that
answers it? `evals/swebench` measures whether a coding agent can patch a
repository, which is a different question and was the only one being asked.

```bash
npm run eval:memory                                  # all three channels
npm run eval:memory -- --no-vector --no-worker       # keyword only, fast
npm run eval:memory -- --out run.json                # save a run
npm run eval:memory -- --compare baseline-4.0.0.json # diff against a saved run
npm run eval:memory -- --project steuerstand         # default
```

No Docker. It runs the real search code against the real database.

## The three channels

| Channel | What it calls | Why it is here |
|---|---|---|
| `fts` | `SessionSearch` directly | the keyword path in isolation |
| `vector` | `SqliteVecManager` directly | the semantic path in isolation |
| `worker` | `GET /api/search` on the running worker | **what a person actually gets** |

The `worker` channel needs a running worker and says so when there is none,
rather than scoring zero.

It exists because the two direct channels are not enough, and that is not a
hypothetical: a ranking fault lived between `SessionSearch` and the answer, and
both direct channels scored it fine because neither goes through the code that
broke it. Hydration by id discarded the fused ranking, so the question "Lizenz
nennen ist nicht mitliefern" — nearly the title of record 0081 — returned the
five most recently imported records, and 0081 was not among them. A measurement
that cannot see the path the user takes will keep reporting health while the
product is broken.

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

`nach-b8.json` — after the ranking fix, with the `worker` channel added:

| Channel | B @1/@10 | C @1/@10 | D agreement |
|---|---|---|---|
| fts | 58% / 75% | 70% / 90% | 100% (9/9) |
| vector | 67% / 100% | 80% / 100% | 31% (0/9) |
| **worker** | **71% / 96%** | 70% / 100% | 41% (0/9) |

The fused path beats both channels it fuses at @1, which is the point of RRF —
and was worth nothing while the ranking was being discarded during hydration.
Its 41% spelling agreement sits between the two: the keyword half now matches
both spellings perfectly, the semantic half still does not, and fusing them
averages the two.

`nach-b1-rest.json` — **different corpus**: 333 records (137 decisions + 196
work items) instead of 126.

| Channel | B @1/@10 | C @1/@10 | D agreement |
|---|---|---|---|
| fts | 54% / 75% | 70% / 90% | 89% (8/9) |
| vector | 71% / 88% | 80% / 100% | 11% (0/9) |
| **worker** | **75% / 96%** | 70% / 100% | 24% (0/9) |

**Do not read the deltas against the earlier runs as regressions.** The corpus
grew by a factor of 2.6 and now contains 196 work items that no question asks
about, so every question competes against far more candidates. That is why
`--compare` prints a diff and not a verdict.

The one number that is comparable is the direction of the fused path under a
harder corpus: 71% → 75% @1. The spelling figures fall for the same reason they
are measured as set agreement — more documents means the two top-10 lists
overlap less, not that folding got worse.

## Adding questions

Append to `questions.jsonl`. Keep `herkunft` honest — if a question reuses the
record's own wording, say so, and expect its score to mean less.

Set D terms were harvested from the corpus by frequency rather than invented;
`korpus` records how often each appeared. Terms that do not occur measure
nothing.
