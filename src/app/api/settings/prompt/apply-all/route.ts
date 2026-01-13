/**
 * Apply Default Prompt to All Buyers
 *
 * POST /api/settings/prompt/apply-all - Clear all buyer-specific prompts
 *
 * This effectively resets all buyers to use the default system prompt.
 */

import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/client';

export async function POST() {
  try {
    const supabase = getServerSupabase();

    // Get count of buyers with custom prompts before reset
    const { count: beforeCount } = await supabase
      .from('buyers')
      .select('id', { count: 'exact', head: true })
      .not('system_prompt', 'is', null);

    // Clear all buyer-specific system_prompt values
    const { error } = await supabase
      .from('buyers')
      .update({ system_prompt: null })
      .not('system_prompt', 'is', null);

    if (error) {
      throw error;
    }

    return NextResponse.json({
      success: true,
      message: `Reset ${beforeCount || 0} buyer(s) to use the default prompt`,
      resetCount: beforeCount || 0,
    });
  } catch (error) {
    console.error('Error applying default prompt to all buyers:', error);
    return NextResponse.json(
      { error: 'Failed to apply default prompt to all buyers' },
      { status: 500 }
    );
  }
}
