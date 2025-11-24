import { Hono } from 'hono'
import { orchestrator } from '../services/orchestrator.js'
import { validateBody, searchQuerySchema } from '../middleware/validator.js'
import type { SearchQueryInput } from '../middleware/validator.js'

const search = new Hono()

/**
 * POST /api/v1/search
 * Search for places based on location and filters
 */
search.post('/', validateBody(searchQuerySchema), async (c) => {
  try {
    const query = c.get('validatedData') as SearchQueryInput

    // Execute search (just local for now)
    const result = await orchestrator.search(query)

    // Return response
    return c.json({
      success: true,
      results: result.places,
      metadata: {
        provider: result.provider,
        count: result.metadata.count,
        cached: result.metadata.cached,
        latency_ms: result.metadata.latency,
        confidence: result.metadata.confidence,
        sources: (result.metadata as any).sources,
      },
    })
  } catch (error) {
    console.error('[API] Search failed:', error)
    return c.json(
      {
        success: false,
        error: 'Search failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    )
  }
})

/**
 * GET /api/v1/search/health
 * Health check for all providers
 */
search.get('/health', async (c) => {
  try {
    const health = await orchestrator.healthCheck()
    const allHealthy = Object.values(health).every((v) => v === true)

    return c.json(
      {
        success: true,
        status: allHealthy ? 'healthy' : 'degraded',
        providers: health,
      },
      allHealthy ? 200 : 503
    )
  } catch (error) {
    return c.json(
      {
        success: false,
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    )
  }
})

export default search
