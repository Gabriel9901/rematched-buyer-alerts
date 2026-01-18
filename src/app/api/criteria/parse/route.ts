/**
 * Criteria Parse API
 *
 * POST /api/criteria/parse
 *
 * Parses natural language buyer requirements into structured criteria
 * using Gemini AI.
 */

import { NextRequest, NextResponse } from 'next/server';
import { parseTextToCriteria, ParseResult } from '@/lib/criteria/parseText';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { text } = body;

    if (!text || typeof text !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid "text" field' },
        { status: 400 }
      );
    }

    if (text.trim().length < 10) {
      return NextResponse.json(
        { error: 'Text too short. Please provide more details about buyer requirements.' },
        { status: 400 }
      );
    }

    if (text.length > 5000) {
      return NextResponse.json(
        { error: 'Text too long. Please keep under 5000 characters.' },
        { status: 400 }
      );
    }

    const result: ParseResult = await parseTextToCriteria(text);

    return NextResponse.json(result);
  } catch (error) {
    console.error('Parse API error:', error);
    return NextResponse.json(
      { error: 'Failed to parse text', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
