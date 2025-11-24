# Mapier Hub API

Multi-provider map data aggregation backend built with Hono, TypeScript, and Supabase.

## Features

- ✅ Geospatial search using PostGIS
- ✅ Full-text search on place names
- ✅ Redis caching for performance
- ✅ Provider abstraction layer (ready for Google Places, OSM, etc.)
- ✅ Type-safe with TypeScript and Zod validation
- ✅ Fast and lightweight (Hono framework)

## Prerequisites

- Node.js 20+
- Supabase project
- Redis instance (Upstash recommended)

## Quick Start

### 1. Install Dependencies

```bash
yarn install
```

### 2. Environment Setup

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Required environment variables:

```env
# Supabase (from your Supabase project settings)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Redis (from Upstash or your Redis provider)
REDIS_URL=rediss://default:password@endpoint.upstash.io:6379

# Server
PORT=3000
NODE_ENV=development
```

### 3. Run Development Server

```bash
yarn dev
```

Server will start on `http://localhost:3000`

## API Endpoints

### Search Places

**Endpoint:** `POST /api/v1/search`

**Request Body:**

```json
{
  "location": {
    "lat": 40.7580,
    "lon": -73.9855,
    "radius": 1000
  },
  "query": "coffee",
  "category": "cafe",
  "limit": 20,
  "offset": 0
}
```

**Response:**

```json
{
  "success": true,
  "results": [
    {
      "id": "place_123",
      "name": "Blue Bottle Coffee",
      "location": {
        "lat": 40.7580,
        "lon": -73.9855
      },
      "category": {
        "primary": "cafe",
        "secondary": []
      },
      "confidence": 0.95,
      "socials": [],
      "websites": ["https://bluebottlecoffee.com"],
      "attributes": {},
      "distance": 150.5
    }
  ],
  "metadata": {
    "provider": "local",
    "count": 15,
    "cached": false,
    "latency_ms": 45,
    "confidence": 1.0
  }
}
```

### Get Place Details

**Endpoint:** `GET /api/v1/places/:id`

**Response:**

```json
{
  "success": true,
  "place": {
    "id": "place_123",
    "name": "Blue Bottle Coffee",
    "location": {
      "lat": 40.7580,
      "lon": -73.9855
    },
    "category": {
      "primary": "cafe"
    },
    "confidence": 0.95,
    "socials": [],
    "websites": ["https://bluebottlecoffee.com"],
    "attributes": {}
  }
}
```

### Health Check

**Endpoint:** `GET /api/v1/search/health`

**Response:**

```json
{
  "success": true,
  "status": "healthy",
  "providers": {
    "local": true
  }
}
```

### Cache Statistics

**Endpoint:** `GET /api/v1/stats`

**Response:**

```json
{
  "cache": {
    "keys": 142,
    "memory": "1.2M"
  },
  "uptime": 3600.5,
  "memory": {
    "rss": 50331648,
    "heapTotal": 20971520,
    "heapUsed": 15728640
  }
}
```

## Supported Query Types

### 1. Geospatial Search (Required)

Find places within a radius:

```json
{
  "location": {
    "lat": 40.7580,
    "lon": -73.9855,
    "radius": 2000
  }
}
```

### 2. Category Filtering

Filter by place category:

```json
{
  "location": { "lat": 40.7580, "lon": -73.9855 },
  "category": "restaurant"
}
```

### 3. Text Search

Search by place name:

```json
{
  "location": { "lat": 40.7580, "lon": -73.9855 },
  "query": "starbucks"
}
```

### 4. Combined Queries

Combine all filters:

```json
{
  "location": { "lat": 40.7580, "lon": -73.9855, "radius": 1000 },
  "category": "cafe",
  "query": "coffee",
  "limit": 20
}
```

## Database Schema

The API uses the following Supabase tables:

### `places`

| Column | Type | Description |
|--------|------|-------------|
| id | text | Primary key |
| name | text | Place name |
| lat | float | Latitude |
| lon | float | Longitude |
| geom | geometry | PostGIS point (auto-generated) |
| primary_category | text | Main category |
| confidence | float | Data quality score (0-1) |
| socials | text[] | Social media URLs |
| websites | text[] | Website URLs |
| raw | jsonb | Raw provider data |
| search_vector | tsvector | Full-text search (auto-generated) |

### Postgres Functions

- `search_places_nearby()` - Efficient geospatial search
- `get_place_by_id()` - Fetch place details

## Project Structure

```
src/
├── config/           # Configuration (env, supabase, redis)
├── providers/        # Provider abstraction layer
│   ├── types.ts      # Type definitions
│   ├── base.ts       # Base provider class
│   └── local.provider.ts  # Local DB provider
├── services/         # Business logic
│   ├── orchestrator.ts    # Query coordinator
│   └── cache.service.ts   # Redis caching
├── routes/           # API endpoints
│   ├── search.ts     # Search endpoints
│   └── places.ts     # Place endpoints
├── middleware/       # Request processing
│   └── validator.ts  # Zod validation
└── index.ts          # App entry point
```

## Caching Strategy

### Search Results
- **TTL:** 5 minutes (300 seconds)
- **Key format:** `search:{params_hash}`

### Place Details
- **TTL:** 30 minutes (1800 seconds)
- **Key format:** `place:{id}`

### Cache Hit Rate
Expected: 40-60% based on typical usage patterns

## Performance

### Expected Latencies (p95)

- **Local only:** 50-100ms
- **With cache hit:** 5-10ms
- **With cache miss:** 100-200ms

### Throughput

- **Single instance:** 500-1000 req/s
- **With Redis:** 2000+ req/s

## Development

### Run Tests

```bash
yarn test
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

## Next Steps (Phase 2)

- [ ] Add Google Places provider
- [ ] Add OpenStreetMap provider
- [ ] Implement result merging and deduplication
- [ ] Add natural language query parsing
- [ ] Implement streaming API (SSE)
- [ ] Add GraphQL endpoint

## License

MIT
