import { tool } from 'ai'
import { z } from 'zod'
import { orchestrator } from './orchestrator.js'

/**
 * Mapier Tool Definitions
 * Each tool represents a capability that the LLM can invoke
 */

/**
 * Search for accessible and gender-neutral restrooms
 */
export const searchRestroomsTool = tool({
  description:
    'Search for accessible and gender-neutral restrooms near a location. Use this when users ask about restrooms, bathrooms, or toilets. IMPORTANT: You must provide the user\'s latitude and longitude coordinates.',
  inputSchema: z.object({
    lat: z.number().describe('Latitude of search location - use the user\'s current latitude from the system message'),
    lon: z.number().describe('Longitude of search location - use the user\'s current longitude from the system message'),
    radius: z.number().optional().describe('Search radius in meters (default: 2000)'),
    limit: z.number().optional().describe('Maximum number of results (default: 10)'),
  }),
  execute: async ({ lat, lon, radius = 2000, limit = 10 }) => {
    console.log(`[Tool: search_restrooms] lat=${lat}, lon=${lon}, radius=${radius}m`)

    // Validate coordinates
    if (!lat || !lon || isNaN(lat) || isNaN(lon)) {
      return {
        error: 'Invalid or missing coordinates. Please provide valid latitude and longitude.',
        count: 0,
        restrooms: [],
      }
    }

    // Get refuge provider
    const refugeProvider = (orchestrator as any).providers.get('refuge')
    if (!refugeProvider) {
      return { error: 'Refuge Restrooms provider not available', count: 0, restrooms: [] }
    }

    try {
      // Search for restrooms
      const result = await refugeProvider.search({
        location: { lat, lon, radius },
        query: 'restroom',
        limit,
      })

      return {
        count: result.places.length,
        restrooms: result.places.map((place: any) => ({
          name: place.name,
          distance: place.distance,
          accessible: place.attributes.accessible,
          unisex: place.attributes.unisex,
          changing_table: place.attributes.changing_table,
          street: place.attributes.street,
          city: place.attributes.city,
          directions: place.attributes.directions,
        })),
      }
    } catch (error) {
      return {
        error: `Failed to search restrooms: ${error instanceof Error ? error.message : 'Unknown error'}`,
        count: 0,
        restrooms: [],
      }
    }
  },
})

/**
 * TODO: Add more tools here:
 * - searchPOIs: General POI search (restaurants, cafes, etc.)
 * - resolveAddress: Convert address to coordinates
 * - getAreaStats: Get statistics about an area (rent prices, demographics, etc.)
 * - findSimilarPOIs: Find POIs similar to a given one
 * - getRouteInfo: Get directions and transit info
 */

/**
 * All available tools for the AI service
 * Add new tools to this object to make them available to the LLM
 */
export const mapierTools = {
  search_restrooms: searchRestroomsTool,
  // Future tools go here
}
