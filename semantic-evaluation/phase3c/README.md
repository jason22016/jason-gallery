# Semantic Search Phase 3C relevance gate

`holdout-queries.json` is a new post-model-selection query set. Its exact query strings are checked against the Phase 1/2, extra-paraphrase and hard-query inputs so a previously used query cannot silently become the only release gate.

`ai-assisted-labels.json` was frozen from Codex thumbnail inspection before model candidates were generated. It supports automated diagnostics only. It is explicitly not independent human ground truth.

Run:

```bash
pnpm semantic:phase3c
```

This uses the production client release in Google Chrome, writes Top-10 candidates and AI-assisted metrics under `reports/semantic/phase3c/`, and builds `review.html` plus an unranked `corpus.html` containing all 154 public thumbnails. The review starts blind: assisted labels, expected-answer classes and cosine diagnostics are hidden. It stores decisions in local browser storage and exports a review JSON.

Release procedure:

1. An independent reviewer opens `reports/semantic/phase3c/review.html`, uses the linked complete corpus sheet to judge answerability, and judges every Top-10 result from the written criterion.
2. The reviewer exports JSON, identifies themselves, sets `independentFromModelSelection` to `true`, checks completeness and replaces the pending `human-review.json` template.
3. Run `pnpm semantic:phase3c:score`. It rejects missing/unsure decisions and evaluates the frozen positive-ranking gates in `release-gates.json`.

The frozen gates are a practical small-sample release screen, not a statistically powered non-inferiority claim. They require all 38 answerability decisions and all 380 Top-10 judgements, no `unsure`, an independent-review declaration, at least 24 human-answerable queries, Hit@1 ≥ 0.60, Hit@5 ≥ 0.90, Hit@10 ≥ 0.95, MRR ≥ 0.72, and Hit@5 ≥ 0.80 for each language bucket with at least four answerable queries.

Cosine values are ranking signals, not probabilities. Phase 3C does not ship an abstention threshold from six AI-labelled negative examples. The policy and minimum calibration evidence are recorded in `metrics.json` and `SEMANTIC_SEARCH_PHASE3C.md`.
