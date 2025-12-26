import { createClient } from '@supabase/supabase-js'
import { env } from './env.js'

/**
 * Supabase client singleton
 * Uses service role key for backend operations (bypasses RLS)
 */
export const supabase = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: false, // No session persistence in backend
      autoRefreshToken: false,
    },
  }
)

/**
 * Test Supabase connection with timeout
 */
export async function testSupabaseConnection(): Promise<boolean> {
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout after 5s')), 5000)
    })

    const queryPromise = supabase.from('places').select('id').limit(1)

    const { error } = await Promise.race([queryPromise, timeoutPromise])

    if (error) throw error

    console.log('✅ Supabase connection successful')
    return true
  } catch (error) {
    console.error('❌ Supabase connection failed:', error)
    return false
  }
}
