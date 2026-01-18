/**
 * Agent Message Utilities
 *
 * Generates contextual messages for contacting agents about listings/requests.
 * Messages adapt based on the type (listing vs client_request) and source platform.
 */

import numeral from "numeral";

// Minimum price thresholds to filter out obviously wrong prices
const MIN_SALE_PRICE = 50000;
const MIN_RENT_PRICE = 1000;
const UNKNOWN_VALUE = 999999999;

type Source = "whatsapp" | "telegram" | "app" | "xml" | null | undefined;

// Listing data structure from Typesense/Supabase matches
interface ListingData {
  id?: string;
  source?: string;
  data?: {
    kind?: string;
    transaction_type?: string;
    property_type?: string | string[];
    community?: string;
    location_raw?: string;
    bedrooms?: number | number[];
    bathrooms?: number | number[];
    price_aed?: number;
    area_sqft?: number;
    message_body_clean?: string;
    message_body_raw?: string;
    budget_min_aed?: number;
    budget_max_aed?: number;
    budget_min_aed_null?: boolean;
    budget_max_aed_null?: boolean;
    is_off_plan?: boolean;
    is_distressed_deal?: boolean;
    furnishing?: string;
    is_agent_covered?: boolean;
  };
}

/**
 * Get human-readable source text
 */
function getSourceText(source?: Source | string | null): string {
  if (source === "xml" || source === "app") {
    return "ReMatch";
  } else if (source === "telegram") {
    return "a Telegram group";
  }
  return "a WhatsApp group";
}

/**
 * Format bedrooms array or number
 */
function formatBedrooms(bedrooms: number | number[] | undefined): string {
  if (bedrooms === undefined || bedrooms === null) return "";

  const bedroomArray = Array.isArray(bedrooms) ? bedrooms : [bedrooms];
  const validBedrooms = bedroomArray.filter(
    (b) => b !== undefined && b !== null
  );
  if (validBedrooms.length === 0) return "";

  const bedroomStrings = validBedrooms.map((b) =>
    b === 0 ? "Studio" : `${b}BR`
  );
  return bedroomStrings.join(", ");
}

/**
 * Format property type(s)
 */
function formatPropertyTypes(
  propertyTypes: string | string[] | undefined
): string {
  if (!propertyTypes) return "";

  const types = Array.isArray(propertyTypes) ? propertyTypes : [propertyTypes];
  return types
    .map((type) => {
      const lowerType = type.toLowerCase();
      return lowerType === "other" ? "property" : lowerType;
    })
    .join(", ");
}

/**
 * Format location from community or location_raw
 */
function formatLocation(data: ListingData["data"]): string {
  if (!data) return "";
  if (data.community && data.community !== "~~" && data.community !== "null") {
    return data.community;
  }
  if (
    data.location_raw &&
    data.location_raw !== "~~" &&
    data.location_raw !== "null"
  ) {
    return data.location_raw;
  }
  return "";
}

/**
 * Format price in AED with K/M suffix
 */
function formatMoney(num: number | undefined): string {
  if (!num) return "";
  return `AED ${numeral(num).format("0.00a").toUpperCase()}`;
}

/**
 * Format price for listing display, with validation
 */
function formatPriceForListing(data: ListingData["data"]): string {
  if (!data?.price_aed) return "";

  const price = data.price_aed;
  if (price === 0 || price === 1 || price === UNKNOWN_VALUE) return "";

  if (data.transaction_type === "sale" && price < MIN_SALE_PRICE) return "";
  if (data.transaction_type === "rent" && price < MIN_RENT_PRICE) return "";

  return formatMoney(price);
}

/**
 * Format budget for client request display
 */
function formatBudgetForClientRequest(data: ListingData["data"]): string {
  if (!data) return "Not mentioned";

  const minBudget = data.budget_min_aed;
  const maxBudget = data.budget_max_aed;
  const minIsNull = data.budget_min_aed_null;
  const maxIsNull = data.budget_max_aed_null;

  const minIsUnknown =
    minIsNull ||
    !minBudget ||
    minBudget === 0 ||
    minBudget === 1 ||
    minBudget === UNKNOWN_VALUE;
  const maxIsUnknown =
    maxIsNull ||
    !maxBudget ||
    maxBudget === 0 ||
    maxBudget === 1 ||
    maxBudget === UNKNOWN_VALUE;

  if (minIsUnknown && maxIsUnknown) return "Not mentioned";
  if (minIsUnknown && !maxIsUnknown) return formatMoney(maxBudget);
  if (!minIsUnknown && maxIsUnknown) return formatMoney(minBudget);
  if (minBudget === maxBudget) return formatMoney(maxBudget);

  // Range
  const minFormatted = numeral(minBudget).format("0.00a").toUpperCase();
  const maxFormatted = numeral(maxBudget).format("0.00a").toUpperCase();
  return `AED ${minFormatted}-${maxFormatted}`;
}

/**
 * Build a description line for a listing
 */
function buildListingLine(data: ListingData["data"]): string {
  if (!data) return "";

  const beds = formatBedrooms(data.bedrooms);
  const propertyTypes = formatPropertyTypes(data.property_type);
  const transactionType = data.transaction_type;
  const location = formatLocation(data);
  const price = formatPriceForListing(data);

  // For land, omit bedrooms
  const omitBedrooms =
    Array.isArray(data.property_type) &&
    data.property_type.some((t) => t.toLowerCase() === "land");

  let line = "";
  if (beds && !omitBedrooms) line += `${beds}`;
  if (propertyTypes) line += ` ${propertyTypes}`;
  if (transactionType) line += ` for ${transactionType}`;
  if (location) line += ` in ${location}`;
  if (price) line += ` for ${price}`;

  return line.trim();
}

/**
 * Build a description line for a client request
 */
function buildClientRequestLine(data: ListingData["data"]): string {
  if (!data) return "";

  const beds = formatBedrooms(data.bedrooms);
  const propertyTypes = formatPropertyTypes(data.property_type);
  const transactionType = data.transaction_type;
  const location = formatLocation(data);
  const budget = formatBudgetForClientRequest(data);

  let line = "";
  if (beds) line += `${beds}`;
  if (propertyTypes) line += ` ${propertyTypes}`;
  if (transactionType) line += ` for ${transactionType}`;
  if (location) line += ` in ${location}`;

  // Add period after main property description
  if (beds || propertyTypes || transactionType || location) {
    line += ". ";
  }

  if (budget && budget !== "Not mentioned") {
    line += `Budget: ${budget}.`;
  }

  return line.trim();
}

/**
 * Strip emojis from text for cleaner messages
 */
function stripEmojis(text: string): string {
  if (!text || typeof text !== "string") return text || "";

  return text
    .replace(
      /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu,
      ""
    )
    .replace(/[\u200d\ufe0f]/g, "") // Clean up ZWJ/variation selectors
    .replace(/\s+/g, " ") // Normalize whitespace
    .trim();
}

/**
 * Check if raw message is valid for display
 */
function hasValidRawMessage(messageRaw: string | undefined): boolean {
  return !!(
    messageRaw &&
    messageRaw.trim() &&
    messageRaw.trim() !== "~~" &&
    messageRaw.trim() !== "null"
  );
}

/**
 * Get the follow-up line based on property type
 */
function getFollowUpLine(propertyTypes: string | string[] | undefined): string {
  const types = Array.isArray(propertyTypes)
    ? propertyTypes
    : propertyTypes
      ? [propertyTypes]
      : [];
  const isLand = types.some((t) => t.toLowerCase() === "land");

  if (isLand) {
    return "Can you confirm it's direct & share affection plan/location pin if it's still available?";
  }
  return "Can you share more details / pictures if it's still available?";
}

/**
 * Generate message for contacting about a LISTING
 * (User has a client request, found a listing that matches)
 */
export function generateMessageForListing(
  listingData: ListingData,
  source?: Source | string | null
): string {
  const data = listingData.data;
  const sourceText = getSourceText(source || listingData.source);

  // Use raw message if available, otherwise build from structured data
  const description = hasValidRawMessage(data?.message_body_raw)
    ? `"${stripEmojis(data!.message_body_raw!)}"`
    : buildListingLine(data);

  const followUpLine = getFollowUpLine(data?.property_type);

  return `Hey, found the listing you posted on ${sourceText}:

- ${description}

${followUpLine}

Found you through ReMatch: https://www.joinrematch.com/agent-ext`;
}

/**
 * Generate message for contacting about a CLIENT REQUEST
 * (User has a listing, found a client request that matches)
 */
export function generateMessageForClientRequest(
  listingData: ListingData,
  source?: Source | string | null
): string {
  const data = listingData.data;
  const sourceText = getSourceText(source || listingData.source);

  // Use raw message if available, otherwise build from structured data
  const description = hasValidRawMessage(data?.message_body_raw)
    ? `"${stripEmojis(data!.message_body_raw!)}"`
    : buildClientRequestLine(data);

  return `Hey, found the request you posted on ${sourceText}:

- ${description}

Is this still relevant?

Found you through ReMatch: https://www.joinrematch.com/agent-ext`;
}

/**
 * Main function: Generate contact message based on listing/request type
 */
export function generateContactMessage(
  listingData: ListingData,
  source?: Source | string | null
): string {
  const kind = listingData.data?.kind;

  if (kind === "client_request") {
    return generateMessageForClientRequest(listingData, source);
  }

  // Default to listing message
  return generateMessageForListing(listingData, source);
}
