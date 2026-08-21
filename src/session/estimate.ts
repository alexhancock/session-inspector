const CHARS_PER_TOKEN = 2.5

export const estimateTokens = (text: string): number => (text ? Math.max(1, Math.round(text.length / CHARS_PER_TOKEN)) : 0)
