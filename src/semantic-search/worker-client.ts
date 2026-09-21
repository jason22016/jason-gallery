import { abortError, SemanticSearchError } from './errors';
import type {
  SemanticWorkerInitRequest,
  SemanticWorkerQueryRequest,
  SemanticWorkerQueryResult,
  SemanticWorkerReadyResult,
  SemanticWorkerRequest,
  SemanticWorkerResponse,
  SemanticWorkerResult,
} from './worker-protocol';
import type { SemanticBackendPreference } from './types';

export interface WorkerLike {
  onmessage: ((event: MessageEvent<SemanticWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(message: SemanticWorkerRequest, transfer?: Transferable[]): void;
  terminate(): void;
}

export interface WorkerInitialization {
  releaseId: string;
  backend: SemanticBackendPreference;
  model: ArrayBuffer;
  tokenizer: ArrayBuffer;
  tokenizerConfig: ArrayBuffer;
  modelConfig: ArrayBuffer;
  vectors: ArrayBuffer;
  photoIds: string[];
}

interface Pending {
  resolve: (result: SemanticWorkerResult) => void;
  reject: (error: unknown) => void;
  queryId?: number;
}

export class SemanticWorkerClient {
  readonly worker: WorkerLike;
  private sequence = 0;
  private pending = new Map<number, Pending>();
  private closed = false;

  constructor(worker: WorkerLike) {
    this.worker = worker;
    worker.onmessage = event => this.handleMessage(event.data);
    worker.onerror = event => this.crash(new SemanticSearchError('WORKER_CRASH', event.message || 'Semantic worker crashed'));
    worker.onmessageerror = () => this.crash(new SemanticSearchError('WORKER_PROTOCOL', 'Semantic worker message could not be decoded'));
  }

  private handleMessage(message: SemanticWorkerResponse): void {
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.error) pending.reject(new SemanticSearchError(message.error.code, message.error.message));
    else if (message.result) pending.resolve(message.result);
    else pending.reject(new SemanticSearchError('WORKER_PROTOCOL', 'Semantic worker returned an empty response'));
  }

  private request(message: Omit<SemanticWorkerRequest, 'id'> & { id?: never }, transfer: Transferable[] = [], queryId?: number): { id: number; promise: Promise<SemanticWorkerResult> } {
    if (this.closed) throw new SemanticSearchError('WORKER_CLOSED', 'Semantic worker is closed');
    const id = ++this.sequence;
    const promise = new Promise<SemanticWorkerResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, ...(queryId === undefined ? {} : { queryId }) });
      this.worker.postMessage({ ...message, id } as SemanticWorkerRequest, transfer);
    });
    return { id, promise };
  }

  async initialize(initialization: WorkerInitialization): Promise<SemanticWorkerReadyResult> {
    const message: Omit<SemanticWorkerInitRequest, 'id'> = { type: 'initialize', ...initialization };
    const { promise } = this.request(message as Omit<SemanticWorkerRequest, 'id'> & { id?: never }, [
      initialization.model,
      initialization.tokenizer,
      initialization.tokenizerConfig,
      initialization.modelConfig,
      initialization.vectors,
    ]);
    const result = await promise;
    if (result.kind !== 'ready') throw new SemanticSearchError('WORKER_PROTOCOL', 'Semantic worker did not return ready state');
    return result;
  }

  query(queryId: number, text: string, topK: number): Promise<SemanticWorkerQueryResult> {
    const message: Omit<SemanticWorkerQueryRequest, 'id'> = { type: 'query', queryId, text, topK };
    const { promise } = this.request(message as Omit<SemanticWorkerRequest, 'id'> & { id?: never }, [], queryId);
    return promise.then(result => {
      if (result.kind !== 'query' || result.queryId !== queryId) throw new SemanticSearchError('WORKER_PROTOCOL', 'Semantic worker returned a mismatched query result');
      return result;
    });
  }

  cancel(queryId: number): void {
    if (this.closed) return;
    this.worker.postMessage({ type: 'cancel', queryId });
    for (const [id, pending] of this.pending) {
      if (pending.queryId === queryId) {
        this.pending.delete(id);
        pending.reject(abortError());
      }
    }
  }

  private crash(error: unknown): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.worker.terminate();
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) pending.reject(abortError('Semantic runtime was disposed'));
    this.pending.clear();
    this.worker.terminate();
  }
}
