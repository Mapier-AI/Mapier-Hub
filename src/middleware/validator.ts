import { z } from 'zod'
import type { Context, Next } from 'hono'

/**
 * Search query validation schema
 */
export const searchQuerySchema = z.object({
  location: z.object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    radius: z.number().min(1).max(50000).optional().default(1000),
  }),
  query: z.string().optional(),
  category: z.string().optional(),
  limit: z.number().min(1).max(100).optional().default(20),
  offset: z.number().min(0).optional().default(0),
})

export type SearchQueryInput = z.infer<typeof searchQuerySchema>

/**
 * Validation middleware factory
 */
export function validateBody<T extends z.ZodSchema>(schema: T) {
  return async (c: Context, next: Next) => {
    try {
      const body = await c.req.json()
      const validated = schema.parse(body)

      // Store validated data in context
      c.set('validatedData', validated)

      await next()
    } catch (error) {
      if (error instanceof z.ZodError) {
        return c.json(
          {
            error: 'Validation failed',
            details: error.errors.map((err) => ({
              path: err.path.join('.'),
              message: err.message,
            })),
          },
          400
        )
      }

      return c.json({ error: 'Invalid request body' }, 400)
    }
  }
}
