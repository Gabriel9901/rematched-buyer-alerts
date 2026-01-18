/**
 * Criteria Parse File API
 *
 * POST /api/criteria/parse-file
 *
 * Parses PDF or image files containing buyer requirements into structured criteria
 * using Gemini AI. Can extract multiple criteria from a single document.
 */

import { NextRequest, NextResponse } from 'next/server';
import { parseFileToCriteria } from '@/lib/criteria/parseText';

// Supported MIME types
const SUPPORTED_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
];

// Max file size: 10MB (Gemini supports up to 20MB)
const MAX_FILE_SIZE = 10 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const additionalContext = formData.get('context') as string | null;

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    // Validate file type
    if (!SUPPORTED_MIME_TYPES.includes(file.type)) {
      return NextResponse.json(
        {
          error: `Unsupported file type: ${file.type}. Supported types: PDF, PNG, JPEG, WebP`,
        },
        { status: 400 }
      );
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        {
          error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB`,
        },
        { status: 400 }
      );
    }

    // Convert file to base64
    const arrayBuffer = await file.arrayBuffer();
    const base64Data = Buffer.from(arrayBuffer).toString('base64');

    // Parse the file
    const result = await parseFileToCriteria(
      base64Data,
      file.type,
      additionalContext || undefined
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error('Parse file API error:', error);
    return NextResponse.json(
      {
        error: 'Failed to parse file',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
