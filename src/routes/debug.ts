import { Hono } from 'hono'
import { LocalDatabaseProvider } from '../providers/local.provider.js'

const debug = new Hono()

/**
 * POST /api/v1/debug/local
 * Test local provider directly (bypass orchestrator)
 */
debug.post('/local', async (c) => {
  try {
    const body = await c.req.json()

    const localProvider = new LocalDatabaseProvider()
    const result = await localProvider.search(body)

    return c.json({
      success: true,
      result,
    })
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    )
  }
})

export default debug
