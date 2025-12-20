import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { prettyJSON } from 'hono/pretty-json'

// Import config
import { env } from './config/env.js'
import { testSupabaseConnection } from './config/supabase.js'
import { testRedisConnection, closeRedisConnection } from './config/redis.js'

// Import routes
import searchRoutes from './routes/search.js'
import placesRoutes from './routes/places.js'
import debugRoutes from './routes/debug.js'
import aiRoutes from './routes/ai.js'

// Import services
import { cacheService } from './services/cache.service.js'

// Create Hono app
const app = new Hono()

// Middleware
app.use('*', logger())
app.use('*', cors())
app.use('*', prettyJSON())

// Root endpoint
app.get('/', (c) => {
  return c.json({
    name: 'Mapier Hub API',
    version: '1.0.0',
    status: 'operational',
    endpoints: {
      search: 'POST /api/v1/search',
      aiQuery: 'POST /api/v1/ai/query',
      autocomplete: 'GET /api/v1/places/autocomplete?input=query',
      place: 'GET /api/v1/places/:id',
      poiResolve: 'POST /api/v1/places/resolve',
      health: 'GET /api/v1/search/health',
      stats: 'GET /api/v1/stats',
    },
    features: {
      providers: ['local', 'google', 'refuge'],
      ai: !!process.env.OPENROUTER_API_KEY,
      aiModel: 'grok-4.1-fast:free',
      semanticSearch: true,
      deduplication: true,
    },
  })
})

// Stats endpoint
app.get('/api/v1/stats', async (c) => {
  const cacheStats = await cacheService.getStats()
  return c.json({
    cache: cacheStats,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  })
})

// Mount routes
app.route('/api/v1/search', searchRoutes)
app.route('/api/v1/places', placesRoutes)
app.route('/api/v1/ai', aiRoutes)
app.route('/api/v1/debug', debugRoutes)

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Not found', path: c.req.path }, 404)
})

// Error handler
app.onError((err, c) => {
  console.error('[App] Error:', err)
  return c.json(
    {
      error: 'Internal server error',
      message: err.message,
    },
    500
  )
})

/**
 * Start the server
 */
async function startServer() {
  console.log('🚀 Starting Mapier Hub API...\n')

  // Test connections
  console.log('Testing connections...')
  const [supabaseOk, redisOk] = await Promise.all([
    testSupabaseConnection(),
    testRedisConnection(),
  ])

  if (!supabaseOk) {
    console.warn('⚠️  Supabase connection failed. Local database features disabled.')
  }

  if (!redisOk) {
    console.warn('⚠️  Redis connection failed. Caching disabled.')
  }

  // Start server
  const port = env.PORT
  console.log(`\n✅ Server started on port ${port}`)
  console.log(`📍 http://localhost:${port}\n`)

  serve({
    fetch: app.fetch,
    port,
  })
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...')
  await closeRedisConnection()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  console.log('\n🛑 Shutting down gracefully...')
  await closeRedisConnection()
  process.exit(0)
})

// Start the server
startServer().catch((error) => {
  console.error('❌ Failed to start server:', error)
  process.exit(1)
})
