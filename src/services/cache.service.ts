import { redis } from '../config/redis.js'
import type { ProviderResult } from '../providers/types.js'

/**
 * Cache service for Redis operations
 * Handles query result caching and provider response caching
 */
export class CacheService {
  private readonly defaultTTL = 300 // 5 minutes in seconds

  /**
   * Generate a cache key from search parameters
   */
  private generateCacheKey(prefix: string, params: Record<string, any>): string {
    const sortedParams = Object.keys(params)
      .sort()
      .reduce((acc, key) => {
        acc[key] = params[key]
        return acc
      }, {} as Record<string, any>)

    return `${prefix}:${JSON.stringify(sortedParams)}`
  }

  /**
   * Get cached search results
   */
  async getSearchResults(params: Record<string, any>): Promise<ProviderResult | null> {
    try {
      const key = this.generateCacheKey('search', params)
      const cached = await redis.get(key)

      if (!cached) {
        return null
      }

      return JSON.parse(cached) as ProviderResult
    } catch (error) {
      console.error('[Cache] Failed to get search results:', error)
      return null
    }
  }

  /**
   * Cache search results
   */
  async setSearchResults(
    params: Record<string, any>,
    result: ProviderResult,
    ttl: number = this.defaultTTL
  ): Promise<void> {
    try {
      const key = this.generateCacheKey('search', params)
      await redis.setex(key, ttl, JSON.stringify(result))
    } catch (error) {
      console.error('[Cache] Failed to set search results:', error)
    }
  }

  /**
   * Get cached place details
   */
  async getPlace(id: string): Promise<any | null> {
    try {
      const key = `place:${id}`
      const cached = await redis.get(key)

      if (!cached) {
        return null
      }

      return JSON.parse(cached)
    } catch (error) {
      console.error('[Cache] Failed to get place:', error)
      return null
    }
  }

  /**
   * Cache place details
   */
  async setPlace(id: string, place: any, ttl: number = 1800): Promise<void> {
    try {
      const key = `place:${id}`
      await redis.setex(key, ttl, JSON.stringify(place))
    } catch (error) {
      console.error('[Cache] Failed to set place:', error)
    }
  }

  /**
   * Invalidate cache for a specific pattern
   */
  async invalidate(pattern: string): Promise<number> {
    try {
      const keys = await redis.keys(pattern)
      if (keys.length === 0) {
        return 0
      }

      await redis.del(...keys)
      return keys.length
    } catch (error) {
      console.error('[Cache] Failed to invalidate:', error)
      return 0
    }
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{ keys: number; memory: string }> {
    try {
      const dbsize = await redis.dbsize()
      const info = await redis.info('memory')
      const memoryMatch = info.match(/used_memory_human:(.+)/)
      const memory = memoryMatch ? memoryMatch[1].trim() : 'unknown'

      return { keys: dbsize, memory }
    } catch (error) {
      console.error('[Cache] Failed to get stats:', error)
      return { keys: 0, memory: 'unknown' }
    }
  }
}

// Singleton instance
export const cacheService = new CacheService()
