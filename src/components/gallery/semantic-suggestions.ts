export interface SemanticQuerySuggestion {
  readonly id: string;
  readonly label: string;
  readonly query: string;
}

/** Curated, network-free prompts. Locale buckets can grow without changing the UI. */
const suggestions: Readonly<Record<string, readonly SemanticQuerySuggestion[]>> = Object.freeze({
  'zh-CN': Object.freeze([
    { id: 'misty-mountains', label: '雾中的雪山', query: '雾中的雪山' },
    { id: 'ancient-town-night', label: '夜晚的古镇', query: '夜晚的古镇' },
    { id: 'forest-animals', label: '森林里的动物', query: '森林里的动物' },
    { id: 'golden-sunset', label: '金色日落', query: '金色日落' },
    { id: 'rocky-rapids', label: '岩石间的急流', query: '岩石间的急流' },
  ]),
  en: Object.freeze([
    { id: 'misty-mountains', label: 'Misty snow mountains', query: 'Misty snow mountains' },
    { id: 'ancient-town-night', label: 'Ancient town at night', query: 'Ancient town at night' },
    { id: 'forest-animals', label: 'Animals in a forest', query: 'Animals in a forest' },
    { id: 'golden-sunset', label: 'Golden sunset', query: 'Golden sunset' },
    { id: 'rocky-rapids', label: 'Rapids between rocks', query: 'Rapids between rocks' },
  ]),
});

export function semanticQuerySuggestions(locale = 'zh-CN'): readonly SemanticQuerySuggestion[] {
  return suggestions[locale] ?? suggestions[locale.split('-')[0]!] ?? suggestions['zh-CN']!;
}
