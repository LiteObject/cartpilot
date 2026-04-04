import type {
    LlmConfig,
    NormalizationResult,
    PriceIntent,
    ProductCandidate,
    ProductSelectionResult
} from "../shared/types";
import { normalizeWhitespace } from "../utils/dom";

export interface PriceIntentResult {
    intent: PriceIntent;
    cleanedItem: string;
}

interface OllamaGenerateResponse {
    response?: string;
    error?: string;
}

interface CandidateScore {
    overlap: number;
    coverage: number;
    effectivePrice: number | null;
    total: number;
}

const COMMON_QUERY_HINTS: Record<string, string> = {
    milk: "whole milk 1 gallon",
    eggs: "large eggs dozen",
    bread: "whole wheat sandwich bread",
    rice: "long grain white rice 2 lb",
    bananas: "bananas 1 bunch",
    chicken: "boneless skinless chicken breast"
};

const UNIT_PRICE_RE = /\b(?:cheapest|lowest|best)\s+unit\s+price\b|\bunit\s+price\b|\bprice\s+per\s+(?:unit|oz|ounce|lb|pound|gram|ml|liter|fl\s*oz)\b/i;
const CHEAPEST_RE = /\b(?:cheapest|cheap|lowest[- ]price|budget|most[- ]affordable|least[- ]expensive|inexpensive)\b/i;
const PRICE_KEYWORD_STRIP_RE = /\b(?:cheapest|cheap|lowest[- ]?price|budget|most[- ]?affordable|least[- ]?expensive|inexpensive|unit\s+price|price\s+per\s+(?:unit|oz|ounce|lb|pound|gram|ml|liter|fl\s*oz))\b/gi;
const CANONICAL_TEXT_REPLACEMENTS: Array<{ pattern: RegExp; replacement: string }> = [
    { pattern: /\b(?:fat[\s-]*free|non[\s-]*fat|skimmed)\b/gi, replacement: "skim" },
    { pattern: /\b(?:half\s+gallon|half\s+gal|1\/2\s+gallon|1\/2\s+gal)\b/gi, replacement: "64 oz" },
    { pattern: /\b(?:one\s+gallon|1\s+gallon|1\s+gal)\b/gi, replacement: "128 oz" },
    { pattern: /\b(?:fl(?:uid)?\.?\s*oz)\b/gi, replacement: "oz" },
    { pattern: /\b(?:zero\s+percent|0\s*percent)\b/gi, replacement: "skim" },
    { pattern: /\b(?:one\s+percent|1\s*percent)\b/gi, replacement: "1%" },
    { pattern: /\b(?:two\s+percent|2\s*percent)\b/gi, replacement: "2%" }
];

export function extractPriceIntent(rawItem: string): PriceIntentResult {
    const trimmed = rawItem.trim();

    if (UNIT_PRICE_RE.test(trimmed)) {
        const cleanedItem = normalizeWhitespace(trimmed.replace(PRICE_KEYWORD_STRIP_RE, ""));
        return { intent: "cheapest-unit-price", cleanedItem: cleanedItem || trimmed };
    }

    if (CHEAPEST_RE.test(trimmed)) {
        const cleanedItem = normalizeWhitespace(trimmed.replace(PRICE_KEYWORD_STRIP_RE, ""));
        return { intent: "cheapest", cleanedItem: cleanedItem || trimmed };
    }

    return { intent: "none", cleanedItem: trimmed };
}

function resolveGenerateEndpoint(endpoint: string): string {
    const normalized = endpoint.trim().replace(/\/$/, "");
    return normalized.endsWith("/api/generate") ? normalized : `${normalized}/api/generate`;
}

function heuristicNormalize(rawItem: string, extraContext?: string): NormalizationResult {
    const key = rawItem.trim().toLowerCase();
    const hinted = COMMON_QUERY_HINTS[key] ?? rawItem.trim();
    const normalizedQuery = normalizeWhitespace([hinted, extraContext].filter(Boolean).join(" "));

    return {
        normalizedQuery,
        needsClarification: false,
        clarificationQuestion: null
    };
}

function canonicalizeSelectionText(value: string): string {
    let normalized = normalizeWhitespace(value).toLowerCase();

    for (const replacement of CANONICAL_TEXT_REPLACEMENTS) {
        normalized = normalized.replace(replacement.pattern, replacement.replacement);
    }

    return normalizeWhitespace(normalized);
}

function tokenize(value: string): string[] {
    return canonicalizeSelectionText(value)
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length > 1 || /^\d$/.test(token));
}

function resolveEffectivePrice(candidate: ProductCandidate, priceIntent: PriceIntent): number | null {
    const price = priceIntent === "cheapest-unit-price"
        ? (candidate.unitPrice ?? candidate.price)
        : candidate.price;

    return price !== null && price > 0 ? price : null;
}

function scoreCandidate(query: string, candidate: ProductCandidate, priceIntent: PriceIntent): CandidateScore {
    const queryTokens = Array.from(new Set(tokenize(query)));
    const titleTokens = new Set(tokenize(candidate.title));
    const overlap = queryTokens.reduce((score, token) => score + (titleTokens.has(token) ? 1 : 0), 0);
    const coverage = queryTokens.length === 0 ? 0 : overlap / queryTokens.length;

    if (priceIntent !== "none") {
        const effectivePrice = resolveEffectivePrice(candidate, priceIntent);
        const pricePenalty = effectivePrice === null
            ? (priceIntent === "cheapest-unit-price" ? 100000 : 1000)
            : effectivePrice * (priceIntent === "cheapest-unit-price" ? 1000 : 10);

        return {
            overlap,
            coverage,
            effectivePrice,
            total: coverage * 1000 - pricePenalty + (candidate.rating ?? 0)
        };
    }

    const priceScore = candidate.price === null ? 0 : Math.max(0, 10 - candidate.price / 5);
    const ratingScore = candidate.rating ?? 0;

    return {
        overlap,
        coverage,
        effectivePrice: candidate.price,
        total: overlap * 10 + priceScore + ratingScore
    };
}

function heuristicSelect(normalizedQuery: string, candidates: ProductCandidate[], priceIntent: PriceIntent = "none"): ProductSelectionResult {
    if (candidates.length === 0) {
        return {
            selectedIndex: null,
            needsClarification: false,
            clarificationQuestion: null,
            reason: "No candidates were available to score."
        };
    }

    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;

    candidates.forEach((candidate, index) => {
        const score = scoreCandidate(normalizedQuery, candidate, priceIntent);

        console.debug("CartPilot heuristic candidate score", {
            index,
            priceIntent,
            title: candidate.title,
            overlap: score.overlap,
            coverage: score.coverage,
            effectivePrice: score.effectivePrice,
            total: score.total
        });

        if (score.total > bestScore) {
            bestScore = score.total;
            bestIndex = index;
        }
    });

    return {
        selectedIndex: bestIndex,
        needsClarification: false,
        clarificationQuestion: null,
        reason: priceIntent === "none"
            ? "Selected with the built-in heuristic fallback."
            : `Selected with the built-in heuristic ${priceIntent} fallback.`
    };
}

async function ollamaGenerate(prompt: string, config: LlmConfig): Promise<OllamaGenerateResponse> {
    const response = await fetch(resolveGenerateEndpoint(config.endpoint), {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: config.model,
            prompt,
            stream: false,
            format: "json",
            options: {
                temperature: config.temperature
            }
        })
    });

    if (!response.ok) {
        throw new Error(`Ollama request failed: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as OllamaGenerateResponse;
}

const OLLAMA_EMPTY_RETRIES = 1;
const OLLAMA_RETRY_DELAY_MS = 2000;

async function callOllamaJson<T>(prompt: string, config: LlmConfig): Promise<T> {
    if (!config.endpoint.trim()) {
        throw new Error("Missing Ollama endpoint.");
    }

    if (!config.model.trim()) {
        throw new Error("Missing Ollama model.");
    }

    let lastPayload: OllamaGenerateResponse | undefined;

    for (let attempt = 0; attempt <= OLLAMA_EMPTY_RETRIES; attempt++) {
        if (attempt > 0) {
            console.debug(`CartPilot: retrying Ollama request (attempt ${attempt + 1}) after empty response.`);
            await new Promise<void>((resolve) => setTimeout(resolve, OLLAMA_RETRY_DELAY_MS));
        }

        lastPayload = await ollamaGenerate(prompt, config);

        if (lastPayload.error) {
            throw new Error(lastPayload.error);
        }

        if (lastPayload.response) {
            return JSON.parse(lastPayload.response) as T;
        }
    }

    throw new Error("Ollama returned an empty response after retries.");
}

export async function normalizeQuery(
    rawItem: string,
    config: LlmConfig,
    extraContext?: string
): Promise<NormalizationResult> {
    const prompt = [
        "You normalize grocery shopping requests for a browser extension.",
        "Return JSON with keys: normalized_query, needs_clarification, clarification_question.",
        "Rules:",
        "- Be specific but not overly restrictive.",
        "- Avoid unnecessary brand bias.",
        "- Ask a concise clarification question only if the request is too ambiguous to search well.",
        "- If clarification is needed, still provide the best provisional normalized_query you can.",
        `Item: ${rawItem}`,
        extraContext ? `Additional context from user: ${extraContext}` : null
    ]
        .filter(Boolean)
        .join("\n");

    try {
        const result = await callOllamaJson<{
            normalized_query?: string;
            needs_clarification?: boolean;
            clarification_question?: string | null;
        }>(prompt, config);

        return {
            normalizedQuery: normalizeWhitespace(result.normalized_query) || heuristicNormalize(rawItem, extraContext).normalizedQuery,
            needsClarification: Boolean(result.needs_clarification),
            clarificationQuestion: normalizeWhitespace(result.clarification_question) || null
        };
    } catch (error) {
        console.warn("CartPilot normalization fallback engaged.", error);
        return heuristicNormalize(rawItem, extraContext);
    }
}

export async function selectProduct(
    rawItem: string,
    normalizedQuery: string,
    candidates: ProductCandidate[],
    config: LlmConfig,
    priceIntent: PriceIntent = "none"
): Promise<ProductSelectionResult> {
    if (priceIntent !== "none") {
        console.debug(`CartPilot: price intent "${priceIntent}" detected — using heuristic price-based selection.`);
        return heuristicSelect(normalizedQuery, candidates, priceIntent);
    }

    const prompt = [
        "You select the best grocery product for a Chrome extension.",
        "Return JSON with keys: selected_index, needs_clarification, clarification_question, reason.",
        "Rules:",
        "- Prioritize relevance first.",
        "- Prefer lower price when products are similarly relevant.",
        "- Prefer higher rating when products are similarly relevant.",
        "- Ask for clarification only if the product list is too ambiguous.",
        `Original item: ${rawItem}`,
        `Normalized query: ${normalizedQuery}`,
        `Candidates: ${JSON.stringify(candidates)}`
    ].join("\n");

    try {
        const result = await callOllamaJson<{
            selected_index?: number | null;
            needs_clarification?: boolean;
            clarification_question?: string | null;
            reason?: string;
        }>(prompt, config);

        if (typeof result.selected_index === "number" && result.selected_index >= 0 && result.selected_index < candidates.length) {
            return {
                selectedIndex: result.selected_index,
                needsClarification: Boolean(result.needs_clarification),
                clarificationQuestion: normalizeWhitespace(result.clarification_question) || null,
                reason: normalizeWhitespace(result.reason) || "Selected by Ollama."
            };
        }

        if (result.needs_clarification) {
            return {
                selectedIndex: null,
                needsClarification: true,
                clarificationQuestion: normalizeWhitespace(result.clarification_question) || "Which option do you want?",
                reason: normalizeWhitespace(result.reason) || "Clarification requested by Ollama."
            };
        }

        return heuristicSelect(normalizedQuery, candidates);
    } catch (error) {
        console.warn("CartPilot product selection fallback engaged.", error);
        return heuristicSelect(normalizedQuery, candidates);
    }
}