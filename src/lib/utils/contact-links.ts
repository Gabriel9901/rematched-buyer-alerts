/**
 * Contact Link Utilities
 *
 * Generates WhatsApp and Telegram links with pre-filled messages.
 */

/**
 * Clean phone number to international format (remove spaces, dashes, etc)
 */
function cleanPhoneNumber(phone: string): string {
  // Remove all non-digit characters except leading +
  let cleaned = phone.replace(/[^\d+]/g, "");

  // Ensure it starts with country code (if no + and doesn't start with country code)
  if (!cleaned.startsWith("+") && !cleaned.startsWith("971")) {
    // Default to UAE country code if no prefix
    if (cleaned.startsWith("0")) {
      cleaned = "971" + cleaned.slice(1);
    }
  }

  // Remove leading + for wa.me URL format
  return cleaned.replace(/^\+/, "");
}

/**
 * Generate WhatsApp link with pre-filled message
 * Format: https://wa.me/{phone}?text={encoded_message}
 *
 * @param phone - Phone number (will be cleaned to international format)
 * @param message - Message to pre-fill (will be URL encoded)
 * @returns WhatsApp deep link URL
 */
export function generateWhatsAppLink(phone: string, message?: string): string {
  const cleanedPhone = cleanPhoneNumber(phone);
  const baseUrl = `https://wa.me/${cleanedPhone}`;

  if (!message) {
    return baseUrl;
  }

  const encodedMessage = encodeURIComponent(message);
  return `${baseUrl}?text=${encodedMessage}`;
}

/**
 * Clean Telegram username (remove @ prefix if present)
 */
function cleanTelegramUsername(username: string): string {
  return username.replace(/^@/, "");
}

/**
 * Generate Telegram link with pre-filled message
 * Format: https://t.me/{username}?text={encoded_message}
 *
 * Note: Telegram's text parameter support varies by client.
 * The link will open the chat, and the message may be pre-filled
 * in some Telegram clients.
 *
 * @param username - Telegram username (with or without @)
 * @param message - Message to pre-fill (will be URL encoded)
 * @returns Telegram deep link URL
 */
export function generateTelegramLink(
  username: string,
  message?: string
): string {
  const cleanedUsername = cleanTelegramUsername(username);
  const baseUrl = `https://t.me/${cleanedUsername}`;

  if (!message) {
    return baseUrl;
  }

  // Note: Telegram's ?text parameter support is limited
  // It works better with ?start parameter for bots
  // For regular users, the text may or may not be pre-filled
  const encodedMessage = encodeURIComponent(message);
  return `${baseUrl}?text=${encodedMessage}`;
}

/**
 * Generate contact links for a listing
 * Returns object with available contact methods
 */
export function generateContactLinks(
  phone: string | null | undefined,
  username: string | null | undefined,
  message?: string
): {
  whatsappLink: string | null;
  telegramLink: string | null;
} {
  return {
    whatsappLink: phone ? generateWhatsAppLink(phone, message) : null,
    telegramLink: username ? generateTelegramLink(username, message) : null,
  };
}
