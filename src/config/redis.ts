import Redis from 'ioredis'
import { env } from './env.js'

/**
 * Redis client singleton
 * Used for caching and job queues
 */
export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000)
    return delay
  },
  reconnectOnError(err) {
    const targetError = 'READONLY'
    if (err.message.includes(targetError)) {
      // Reconnect when Redis is in readonly mode
      return true
    }
    return false
  },
})

// Event handlers
redis.on('connect', () => {
  console.log('✅ Redis connected')
})

redis.on('error', (err) => {
  console.error('❌ Redis error:', err)
})

redis.on('close', () => {
  console.log('⚠️  Redis connection closed')
})

/**
 * Test Redis connection
 */
export async function testRedisConnection(): Promise<boolean> {
  try {
    const pong = await redis.ping()
    if (pong === 'PONG') {
      console.log('✅ Redis connection successful')
      return true
    }
    return false
  } catch (error) {
    console.error('❌ Redis connection failed:', error)
    return false
  }
}

/**
 * Gracefully close Redis connection
 */
export async function closeRedisConnection(): Promise<void> {
  await redis.quit()
}
