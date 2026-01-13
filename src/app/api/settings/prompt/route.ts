/**
 * Default System Prompt API
 *
 * GET /api/settings/prompt - Get the default system prompt and placeholder docs
 * PUT /api/settings/prompt - Update the default system prompt
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/client';
import { SystemPromptSetting, PlaceholderDocumentation } from '@/lib/supabase/types';
import { DEFAULT_SYSTEM_PROMPT, PLACEHOLDER_DOCS, validateTemplate } from '@/lib/gemini/promptTemplate';

export async function GET() {
  try {
    const supabase = getServerSupabase();

    // Fetch the default system prompt
    const { data: promptSetting } = await supabase
      .from('app_settings')
      .select('value, updated_at')
      .eq('key', 'default_system_prompt')
      .single();

    // Fetch placeholder documentation
    const { data: placeholderSetting } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'system_prompt_placeholders')
      .single();

    const template = promptSetting?.value
      ? (promptSetting.value as SystemPromptSetting).template
      : DEFAULT_SYSTEM_PROMPT;

    const placeholders = placeholderSetting?.value
      ? (placeholderSetting.value as PlaceholderDocumentation)
      : PLACEHOLDER_DOCS;

    const version = promptSetting?.value
      ? (promptSetting.value as SystemPromptSetting).version
      : 1;

    return NextResponse.json({
      template,
      version,
      placeholders,
      updatedAt: promptSetting?.updated_at,
      isDefault: !promptSetting?.value,
    });
  } catch (error) {
    console.error('Error fetching default prompt:', error);
    return NextResponse.json(
      { error: 'Failed to fetch default prompt' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { template } = body;

    if (!template || typeof template !== 'string') {
      return NextResponse.json(
        { error: 'Template is required and must be a string' },
        { status: 400 }
      );
    }

    // Validate the template has at least some required placeholders
    const validation = validateTemplate(template);
    if (!validation.isValid) {
      return NextResponse.json(
        {
          error: 'Invalid template',
          missingBuyer: validation.missingBuyer,
          missingListing: validation.missingListing,
        },
        { status: 400 }
      );
    }

    const supabase = getServerSupabase();

    // Get the current version
    const { data: currentSetting } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'default_system_prompt')
      .single();

    const currentVersion = currentSetting?.value
      ? (currentSetting.value as SystemPromptSetting).version
      : 0;

    // Update the default prompt with incremented version
    const newValue: SystemPromptSetting = {
      template,
      version: currentVersion + 1,
    };

    const { error } = await supabase
      .from('app_settings')
      .upsert({
        key: 'default_system_prompt',
        value: newValue,
        updated_at: new Date().toISOString(),
      });

    if (error) {
      throw error;
    }

    return NextResponse.json({
      success: true,
      version: newValue.version,
      message: 'Default prompt updated successfully',
    });
  } catch (error) {
    console.error('Error updating default prompt:', error);
    return NextResponse.json(
      { error: 'Failed to update default prompt' },
      { status: 500 }
    );
  }
}
