import { createClient } from '@supabase/supabase-js'

const env = import.meta.env || {}

const FALLBACK_SUPABASE_URL = 'https://gylkqocldmahurvklkcs.supabase.co'
const FALLBACK_SUPABASE_ANON_KEY = 'sb_publishable_8whEur7VAJhVYFQoDcOkFw_m1oiofyX'
const FALLBACK_ADMIN_EMAIL = '1781586305@qq.com'

export const SUPABASE_URL = env.VITE_SUPABASE_URL || FALLBACK_SUPABASE_URL
export const SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY || FALLBACK_SUPABASE_ANON_KEY
export const ADMIN_EMAIL = env.VITE_ADMIN_EMAIL || FALLBACK_ADMIN_EMAIL

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // eslint-disable-next-line no-console
  console.warn('Supabase env is missing. Please check .env.local config.')
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)