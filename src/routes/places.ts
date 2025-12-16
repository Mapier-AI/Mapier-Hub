import { Hono } from 'hono'
import { z } from 'zod'
import { streamSSE } from 'hono/streaming'
import { orchestrator } from '../services/orchestrator.js'

const places = new Hono()

/**
 * GET /api/v1/places/autocomplete
 * Google Places Autocomplete
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

    const suggestions = await orchestrator.autocomplete(input, location)

    return c.json({
      success: true,
      input,
      suggestions,
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
 * GET /api/v1/places/details-stream
 * Progressive enhancement: Stream place details as they become available
 *
 * Flow:
 * 1. Immediately stream Google Places details (50-150ms)
 * 2. Parallel: Check if POI already matched (indexed lookup, <1ms)
 *    - If matched: Stream POI + enrichments immediately
 *    - If not matched: Fuzzy match (50ms), then stream POI + enrichments
 *
 * Uses Server-Sent Events (SSE) for progressive data loading
 */
places.get('/details-stream', async (c) => {
  const googlePlaceId = c.req.query('google_place_id')
  const lat = c.req.query('lat')
  const lon = c.req.query('lon')
  const name = c.req.query('name')

  if (!googlePlaceId) {
    return c.json({ success: false, error: 'google_place_id is required' }, 400)
  }

  return streamSSE(c, async (stream) => {
    try {
      const startTime = Date.now()

      // Step 1: Fetch Google details and check for existing match in parallel
      const [googleDetails, existingMatch] = await Promise.all([
        orchestrator.getGooglePlaceDetailsCached(googlePlaceId),
        // Quick indexed lookup only (no fuzzy match yet)
        orchestrator.matchCanonicalPOI(googlePlaceId, undefined, undefined),
      ])

      // Event 1: Stream Google details immediately
      await stream.writeSSE({
        data: JSON.stringify({
          type: 'google',
          data: googleDetails,
          latency_ms: Date.now() - startTime,
        }),
      })

      // Step 2: Handle POI matching
      let canonicalPoi = existingMatch

      if (existingMatch) {
        // Fast path: POI already matched, stream immediately
        console.log('[API] Fast path: POI already matched')

        await stream.writeSSE({
          data: JSON.stringify({
            type: 'poi_match',
            data: {
              poi_id: existingMatch.id,
              confidence: 1.0,
              source_type: existingMatch.source_type,
              matched: true,
              fast_path: true,
            },
            latency_ms: Date.now() - startTime,
          }),
        })

        // Fetch and stream enrichments immediately
        const enrichments = await orchestrator.fetchEnrichments(existingMatch.id)
        await stream.writeSSE({
          data: JSON.stringify({
            type: 'enrichments',
            data: enrichments,
            latency_ms: Date.now() - startTime,
          }),
        })
      } else {
        // Slow path: Need fuzzy matching
        console.log('[API] Slow path: Fuzzy matching required')

        const coordinate =
          lat && lon ? { lat: parseFloat(lat), lon: parseFloat(lon) } : undefined

        if (coordinate && name) {
          // Try fuzzy match
          canonicalPoi = await orchestrator.matchCanonicalPOI(googlePlaceId, coordinate, name)

          if (canonicalPoi) {
            await stream.writeSSE({
              data: JSON.stringify({
                type: 'poi_match',
                data: {
                  poi_id: canonicalPoi.id,
                  confidence: canonicalPoi.similarity || 0.8,
                  source_type: canonicalPoi.source_type,
                  matched: true,
                  fast_path: false,
                },
                latency_ms: Date.now() - startTime,
              }),
            })

            // Fetch and stream enrichments
            const enrichments = await orchestrator.fetchEnrichments(canonicalPoi.id)
            await stream.writeSSE({
              data: JSON.stringify({
                type: 'enrichments',
                data: enrichments,
                latency_ms: Date.now() - startTime,
              }),
            })

            // Background: Link google_place_id for future fast path
            void orchestrator.linkGooglePlaceId(canonicalPoi.id, googlePlaceId)
          } else {
            // No match found
            await stream.writeSSE({
              data: JSON.stringify({
                type: 'poi_match',
                data: {
                  matched: false,
                },
                latency_ms: Date.now() - startTime,
              }),
            })
          }
        } else {
          // Missing coordinate/name for fuzzy match
          await stream.writeSSE({
            data: JSON.stringify({
              type: 'poi_match',
              data: {
                matched: false,
                reason: 'Missing coordinate or name for fuzzy matching',
              },
              latency_ms: Date.now() - startTime,
            }),
          })
        }
      }

      // Event: Complete
      await stream.writeSSE({
        data: JSON.stringify({
          type: 'complete',
          total_latency_ms: Date.now() - startTime,
        }),
      })
    } catch (error) {
      console.error('[API] Stream error:', error)
      await stream.writeSSE({
        data: JSON.stringify({
          type: 'error',
          error: 'Stream failed',
          message: error instanceof Error ? error.message : 'Unknown error',
        }),
      })
    }
  })
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
