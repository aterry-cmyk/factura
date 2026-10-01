// The only place the model id is defined. Override with ANTHROPIC_MODEL.
export const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

export const aiConfigured = (): boolean => Boolean(process.env.ANTHROPIC_API_KEY);
