import OpenAI from 'openai'
import { env } from '../config/env.js'
import type { SearchQuery } from '../providers/types.js'

/**
 * NLP Service for natural language query parsing and embeddings
 * Uses OpenAI for query understanding and semantic search
 */
export class NLPService {
  private openai: OpenAI | null = null

  constructor() {
    if (env.OPENAI_API_KEY) {
      this.openai = new OpenAI({ apiKey: env.OPENAI_API_KEY })
      console.log('✅ OpenAI NLP service initialized')
    } else {
      console.log('⚠️  OpenAI API key not found. NLP features disabled.')
    }
  }

  /**
   * Check if NLP is available
   */
  isAvailable(): boolean {
    return this.openai !== null
  }

  /**
   * Parse natural language query into structured SearchQuery
   * Example: "find me coffee shops near Central Park"
   * -> { location: {...}, category: "cafe", query: "coffee" }
   */
  async parseNaturalLanguageQuery(
    naturalQuery: string,
    userLocation?: { lat: number; lon: number }
  ): Promise<Partial<SearchQuery>> {
    if (!this.openai) {
      throw new Error('OpenAI API key not configured')
    }

    const completion = await this.openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a query parser for a location-based search API. Parse natural language queries into structured JSON.

Extract:
- "query": search terms for place names (e.g., "starbucks", "coffee")
- "category": place category (e.g., "cafe", "restaurant", "restroom", "park")
- "radius": search radius in meters (default: 1000, max: 50000)
- "location_mentioned": true if query mentions a specific location

Common categories:
- cafe, restaurant, bar, park, restroom, gas_station, pharmacy, hospital, bank, atm, hotel, gym, library, school, museum, theater

Return ONLY valid JSON, no explanation.`,
        },
        {
          role: 'user',
          content: `Parse this query: "${naturalQuery}"${userLocation ? `\nUser is at: lat=${userLocation.lat}, lon=${userLocation.lon}` : ''}`,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    })

    const parsed = JSON.parse(completion.choices[0].message.content || '{}')

    // Build SearchQuery
    const searchQuery: Partial<SearchQuery> = {
      query: parsed.query || naturalQuery,
      category: parsed.category,
      limit: parsed.limit || 20,
    }

    // If user location provided and no specific location mentioned, use it
    if (userLocation && !parsed.location_mentioned) {
      searchQuery.location = {
        lat: userLocation.lat,
        lon: userLocation.lon,
        radius: parsed.radius || 1000,
      }
    }

    return searchQuery
  }

  /**
   * Generate embedding for text (for semantic search)
   * Uses OpenAI text-embedding-3-small (1536 dimensions)
   */
  async generateEmbedding(text: string): Promise<number[]> {
    if (!this.openai) {
      throw new Error('OpenAI API key not configured')
    }

    const response = await this.openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
      encoding_format: 'float',
    })

    return response.data[0].embedding
  }

  /**
   * Batch generate embeddings (more efficient)
   */
  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (!this.openai) {
      throw new Error('OpenAI API key not configured')
    }

    const response = await this.openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: texts,
      encoding_format: 'float',
    })

    return response.data.map((d) => d.embedding)
  }

  /**
   * Generate embeddings for all places in the database (one-time operation)
   * Should be run as a background job
   */
  async generatePlaceEmbeddings(
    places: Array<{ id: string; name: string }>
  ): Promise<Map<string, number[]>> {
    const embeddings = new Map<string, number[]>()

    // Batch by 100 (OpenAI limit is 2048)
    const batchSize = 100
    for (let i = 0; i < places.length; i += batchSize) {
      const batch = places.slice(i, i + batchSize)
      const texts = batch.map((p) => p.name)

      try {
        const batchEmbeddings = await this.generateEmbeddings(texts)

        batch.forEach((place, idx) => {
          embeddings.set(place.id, batchEmbeddings[idx])
        })

        console.log(`Generated embeddings for ${i + batch.length}/${places.length} places`)

        // Rate limiting: wait 1 second between batches
        if (i + batchSize < places.length) {
          await new Promise((resolve) => setTimeout(resolve, 1000))
        }
      } catch (error) {
        console.error(`Failed to generate embeddings for batch ${i}:`, error)
      }
    }

    return embeddings
  }
}

// Singleton instance
export const nlpService = new NLPService()
