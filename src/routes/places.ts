import { Hono } from 'hono'
import { z } from 'zod'
import { orchestrator } from '../services/orchestrator.js'
import { cacheService } from '../services/cache.service.js'

const places = new Hono()

/**
 * GET /api/v1/places/autocomplete
 * Google Places Autocomplete with 30-day caching
 * Query params: input (required), lat, lon (optional)
 */
places.get('/autocomplete', async (c) => {
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

    // Build cache params
    const cacheParams = {
      input,
      ...(location && { lat: location.lat, lon: location.lon }),
    }

    // Check cache first
    const cached = await cacheService.getAutocomplete(cacheParams)
    if (cached) {
      return c.json({
        success: true,
        input,
        suggestions: cached,
        metadata: { cached: true },
      })
    }

    // Cache miss - fetch from Google
    const suggestions = await orchestrator.autocomplete(input, location)

    // Cache for 30 days
    await cacheService.setAutocomplete(cacheParams, suggestions)

    return c.json({
      success: true,
      input,
      suggestions,
      metadata: { cached: false },
    })
  } catch (error) {
    console.error('[API] Autocomplete failed:', error)
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

/**
 * GET /api/v1/places/:id
 * Get details for a specific place
 */
places.get('/:id', async (c) => {
  try {
    const id = c.req.param('id')

    if (!id) {
      return c.json({ success: false, error: 'Place ID is required' }, 400)
    }

    const place = await orchestrator.getPlace(id)

    if (!place) {
      return c.json({ success: false, error: 'Place not found' }, 404)
    }

    return c.json({
      success: true,
      place,
    })
  } catch (error) {
    console.error('[API] Get place failed:', error)
    return c.json(
      {
        success: false,
        error: 'Failed to fetch place',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    )
  }
})

/**
 * POST /api/v1/places/resolve
 * Resolve and enrich a POI (find or create canonical record)
 *
 * Flow:
 * 1. User taps Google Autocomplete result
 * 2. Client calls Google Places Details API directly (fast UI)
 * 3. Client sends google_place_id + basic metadata to /resolve (background)
 * 4. Backend finds or creates canonical POI, enriches with Mapier data
 * 5. Client receives enriched POI and updates UI
 *
 * Note: We don't store Google data (ToS restriction). Only store:
 * - google_place_id for linking
 * - Basic metadata (name, location, category) for our canonical record
 *
 * TODO: Add ETL pipeline to:
 * - Periodically fetch fresh Google data for POIs
 * - Extract semantic tags from reviews/descriptions (LLM)
 * - Generate dish tags, vibe tags, amenity tags
 * - Store tags in poi_tags table (not raw Google data)
 */
places.post('/resolve', async (c) => {
  try {
    const body = await c.req.json()

    // Validate request
    const schema = z.object({
      google_place_id: z.string().optional(),
      lat: z.number().optional(),
      lon: z.number().optional(),
      name: z.string().optional(),
      category: z.string().optional(),
    })

    const data = schema.parse(body)

    // Require at least google_place_id or coordinates
    if (!data.google_place_id && (!data.lat || !data.lon)) {
      return c.json(
        {
          success: false,
          error: 'Either google_place_id or coordinates (lat, lon) are required',
        },
        400
      )
    }

    // Resolve the POI (find or create with enrichment)
    const poi = await orchestrator.resolvePOI(data)

    return c.json({
      success: true,
      poi,
    })
  } catch (error) {
    console.error('[API] POI resolve failed:', error)
    return c.json(
      {
        success: false,
        error: 'Failed to resolve POI',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    )
  }
})

export default places
