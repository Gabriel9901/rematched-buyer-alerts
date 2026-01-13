/**
 * Typesense Client
 *
 * Executes multi_search queries against Typesense.
 * Does NOT log API keys or full filters in production.
 */

import { MultiSearchBody, MultiSearchResult } from './types';

const TYPESENSE_API_URL = process.env.TYPESENSE_API_URL || 'https://s.getrematched.com';

export class TypesenseError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public responseText: string
  ) {
    super(message);
    this.name = 'TypesenseError';
  }
}

/**
 * Execute a multi_search query against Typesense
 *
 * @param scopedSearchKey - The scoped API key (with embedded filters)
 * @param body - The search body from buildMultiSearchBody
 * @returns The search results
 */
export async function typesenseMultiSearch(
  scopedSearchKey: string,
  body: MultiSearchBody
): Promise<MultiSearchResult> {
  const url = `${TYPESENSE_API_URL}/multi_search?x-typesense-api-key=${encodeURIComponent(scopedSearchKey)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new TypesenseError(
      `Typesense request failed: ${response.status} ${response.statusText}`,
      response.status,
      text
    );
  }

  return response.json();
}

/**
 * Execute a multi_search with a custom API URL
 * Use this for testing or different Typesense instances
 */
export async function typesenseMultiSearchCustom(
  apiBaseUrl: string,
  scopedSearchKey: string,
  body: MultiSearchBody
): Promise<MultiSearchResult> {
  const url = `${apiBaseUrl}/multi_search?x-typesense-api-key=${encodeURIComponent(scopedSearchKey)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new TypesenseError(
      `Typesense request failed: ${response.status} ${response.statusText}`,
      response.status,
      text
    );
  }

  return response.json();
}
