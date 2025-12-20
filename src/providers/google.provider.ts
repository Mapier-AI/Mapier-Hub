import { PlacesClient } from '@googlemaps/places'
import { BaseProvider } from './base.js'
import type { SearchQuery, ProviderResult, Place } from './types.js'
import { env } from '../config/env.js'

/**
 * Google Places Provider
 * Integrates Google Places API (New) v1 for POI search
 */
export class GooglePlacesProvider extends BaseProvider {
  private client: PlacesClient

  constructor() {
    super({
      name: 'google',
      priority: 2, // Lower priority than local (fallback)
      timeout: 3000, // 3 seconds
      enabled: !!env.GOOGLE_PLACES_API_KEY,
    })

    // Initialize PlacesClient with API key
    this.client = new PlacesClient({
      apiKey: env.GOOGLE_PLACES_API_KEY,
    })

    if (!env.GOOGLE_PLACES_API_KEY) {
      this.log('warn', 'Google Places API key not configured. Provider disabled.')
    }
  }

  /**
   * Search for places using Google Places Nearby Search
   *
   * TODO: Implement data pipeline for Google Places results
   * When this API returns results, we should:
   * 1. Return results to client immediately (current behavior)
   * 2. Send results to a background data pipeline that:
   *    - Resolves Google POI info to enrich our local POI database
   *    - Ensures compliance with Google Places API ToS (no direct caching, only enrichment)
   *    - Updates our database with missing places or enhanced data
   */
  async search(query: SearchQuery): Promise<ProviderResult> {
    if (!env.GOOGLE_PLACES_API_KEY) {
      throw new Error('Google Places API key not configured')
    }

    const { result, latency } = await this.measureTime(async () => {
      try {
        const [response] = await this.client.searchNearby({
          locationRestriction: {
            circle: {
              center: {
                latitude: query.location.lat,
                longitude: query.location.lon,
              },
              radius: query.location.radius || 1000,
            },
          },
          maxResultCount: query.limit || 20,
          ...(query.query && { keyword: query.query }),
          ...(query.category && { includedTypes: [this.mapCategoryToGoogleType(query.category)] }),
        } as any)

        if (!response || !response.places) {
          return []
        }

        const places = response.places
          .slice(0, query.limit || 20)
          .map((place: any) => this.transformGooglePlace(place))

        return places
      } catch (error) {
        this.log('error', 'Google Places search failed', error)
        throw error
      }
    })

    this.log('info', `Found ${result.length} places from Google in ${latency}ms`)

    return {
      provider: this.name,
      places: result,
      metadata: {
        count: result.length,
        cached: false,
        latency,
        confidence: 0.9, // Google data is highly trusted
      },
    }
  }

  /**
   * Get place details by Google Place ID
   */
  async getPlace(id: string): Promise<Place | null> {
    if (!env.GOOGLE_PLACES_API_KEY) {
      return null
    }

    try {
      const [response] = await this.client.getPlace({
        name: `places/${id}`,
        // Request specific fields using field mask
        // Equivalent to X-Goog-FieldMask header
      } as any, {
        otherArgs: {
          headers: {
            'X-Goog-FieldMask': 'id,displayName,formattedAddress,location,types,rating,userRatingCount,currentOpeningHours,websiteUri,internationalPhoneNumber,photos',
          },
        },
      })

      if (!response) {
        return null
      }

      return this.transformGooglePlace(response as any)
    } catch (error) {
      this.log('error', `Failed to fetch place ${id}`, error)
      return null
    }
  }

  /**
   * Google Places Autocomplete (New API)
   * For fuzzy search / suggestions
   */
  async autocomplete(input: string, location?: { lat: number; lon: number }): Promise<any[]> {
    if (!env.GOOGLE_PLACES_API_KEY) {
      throw new Error('Google Places API key not configured')
    }

    try {
      const request: any = {
        input,
        languageCode: 'en',
      }

      // Add location bias if provided
      if (location) {
        request.locationBias = {
          circle: {
            center: {
              latitude: location.lat,
              longitude: location.lon,
            },
            radius: 50000, // 50km radius (matching frontend)
          },
        }
      }

      const [response] = await this.client.autocompletePlaces(request)

      if (!response || !response.suggestions) {
        return []
      }

      // Filter for place predictions only (exclude query predictions)
      const predictions = response.suggestions
        .filter((s: any) => s.placePrediction)
        .map((suggestion: any) => {
          const placePrediction = suggestion.placePrediction
          return {
            placeId: placePrediction.placeId || placePrediction.place,
            description: placePrediction.text?.text || '',
            mainText: placePrediction.structuredFormat?.mainText?.text || '',
            secondaryText: placePrediction.structuredFormat?.secondaryText?.text || '',
            types: placePrediction.types || [],
          }
        })

      return predictions
    } catch (error) {
      this.log('error', 'Google Autocomplete failed', error)
      throw error
    }
  }

  /**
   * Transform Google Place (New API format) to our canonical Place format
   */
  private transformGooglePlace(googlePlace: any): Place {
    const location = googlePlace.location || {}

    return {
      id: googlePlace.id || googlePlace.name?.replace('places/', '') || `google_${Date.now()}`,
      name: googlePlace.displayName?.text || googlePlace.name || 'Unknown',
      location: {
        lat: location.latitude || 0,
        lon: location.longitude || 0,
      },
      category: {
        primary: this.mapGoogleTypeToCategory(googlePlace.types?.[0]),
        secondary: googlePlace.types?.slice(1, 3) || [],
      },
      confidence: 0.9, // Google data is reliable
      socials: [],
      websites: googlePlace.websiteUri ? [googlePlace.websiteUri] : [],
      attributes: {
        rating: googlePlace.rating,
        user_ratings_total: googlePlace.userRatingCount,
        price_level: googlePlace.priceLevel,
        opening_hours: googlePlace.currentOpeningHours,
        address: googlePlace.formattedAddress,
        phone: googlePlace.internationalPhoneNumber,
        photos: googlePlace.photos?.map((p: any) => ({
          name: p.name,
          widthPx: p.widthPx,
          heightPx: p.heightPx,
          authorAttributions: p.authorAttributions,
        })),
      },
      providers: {
        google: {
          externalId: googlePlace.id || googlePlace.name?.replace('places/', ''),
          raw: googlePlace,
        },
      },
    }
  }

  /**
   * Map our category to Google Place type
   */
  private mapCategoryToGoogleType(category?: string): string | undefined {
    if (!category) return undefined

    const mapping: Record<string, string> = {
      cafe: 'cafe',
      restaurant: 'restaurant',
      bar: 'bar',
      park: 'park',
      gym: 'gym',
      hospital: 'hospital',
      pharmacy: 'pharmacy',
      bank: 'bank',
      atm: 'atm',
      gas_station: 'gas_station',
      hotel: 'lodging',
      museum: 'museum',
      library: 'library',
      school: 'school',
      restroom: 'restroom',
    }

    return mapping[category] || category
  }

  /**
   * Map Google type to our category
   */
  private mapGoogleTypeToCategory(googleType?: string): string {
    if (!googleType) return 'unknown'

    const mapping: Record<string, string> = {
      cafe: 'cafe',
      restaurant: 'restaurant',
      bar: 'bar',
      park: 'park',
      gym: 'gym',
      hospital: 'hospital',
      pharmacy: 'pharmacy',
      bank: 'bank',
      atm: 'atm',
      gas_station: 'gas_station',
      lodging: 'hotel',
      museum: 'museum',
      library: 'library',
      school: 'school',
      restroom: 'restroom',
    }

    return mapping[googleType] || googleType
  }
}
