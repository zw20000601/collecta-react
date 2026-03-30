function safeDecodeBase64Url(value) {
  try {
    const input = String(value || '')
      .replace(/-/g, '+')
      .replace(/_/g, '/')
    const padLength = (4 - (input.length % 4)) % 4
    const padded = input + '='.repeat(padLength)
    return atob(padded)
  } catch {
    return ''
  }
}

function parseJwtPayload(token) {
  const parts = String(token || '').split('.')
  if (parts.length < 2) return null
  const raw = safeDecodeBase64Url(parts[1])
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function extractRole(user, session) {
  const token = session && session.access_token ? session.access_token : ''
  const payload = parseJwtPayload(token)

  const appRole = user && user.app_metadata && typeof user.app_metadata.role === 'string'
    ? user.app_metadata.role
    : ''
  if (appRole) return appRole

  const payloadAppRole = payload && payload.app_metadata && typeof payload.app_metadata.role === 'string'
    ? payload.app_metadata.role
    : ''
  if (payloadAppRole) return payloadAppRole

  const userRole = user && user.user_metadata && typeof user.user_metadata.role === 'string'
    ? user.user_metadata.role
    : ''
  if (userRole) return userRole

  const fromPayload = payload && typeof payload.role === 'string' ? payload.role : ''
  if (fromPayload) return fromPayload

  return ''
}

export function isAdminRole(user, session) {
  return String(extractRole(user, session)).toLowerCase() === 'admin'
}
