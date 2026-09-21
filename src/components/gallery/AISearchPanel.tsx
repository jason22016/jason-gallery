import type { SemanticRuntimeState } from '../../semantic-search/types';
import PhotoThumbnail from './PhotoThumbnail';
import type { MappedSemanticResult } from './semantic-results';
import type { SemanticQuerySuggestion } from './semantic-suggestions';
import { Icon } from './ui/Icon';

const setupStatuses = new Set(['not-downloaded', 'downloading', 'verifying', 'initializing']);

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1_000))} KB`;
  return `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(bytes / 1_000_000)} MB`;
}

function setupLabel(status: SemanticRuntimeState['status'] | 'loading-module'): string {
  if (status === 'loading-module') return '正在准备 AI Search…';
  if (status === 'not-downloaded') return '正在检查本机模型…';
  if (status === 'downloading') return '正在下载 AI 模型…';
  if (status === 'verifying') return '正在验证模型…';
  return '正在初始化本机搜索引擎…';
}

function SetupProgress({ state, moduleLoading, onCancel }: {
  state: Readonly<SemanticRuntimeState> | null;
  moduleLoading: boolean;
  onCancel: () => void;
}) {
  const progress = state?.progress;
  const hasTotal = !!progress?.totalBytes;
  const status = moduleLoading ? 'loading-module' : state?.status ?? 'loading-module';
  return <section className="ai-enable-panel ai-progress-panel" aria-labelledby="ai-progress-title" aria-busy="true">
    <span className="ai-panel-icon ai-progress-icon"><Icon name="loading" /></span>
    <div className="ai-panel-copy">
      <h3 id="ai-progress-title">{setupLabel(status)}</h3>
      <p className="ai-progress-detail" role="status" aria-live="polite">
        {hasTotal ? `${formatBytes(progress!.downloadedBytes)} / ${formatBytes(progress!.totalBytes)}` : '读取已安装状态'}
        {progress?.file && <small>{progress.file}</small>}
      </p>
      <progress aria-label="AI Search 模型进度" {...(hasTotal ? { value: progress!.downloadedBytes, max: progress!.totalBytes } : {})} />
      <p className="ai-progress-note">正在本机验证数据；下载中断后可安全重试。</p>
    </div>
    <button type="button" className="ai-secondary-action" onClick={onCancel}>取消</button>
  </section>;
}

function EnablePanel({ onEnable }: { onEnable: () => void }) {
  return <section className="ai-enable-panel" aria-labelledby="ai-enable-title">
    <span className="ai-panel-icon"><Icon name="sparkles-2" /></span>
    <div className="ai-panel-copy">
      <h3 id="ai-enable-title">Enable AI Search</h3>
      <p>用自然语言描述想找的画面。检索完全在此设备上运行，搜索词不会上传。</p>
      <ul className="ai-privacy-points" aria-label="AI Search 隐私与下载说明">
        <li><Icon name="check" />On-device visual search</li>
        <li><Icon name="check" />Queries stay private</li>
        <li><Icon name="download-2" />约 101 MB 一次性下载</li>
      </ul>
    </div>
    <button type="button" className="primary-button ai-enable-action" onClick={onEnable}>Download &amp; Enable</button>
  </section>;
}

function FailurePanel({ state, moduleError, onRetry }: {
  state: Readonly<SemanticRuntimeState> | null;
  moduleError: string;
  onRetry: () => void;
}) {
  const update = state?.status === 'update-required';
  const message = state?.error?.message || moduleError || '无法启用 AI Search。';
  const retryable = state?.error?.recoverable !== false || !!moduleError || update;
  return <section className="ai-enable-panel ai-error-panel" role="alert" aria-labelledby="ai-error-title">
    <span className="ai-panel-icon"><Icon name="warning" /></span>
    <div className="ai-panel-copy">
      <h3 id="ai-error-title">{update ? 'AI Search 需要更新' : 'AI Search 启用失败'}</h3>
      <p>{message}</p>
      <small>{update ? '当前图库索引与本机模型不兼容。检查并验证最新发布。' : '若缓存不完整，重试会清理当前代并重新下载。'}</small>
    </div>
    {retryable && <button type="button" className="primary-button" onClick={onRetry}>{update ? '检查并更新' : '重试'}</button>}
  </section>;
}

export function AISearchPanel({ state, moduleLoading, moduleError, query, suggestions, outcome, searchError, onEnable, onCancel, onRetry, onSuggestion, onOpen, onViewAll, onRetryQuery }: {
  state: Readonly<SemanticRuntimeState> | null;
  moduleLoading: boolean;
  moduleError: string;
  query: string;
  suggestions: readonly SemanticQuerySuggestion[];
  outcome: { readonly query: string; readonly results: readonly MappedSemanticResult[] } | null;
  searchError: string;
  onEnable: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onSuggestion: (query: string) => void;
  onOpen: (result: MappedSemanticResult) => void;
  onViewAll: () => void;
  onRetryQuery: () => void;
}) {
  if (moduleLoading || (state && setupStatuses.has(state.status))) return <SetupProgress state={state} moduleLoading={moduleLoading} onCancel={onCancel} />;
  if (moduleError || state?.status === 'error' || state?.status === 'update-required') return <FailurePanel state={state} moduleError={moduleError} onRetry={onRetry} />;
  if (!state || state.status === 'disabled') return <EnablePanel onEnable={onEnable} />;
  if (state.status !== 'ready' && state.status !== 'searching') return <EnablePanel onEnable={onEnable} />;

  const searching = state.status === 'searching';
  return <div className="ai-ready" data-semantic-status={state.status}>
    <section className="ai-suggestion-section" aria-labelledby="ai-suggestions-title">
      <div className="ai-section-heading"><span><Icon name="sparkles-2" /><strong id="ai-suggestions-title">试试这些场景</strong></span><small>{state.backend?.toUpperCase()} · {state.cache === 'persistent' ? '已保存到此设备' : '本次会话'}</small></div>
      <div className="ai-suggestions" role="group" aria-label="推荐语义查询">
        {suggestions.map(suggestion => <button type="button" key={suggestion.id} onClick={() => onSuggestion(suggestion.query)}>{suggestion.label}</button>)}
      </div>
    </section>
    <section className="ai-results" aria-label="AI Search 结果" aria-busy={searching || undefined}>
      {searching && <p className="ai-searching" role="status" aria-live="polite"><Icon name="loading" />正在此设备上搜索“{query.trim()}”…</p>}
      {searchError && <div className="ai-query-error" role="alert"><span>{searchError}</span><button type="button" onClick={onRetryQuery}>重试</button></div>}
      {!searching && !searchError && outcome && outcome.results.length === 0 && <div className="ai-no-results" role="status"><Icon name="search" /><strong>没有找到匹配照片</strong><span>换一种更宽泛的场景描述试试。</span></div>}
      {!!outcome?.results.length && <>
        <div className="ai-result-heading"><span><strong>最相关照片</strong><small>按语义相关度排序</small></span><span>{outcome.results.length} 张</span></div>
        <div className="ai-result-list">
          {outcome.results.slice(0, 5).map(result => <button type="button" className="ai-result-item" key={result.publicId} onClick={() => onOpen(result)} aria-label={`打开照片：${result.photo.title}`}>
            <span className="ai-result-thumbnail"><PhotoThumbnail photo={result.photo} /></span>
            <span className="ai-result-copy"><strong>{result.photo.title}</strong><small>{result.photo.projects?.[0]?.title || result.photo.date?.slice(0, 10) || '公开图库'}</small></span>
            <span className="ai-result-rank">#{result.rank}</span><Icon name="arrow-right" />
          </button>)}
        </div>
        <button type="button" className="ai-view-all primary-button" onClick={onViewAll}>View all in Explore <Icon name="arrow-right" /></button>
      </>}
      {!query.trim() && !outcome && <p className="ai-ready-hint">输入自然语言，或选择一个推荐场景。</p>}
    </section>
    <footer className="ai-local-note"><Icon name="check" />查询和向量均留在此设备上</footer>
  </div>;
}
