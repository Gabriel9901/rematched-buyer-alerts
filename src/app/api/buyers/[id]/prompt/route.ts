/**
 * Buyer-Specific System Prompt API
 *
 * GET /api/buyers/[id]/prompt - Get the buyer's system prompt (or indication to use default)
 * PUT /api/buyers/[id]/prompt - Update the buyer's system prompt
 * DELETE /api/buyers/[id]/prompt - Reset buyer to use default prompt
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/client';
import { validateTemplate, DEFAULT_SYSTEM_PROMPT } from '@/lib/gemini/promptTemplate';
import { SystemPromptSetting } from '@/lib/supabase/types';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id: buyerId } = await params;
    const supabase = getServerSupabase();

    // Fetch the buyer
    const { data: buyer, error: buyerError } = await supabase
      .from('buyers')
      .select('id, name, system_prompt')
      .eq('id', buyerId)
      .single();

    if (buyerError || !buyer) {
      return NextResponse.json({ error: 'Buyer not found' }, { status: 404 });
    }

    // If buyer has a custom prompt, return it
    if (buyer.system_prompt) {
      return NextResponse.json({
        buyerId: buyer.id,
        buyerName: buyer.name,
        template: buyer.system_prompt,
        isCustom: true,
        message: 'Buyer has a custom system prompt',
      });
    }

    // Otherwise, fetch the default prompt to show what they'd get
    const { data: defaultPromptSetting } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'default_system_prompt')
      .single();

    const defaultTemplate = defaultPromptSetting?.value
      ? (defaultPromptSetting.value as SystemPromptSetting).template
      : DEFAULT_SYSTEM_PROMPT;

    return NextResponse.json({
      buyerId: buyer.id,
      buyerName: buyer.name,
      template: defaultTemplate,
      isCustom: false,
      message: 'Buyer uses the default system prompt',
    });
  } catch (error) {
    console.error('Error fetching buyer prompt:', error);
    return NextResponse.json(
      { error: 'Failed to fetch buyer prompt' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: buyerId } = await params;
    const body = await request.json();
    const { template } = body;

    if (!template || typeof template !== 'string') {
      return NextResponse.json(
        { error: 'Template is required and must be a string' },
        { status: 400 }
      );
    }

    // Validate the template
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

    // Update the buyer's system_prompt
    const { data: buyer, error } = await supabase
      .from('buyers')
      .update({ system_prompt: template })
      .eq('id', buyerId)
      .select('id, name, system_prompt')
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Buyer not found' }, { status: 404 });
      }
      throw error;
    }

    return NextResponse.json({
      success: true,
      buyerId: buyer.id,
      buyerName: buyer.name,
      message: 'Buyer prompt updated successfully',
    });
  } catch (error) {
    console.error('Error updating buyer prompt:', error);
    return NextResponse.json(
      { error: 'Failed to update buyer prompt' },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id: buyerId } = await params;
    const supabase = getServerSupabase();

    // Reset the buyer's system_prompt to null (will use default)
    const { data: buyer, error } = await supabase
      .from('buyers')
      .update({ system_prompt: null })
      .eq('id', buyerId)
      .select('id, name')
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Buyer not found' }, { status: 404 });
      }
      throw error;
    }

    return NextResponse.json({
      success: true,
      buyerId: buyer.id,
      buyerName: buyer.name,
      message: 'Buyer reset to use default prompt',
    });
  } catch (error) {
    console.error('Error resetting buyer prompt:', error);
    return NextResponse.json(
      { error: 'Failed to reset buyer prompt' },
      { status: 500 }
    );
  }
}
