function isImageIcon(value) {
  const raw = String(value || '').trim()
  if (!raw) return false
  return /^(data:image\/|https?:\/\/|blob:|\/)/i.test(raw)
}

export default function CategoryIcon({ value, fallback = '📁', className = '' }) {
  const raw = String(value || '').trim()
  const icon = raw || fallback
  const merged = String(className || '').trim()

  if (isImageIcon(icon)) {
    return <img src={icon} alt="" className={`category-icon-img ${merged}`.trim()} />
  }

  return <span className={`category-icon-emoji ${merged}`.trim()}>{icon}</span>
}

