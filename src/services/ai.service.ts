import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { generateText } from 'ai'
import { env } from '../config/env.js'
import { mapierTools } from './tools.js'

/**
 * AI Service using OpenRouter with free Grok model
 * Handles natural language queries with tool calling
 */
class AIService {
  private provider: ReturnType<typeof createOpenRouter> | null = null

  constructor() {
    if (env.OPENROUTER_API_KEY) {
      this.provider = createOpenRouter({
        apiKey: env.OPENROUTER_API_KEY,
      })
      console.log('✅ AI Service initialized with OpenRouter (Grok-4.1-fast)')
    } else {
      console.log('⚠️  OpenRouter API key not found. AI features disabled.')
    }
  }

  /**
   * Check if AI service is available
   */
  isAvailable(): boolean {
    return this.provider !== null
  }

  /**
   * Process a natural language query with tool calling
   */
  async query(message: string, location?: { lat: number; lon: number }): Promise<any> {
    if (!this.provider) {
      throw new Error('AI Service not available. Please configure OPENROUTER_API_KEY.')
    }

    try {
      console.log('[AI Service] Processing query:', {
        message,
        location,
        availableTools: Object.keys(mapierTools),
      })

      const result = await generateText({
        model: this.provider('x-ai/grok-4.1-fast:free'),
        messages: [
          {
            role: 'system',
            content: `You are Mapier, a helpful map assistant. You help users find places and answer questions about locations.

${
  location
    ? `IMPORTANT: The user's current location is at coordinates: latitude=${location.lat}, longitude=${location.lon}.
When using tools that require lat/lon parameters, use these exact coordinates.`
    : ''
}

You have access to tools to search for restrooms, POIs, and other location-based information.
When calling tools that need location coordinates (lat, lon), use the user's current location coordinates provided above.
Always provide helpful, concise, and friendly responses.`,
          },
          {
            role: 'user',
            content: message,
          },
        ],
        tools: mapierTools, // Import all tools from tools.ts
        maxSteps: 5, // Allow up to 5 tool calls
      })

      console.log('[AI Service] Result:', {
        text: result.text,
        steps: result.steps.length,
        finishReason: result.finishReason,
      })

      result.steps.forEach((step, i) => {
        const toolResult = step.toolResults?.[0]?.result
        console.log(`[AI Service] Step ${i}:`, {
          type: step.toolCalls ? 'tool-call' : 'text',
          toolCallsCount: step.toolCalls?.length || 0,
          toolResultsCount: step.toolResults?.length || 0,
          toolResultsSample: toolResult ? JSON.stringify(toolResult).substring(0, 200) : undefined,
          hasText: !!step.text,
          textPreview: step.text ? step.text.substring(0, 100) : undefined,
        })
      })

      // Extract tool results from steps
      const toolResults = result.steps
        .filter((step) => step.toolResults && step.toolResults.length > 0)
        .flatMap((step) => step.toolResults)

      return {
        text: result.text,
        tool_calls: result.steps
          .filter((step) => step.toolCalls && step.toolCalls.length > 0)
          .flatMap((step) => step.toolCalls),
        tool_results: toolResults,
        usage: result.usage,
        finish_reason: result.finishReason,
      }
    } catch (error) {
      console.error('[AI Service] Query failed:', error)
      throw error
    }
  }
}

export const aiService = new AIService()
