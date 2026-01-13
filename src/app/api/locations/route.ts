/**
 * Location Search API
 *
 * Searches Typesense for locations and returns PSL codes.
 * Used for the community/location picker in the criteria form.
 */

import { NextRequest, NextResponse } from 'next/server';

const TYPESENSE_API_URL = process.env.TYPESENSE_API_URL || 'https://s.getrematched.com';

interface LocationResult {
  name: string;
  pslCode: string;
  address: string;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');

  if (!query || query.length < 2) {
    return NextResponse.json({ locations: [] });
  }

  const typesenseKey = process.env.TYPESENSE_SCOPED_KEY;
  if (!typesenseKey) {
    return NextResponse.json(
      { error: 'Typesense not configured' },
      { status: 500 }
    );
  }

  try {
    const searchBody = {
      searches: [
        {
          collection: 'unit',
          q: query,
          query_by: 'data.location_raw',
          filter_by: 'data.kind:=listing && location_data_null:=false',
          per_page: 50,
          include_fields: 'location_data',
        },
      ],
    };

    const response = await fetch(
      `${TYPESENSE_API_URL}/multi_search?x-typesense-api-key=${encodeURIComponent(typesenseKey.trim())}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          Accept: 'application/json',
        },
        body: JSON.stringify(searchBody),
      }
    );

    if (!response.ok) {
      throw new Error(`Typesense error: ${response.status}`);
    }

    const result = await response.json();
    const hits = result.results?.[0]?.hits || [];

    // Extract unique locations by PSL code
    const locationMap = new Map<string, LocationResult>();

    for (const hit of hits) {
      const locationData = hit.document?.location_data;
      if (!locationData || !Array.isArray(locationData)) continue;

      for (const loc of locationData) {
        if (loc.psl_code && loc.name && !locationMap.has(loc.psl_code)) {
          locationMap.set(loc.psl_code, {
            name: loc.name,
            pslCode: loc.psl_code,
            address: loc.address || loc.name,
          });
        }
      }
    }

    // Convert to array and sort by name
    const locations = Array.from(locationMap.values())
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 20); // Limit to 20 results

    return NextResponse.json({ locations });
  } catch (error) {
    console.error('Location search error:', error);
    return NextResponse.json(
      { error: 'Search failed' },
      { status: 500 }
    );
  }
}
