export interface WaitOptions {
    timeoutMs?: number;
    intervalMs?: number;
}

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function randomBetween(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

export async function humanDelay(minMs: number, maxMs: number): Promise<void> {
    await sleep(randomBetween(minMs, maxMs));
}

export function normalizeWhitespace(value: string | null | undefined): string {
    return (value ?? "").replace(/\s+/g, " ").trim();
}

export function createId(prefix: string): string {
    return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function queryFirst<T extends Element = HTMLElement>(selectors: string[], root: ParentNode = document): T | null {
    for (const selector of selectors) {
        const match = root.querySelector<T>(selector);

        if (match) {
            return match;
        }
    }

    return null;
}

export function queryAll<T extends Element = HTMLElement>(selectors: string[], root: ParentNode = document): T[] {
    for (const selector of selectors) {
        const matches = Array.from(root.querySelectorAll<T>(selector));

        if (matches.length > 0) {
            return matches;
        }
    }

    return [];
}

export function dispatchTextInput(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value");
    descriptor?.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
}

export async function waitForCondition<T>(
    predicate: () => T | null | undefined | false,
    options: WaitOptions = {}
): Promise<T> {
    const timeoutMs = options.timeoutMs ?? 10000;
    const intervalMs = options.intervalMs ?? 200;
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
        const result = predicate();

        if (result) {
            return result;
        }

        await sleep(intervalMs);
    }

    throw new Error(`Timed out after ${timeoutMs}ms`);
}

export async function waitForSelectors<T extends Element = HTMLElement>(
    selectors: string[],
    options: WaitOptions = {}
): Promise<T> {
    return waitForCondition(() => queryFirst<T>(selectors), options);
}

export async function waitForUrlChange(previousUrl: string, options: WaitOptions = {}): Promise<string> {
    return waitForCondition(() => (window.location.href !== previousUrl ? window.location.href : null), options);
}

export function findButtonByText(
    textOptions: string[],
    root: ParentNode = document
): HTMLButtonElement | HTMLAnchorElement | null {
    const normalizedOptions = textOptions.map((option) => option.toLowerCase());
    const candidates = Array.from(root.querySelectorAll<HTMLButtonElement | HTMLAnchorElement>("button, a[role='button'], a"));

    return (
        candidates.find((candidate) => {
            const text = normalizeWhitespace(candidate.textContent).toLowerCase();
            return normalizedOptions.some((option) => text.includes(option));
        }) ?? null
    );
}

export function parsePrice(text: string | null | undefined): number | null {
    const normalized = normalizeWhitespace(text);

    if (!normalized) {
        return null;
    }

    const match = normalized.match(/\$?\s*(\d+[\d,]*\.?\d{0,2})/);

    if (!match) {
        return null;
    }

    const value = Number.parseFloat(match[1].replace(/,/g, ""));
    return Number.isFinite(value) ? value : null;
}

export function parseUnitPrice(text: string | null | undefined): number | null {
    const normalized = normalizeWhitespace(text);

    if (!normalized) {
        return null;
    }

    const centsMatch = normalized.match(/(\d+\.?\d*)\s*[¢c]\s*\/\s*[a-z\s]+/i);

    if (centsMatch) {
        const value = Number.parseFloat(centsMatch[1]) / 100;
        return Number.isFinite(value) && value > 0 ? value : null;
    }

    const dollarMatch = normalized.match(/\$\s*(\d+\.?\d*)\s*\/\s*[a-z\s]+/i);

    if (dollarMatch) {
        const value = Number.parseFloat(dollarMatch[1]);
        return Number.isFinite(value) && value > 0 ? value : null;
    }

    return null;
}

export function parseRating(text: string | null | undefined): number | null {
    const normalized = normalizeWhitespace(text);

    if (!normalized) {
        return null;
    }

    const match = normalized.match(/(\d(?:\.\d)?)/);

    if (!match) {
        return null;
    }

    const value = Number.parseFloat(match[1]);
    return value >= 0 && value <= 5 ? value : null;
}

export function highlightElement(element: HTMLElement, color = "#ff7a18"): () => void {
    const previousOutline = element.style.outline;
    const previousOutlineOffset = element.style.outlineOffset;
    const previousTransition = element.style.transition;

    element.scrollIntoView({ behavior: "smooth", block: "center" });
    element.style.transition = `${previousTransition ? `${previousTransition}, ` : ""}outline 120ms ease`;
    element.style.outline = `3px solid ${color}`;
    element.style.outlineOffset = "3px";

    return () => {
        element.style.outline = previousOutline;
        element.style.outlineOffset = previousOutlineOffset;
        element.style.transition = previousTransition;
    };
}