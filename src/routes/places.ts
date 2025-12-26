import { Hono } from 'hono'
import { z } from 'zod'
import { orchestrator } from '../services/orchestrator.js'
import { cacheService } from '../services/cache.service.js'
import { pliService } from '../services/pli.service.js'

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
 * Resolve a place from iOS/Android to canonical ID with cross-platform PLI sync
 *
 * Flow:
 * 1. Client sends platform-specific place ID (google_place_id or apple_place_id) + metadata
 * 2. Backend calls conflate_place() to find matching Overture place or custom_place
 * 3. If match found: cache the PLI on the canonical record
 * 4. If no match: create new custom_place
 * 5. Return canonical place with both PLIs (for cross-platform)
 */
const resolveSchema = z.object({
  // Platform identifiers
  google_place_id: z.string().optional(),
  apple_place_id: z.string().optional(),

  // Location (required)
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),

  // Place details
  name: z.string().min(1).max(200),
  category: z.string().max(100).optional(),

  // Optional address
  address: z
    .object({
      street: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      postcode: z.string().optional(),
      country: z.string().optional(),
      formatted: z.string().optional(),
    })
    .optional(),

  // Optional contact
  phone: z.string().optional(),
  website: z.url().optional(),

  // Source platform (from header or body)
  source_platform: z.enum(['ios', 'android']).optional(),
})

places.post('/resolve', async (c) => {
  try {
    const body = await c.req.json()

    // Get platform from header if not in body
    const platformHeader = c.req.header('X-Platform') as 'ios' | 'android' | undefined
    if (platformHeader && !body.source_platform) {
      body.source_platform = platformHeader
    }

    // Default to android if not specified (backwards compatibility)
    if (!body.source_platform) {
      body.source_platform = 'android'
    }

    const parsed = resolveSchema.safeParse(body)
    if (!parsed.success) {
      return c.json(
        {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message },
        },
        400
      )
    }

    const result = await pliService.resolve(parsed.data as Parameters<typeof pliService.resolve>[0])
    return c.json(result)
  } catch (error) {
    console.error('[places/resolve] Error:', error)
    return c.json(
      {
        success: false,
        error: { code: 'RESOLUTION_FAILED', message: 'Failed to resolve place' },
      },
      500
    )
  }
})

/**
 * POST /api/v1/places/sync-pli
 * Store platform-specific PLI after client-side native search
 * (This writes to PostgreSQL, NOT Redis cache)
 */
const syncPLISchema = z.object({
  place_id: z.string(),
  platform: z.enum(['ios', 'android']),
  pli: z.string().min(1),
})

places.post('/sync-pli', async (c) => {
  try {
    const body = await c.req.json()
    const parsed = syncPLISchema.safeParse(body)

    if (!parsed.success) {
      return c.json(
        {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message },
        },
        400
      )
    }

    const result = await pliService.syncPLI(parsed.data.place_id, parsed.data.platform, parsed.data.pli)
    return c.json(result)
  } catch (error) {
    console.error('[places/sync-pli] Error:', error)
    return c.json({ success: false }, 500)
  }
})

/**
 * GET /api/v1/places/:id/bridge
 * Get place with PLI hints for cross-platform display
 */
places.get('/:id/bridge', async (c) => {
  const placeId = c.req.param('id')
  const targetPlatform = c.req.query('target_platform') as 'ios' | 'android'

  if (!targetPlatform || !['ios', 'android'].includes(targetPlatform)) {
    return c.json(
      {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'target_platform must be ios or android' },
      },
      400
    )
  }

  try {
    const bridge = await pliService.getBridge(placeId, targetPlatform)
    return c.json({ success: true, ...bridge })
  } catch (error) {
    console.error('[places/bridge] Error:', error)
    return c.json(
      {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Place not found' },
      },
      404
    )
  }
})

/**
 * POST /api/v1/places/find-nearby
 * Find nearest POI for "Near X" context
 */
const findNearbySchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  radius_meters: z.number().min(10).max(500).default(100),
})

places.post('/find-nearby', async (c) => {
  try {
    const body = await c.req.json()
    const parsed = findNearbySchema.safeParse(body)

    if (!parsed.success) {
      return c.json(
        {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message },
        },
        400
      )
    }

    const nearby = await pliService.findNearby(parsed.data.lat, parsed.data.lon, parsed.data.radius_meters)

    return c.json({
      success: true,
      nearby_place: nearby, // null if no nearby place found
    })
  } catch (error) {
    console.error('[places/find-nearby] Error:', error)
    return c.json({ success: false, nearby_place: null }, 500)
  }
})

export default places
