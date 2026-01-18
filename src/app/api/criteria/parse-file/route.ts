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

// Vercel function configuration - extend timeout for AI processing
export const maxDuration = 60; // 60 seconds timeout

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
    // Check for API key first
    if (!process.env.GEMINI_API_KEY) {
      console.error('GEMINI_API_KEY not configured');
      return NextResponse.json(
        { error: 'AI service not configured. Please add GEMINI_API_KEY to environment variables.' },
        { status: 503 }
      );
    }

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
    console.log(`[parse-file] Processing file: ${file.name}, type: ${file.type}, size: ${file.size} bytes`);
    const arrayBuffer = await file.arrayBuffer();
    const base64Data = Buffer.from(arrayBuffer).toString('base64');
    console.log(`[parse-file] Base64 encoded, length: ${base64Data.length} chars`);

    // Parse the file with Gemini
    console.log('[parse-file] Calling Gemini multimodal API...');
    const result = await parseFileToCriteria(
      base64Data,
      file.type,
      additionalContext || undefined
    );
    console.log(`[parse-file] Gemini returned ${result.criteria.length} criteria, ${result.warnings.length} warnings`);

    return NextResponse.json(result);
  } catch (error) {
    // Log detailed error info
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error('[parse-file] API error:', {
      message: errorMessage,
      stack: errorStack,
      error,
    });

    // Check for specific error types
    if (errorMessage.includes('API error')) {
      return NextResponse.json(
        {
          error: 'AI service error. The Gemini API returned an error.',
          details: errorMessage,
        },
        { status: 502 }
      );
    }

    if (errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT')) {
      return NextResponse.json(
        {
          error: 'Request timed out. Try with a smaller file or simpler document.',
          details: errorMessage,
        },
        { status: 504 }
      );
    }

    return NextResponse.json(
      {
        error: 'Failed to parse file',
        details: errorMessage,
      },
      { status: 500 }
    );
  }
}
