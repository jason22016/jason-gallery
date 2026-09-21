import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CandidateRow } from './phase3c';

type Answerability = 'answerable' | 'no-match' | 'unsure';
type Judgement = 'relevant' | 'not-relevant' | 'unsure';

interface HumanReview {
  schemaVersion: 1;
  querySet: string;
  indexVersion: string | null;
  status: 'pending' | 'complete';
  reviewer: string | null;
  independentFromModelSelection: boolean | null | string;
  completedAt: string | null;
  answerability: Record<string, Answerability>;
  judgements: Record<string, Record<string, Judgement>>;
}

interface ReleaseGates {
  schemaVersion: 1;
  querySet: string;
  positiveRanking: {
    minimumAnswerableQueries: number;
    hitAt1Minimum: number;
    hitAt5Minimum: number;
    hitAt10Minimum: number;
    meanReciprocalRankMinimum: number;
    perLanguageHitAt5Minimum: number;
    perLanguageMinimumAnswerableQueries: number;
  };
  noResult: { productionThresholdEnabled: false };
}

interface CandidatesFile {
  schemaVersion: 1;
  querySet: string;
  runtime: { ready: { indexVersion?: string } };
  rows: CandidateRow[];
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function rounded(value: number): number {
  return Number(value.toFixed(6));
}

function rankingMetrics(rows: CandidateRow[], review: HumanReview, allLanguages: string[]) {
  const perQuery = rows.map(row => {
    const relevantRanks = row.results.filter(result => review.judgements[row.query.id]![result.publicId] === 'relevant').map(result => result.rank);
    const first = relevantRanks[0];
    const dcg = (k: number) => relevantRanks.filter(rank => rank <= k).reduce((sum, rank) => sum + 1 / Math.log2(rank + 1), 0);
    const ideal = (k: number) => Array.from({ length: Math.min(k, relevantRanks.length) }, (_, index) => 1 / Math.log2(index + 2)).reduce((sum, value) => sum + value, 0);
    return {
      id: row.query.id,
      language: row.query.language,
      relevantInTop10: relevantRanks.length,
      hit1: relevantRanks.some(rank => rank <= 1) ? 1 : 0,
      hit5: relevantRanks.some(rank => rank <= 5) ? 1 : 0,
      hit10: relevantRanks.length ? 1 : 0,
      reciprocalRank: first ? 1 / first : 0,
      ndcg5: ideal(5) ? dcg(5) / ideal(5) : 0,
      ndcg10: ideal(10) ? dcg(10) / ideal(10) : 0,
    };
  });
  const summarize = (items: typeof perQuery) => ({
    queryCount: items.length,
    hit1: rounded(mean(items.map(item => item.hit1))),
    hit5: rounded(mean(items.map(item => item.hit5))),
    hit10: rounded(mean(items.map(item => item.hit10))),
    meanReciprocalRank: rounded(mean(items.map(item => item.reciprocalRank))),
    ndcg5: rounded(mean(items.map(item => item.ndcg5))),
    ndcg10: rounded(mean(items.map(item => item.ndcg10))),
  });
  return { overall: summarize(perQuery), byLanguage: Object.fromEntries(allLanguages.map(language => [language, summarize(perQuery.filter(item => item.language === language))])), perQuery };
}

export function scoreHumanReview(candidates: CandidatesFile, review: HumanReview, gates: ReleaseGates) {
  if (review.status !== 'complete') throw new Error('Independent human review is still pending');
  if (!review.reviewer || review.reviewer === 'FILL_REVIEWER_ID') throw new Error('Reviewer identity is missing');
  if (review.independentFromModelSelection !== true) throw new Error('Independent reviewer declaration must be true');
  if (!review.completedAt || !Number.isFinite(Date.parse(review.completedAt))) throw new Error('Review completion timestamp is missing or invalid');
  if (review.querySet !== candidates.querySet || gates.querySet !== candidates.querySet) throw new Error('Query-set mismatch');
  if (review.indexVersion !== candidates.runtime.ready.indexVersion) throw new Error('Index-version mismatch');

  const expectedIds = new Set(candidates.rows.map(row => row.query.id));
  if (Object.keys(review.answerability).length !== expectedIds.size || Object.keys(review.judgements).length !== expectedIds.size) throw new Error('Every query must have answerability and Top-10 judgements');
  for (const supplied of [...Object.keys(review.answerability), ...Object.keys(review.judgements)]) if (!expectedIds.has(supplied)) throw new Error(`Unknown reviewed query: ${supplied}`);

  for (const row of candidates.rows) {
    const answerability = review.answerability[row.query.id];
    if (answerability !== 'answerable' && answerability !== 'no-match') throw new Error(`Missing or unsure answerability: ${row.query.id}`);
    const decisions = review.judgements[row.query.id];
    const resultIds = new Set(row.results.map(result => result.publicId));
    if (!decisions || Object.keys(decisions).length !== row.results.length) throw new Error(`Exactly ${row.results.length} candidate judgements are required: ${row.query.id}`);
    for (const [publicId, decision] of Object.entries(decisions)) {
      if (!resultIds.has(publicId)) throw new Error(`Unknown candidate ${publicId} for ${row.query.id}`);
      if (decision !== 'relevant' && decision !== 'not-relevant') throw new Error(`Missing or unsure candidate judgement: ${row.query.id}/${publicId}`);
      if (answerability === 'no-match' && decision === 'relevant') throw new Error(`No-match query has a relevant candidate: ${row.query.id}/${publicId}`);
    }
  }

  const positiveRows = candidates.rows.filter(row => review.answerability[row.query.id] === 'answerable');
  const metrics = rankingMetrics(positiveRows, review, [...new Set(candidates.rows.map(row => row.query.language))].sort());
  const checks = [
    { id: 'minimum-answerable-queries', actual: metrics.overall.queryCount, required: gates.positiveRanking.minimumAnswerableQueries, pass: metrics.overall.queryCount >= gates.positiveRanking.minimumAnswerableQueries },
    { id: 'hit-at-1', actual: metrics.overall.hit1, required: gates.positiveRanking.hitAt1Minimum, pass: metrics.overall.hit1 >= gates.positiveRanking.hitAt1Minimum },
    { id: 'hit-at-5', actual: metrics.overall.hit5, required: gates.positiveRanking.hitAt5Minimum, pass: metrics.overall.hit5 >= gates.positiveRanking.hitAt5Minimum },
    { id: 'hit-at-10', actual: metrics.overall.hit10, required: gates.positiveRanking.hitAt10Minimum, pass: metrics.overall.hit10 >= gates.positiveRanking.hitAt10Minimum },
    { id: 'mean-reciprocal-rank', actual: metrics.overall.meanReciprocalRank, required: gates.positiveRanking.meanReciprocalRankMinimum, pass: metrics.overall.meanReciprocalRank >= gates.positiveRanking.meanReciprocalRankMinimum },
    ...Object.entries(metrics.byLanguage).flatMap(([language, values]) => [
      { id: `${language}-minimum-answerable-queries`, actual: values.queryCount, required: gates.positiveRanking.perLanguageMinimumAnswerableQueries, pass: values.queryCount >= gates.positiveRanking.perLanguageMinimumAnswerableQueries },
      { id: `${language}-hit-at-5`, actual: values.hit5, required: gates.positiveRanking.perLanguageHitAt5Minimum, pass: values.hit5 >= gates.positiveRanking.perLanguageHitAt5Minimum },
    ]),
  ];
  return {
    schemaVersion: 1,
    evidenceClass: 'independent human visual review',
    querySet: candidates.querySet,
    indexVersion: review.indexVersion,
    reviewer: review.reviewer,
    completedAt: review.completedAt,
    noResultThresholdEnabled: gates.noResult.productionThresholdEnabled,
    metrics,
    checks,
    pass: checks.every(check => check.pass),
  };
}

async function main(): Promise<void> {
  const root = path.resolve('.');
  const candidates = JSON.parse(await fs.readFile(path.join(root, 'reports/semantic/phase3c/candidates.json'), 'utf8')) as CandidatesFile;
  const review = JSON.parse(await fs.readFile(path.join(root, 'semantic-evaluation/phase3c/human-review.json'), 'utf8')) as HumanReview;
  const gates = JSON.parse(await fs.readFile(path.join(root, 'semantic-evaluation/phase3c/release-gates.json'), 'utf8')) as ReleaseGates;
  const result = scoreHumanReview(candidates, review, gates);
  await fs.writeFile(path.join(root, 'reports/semantic/phase3c/human-metrics.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ pass: result.pass, reviewer: result.reviewer, metrics: result.metrics.overall }));
  if (!result.pass) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
