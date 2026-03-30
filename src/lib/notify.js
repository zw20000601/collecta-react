export function notify(message, type) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent('collecta:notify', {
      detail: {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        message: String(message || ''),
        type: type || 'info',
      },
    }),
  )
}

export function notifySuccess(message) {
  notify(message, 'success')
}

export function notifyError(message) {
  notify(message, 'error')
}

export function notifyInfo(message) {
  notify(message, 'info')
}
