import { Hono } from 'hono'
import { orchestrator } from '../services/orchestrator.js'

const places = new Hono()

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

export default places
