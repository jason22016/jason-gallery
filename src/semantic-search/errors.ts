export class SemanticSearchError extends Error {
  readonly code: string;
  readonly recoverable: boolean;

  constructor(code: string, message: string, options: { recoverable?: boolean; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'SemanticSearchError';
    this.code = code;
    this.recoverable = options.recoverable ?? true;
  }
}

export function semanticError(error: unknown, fallbackCode = 'RUNTIME_ERROR'): SemanticSearchError {
  if (error instanceof SemanticSearchError) return error;
  if (error instanceof DOMException && error.name === 'AbortError') return new SemanticSearchError('ABORTED', error.message || 'Semantic operation was cancelled', { cause: error });
  return new SemanticSearchError(fallbackCode, error instanceof Error ? error.message : String(error), { cause: error });
}

export function abortError(message = 'Semantic query was cancelled'): DOMException {
  return new DOMException(message, 'AbortError');
}
