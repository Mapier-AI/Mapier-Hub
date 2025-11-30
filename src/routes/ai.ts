import { Hono } from 'hono'
import { z } from 'zod'
import { aiService } from '../services/ai.service.js'

const ai = new Hono()

/**
 * POST /api/v1/ai/query
 * Process natural language queries with LLM + tool calling
 *
 * Example queries:
 * - "Find me the nearest restroom"
 * - "Where can I find an accessible bathroom near me?"
 * - "Show me gender-neutral restrooms in Hyde Park"
 */
ai.post('/query', async (c) => {
  try {
    const body = await c.req.json()

    // Validate request
    const schema = z.object({
      message: z.string().min(1),
      location: z
        .object({
          lat: z.number().min(-90).max(90),
          lon: z.number().min(-180).max(180),
        })
        .optional(),
    })

    const data = schema.parse(body)

    // Check if AI service is available
    if (!aiService.isAvailable()) {
      return c.json(
        {
          success: false,
          error: 'AI service not available. Please configure OPENROUTER_API_KEY.',
        },
        503
      )
    }

    // Process query with LLM + tools
    const result = await aiService.query(data.message, data.location)

    return c.json({
      success: true,
      response: result.text,
      tool_calls: result.tool_calls,
      tool_results: result.tool_results,
      finish_reason: result.finish_reason,
      usage: result.usage,
    })
  } catch (error) {
    console.error('[AI API] Query failed:', error)
    return c.json(
      {
        success: false,
        error: 'AI query failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    )
  }
})

export default ai
