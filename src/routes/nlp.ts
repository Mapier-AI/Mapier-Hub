import { Hono } from 'hono'
import { orchestrator } from '../services/orchestrator.js'
import { nlpService } from '../services/nlp.service.js'
import { z } from 'zod'

const nlp = new Hono()

/**
 * POST /api/v1/nl-search
 * Natural language search endpoint
 * Example: "find me coffee shops near me"
 */
nlp.post('/search', async (c) => {
  try {
    const body = await c.req.json()

    // Validate input
    const schema = z.object({
      query: z.string().min(1),
      location: z
        .object({
          lat: z.number().min(-90).max(90),
          lon: z.number().min(-180).max(180),
        })
        .optional(),
      limit: z.number().min(1).max(100).optional().default(20),
    })

    const validated = schema.parse(body)

    // Check if NLP is available
    if (!nlpService.isAvailable()) {
      return c.json(
        {
          success: false,
          error: 'NLP service not available. Please configure OPENAI_API_KEY.',
        },
        503
      )
    }

    // Parse natural language query
    const parsedQuery = await nlpService.parseNaturalLanguageQuery(
      validated.query,
      validated.location
    )

    // Ensure we have a location
    if (!parsedQuery.location) {
      return c.json(
        {
          success: false,
          error: 'Could not determine location. Please provide location coordinates.',
          parsed: parsedQuery,
        },
        400
      )
    }

    // Execute search with parsed query
    const result = await orchestrator.search({
      ...parsedQuery,
      location: parsedQuery.location,
      limit: validated.limit,
    } as any)

    return c.json({
      success: true,
      query: {
        original: validated.query,
        parsed: parsedQuery,
      },
      results: result.places,
      metadata: result.metadata,
    })
  } catch (error) {
    console.error('[NLP API] Natural language search failed:', error)
    return c.json(
      {
        success: false,
        error: 'Natural language search failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    )
  }
})

/**
 * GET /api/v1/nl-search/autocomplete
 * Google Places Autocomplete endpoint
 * Query params: input (required), lat, lon (optional)
 */
nlp.get('/autocomplete', async (c) => {
  try {
    const input = c.req.query('input')
    const lat = c.req.query('lat')
    const lon = c.req.query('lon')

    if (!input) {
      return c.json({ success: false, error: 'Input is required' }, 400)
    }

    const location =
      lat && lon
        ? {
            lat: parseFloat(lat),
            lon: parseFloat(lon),
          }
        : undefined

    const suggestions = await orchestrator.autocomplete(input, location)

    return c.json({
      success: true,
      input,
      suggestions,
    })
  } catch (error) {
    console.error('[NLP API] Autocomplete failed:', error)
    return c.json(
      {
        success: false,
        error: 'Autocomplete failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    )
  }
})

export default nlp
