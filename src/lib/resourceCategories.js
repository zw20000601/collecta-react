export const DEFAULT_RESOURCE_CATEGORIES = [
  { id: 'default-article', name: '文章', emoji: '📚', sort_order: 10 },
  { id: 'default-video', name: '视频', emoji: '🎬', sort_order: 20 },
  { id: 'default-tool', name: '工具', emoji: '🛠️', sort_order: 30 },
  { id: 'default-design', name: '设计', emoji: '🎨', sort_order: 40 },
  { id: 'default-ebook', name: '电子书', emoji: '📖', sort_order: 50 },
  { id: 'default-podcast', name: '播客', emoji: '🎧', sort_order: 60 },
  { id: 'default-note', name: '笔记', emoji: '📝', sort_order: 70 },
  { id: 'default-code', name: '代码', emoji: '💻', sort_order: 80 },
]

export function normalizeResourceCategoryRow(row, index) {
  return {
    id: row && row.id ? row.id : `row-${index}`,
    name: String((row && row.name) || '').trim(),
    emoji: String((row && row.emoji) || '').trim() || '📁',
    sort_order: typeof (row && row.sort_order) === 'number' ? row.sort_order : 100,
  }
}

export function withFallbackCategories(rows) {
  const clean = (rows || []).filter((item) => item && item.name)
  return clean.length ? clean : DEFAULT_RESOURCE_CATEGORIES
}

export function getDefaultCategoryName(rows) {
  const list = withFallbackCategories(rows)
  return (list[0] && list[0].name) || '工具'
}
