// Gemini API utility with fallback support
// Handles automatic fallback from gemini-2.5-flash to gemini-2.0-flash when rate limits are reached

const GEMINI_MODELS = {
  PRIMARY: 'gemini-2.5-flash',
  PRIMARY_LITE: 'gemini-2.5-flash-lite-preview-06-17',
  FALLBACK: 'gemini-2.0-flash'
};

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Makes API call to Gemini with automatic fallback
 * @param {string} apiKey - Gemini API key
 * @param {string} model - Primary model to try first
 * @param {Object} requestBody - Request body for the API call
 * @returns {Promise<Object>} API response
 */
export const callGeminiWithFallback = async (apiKey, model, requestBody) => {
  if (!apiKey) {
    throw new Error('Gemini API key is required');
  }

  // Determine if we should use lite version for primary model
  const primaryModel = model.includes('lite') ? GEMINI_MODELS.PRIMARY_LITE : model;
  const fallbackModel = GEMINI_MODELS.FALLBACK;

  // Try primary model first
  try {
    const response = await makeGeminiRequest(apiKey, primaryModel, requestBody);
    return response;
  } catch (error) {
    // Check if error is due to rate limiting or quota exceeded
    if (isRateLimitError(error)) {
      console.warn(`Primary model ${primaryModel} rate limited, falling back to ${fallbackModel}`);
      
      try {
        const fallbackResponse = await makeGeminiRequest(apiKey, fallbackModel, requestBody);
        return fallbackResponse;
      } catch (fallbackError) {
        console.error('Fallback model also failed:', fallbackError);
        throw new Error(`Both primary (${primaryModel}) and fallback (${fallbackModel}) models failed. Primary error: ${error.message}, Fallback error: ${fallbackError.message}`);
      }
    } else {
      // If it's not a rate limit error, throw the original error
      throw error;
    }
  }
};

/**
 * Makes the actual API request to Gemini
 * @param {string} apiKey - API key
 * @param {string} model - Model to use
 * @param {Object} requestBody - Request body
 * @returns {Promise<Object>} API response
 */
const makeGeminiRequest = async (apiKey, model, requestBody) => {
  const response = await fetch(`${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API request failed: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  
  // Check for API-level errors in response
  if (data.error) {
    throw new Error(`API error: ${data.error.message || 'Unknown error'}`);
  }

  const result = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!result) {
    throw new Error('No response content received from API');
  }

  return {
    text: result,
    fullResponse: data
  };
};

/**
 * Checks if an error is due to rate limiting or quota exceeded
 * @param {Error} error - Error to check
 * @returns {boolean} True if error is rate limit related
 */
const isRateLimitError = (error) => {
  const errorMessage = error.message.toLowerCase();
  const rateLimitIndicators = [
    'rate limit',
    'quota exceeded',
    'too many requests',
    '429',
    'rate_limit_exceeded',
    'quota_exceeded',
    'resource_exhausted'
  ];
  
  return rateLimitIndicators.some(indicator => errorMessage.includes(indicator));
};

/**
 * Legacy function for compatibility with existing disputeHandler.js
 * @param {string} apiKey - API key
 * @param {string} model - Model name (will be mapped to appropriate model)
 * @param {Object} requestBody - Request body
 * @returns {Promise<Object>} API response
 */
export const callGeminiAPI = async (apiKey, model, requestBody) => {
  return callGeminiWithFallback(apiKey, model, requestBody);
};