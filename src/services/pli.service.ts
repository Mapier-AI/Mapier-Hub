/**
 * PLI (Place/Location ID) Sync Service
 *
 * Handles cross-platform place resolution between iOS (Apple MapKit)
 * and Android (Google Places). Uses Overture GERS IDs as canonical
 * identifiers with spatial + name matching for conflation.
 */

import { supabase } from '../config/supabase.js'

// Types for PLI resolution
export interface ResolveRequest {
  // Platform identifiers (at least one required for exact match)
  google_place_id?: string
  apple_place_id?: string

  // Location (required for spatial matching)
  lat: number
  lon: number

  // Place details
  name: string
  category?: string

  // Optional address
  address?: {
    street?: string
    city?: string
    state?: string
    postcode?: string
    country?: string
    formatted?: string
  }

  // Optional contact
  phone?: string
  website?: string

  // Source platform
  source_platform: 'ios' | 'android'
}

export interface ResolveResponse {
  success: boolean

  // Canonical place info
  place: {
    id: string // GERS ID or custom_* ID
    source: 'places' | 'custom_places'
    name: string
    lat: number
    lon: number
    category?: string

    // Both PLIs (for cross-platform)
    google_place_id?: string
    apple_place_id?: string

    // Address fields
    address?: {
      street?: string
      city?: string
      state?: string
      postcode?: string
      country?: string
      formatted?: string
    }
  }

  // Resolution metadata
  resolution: {
    method: 'exact_pli' | 'spatial_match' | 'created_custom'
    confidence: number
    distance_meters?: number
  }
}

export interface BridgeResponse {
  place_id: string
  name: string
  lat: number
  lon: number
  category?: string

  // Target platform PLI (if cached)
  target_pli?: string

  // Resolution hint
  resolution_hint: 'cached' | 'search_required'

  // Address fields
  address?: {
    street?: string
    city?: string
    state?: string
    postcode?: string
    country?: string
    formatted?: string
  }
}

export class PLIService {
  /**
   * Format address from individual components
   * Handles both custom_places (with formatted) and places (without formatted)
   */
  private formatAddress(
    street?: string | null,
    city?: string | null,
    state?: string | null,
    postcode?: string | null,
    country?: string | null,
    formatted?: string | null
  ): {
    street?: string
    city?: string
    state?: string
    postcode?: string
    country?: string
    formatted?: string
  } {
    const components = [street, city, state, postcode].filter((c) => c && c.trim())

    return {
      street: street || undefined,
      city: city || undefined,
      state: state || undefined,
      postcode: postcode || undefined,
      country: country || undefined,
      formatted: formatted || (components.length > 0 ? components.join(', ') : undefined),
    }
  }

  /**
   * Resolve a place from any platform to canonical ID
   * This is the core conflation logic
   */
  async resolve(request: ResolveRequest): Promise<ResolveResponse> {
    // 1. Call conflate_place() RPC
    const { data: matches, error } = await supabase.rpc('conflate_place', {
      p_name: request.name,
      p_lat: request.lat,
      p_lon: request.lon,
      p_google_place_id: request.google_place_id || null,
      p_apple_place_id: request.apple_place_id || null,
      p_radius_meters: 50,
      p_name_threshold: 0.7,
    })

    if (error) {
      throw new Error(`Conflation failed: ${error.message}`)
    }

    const match = matches?.[0]

    // 2. Handle match results
    if (match?.matched_source === 'places') {
      // Fetch full place details including address
      const { data: placeData } = await supabase
        .from('places')
        .select('street, city, state, postcode, country')
        .eq('id', match.matched_id)
        .single()

      await this.cachePLI('places', match.matched_id, request)

      return {
        success: true,
        place: {
          id: match.matched_id,
          source: 'places',
          name: match.matched_name,
          lat: request.lat,
          lon: request.lon,
          category: request.category,
          google_place_id: match.google_place_id || request.google_place_id,
          apple_place_id: match.apple_place_id || request.apple_place_id,
          address: placeData ? this.formatAddress(
            placeData.street,
            placeData.city,
            placeData.state,
            placeData.postcode,
            placeData.country
          ) : undefined,
        },
        resolution: {
          method: match.match_confidence === 1.0 ? 'exact_pli' : 'spatial_match',
          confidence: match.match_confidence,
          distance_meters: match.distance_meters,
        },
      }
    }

    if (match?.matched_source === 'custom_places') {
      // Fetch full place details including address
      const { data: placeData } = await supabase
        .from('custom_places')
        .select('street, city, state, postcode, country, formatted_address')
        .eq('id', match.matched_id)
        .single()

      await this.cachePLI('custom_places', match.matched_id, request)

      return {
        success: true,
        place: {
          id: match.matched_id,
          source: 'custom_places',
          name: match.matched_name,
          lat: request.lat,
          lon: request.lon,
          category: request.category,
          google_place_id: match.google_place_id || request.google_place_id,
          apple_place_id: match.apple_place_id || request.apple_place_id,
          address: placeData ? this.formatAddress(
            placeData.street,
            placeData.city,
            placeData.state,
            placeData.postcode,
            placeData.country,
            placeData.formatted_address
          ) : undefined,
        },
        resolution: {
          method: match.match_confidence === 1.0 ? 'exact_pli' : 'spatial_match',
          confidence: match.match_confidence,
          distance_meters: match.distance_meters,
        },
      }
    }

    // 3. No match - create custom place
    const customPlace = await this.createCustomPlace(request)

    return {
      success: true,
      place: {
        id: customPlace.id,
        source: 'custom_places',
        name: customPlace.name,
        lat: customPlace.lat,
        lon: customPlace.lon,
        category: request.category,
        google_place_id: request.google_place_id,
        apple_place_id: request.apple_place_id,
        address: request.address,
      },
      resolution: {
        method: 'created_custom',
        confidence: 0.5,
      },
    }
  }

  /**
   * Cache a platform-specific PLI on the canonical place
   * Only updates if the field is currently null (don't overwrite)
   */
  private async cachePLI(
    table: 'places' | 'custom_places',
    placeId: string,
    request: Pick<ResolveRequest, 'source_platform' | 'google_place_id' | 'apple_place_id'>
  ): Promise<void> {
    const updates: Record<string, string> = {}

    if (request.source_platform === 'android' && request.google_place_id) {
      updates.google_place_id = request.google_place_id
    }
    if (request.source_platform === 'ios' && request.apple_place_id) {
      updates.apple_place_id = request.apple_place_id
    }

    if (Object.keys(updates).length === 0) return

    // Only update if the field is currently null (don't overwrite)
    const column = request.source_platform === 'ios' ? 'apple_place_id' : 'google_place_id'

    await supabase.from(table).update(updates).eq('id', placeId).is(column, null)
  }

  /**
   * Sync/store a PLI to the database (called by client after native search)
   * This is NOT caching - it's permanent storage in PostgreSQL
   */
  async syncPLI(
    placeId: string,
    platform: 'ios' | 'android',
    pli: string
  ): Promise<{ success: boolean }> {
    // Determine which table
    const isCustom = placeId.startsWith('custom_')
    const table = isCustom ? 'custom_places' : 'places'
    const column = platform === 'ios' ? 'apple_place_id' : 'google_place_id'

    const { error } = await supabase
      .from(table)
      .update({ [column]: pli })
      .eq('id', placeId)
      .is(column, null) // Only if not already set

    if (error) {
      console.error(`[PLI] Sync failed for ${placeId}:`, error)
      return { success: false }
    }

    return { success: true }
  }

  /**
   * Create a custom place (not in Overture)
   */
  private async createCustomPlace(request: ResolveRequest): Promise<{
    id: string
    name: string
    lat: number
    lon: number
  }> {
    const id = `custom_${crypto.randomUUID()}`

    const { data, error } = await supabase
      .from('custom_places')
      .insert({
        id,
        name: request.name,
        lat: request.lat,
        lon: request.lon,
        primary_category: request.category,
        google_place_id: request.google_place_id,
        apple_place_id: request.apple_place_id,
        formatted_address: request.address?.formatted,
        street: request.address?.street,
        city: request.address?.city,
        state: request.address?.state,
        postcode: request.address?.postcode,
        country: request.address?.country || 'US',
        phone: request.phone,
        website: request.website,
        source_platform: request.source_platform,
      })
      .select('id, name, lat, lon')
      .single()

    if (error) {
      throw new Error(`Failed to create custom place: ${error.message}`)
    }

    return data
  }

  /**
   * Get bridge info for cross-platform display
   */
  async getBridge(placeId: string, targetPlatform: 'ios' | 'android'): Promise<BridgeResponse> {
    const isCustom = placeId.startsWith('custom_')
    const table = isCustom ? 'custom_places' : 'places'

    const columns = 'id, name, lat, lon, primary_category, google_place_id, apple_place_id, street, city, state, postcode, country'

    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .eq('id', placeId)
      .single()

    if (error || !data) {
      throw new Error(`Place not found: ${placeId}`)
    }

    const targetPli = targetPlatform === 'ios' ? data.apple_place_id : data.google_place_id
    const formattedAddress = isCustom ? (data as any).formatted_address : undefined

    return {
      place_id: data.id,
      name: data.name,
      lat: data.lat,
      lon: data.lon,
      category: data.primary_category,
      target_pli: targetPli || undefined,
      resolution_hint: targetPli ? 'cached' : 'search_required',
      address: this.formatAddress(
        data.street,
        data.city,
        data.state,
        data.postcode,
        data.country,
        formattedAddress
      ),
    }
  }

  /**
   * Find nearby place for "Near X" context
   */
  async findNearby(
    lat: number,
    lon: number,
    radiusMeters = 100
  ): Promise<{
    place_id: string
    name: string
    distance_meters: number
    category?: string
    address?: {
      street?: string
      city?: string
      state?: string
      postcode?: string
      country?: string
      formatted?: string
    }
  } | null> {
    const { data, error } = await supabase.rpc('find_nearby_place_new', {
      p_lat: lat,
      p_lon: lon,
      p_radius_meters: radiusMeters,
    })

    if (error || !data?.[0]) {
      return null
    }

    const place = data[0]

    return {
      place_id: place.place_id,
      name: place.place_name,
      distance_meters: place.distance_meters,
      category: place.category,
      address: this.formatAddress(
        place.street,
        place.city,
        place.state,
        place.postcode,
        place.country
      ),
    }
  }
}

export const pliService = new PLIService()
