/**
 * Slack Notification Module
 *
 * Sends webhook notifications to Slack when new matches are found.
 */

import { MatchWithDetails } from '../supabase/types';

interface SlackBlock {
  type: string;
  text?: {
    type: string;
    text: string;
    emoji?: boolean;
  };
  elements?: Array<{
    type: string;
    text?: string | { type: string; text: string };
    url?: string;
    action_id?: string;
  }>;
  fields?: Array<{
    type: string;
    text: string;
  }>;
}

interface SlackMessage {
  text: string; // Fallback text
  blocks: SlackBlock[];
}

/**
 * Format a match for Slack display
 */
function formatMatchBlock(match: MatchWithDetails): SlackBlock[] {
  const listing = match.listing_data as Record<string, unknown>;
  const data = (listing.data || listing) as Record<string, unknown>;

  const propertyType = data.property_type || 'Property';
  const community = data.community || data.location_raw || 'Unknown location';
  const bedrooms = data.bedrooms;
  const price = data.price_aed;
  const score = match.relevance_score;

  // Build description
  const parts: string[] = [];
  if (bedrooms !== undefined) parts.push(`${bedrooms} BR`);
  parts.push(String(propertyType));
  parts.push(`in ${community}`);
  if (price) parts.push(`- AED ${Number(price).toLocaleString()}`);

  const blocks: SlackBlock[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${parts.join(' ')}*${score ? ` (Score: ${Math.round(score)})` : ''}`,
      },
    },
  ];

  // Add qualification notes if available
  if (match.qualification_notes) {
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: match.qualification_notes,
        },
      ],
    });
  }

  return blocks;
}

/**
 * Build Slack message for new matches
 */
function buildSlackMessage(
  buyerName: string,
  criteriaName: string,
  matches: MatchWithDetails[]
): SlackMessage {
  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `🏠 ${matches.length} New Match${matches.length > 1 ? 'es' : ''} Found`,
        emoji: true,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Buyer:* ${buyerName}\n*Search:* ${criteriaName}`,
      },
    },
    {
      type: 'divider',
    },
  ];

  // Add up to 5 match blocks (Slack has limits)
  const displayMatches = matches.slice(0, 5);
  for (const match of displayMatches) {
    blocks.push(...formatMatchBlock(match));
    blocks.push({ type: 'divider' });
  }

  // If there are more matches, add a note
  if (matches.length > 5) {
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `_+${matches.length - 5} more matches - view all in the dashboard_`,
        },
      ],
    });
  }

  return {
    text: `🏠 ${matches.length} new match${matches.length > 1 ? 'es' : ''} for ${buyerName} - ${criteriaName}`,
    blocks,
  };
}

/**
 * Send notification to Slack webhook
 *
 * @param webhookUrl - Slack webhook URL
 * @param buyerName - Name of the buyer
 * @param criteriaName - Name of the search criteria
 * @param matches - Array of matches to notify about
 */
export async function sendSlackNotification(
  webhookUrl: string,
  buyerName: string,
  criteriaName: string,
  matches: MatchWithDetails[]
): Promise<void> {
  if (matches.length === 0) return;

  const message = buildSlackMessage(buyerName, criteriaName, matches);

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(message),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Slack webhook failed: ${response.status} - ${text}`);
  }
}

/**
 * Send a simple text notification to Slack
 */
export async function sendSlackText(webhookUrl: string, text: string): Promise<void> {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`Slack webhook failed: ${response.status} - ${responseText}`);
  }
}

/**
 * Send daily summary to Slack
 */
export async function sendDailySummary(
  webhookUrl: string,
  stats: {
    totalSearches: number;
    totalMatches: number;
    topBuyers: Array<{ name: string; matchCount: number }>;
  }
): Promise<void> {
  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: '📊 Daily Buyer Alerts Summary',
        emoji: true,
      },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Searches Run:*\n${stats.totalSearches}`,
        },
        {
          type: 'mrkdwn',
          text: `*Matches Found:*\n${stats.totalMatches}`,
        },
      ],
    },
  ];

  if (stats.topBuyers.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          '*Top Buyers:*\n' +
          stats.topBuyers.map((b) => `• ${b.name}: ${b.matchCount} matches`).join('\n'),
      },
    });
  }

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: `📊 Daily Summary: ${stats.totalMatches} matches from ${stats.totalSearches} searches`,
      blocks,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Slack webhook failed: ${response.status} - ${text}`);
  }
}
