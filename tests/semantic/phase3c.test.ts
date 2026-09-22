import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { computePhase3CMetrics, loadAndValidatePhase3CInputs, renderPhase3CCorpus, renderPhase3CReview, type CandidateRow } from '../../scripts/semantic/phase3c';
import { scoreHumanReview } from '../../scripts/semantic/phase3c-score';

test('Phase 3C holdout is post-selection, multilingual, category-complete, and fully AI-labelled without claiming human review', async () => {
  const { holdout, labels, corpus } = await loadAndValidatePhase3CInputs({ corpusFile: 'tests/semantic/phase3c-corpus.fixture.json' });
  assert.equal(corpus.length, 154);
  assert.equal(new Set(corpus.map(photo => photo.publicId)).size, corpus.length);
  assert.equal(holdout.createdAfterModelSelection, true);
  assert.equal(holdout.modelSelectionUse, 'none');
  assert(holdout.queries.length >= 30);
  assert.deepEqual(new Set(holdout.queries.map(query => query.language)), new Set(['zh-Hans', 'zh-Hant', 'en', 'mixed']));
  assert.deepEqual(new Set(holdout.queries.map(query => query.category)), new Set(['object', 'scene', 'action', 'relation', 'difficult-paraphrase', 'near-match', 'no-match']));
  assert.equal(labels.status, 'ai-assisted-not-independent-human');
  assert.match(labels.annotator, /not an independent human review/i);
  assert.equal(Object.keys(labels.labels).length, holdout.queries.length);
  assert(holdout.queries.filter(query => query.expected === 'no-match').length >= 6);
  const pending = JSON.parse(await fs.readFile('semantic-evaluation/phase3c/human-review.json', 'utf8'));
  assert.equal(pending.status, 'pending');
  assert.equal(pending.reviewer, null);
});

test('review page starts blind, separates Top-5/Top-10, exports judgements, and calls cosine a non-probability', () => {
  const rows: CandidateRow[] = [{
    query: { id: 'fixture', language: 'en', category: 'object', expected: 'present', text: 'fixture query', criterion: 'fixture criterion' },
    elapsedMs: 12,
    results: Array.from({ length: 10 }, (_, index) => ({ publicId: String(index).padStart(16, '0'), rank: index + 1, score: .2 - index / 100, ordinal: index, filename: `${index}.jpg`, thumbnail: `public/thumbnails/${index}.jpg`, projects: [] })),
  }];
  const labels = { labels: { fixture: { answerable: true, relevantPublicIds: ['0000000000000000'] } } } as never;
  const html = renderPhase3CReview('fixture-set', 'fixture-index', rows, labels);
  assert.match(html, /AI prep label: relevant/);
  assert.match(html, /\.diagnostic,\.ai-label\{display:none\}/);
  assert.match(html, /cosine .*not probability/);
  assert.equal((html.match(/<figure class="candidate/g) ?? []).length, 10);
  assert.equal((html.match(/class="candidate secondary"/g) ?? []).length, 5);
  assert.match(html, /Export review JSON/);
  assert.match(html, /complete 154-photo corpus sheet/);
  assert.match(html, /blind corpus-answerability and Top-10 visual relevance review/);
});

test('corpus review sheet is unranked and contains no model scores or assisted labels', () => {
  const html = renderPhase3CCorpus([{ ordinal: 0, publicId: 'AAAAAAAAAAAAAAAA', filename: 'a.jpg', thumbnail: 'public/thumbnails/a.jpg', width: 1, height: 1, projects: [] }]);
  assert.match(html, /Unranked public thumbnails/);
  assert.match(html, /AAAAAAAAAAAAAAAA/);
  assert.doesNotMatch(html, /cosine|AI prep label|relevant/i);
});

test('no-result diagnostics keep the production threshold disabled and positive metrics exclude no-match controls', () => {
  const query = (id: string, expected: 'present' | 'no-match'): CandidateRow => ({
    query: { id, language: 'en', category: expected === 'present' ? 'object' : 'no-match', expected, text: id, criterion: id },
    elapsedMs: 10,
    results: [
      { publicId: 'AAAAAAAAAAAAAAAA', rank: 1, score: .2, ordinal: 0, filename: 'a.jpg', thumbnail: 'public/a.jpg', projects: [] },
      { publicId: 'BBBBBBBBBBBBBBBB', rank: 2, score: .19, ordinal: 1, filename: 'b.jpg', thumbnail: 'public/b.jpg', projects: [] },
      { publicId: 'CCCCCCCCCCCCCCCC', rank: 3, score: .18, ordinal: 2, filename: 'c.jpg', thumbnail: 'public/c.jpg', projects: [] },
      { publicId: 'DDDDDDDDDDDDDDDD', rank: 4, score: .17, ordinal: 3, filename: 'd.jpg', thumbnail: 'public/d.jpg', projects: [] },
      { publicId: 'EEEEEEEEEEEEEEEE', rank: 5, score: .16, ordinal: 4, filename: 'e.jpg', thumbnail: 'public/e.jpg', projects: [] },
    ],
  });
  const labels = { labels: { positive: { answerable: true, relevantPublicIds: ['AAAAAAAAAAAAAAAA'] }, negative: { answerable: false, relevantPublicIds: [] } } } as never;
  const metrics = computePhase3CMetrics([query('positive', 'present'), query('negative', 'no-match')], labels);
  assert.equal(metrics.positive.queryCount, 1);
  assert.equal((metrics.positive as Record<string, number>).hit1, 1);
  assert.equal(metrics.noMatchDiagnostics.queryCount, 1);
  assert.equal(metrics.noResultPolicy.productionThresholdEnabled, false);
  assert.match(metrics.noMatchDiagnostics.cosineMeaning, /not a probability/);
  assert(metrics.noResultPolicy.proposedProtocol.some(step => /validation/i.test(step)));
});

test('independent human scorer rejects pending work and enforces frozen ranking checks', () => {
  const rows: CandidateRow[] = [{
    query: { id: 'fixture', language: 'en', category: 'object', expected: 'present', text: 'fixture', criterion: 'fixture' },
    elapsedMs: 1,
    results: Array.from({ length: 10 }, (_, index) => ({ publicId: `id-${index}`, rank: index + 1, score: .2 - index / 100, ordinal: index, filename: `${index}.jpg`, thumbnail: `${index}.jpg`, projects: [] })),
  }];
  const candidates = { schemaVersion: 1, querySet: 'fixture', runtime: { ready: { indexVersion: 'v1' } }, rows } as never;
  const gates = { schemaVersion: 1, querySet: 'fixture', positiveRanking: { minimumAnswerableQueries: 1, hitAt1Minimum: 1, hitAt5Minimum: 1, hitAt10Minimum: 1, meanReciprocalRankMinimum: 1, perLanguageHitAt5Minimum: 1, perLanguageMinimumAnswerableQueries: 1 }, noResult: { productionThresholdEnabled: false } } as never;
  const decisions = Object.fromEntries(rows[0]!.results.map(result => [result.publicId, result.rank === 1 ? 'relevant' : 'not-relevant']));
  assert.throws(() => scoreHumanReview(candidates, { status: 'pending' } as never, gates), /still pending/);
  const scored = scoreHumanReview(candidates, { schemaVersion: 1, querySet: 'fixture', indexVersion: 'v1', status: 'complete', reviewer: 'independent-reviewer-1', independentFromModelSelection: true, completedAt: '2026-09-22T00:00:00.000Z', answerability: { fixture: 'answerable' }, judgements: { fixture: decisions } } as never, gates);
  assert.equal(scored.pass, true);
  assert.equal(scored.metrics.overall.hit1, 1);
  assert.equal(scored.noResultThresholdEnabled, false);
});
