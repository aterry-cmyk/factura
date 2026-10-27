import type Anthropic from "@anthropic-ai/sdk";
import { SPACES, spaceIds } from "@/lib/estimator/catalog";
import { tradeIds } from "@/lib/estimator/pricebook";
import type { Lang } from "@/lib/types";

export const SPACE_PROMPT_VERSION = "estimator-space@1";
export const PRODUCTS_PROMPT_VERSION = "estimator-products@1";

const langName = (lang: Lang) => (lang === "es" ? "Spanish" : "English");

export const SPACE_TOOL: Anthropic.Tool = {
  name: "record_space",
  description: "Record what the photo shows and which remodeling projects could make sense.",
  input_schema: {
    type: "object",
    properties: {
      is_home: { type: "boolean", description: "true when the photo shows part of a home, inside or outside." },
      space: { type: "string", enum: spaceIds, description: "Which space the photo shows." },
      summary: { type: "string", description: "One friendly sentence about the space, at most 25 words." },
      condition: { type: "string", enum: ["good", "fair", "worn"] },
      observations: { type: "array", maxItems: 4, items: { type: "string" }, description: "Up to 4 short things you can see that matter for a remodel, at most 15 words each." },
      suggestions: {
        type: "array",
        maxItems: 4,
        items: {
          type: "object",
          properties: {
            trade: { type: "string", enum: tradeIds },
            reason: { type: "string", description: "Why, from what is visible, at most 18 words." },
            priority: { type: "string", enum: ["high", "medium", "low"] },
          },
          required: ["trade", "reason", "priority"],
        },
      },
    },
    required: ["is_home", "space", "summary", "condition", "observations", "suggestions"],
  },
};

export function spaceSystemPrompt(lang: Lang, hint: string): string {
  const lists = spaceIds.map((s) => `- ${s}: ${SPACES[s].trades.join(", ")}`).join("\n");
  return [
    "You help a remodeling contractor estimate a job from one photo of a customer's home. Answer only with the record_space tool.",
    "Say briefly and honestly what you see and which projects could make sense.",
    "Rules:",
    "- Only describe what is visible. Never guess hidden damage, and never mention prices, costs or brands.",
    "- Suggest only projects allowed for that space:",
    lists,
    "- If the photo isn't part of a home (a person, a car, a document, a view), set is_home to false.",
    hint ? `- The contractor says this is: ${hint}.` : "",
    `- Write summary, observations and reasons in ${langName(lang)}.`,
  ].filter(Boolean).join("\n");
}

export const PRODUCTS_TOOL: Anthropic.Tool = {
  name: "record_products",
  description: "Record the products to look for at The Home Depot to build what the preview shows.",
  input_schema: {
    type: "object",
    properties: {
      products: {
        type: "array",
        minItems: 3,
        maxItems: 8,
        items: {
          type: "object",
          properties: {
            category: { type: "string", description: "A short category, like Cabinets, Countertops, Siding, Faucet." },
            name: { type: "string", description: "What it is, generic, at most 8 words." },
            details: { type: "string", description: "Color, finish, size or material, at most 12 words." },
            search: { type: "string", description: "The words to type into homedepot.com search, in English, 3 to 6 words, no brand." },
          },
          required: ["category", "name", "details", "search"],
        },
      },
      notes: { type: "array", maxItems: 3, items: { type: "string" }, description: "Up to 3 things to confirm on site, one sentence each." },
    },
    required: ["products", "notes"],
  },
};

export function productsSystemPrompt(lang: Lang, space: string, chosen: string[]): string {
  return [
    `You help a remodeling contractor turn an AI preview of a remodeled ${space} into a shopping list. Answer only with the record_products tool.`,
    "Name 3 to 8 products a contractor would buy to build what the picture shows, as things found at The Home Depot.",
    "Rules:",
    "- Use plain generic descriptions. Never name a brand, a model number or a price.",
    "- The search words are in English and short. Everything else is written in " + langName(lang) + ".",
    chosen.length ? `- The customer chose: ${chosen.join("; ")}.` : "",
  ].filter(Boolean).join("\n");
}
