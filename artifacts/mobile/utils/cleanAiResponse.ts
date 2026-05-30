/**
 * Clean AI response text by removing markdown formatting and unnecessary whitespace
 * Converts markdown-formatted text from Gemini into clean, readable text
 */
export function cleanAiResponse(text: string): string {
  if (!text) return '';

  let cleaned = text
    // Strip PARTIAL_PROFILE / PROFILE_COMPLETE markers appended by the backend
    .replace(/PARTIAL_PROFILE:[\s\S]*$/m, '')
    .replace(/PROFILE_COMPLETE:[\s\S]*$/m, '')
    // Remove markdown bold (**text**)
    .replace(/\*\*(.+?)\*\*/g, '$1')
    // Remove markdown italic (*text*)
    .replace(/\*(.+?)\*/g, '$1')
    // Remove markdown inline code (`code`)
    .replace(/`(.+?)`/g, '$1')
    // Remove markdown headings (# Heading, ## Heading, etc.)
    .replace(/^#{1,6}\s+/gm, '')
    // Remove markdown bullet points and numbered lists
    .replace(/^[\s]*[-*+]\s+/gm, '')
    .replace(/^[\s]*\d+\.\s+/gm, '')
    // Remove markdown links [text](url)
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')
    // Remove markdown code blocks (triple backticks)
    .replace(/```[\s\S]*?```/g, '')
    // Remove excessive whitespace (multiple spaces/newlines)
    .replace(/\n\n\n+/g, '\n\n')
    .replace(/[ ]{2,}/g, ' ')
    // Trim leading/trailing whitespace
    .trim();

  return cleaned;
}

/**
 * Format a JSON string response by cleaning any markdown
 * Useful for responses that might contain markdown in JSON fields
 */
export function cleanJsonResponse<T extends Record<string, any>>(data: T): T {
  const cleaned: Record<string, any> = { ...data };

  for (const key in cleaned) {
    if (typeof cleaned[key] === 'string') {
      cleaned[key] = cleanAiResponse(cleaned[key] as string);
    } else if (typeof cleaned[key] === 'object' && cleaned[key] !== null) {
      cleaned[key] = cleanJsonResponse(cleaned[key] as Record<string, any>);
    }
  }

  return cleaned as T;
}
