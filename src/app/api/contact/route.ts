/**
 * Contact API Endpoint
 *
 * Fetches agent contact info from Rematched API for a given listing.
 * Returns phone number and WhatsApp link.
 */

import { NextRequest, NextResponse } from 'next/server';

const REMATCHED_API_URL = 'https://rematch-backend-prod-p3gh2.ondigitalocean.app/api/v1';

// Store the auth token - in production, this should come from env or be refreshed
const AUTH_TOKEN = process.env.REMATCHED_AUTH_TOKEN;

interface ContactInfo {
  phone: string | null;
  username: string | null;
  source: string | null;
  whatsappLink: string | null;
  telegramLink: string | null;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const unitId = searchParams.get('unitId');

  if (!unitId) {
    return NextResponse.json(
      { error: 'unitId is required' },
      { status: 400 }
    );
  }

  if (!AUTH_TOKEN) {
    return NextResponse.json(
      { error: 'REMATCHED_AUTH_TOKEN not configured' },
      { status: 500 }
    );
  }

  try {
    // Fetch contact info from Rematched API
    const response = await fetch(
      `${REMATCHED_API_URL}/inventory-unit-preferences/${unitId}?fields=agentPhone%2CagentUsername%2Csource`,
      {
        headers: {
          'Authorization': `Bearer ${AUTH_TOKEN}`,
          'Accept': 'application/json',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Rematched API error: ${response.status}`);
    }

    const result = await response.json();
    const data = result.data || {};

    const contactInfo: ContactInfo = {
      phone: data.agentPhone || null,
      username: data.agentUsername || null,
      source: data.source || null,
      whatsappLink: data.agentPhone ? `https://wa.me/${data.agentPhone}` : null,
      telegramLink: data.agentUsername ? `https://t.me/${data.agentUsername.replace(/^@/, '')}` : null,
    };

    return NextResponse.json(contactInfo);
  } catch (error) {
    console.error('Error fetching contact:', error);
    return NextResponse.json(
      { error: 'Failed to fetch contact info' },
      { status: 500 }
    );
  }
}

/**
 * Batch fetch contacts for multiple units
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { unitIds } = body;

  if (!unitIds || !Array.isArray(unitIds)) {
    return NextResponse.json(
      { error: 'unitIds array is required' },
      { status: 400 }
    );
  }

  if (!AUTH_TOKEN) {
    return NextResponse.json(
      { error: 'REMATCHED_AUTH_TOKEN not configured' },
      { status: 500 }
    );
  }

  const contacts: Record<string, ContactInfo> = {};

  // Fetch contacts in parallel with rate limiting
  const batchSize = 5;
  for (let i = 0; i < unitIds.length; i += batchSize) {
    const batch = unitIds.slice(i, i + batchSize);

    await Promise.all(
      batch.map(async (unitId: string) => {
        try {
          const response = await fetch(
            `${REMATCHED_API_URL}/inventory-unit-preferences/${unitId}?fields=agentPhone%2CagentUsername%2Csource`,
            {
              headers: {
                'Authorization': `Bearer ${AUTH_TOKEN}`,
                'Accept': 'application/json',
              },
            }
          );

          if (response.ok) {
            const result = await response.json();
            const data = result.data || {};
            contacts[unitId] = {
              phone: data.agentPhone || null,
              username: data.agentUsername || null,
              source: data.source || null,
              whatsappLink: data.agentPhone ? `https://wa.me/${data.agentPhone}` : null,
              telegramLink: data.agentUsername ? `https://t.me/${data.agentUsername.replace(/^@/, '')}` : null,
            };
          }
        } catch {
          contacts[unitId] = {
            phone: null,
            username: null,
            source: null,
            whatsappLink: null,
            telegramLink: null,
          };
        }
      })
    );

    // Small delay between batches
    if (i + batchSize < unitIds.length) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  return NextResponse.json({ contacts });
}
