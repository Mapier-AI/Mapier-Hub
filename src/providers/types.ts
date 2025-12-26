/**
 * Core type definitions for the place provider abstraction layer
 */

// Search query structure
export interface SearchQuery {
  // Geospatial parameters (required)
  location: {
    lat: number
    lon: number
    radius?: number // meters, default: 1000
  }

  // Filters (optional)
  query?: string // Text search on place name
  category?: string // Filter by primary_category
  limit?: number // Max results, default: 20
  offset?: number // Pagination offset, default: 0
}

// Place data structure (canonical format)
export interface Place {
  id: string
  name: string
  location: {
    lat: number
    lon: number
  }
  category: {
    primary: string
    secondary?: string[]
  }
  confidence: number // 0-1, data quality score
  socials?: string[]
  websites?: string[]
  attributes: Record<string, any> // Flexible attributes (rating, hours, etc.)
  distance?: number // Distance from search point in meters

  // Platform-specific IDs for cross-platform sync
  google_place_id?: string
  apple_place_id?: string

  // Source tracking
  source_type?: 'provider' | 'custom' // 'provider' = Overture/data providers, 'custom' = user-submitted

  providers?: {
    [key: string]: {
      externalId: string
      raw: any
    }
  }
}

// Provider result structure
export interface ProviderResult {
  provider: string // Provider name (e.g., "local", "google", "osm")
  places: Place[]
  metadata: {
    count: number
    cached: boolean
    latency: number // milliseconds
    confidence: number // 0-1, overall result quality
  }
}

// Base provider interface
export interface PlaceProvider {
  // Provider metadata
  readonly name: string
  readonly priority: number // Lower = higher priority
  readonly timeout: number // Max wait time in ms

  // Core methods
  search(query: SearchQuery): Promise<ProviderResult>
  getPlace(id: string): Promise<Place | null>
  healthCheck(): Promise<boolean>
}

// Provider configuration
export interface ProviderConfig {
  name: string
  priority: number
  timeout: number
  enabled: boolean
}
