export function normalizeTags(tagsValue) {
  if (Array.isArray(tagsValue)) return tagsValue
  if (tagsValue === null || tagsValue === undefined) return []
  if (typeof tagsValue === 'string') {
    return tagsValue
      .split(/[,，]/)
      .map((item) => item.trim())
      .filter(Boolean)
  }
  try {
    return String(tagsValue)
      .split(/[,，]/)
      .map((item) => item.trim())
      .filter(Boolean)
  } catch (_e) {
    return []
  }
}

export function normalizeResource(raw) {
  const category =
    raw && raw.category !== undefined && raw.category !== null && String(raw.category).trim() !== ''
      ? String(raw.category)
      : raw && raw.category_name !== undefined && raw.category_name !== null
      ? String(raw.category_name)
      : raw && raw.category_id !== undefined && raw.category_id !== null
      ? `分类-${raw.category_id}`
      : '未分类'

  const isPublic =
    raw && raw.is_public !== undefined && raw.is_public !== null
      ? Boolean(raw.is_public)
      : raw && raw.public !== undefined && raw.public !== null
      ? Boolean(raw.public)
      : true

  return {
    ...raw,
    category,
    is_public: isPublic,
    cover_url:
      raw && raw.cover_url !== undefined && raw.cover_url !== null
        ? String(raw.cover_url)
        : raw && raw.cover !== undefined && raw.cover !== null
        ? String(raw.cover)
        : '',
    tags: normalizeTags(raw && raw.tags),
    note: raw && raw.note ? String(raw.note) : '',
  }
}

export function parseQueryKeyword(value) {
  return String(value || '').trim().toLowerCase()
}

export function createResourceSlug(title) {
  const raw = String(title || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  const base = raw || 'resource'
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  return `${base}-${suffix}`
}
