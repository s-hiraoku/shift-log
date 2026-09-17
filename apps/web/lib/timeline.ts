export function timelineEmptyMessage(query: string): string {
  if (query) {
    return `「${query}」に一致する記憶はありません。`;
  }
  return "まだ記憶がありません。収集を有効化して窓をアップロードしてください。";
}
