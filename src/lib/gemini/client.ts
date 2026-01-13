/**
 * Gemini API Client
 *
 * Uses Gemini 2.5 Flash with x-goog-api-key header authentication.
 * Endpoint: generativelanguage.googleapis.com/v1beta
 */

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

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
