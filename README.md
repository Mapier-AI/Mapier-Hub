# Mapier Hub API

Multi-provider map data aggregation backend with AI-powered natural language search. Built with Hono, TypeScript, Supabase, and OpenRouter.

## Features

- ✅ **Multi-provider search** - Local DB, Google Places, Refuge Restrooms
- ✅ **AI-powered queries** - Natural language search with tool calling (Grok-4.1-fast)
- ✅ **Geospatial search** - PostGIS-powered location search with radius filtering
- ✅ **Google Places integration** - Autocomplete and place details
- ✅ **Smart caching** - Redis-backed caching for optimal performance
- ✅ **Result deduplication** - Automatic merging of results from multiple providers
- ✅ **Type-safe** - Full TypeScript with Zod validation

## Quick Start

### 1. Install Dependencies

```bash
yarn install
```

### 2. Environment Setup

Create a `.env` file with the following variables:

```env
# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Redis Configuration (Upstash)
REDIS_URL=rediss://default:password@endpoint.upstash.io:6379

# Server Configuration
PORT=3001
NODE_ENV=development

# API Keys for External Providers
GOOGLE_PLACES_API_KEY=your-google-api-key
OPENROUTER_API_KEY=your-openrouter-api-key  # Optional, for AI features
```

### 3. Run Development Server

```bash
yarn dev
```

Server will start on `http://localhost:3001`

## API Endpoints

### Core Search

**POST /api/v1/search** - Multi-provider POI search

```json
{
  "location": { "lat": 41.7937, "lon": -87.5937, "radius": 2000 },
  "query": "coffee",
  "providers": ["local", "google"],
  "limit": 20
}
```

### AI-Powered Search

**POST /api/v1/ai/query** - Natural language queries with tool calling

```json
{
  "message": "Find me the nearest restroom",
  "location": { "lat": 41.7937, "lon": -87.5937 }
}
```

Response includes tool execution results:

```json
{
  "success": true,
  "response": "",
  "tool_results": [{
    "toolName": "search_restrooms",
    "output": {
      "count": 10,
      "restrooms": [...]
    }
  }],
  "finish_reason": "tool-calls"
}
```

### Google Places

**GET /api/v1/places/autocomplete?input=starbucks&lat=41.7937&lon=-87.5937**

Returns Google Places autocomplete suggestions.

**GET /api/v1/places/:id** - Get place details

**POST /api/v1/places/resolve** - Resolve and enrich POI data

```json
{
  "google_place_id": "ChIJ...",
  "lat": 41.7937,
  "lon": -87.5937,
  "name": "Starbucks",
  "category": "cafe"
}
```

### Health & Stats

**GET /api/v1/search/health** - Provider health check

**GET /api/v1/stats** - Cache statistics and server metrics

## Project Structure

```
src/
├── config/              # Configuration
│   ├── env.ts           # Environment variables with Zod validation
│   ├── supabase.ts      # Supabase client setup
│   └── redis.ts         # Redis client setup
│
├── providers/           # Provider abstraction layer
│   ├── types.ts         # Provider interface definitions
│   ├── base.ts          # Base provider class with metrics
│   ├── local.provider.ts      # Local Supabase/PostGIS provider
│   ├── google.provider.ts     # Google Places API provider
│   └── refuge.provider.ts     # Refuge Restrooms API provider
│
├── services/            # Business logic
│   ├── orchestrator.ts  # Multi-provider query coordination & deduplication
│   ├── cache.service.ts # Redis caching layer
│   ├── ai.service.ts    # OpenRouter AI integration
│   └── tools.ts         # AI tool definitions (restroom search, etc.)
│
├── routes/              # API endpoints
│   ├── search.ts        # Main search endpoint
│   ├── places.ts        # Google Places endpoints
│   ├── ai.ts            # AI query endpoint
│   └── debug.ts         # Debug endpoints for testing providers
│
└── index.ts             # App entry point & server setup
```

## Architecture

### Provider System

The provider abstraction layer allows seamless integration of multiple data sources:

- **Local Provider** - PostGIS-powered geospatial search in Supabase
- **Google Places Provider** - Real-time Google Places API integration
- **Refuge Restrooms Provider** - Accessible/gender-neutral restroom data

Each provider implements a common interface (`SearchProvider`) with:
- `search()` - Query execution
- `getPlace()` - Fetch place details
- `autocomplete()` - Autocomplete suggestions (if supported)

### Query Orchestrator

The orchestrator coordinates queries across multiple providers:

1. **Parallel execution** - Queries all requested providers simultaneously
2. **Result deduplication** - Merges results using spatial proximity (configurable threshold)
3. **Confidence scoring** - Ranks results based on provider reliability and data quality
4. **Caching** - Automatic cache-aside pattern with Redis

### AI Tool Calling

The AI service uses OpenRouter (Grok-4.1-fast:free) with the Vercel AI SDK:

- **Tool definitions** - Modular tools in `services/tools.ts`
- **Multi-step execution** - Supports up to 5 tool calls per query
- **Context injection** - User location passed via system message
- **Result extraction** - Tool results returned in `tool_results` array

Current tools:
- `search_restrooms` - Find accessible/gender-neutral restrooms

## Database Schema

### places

| Column | Type | Description |
|--------|------|-------------|
| id | text | Primary key |
| name | text | Place name |
| lat | float8 | Latitude |
| lon | float8 | Longitude |
| geom | geometry(Point,4326) | PostGIS point |
| google_place_id | text | Google Place ID (unique) |
| primary_category | text | Main category |
| confidence | float8 | Quality score (0-1) |
| socials | text[] | Social media URLs |
| websites | text[] | Website URLs |
| providers | jsonb | Provider metadata |
| raw | jsonb | Raw provider data |
| search_vector | tsvector | Full-text search |

**Indexes:**
- `idx_places_geom` - Spatial index (GIST)
- `idx_places_google_place_id` - Google Place ID lookup
- `idx_places_search_vector` - Full-text search (GIN)

## Caching Strategy

### Search Results
- **TTL:** 5 minutes
- **Key:** `search:{hash(params)}`

### Place Details
- **TTL:** 30 minutes
- **Key:** `place:{id}` or `place:autocomplete:{hash}`

### Performance Targets

- Cache hit: < 10ms
- Cache miss (local only): 50-100ms
- Multi-provider query: 200-400ms

## Development

### Run in Development

```bash
yarn dev  # Starts with hot reload
```

### Type Check

```bash
yarn type-check
```

### Build for Production

```bash
yarn build
yarn start
```

## Testing Providers

Use debug endpoints to test individual providers:

```bash
# Test local provider
curl -X POST http://localhost:3001/api/v1/debug/local \
  -H "Content-Type: application/json" \
  -d '{"location": {"lat": 41.7937, "lon": -87.5937}, "query": "coffee"}'

# Test Google provider
curl -X POST http://localhost:3001/api/v1/debug/google \
  -H "Content-Type: application/json" \
  -d '{"location": {"lat": 41.7937, "lon": -87.5937}, "query": "starbucks"}'

# Test Refuge Restrooms provider
curl -X POST http://localhost:3001/api/v1/debug/refuge \
  -H "Content-Type: application/json" \
  -d '{"location": {"lat": 41.7937, "lon": -87.5937}}'
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_ANON_KEY` | Yes | Supabase anonymous key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key |
| `REDIS_URL` | Yes | Redis connection URL (Upstash format) |
| `PORT` | No | Server port (default: 3001) |
| `NODE_ENV` | No | Environment (development/production) |
| `GOOGLE_PLACES_API_KEY` | No | Google Places API key (enables Google provider) |
| `OPENROUTER_API_KEY` | No | OpenRouter API key (enables AI features) |

