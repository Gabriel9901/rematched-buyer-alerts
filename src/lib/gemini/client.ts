/**
 * Gemini API Client
 *
 * Uses Gemini 2.0 Flash for stable multimodal support (images, PDFs).
 * Endpoint: generativelanguage.googleapis.com/v1beta
 */

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

export interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{ text: string }>;
      role: string;
    };
    finishReason: string;
  }>;
  usageMetadata: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

export class GeminiError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public details?: unknown
  ) {
    super(message);
    this.name = 'GeminiError';
  }
}

/**
 * Call Gemini API with a text prompt
 *
 * @param apiKey - Gemini API key (AIza...)
 * @param prompt - The text prompt to send
 * @returns The generated text response
 */
export async function callGemini(apiKey: string, prompt: string): Promise<string> {
  const response = await fetch(GEMINI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: prompt }],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new GeminiError(
      `Gemini API error: ${response.status} ${response.statusText}`,
      response.status,
      errorData
    );
  }

  const data: GeminiResponse = await response.json();

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new GeminiError('No text in Gemini response');
  }

  return text;
}

/**
 * Call Gemini with a structured prompt expecting JSON response
 *
 * @param apiKey - Gemini API key
 * @param prompt - The prompt (should instruct to return JSON)
 * @returns Parsed JSON object
 */
export async function callGeminiJson<T>(apiKey: string, prompt: string): Promise<T> {
  const text = await callGemini(apiKey, prompt);

  // Extract JSON from response (handle markdown code blocks)
  let jsonStr = text;
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  try {
    return JSON.parse(jsonStr);
  } catch {
    throw new GeminiError(`Failed to parse Gemini JSON response: ${text.substring(0, 200)}`);
  }
}

/**
 * Extract complete JSON objects from a potentially truncated array response.
 * Handles cases where Gemini's response is cut off mid-array.
 */
function extractCompleteJsonObjects(text: string): unknown[] {
  // Pattern to match complete qualification result objects
  const pattern = /\{\s*"listingIndex"\s*:\s*\d+\s*,\s*"score"\s*:\s*[\d.]+\s*,\s*"explanation"\s*:\s*"[^"]*(?:\\.[^"]*)*"\s*,\s*"highlights"\s*:\s*\[[^\]]*\]\s*,\s*"concerns"\s*:\s*\[[^\]]*\]\s*\}/g;

  const matches = text.match(pattern);
  if (!matches) {
    return [];
  }

  const results: unknown[] = [];
  for (const match of matches) {
    try {
      results.push(JSON.parse(match));
    } catch {
      // Skip malformed objects
    }
  }
  return results;
}

/**
 * Call Gemini API with multimodal input (text + file)
 *
 * @param apiKey - Gemini API key
 * @param prompt - The text prompt to send
 * @param fileData - Base64-encoded file data
 * @param mimeType - MIME type of the file (image/png, image/jpeg, application/pdf)
 * @returns The generated text response
 */
export async function callGeminiMultimodal(
  apiKey: string,
  prompt: string,
  fileData: string,
  mimeType: string
): Promise<string> {
  const response = await fetch(GEMINI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType,
                data: fileData,
              },
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new GeminiError(
      `Gemini API error: ${response.status} ${response.statusText}`,
      response.status,
      errorData
    );
  }

  const data: GeminiResponse = await response.json();

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new GeminiError('No text in Gemini response');
  }

  return text;
}

/**
 * Call Gemini with multimodal input expecting JSON response
 *
 * @param apiKey - Gemini API key
 * @param prompt - The prompt (should instruct to return JSON)
 * @param fileData - Base64-encoded file data
 * @param mimeType - MIME type of the file
 * @returns Parsed JSON object
 */
export async function callGeminiMultimodalJson<T>(
  apiKey: string,
  prompt: string,
  fileData: string,
  mimeType: string
): Promise<T> {
  const text = await callGeminiMultimodal(apiKey, prompt, fileData, mimeType);

  // Extract JSON from response (handle markdown code blocks)
  let jsonStr = text;
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  try {
    return JSON.parse(jsonStr);
  } catch {
    throw new GeminiError(`Failed to parse Gemini JSON response: ${text.substring(0, 200)}`);
  }
}

/**
 * Call Gemini with a batch prompt expecting JSON array response.
 * Handles large responses and truncated JSON gracefully.
 *
 * @param apiKey - Gemini API key
 * @param prompt - The batch prompt (should instruct to return JSON array)
 * @returns Parsed JSON array
 */
export async function callGeminiBatchJson<T>(apiKey: string, prompt: string): Promise<T[]> {
  const text = await callGemini(apiKey, prompt);

  // Extract JSON from response (handle markdown code blocks)
  let jsonStr = text;
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  // Try to parse as complete JSON array first
  try {
    const parsed = JSON.parse(jsonStr);
    if (Array.isArray(parsed)) {
      return parsed as T[];
    }
    // Handle case where response is wrapped in an object
    if (parsed.results && Array.isArray(parsed.results)) {
      return parsed.results as T[];
    }
    throw new Error('Response is not an array');
  } catch {
    // If full parse fails, try to extract complete objects from truncated response
    console.warn('Full JSON parse failed, attempting to extract complete objects');
    const extracted = extractCompleteJsonObjects(text) as T[];
    if (extracted.length > 0) {
      console.log(`Extracted ${extracted.length} complete objects from truncated response`);
      return extracted;
    }
    throw new GeminiError(`Failed to parse batch Gemini JSON response: ${text.substring(0, 500)}`);
  }
}
