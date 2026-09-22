import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serveSemanticBrowserFixture } from '../../tests/semantic-browser/server';

const root = path.resolve('.');
const evaluationDirectory = path.join(root, 'semantic-evaluation/phase3c');
const reportDirectory = path.join(root, 'reports/semantic/phase3c');

export interface HoldoutQuery {
  id: string;
  language: 'zh-Hans' | 'zh-Hant' | 'en' | 'mixed';
  category: 'object' | 'scene' | 'action' | 'relation' | 'difficult-paraphrase' | 'near-match' | 'no-match';
  expected: 'present' | 'near-match' | 'no-match';
  text: string;
  criterion: string;
}

interface HoldoutFile {
  schemaVersion: 1;
  name: string;
  createdAfterModelSelection: boolean;
  modelSelectionUse: 'none';
  corpusFingerprint: string;
  instructions: string;
  queries: HoldoutQuery[];
}

interface AssistedLabel {
  answerable: boolean;
  relevantPublicIds: string[];
}

interface LabelsFile {
  schemaVersion: 1;
  querySet: string;
  status: 'ai-assisted-not-independent-human';
  frozenBeforeCandidateGeneration: boolean;
  annotator: string;
  method: string;
  limitations: string[];
  labels: Record<string, AssistedLabel>;
}

interface CorpusPhoto {
  ordinal: number;
  publicId: string;
  filename: string;
  thumbnail: string;
  width: number;
  height: number;
  projects: Array<{ slug: string; title: string }>;
}

interface CandidateResult {
  publicId: string;
  rank: number;
  score: number;
  ordinal: number;
  filename: string;
  thumbnail: string;
  projects: string[];
}

export interface CandidateRow {
  query: HoldoutQuery;
  elapsedMs: number;
  results: CandidateResult[];
}

function exactKeys(value: object, expected: string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) throw new Error(`${label} has unexpected or missing fields`);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function readJSON<T>(filename: string): Promise<T> {
  return JSON.parse(await fs.readFile(filename, 'utf8')) as T;
}

async function priorQueryTexts(): Promise<Set<string>> {
  const original = await readJSON<Array<{ zh: string; en: string }>>(path.join(root, 'scripts/semantic-spike/queries.json'));
  const extra = await readJSON<Array<{ text: string }>>(path.join(root, 'scripts/semantic-spike/smaller/extra-queries.json'));
  const hard = await readJSON<Array<{ text: string }>>(path.join(root, 'scripts/semantic-spike/quantized/hard-queries.json'));
  return new Set([...original.flatMap(query => [query.zh, query.en]), ...extra.map(query => query.text), ...hard.map(query => query.text)].map(text => text.normalize('NFKC').trim()));
}

export async function loadAndValidatePhase3CInputs(options: { corpusFile?: string } = {}): Promise<{
  holdout: HoldoutFile;
  labels: LabelsFile;
  corpus: CorpusPhoto[];
}> {
  const holdout = await readJSON<HoldoutFile>(path.join(evaluationDirectory, 'holdout-queries.json'));
  const labels = await readJSON<LabelsFile>(path.join(evaluationDirectory, 'ai-assisted-labels.json'));
  const corpusFile = await readJSON<{ fingerprint: string; photos: CorpusPhoto[] }>(options.corpusFile ?? path.join(root, '.cache/semantic-spike/corpus.json'));
  exactKeys(holdout, ['schemaVersion', 'name', 'createdAfterModelSelection', 'modelSelectionUse', 'corpusFingerprint', 'instructions', 'queries'], 'Holdout query set');
  if (holdout.schemaVersion !== 1 || !holdout.createdAfterModelSelection || holdout.modelSelectionUse !== 'none') throw new Error('Holdout provenance is invalid');
  if (holdout.corpusFingerprint !== corpusFile.fingerprint) throw new Error('Holdout corpus fingerprint does not match the current evaluation corpus');
  if (labels.querySet !== holdout.name || labels.status !== 'ai-assisted-not-independent-human' || !labels.frozenBeforeCandidateGeneration) throw new Error('AI-assisted label provenance is invalid');
  if (holdout.queries.length < 30) throw new Error('Phase 3C holdout must contain at least 30 queries');
  const ids = new Set<string>();
  const texts = new Set<string>();
  const oldTexts = await priorQueryTexts();
  const corpusIds = new Set(corpusFile.photos.map(photo => photo.publicId));
  for (const query of holdout.queries) {
    exactKeys(query, ['id', 'language', 'category', 'expected', 'text', 'criterion'], `Holdout query ${query.id}`);
    if (!/^[a-z0-9-]+$/.test(query.id) || ids.has(query.id)) throw new Error(`Duplicate or invalid holdout query ID: ${query.id}`);
    ids.add(query.id);
    const normalized = query.text.normalize('NFKC').trim();
    if (!normalized || texts.has(normalized) || oldTexts.has(normalized)) throw new Error(`Holdout query is empty, duplicated, or reused from model selection: ${query.id}`);
    texts.add(normalized);
    const label = labels.labels[query.id];
    if (!label || label.answerable !== (query.expected !== 'no-match')) throw new Error(`Missing or inconsistent AI-assisted label: ${query.id}`);
    if (label.answerable !== (label.relevantPublicIds.length > 0)) throw new Error(`Answerability/qrel mismatch: ${query.id}`);
    if (label.relevantPublicIds.some(id => !corpusIds.has(id))) throw new Error(`Unknown public ID in AI-assisted labels: ${query.id}`);
  }
  if (Object.keys(labels.labels).length !== holdout.queries.length) throw new Error('AI-assisted labels contain extra or missing queries');
  for (const language of ['zh-Hans', 'zh-Hant', 'en', 'mixed']) if (!holdout.queries.some(query => query.language === language)) throw new Error(`Holdout is missing ${language}`);
  for (const category of ['object', 'scene', 'action', 'relation', 'difficult-paraphrase', 'near-match', 'no-match']) if (!holdout.queries.some(query => query.category === category)) throw new Error(`Holdout is missing ${category}`);
  return { holdout, labels, corpus: corpusFile.photos };
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function round(value: number | null, digits = 6): number | null {
  return value === null ? null : Number(value.toFixed(digits));
}

function queryMetrics(row: CandidateRow, label: AssistedLabel) {
  const relevant = new Set(label.relevantPublicIds);
  const positions = row.results.filter(result => relevant.has(result.publicId)).map(result => result.rank);
  const first = positions[0];
  const at = (k: number) => positions.filter(position => position <= k).length;
  const ideal = (k: number) => Array.from({ length: Math.min(k, relevant.size) }, (_, index) => 1 / Math.log2(index + 2)).reduce((sum, value) => sum + value, 0);
  const dcg = (k: number) => positions.filter(position => position <= k).reduce((sum, position) => sum + 1 / Math.log2(position + 1), 0);
  return {
    hit1: at(1) > 0 ? 1 : 0,
    hit5: at(5) > 0 ? 1 : 0,
    hit10: at(10) > 0 ? 1 : 0,
    reciprocalRank: first ? 1 / first : 0,
    precision5: at(5) / 5,
    precision10: at(10) / 10,
    recall5: at(5) / relevant.size,
    recall10: at(10) / relevant.size,
    ndcg5: ideal(5) ? dcg(5) / ideal(5) : 0,
    ndcg10: ideal(10) ? dcg(10) / ideal(10) : 0,
  };
}

function summarize(rows: CandidateRow[], labels: LabelsFile) {
  const positives = rows.filter(row => labels.labels[row.query.id]!.answerable);
  const metrics = positives.map(row => queryMetrics(row, labels.labels[row.query.id]!));
  const keys = Object.keys(metrics[0] ?? {}) as Array<keyof (typeof metrics)[number]>;
  return {
    queryCount: positives.length,
    ...Object.fromEntries(keys.map(key => [key, round(mean(metrics.map(metric => metric[key])))])),
  };
}

export function computePhase3CMetrics(rows: CandidateRow[], labels: LabelsFile) {
  const groups = (key: 'language' | 'category') => Object.fromEntries([...new Set(rows.map(row => row.query[key]))].sort().map(value => [value, summarize(rows.filter(row => row.query[key] === value), labels)]));
  const noMatch = rows.filter(row => !labels.labels[row.query.id]!.answerable).map(row => ({
    id: row.query.id,
    top1Cosine: round(row.results[0]?.score ?? 0),
    top1Top2Margin: round((row.results[0]?.score ?? 0) - (row.results[1]?.score ?? 0)),
    top1Top5Margin: round((row.results[0]?.score ?? 0) - (row.results[4]?.score ?? 0)),
  }));
  const positiveSignals = rows.filter(row => labels.labels[row.query.id]!.answerable).map(row => row.results[0]?.score ?? 0);
  const negativeSignals = noMatch.map(row => row.top1Cosine ?? 0);
  return {
    evidenceClass: 'AI-assisted labels; not independent human review',
    positive: summarize(rows, labels),
    byLanguage: groups('language'),
    byCategory: groups('category'),
    latencyMs: {
      count: rows.length,
      mean: round(mean(rows.map(row => row.elapsedMs)), 3),
      min: round(Math.min(...rows.map(row => row.elapsedMs)), 3),
      max: round(Math.max(...rows.map(row => row.elapsedMs)), 3),
    },
    noMatchDiagnostics: {
      queryCount: noMatch.length,
      rows: noMatch,
      positiveTop1Range: positiveSignals.length ? [round(Math.min(...positiveSignals)), round(Math.max(...positiveSignals))] : null,
      noMatchTop1Range: negativeSignals.length ? [round(Math.min(...negativeSignals)), round(Math.max(...negativeSignals))] : null,
      cosineMeaning: 'opaque ranking signal, not a probability',
    },
    noResultPolicy: {
      productionThresholdEnabled: false,
      status: 'manual-calibration-gate-open',
      rationale: 'Six AI-labelled no-match queries cannot justify a production abstention threshold. False matches are safer than an unvalidated threshold only when the UI describes results as nearest available candidates rather than probabilities or guaranteed matches.',
      proposedProtocol: [
        'Independently label corpus answerability before revealing scores or candidates.',
        'Collect at least 100 queries, including at least 30 no-match queries distributed across all supported language buckets and difficult paraphrases.',
        'Split labels into calibration and untouched validation partitions; lock score/margin rules on calibration only.',
        'Treat top-1 cosine and rank margins as opaque signals, sweep deterministic rules, and report false-accept/false-reject rates with Wilson confidence intervals.',
        'Ship abstention only if the locked validation gate is met; otherwise continue showing clearly labelled nearest available results.',
      ],
    },
  };
}

function escapeHTML(value: unknown): string {
  return String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]!);
}

export function renderPhase3CReview(querySet: string, indexVersion: string, rows: CandidateRow[], labels: LabelsFile): string {
  const cards = rows.map(row => {
    const assisted = new Set(labels.labels[row.query.id]!.relevantPublicIds);
    const results = row.results.map(result => `<figure class="candidate${result.rank > 5 ? ' secondary' : ''}" data-rank="${result.rank}">
      <img src="../../../${escapeHTML(result.thumbnail)}" alt="Candidate ${result.rank} for ${escapeHTML(row.query.text)}" loading="lazy">
      <figcaption><strong>#${result.rank} · ${escapeHTML(result.filename)}</strong><span>${escapeHTML(result.publicId)}</span><span class="diagnostic">cosine ${result.score.toFixed(6)} · not probability</span><span class="ai-label">AI prep label: ${assisted.has(result.publicId) ? 'relevant' : 'not labelled relevant'}</span></figcaption>
      <label>Judgement<select data-result data-query="${escapeHTML(row.query.id)}" data-public-id="${escapeHTML(result.publicId)}"><option value="">Unreviewed</option><option value="relevant">Relevant</option><option value="not-relevant">Not relevant</option><option value="unsure">Unsure</option></select></label>
    </figure>`).join('');
    return `<article class="query" id="${escapeHTML(row.query.id)}">
      <header><span class="number">${escapeHTML(row.query.id)}</span><div><h2>${escapeHTML(row.query.text)}</h2><p>${escapeHTML(row.query.criterion)}</p><small>${escapeHTML(row.query.language)} · ${escapeHTML(row.query.category)}<span class="diagnostic"> · prepared expectation ${escapeHTML(row.query.expected)} · ${row.elapsedMs.toFixed(1)} ms</span></small></div></header>
      <label class="answerability">Does the corpus contain a valid answer?<select data-answerability data-query="${escapeHTML(row.query.id)}"><option value="">Unreviewed</option><option value="answerable">Answerable</option><option value="no-match">No match in corpus</option><option value="unsure">Unsure</option></select></label>
      <div class="candidates">${results}</div>
    </article>`;
  }).join('\n');
  const escapedQuerySet = escapeHTML(querySet);
  const escapedIndex = escapeHTML(indexVersion);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Semantic Search Phase 3C — independent review</title>
<style>
:root{color-scheme:dark;font:14px/1.5 ui-sans-serif,system-ui,sans-serif;background:#1c1c1e;color:#f5f5f7}*{box-sizing:border-box}body{margin:0}main{max-width:1500px;margin:auto;padding:24px}.intro,.toolbar,.query{border:.5px solid rgba(255,255,255,.16);background:rgba(45,45,48,.76);backdrop-filter:blur(24px);border-radius:16px}.intro{padding:20px}.intro h1{margin:0 0 8px;font-size:24px}.intro p{max-width:90ch;color:#c7c7cc}.warning{color:#ff9f0a}.toolbar{position:sticky;top:8px;z-index:10;display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:16px 0;padding:10px 12px}.toolbar button,.toolbar select,.answerability select,.candidate select{min-height:34px;border:.5px solid rgba(255,255,255,.18);border-radius:8px;background:#3a3a3c;color:inherit;padding:6px 10px}.progress{margin-left:auto;color:#aeaeb2}.query{padding:16px;margin:14px 0;scroll-margin-top:76px}.query header{display:flex;gap:12px}.number{font:11px ui-monospace,monospace;color:#64d2ff}.query h2{margin:0;font-size:18px}.query p{margin:4px 0;color:#d1d1d6}.query small{color:#8e8e93}.answerability{display:flex;gap:10px;align-items:center;margin:14px 0;font-weight:600}.candidates{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}.candidate{min-width:0;margin:0;padding:7px;border:.5px solid rgba(255,255,255,.12);border-radius:10px;background:rgba(0,0,0,.18)}.candidate.secondary{margin-top:10px}.candidate img{display:block;width:100%;aspect-ratio:4/3;object-fit:contain;border-radius:7px;background:#111}.candidate figcaption{display:flex;min-height:72px;flex-direction:column;margin:6px 0;font-size:10px;color:#8e8e93;overflow-wrap:anywhere}.candidate figcaption strong{color:#e5e5ea}.candidate label{display:flex;flex-direction:column;gap:4px;font-size:11px}.candidate select{width:100%}.diagnostic,.ai-label{display:none}body.show-diagnostics .diagnostic{display:inline}body.show-ai .ai-label{display:inline;color:#ffd60a}@media(max-width:900px){.candidates{grid-template-columns:repeat(2,minmax(0,1fr))}.progress{width:100%;margin:0}}@media(max-width:420px){main{padding:10px}.candidates{grid-template-columns:1fr}.query{padding:12px}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
</style></head><body><main>
<section class="intro"><h1>Semantic Search Phase 3C review</h1><p><strong>${escapedQuerySet}</strong> · index <code>${escapedIndex}</code></p><p class="warning">This page contains model candidates prepared by Codex. It is not an independent human review. Start in blind mode: judge corpus answerability and visual relevance from the written criterion. Cosine is an opaque ranking signal, not a probability.</p><p>First inspect the <a href="corpus.html" target="_blank" rel="noreferrer">complete 154-photo corpus sheet</a> when deciding whether the corpus contains an answer. Ranks 1–5 appear first; ranks 6–10 are the second row. Decisions stay in this browser until exported.</p></section>
<nav class="toolbar" aria-label="Review controls"><a href="corpus.html" target="_blank" rel="noreferrer">Open full corpus</a><button id="toggle-diagnostics" type="button">Show diagnostics</button><button id="toggle-ai" type="button">Show AI prep labels</button><button id="export" type="button">Export review JSON</button><button id="clear" type="button">Clear local decisions</button><span class="progress" role="status" aria-live="polite"></span></nav>
${cards}
</main><script>
const key=${JSON.stringify(`semantic-phase3c-review:${querySet}:${indexVersion}`)};const controls=[...document.querySelectorAll('select[data-query]')];const progress=document.querySelector('.progress');
function identity(control){return control.hasAttribute('data-result')?'r:'+control.dataset.query+':'+control.dataset.publicId:'a:'+control.dataset.query}
function read(){try{return JSON.parse(localStorage.getItem(key)||'{}')}catch{return {}}}function update(){const values=read();for(const control of controls)control.value=values[identity(control)]||'';const done=controls.filter(control=>control.value).length;progress.textContent=done+' / '+controls.length+' decisions'}
for(const control of controls)control.addEventListener('change',()=>{const values=read();values[identity(control)]=control.value;localStorage.setItem(key,JSON.stringify(values));update()});
document.querySelector('#toggle-diagnostics').onclick=event=>{document.body.classList.toggle('show-diagnostics');event.currentTarget.textContent=document.body.classList.contains('show-diagnostics')?'Hide diagnostics':'Show diagnostics'};
document.querySelector('#toggle-ai').onclick=event=>{document.body.classList.toggle('show-ai');event.currentTarget.textContent=document.body.classList.contains('show-ai')?'Hide AI prep labels':'Show AI prep labels'};
document.querySelector('#clear').onclick=()=>{if(confirm('Clear all locally saved decisions for this review?')){localStorage.removeItem(key);update()}};
document.querySelector('#export').onclick=()=>{const values=read(),answerability={},judgements={};for(const [id,value]of Object.entries(values)){const parts=id.split(':');if(parts[0]==='a')answerability[parts[1]]=value;else{judgements[parts[1]]??={};judgements[parts[1]][parts.slice(2).join(':')]=value}}const artifact={schemaVersion:1,querySet:${JSON.stringify(querySet)},indexVersion:${JSON.stringify(indexVersion)},status:'complete',requiredEvidence:'independent human visual review',reviewer:'FILL_REVIEWER_ID',independentFromModelSelection:'FILL_TRUE_OR_FALSE',method:'blind corpus-answerability and Top-10 visual relevance review',completedAt:new Date().toISOString(),answerability,judgements,notes:null};const blob=new Blob([JSON.stringify(artifact,null,2)+'\\n'],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='semantic-phase3c-human-review.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};update();
</script></body></html>`;
}

export function renderPhase3CCorpus(corpus: CorpusPhoto[]): string {
  const photos = corpus.map(photo => `<figure><img src="../../../${escapeHTML(photo.thumbnail)}" alt="Corpus photo ${photo.ordinal}" loading="lazy"><figcaption><strong>#${photo.ordinal} · ${escapeHTML(photo.filename)}</strong><span>${escapeHTML(photo.publicId)}</span><span>${escapeHTML(photo.projects.map(project => project.title).join(' · '))}</span></figcaption></figure>`).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Phase 3C complete corpus</title><style>:root{color-scheme:dark;font:13px/1.45 ui-sans-serif,system-ui;background:#1c1c1e;color:#f5f5f7}body{margin:0;padding:20px}header{position:sticky;top:8px;z-index:2;padding:14px 16px;border:.5px solid #ffffff2a;border-radius:14px;background:#2c2c2ee8;backdrop-filter:blur(24px)}h1{margin:0;font-size:20px}p{margin:5px 0 0;color:#aeaeb2}.grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin-top:14px}figure{margin:0;padding:7px;border:.5px solid #ffffff22;border-radius:10px;background:#2c2c2e}img{display:block;width:100%;aspect-ratio:4/3;object-fit:contain;border-radius:7px;background:#111}figcaption{display:flex;flex-direction:column;margin-top:6px;font-size:10px;color:#8e8e93;overflow-wrap:anywhere}figcaption strong{color:#e5e5ea}@media(max-width:800px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:420px){body{padding:8px}.grid{grid-template-columns:1fr}}</style></head><body><header><h1>Complete evaluation corpus · ${corpus.length} photos</h1><p>Unranked public thumbnails for independent corpus-answerability review. This page contains no model scores or relevance labels.</p></header><main class="grid">${photos}</main></body></html>`;
}

async function generate(): Promise<void> {
  const { holdout, labels, corpus } = await loadAndValidatePhase3CInputs();
  const server = await serveSemanticBrowserFixture(0, path.join(root, 'public/semantic'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-precise-memory-info'] });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(240_000);
    await page.goto(`${server.url}/?backend=auto`);
    await page.waitForFunction(() => Boolean((window as unknown as { semanticTest?: unknown }).semanticTest));
    await page.evaluate(() => window.semanticTest.clearCaches());
    const coldStarted = performance.now();
    const ready = await page.evaluate(() => window.semanticTest.enable());
    const coldReadyMs = performance.now() - coldStarted;
    const byId = new Map(corpus.map(photo => [photo.publicId, photo]));
    const rows: CandidateRow[] = [];
    for (const query of holdout.queries) {
      const response = await page.evaluate(({ text, topK }) => window.semanticTest.search(text, topK), { text: query.text, topK: 10 });
      rows.push({
        query,
        elapsedMs: response.elapsedMs,
        results: response.results.map(result => {
          const photo = byId.get(result.publicId);
          if (!photo) throw new Error(`Candidate references an unknown public ID: ${result.publicId}`);
          return { publicId: result.publicId, rank: result.rank, score: result.score, ordinal: photo.ordinal, filename: photo.filename, thumbnail: photo.thumbnail, projects: photo.projects.map(project => project.title) };
        }),
      });
    }
    const diagnostics = await page.evaluate(() => window.semanticTest.diagnostics());
    const environment = await page.evaluate(() => ({
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
      webgpuExposed: Boolean(navigator.gpu),
      jsHeap: (() => {
        const memory = (performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
        return memory ? { usedJSHeapSize: memory.usedJSHeapSize, totalJSHeapSize: memory.totalJSHeapSize, jsHeapSizeLimit: memory.jsHeapSizeLimit } : null;
      })(),
    }));
    const generatedAt = new Date().toISOString();
    const candidates = {
      schemaVersion: 1,
      querySet: holdout.name,
      querySetSha256: sha256(JSON.stringify(holdout)),
      generatedAt,
      evidenceClass: 'AI-generated candidates; independent human review pending',
      browser: { name: 'Google Chrome', version: browser.version() },
      environment,
      runtime: { ready, coldReadyMs: Math.round(coldReadyMs), diagnostics },
      rows,
    };
    const metrics = { schemaVersion: 1, querySet: holdout.name, generatedAt, ...computePhase3CMetrics(rows, labels) };
    await fs.mkdir(reportDirectory, { recursive: true });
    await fs.writeFile(path.join(reportDirectory, 'candidates.json'), `${JSON.stringify(candidates, null, 2)}\n`);
    await fs.writeFile(path.join(reportDirectory, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
    await fs.writeFile(path.join(reportDirectory, 'review.html'), renderPhase3CReview(holdout.name, ready.indexVersion ?? 'unknown', rows, labels));
    await fs.writeFile(path.join(reportDirectory, 'corpus.html'), renderPhase3CCorpus(corpus));
    console.log(JSON.stringify({ querySet: holdout.name, queries: rows.length, backend: ready.backend, coldReadyMs: Math.round(coldReadyMs), reportDirectory, metrics: metrics.positive }));
    await context.close();
  } finally {
    await browser.close();
    await server.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await generate();
