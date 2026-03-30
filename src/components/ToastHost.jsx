import { useEffect, useState } from 'react'

const AUTO_DISMISS_MS = 2600

export default function ToastHost() {
  const [toasts, setToasts] = useState([])

  useEffect(() => {
    function handle(event) {
      const detail = event && event.detail ? event.detail : null
      if (!detail || !detail.message) return
      const toast = {
        id: detail.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        message: detail.message,
        type: detail.type || 'info',
      }

      setToasts((prev) => [...prev, toast])

      window.setTimeout(() => {
        setToasts((prev) => prev.filter((item) => item.id !== toast.id))
      }, AUTO_DISMISS_MS)
    }

    window.addEventListener('collecta:notify', handle)
    return () => {
      window.removeEventListener('collecta:notify', handle)
    }
  }, [])

  if (!toasts.length) return null

  return (
    <div className="toast-host" aria-live="polite" aria-atomic="true">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast-item ${toast.type}`}>
          {toast.message}
        </div>
      ))}
    </div>
  )
}
