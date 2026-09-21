/// <reference lib="webworker" />
export {};
const queuedMessages: MessageEvent[] = [];
const queueMessage = (event: MessageEvent) => queuedMessages.push(event);
self.addEventListener('message', queueMessage);
Object.defineProperty(self.navigator, 'gpu', { configurable: true, value: undefined });
await import('../../src/semantic-search/semantic-search.worker');
self.removeEventListener('message', queueMessage);
for (const event of queuedMessages) self.onmessage?.(event);
