import type { ProductCandidate, SupportedSite } from "../shared/types";
import {
    dispatchTextInput,
    findButtonByText,
    highlightElement,
    humanDelay,
    normalizeWhitespace,
    parsePrice,
    parseRating,
    parseUnitPrice,
    queryAll,
    queryFirst,
    waitForCondition,
    waitForSelectors,
    waitForUrlChange
} from "../utils/dom";

export interface ScrapedProduct {
    candidate: ProductCandidate;
    container: HTMLElement;
    link: HTMLAnchorElement | null;
    addButton: HTMLElement | null;
}

export interface SiteAdapter {
    id: SupportedSite;
    search(query: string): Promise<void>;
    getTopProducts(limit: number): Promise<ScrapedProduct[]>;
    addToCart(product: ScrapedProduct): Promise<void>;
    dismissInterruptions(): Promise<void>;
    highlightProduct(product: ScrapedProduct): () => void;
}

export interface GenericAdapterConfig {
    id: SupportedSite;
    searchInputSelectors: string[];
    searchSubmitSelectors: string[];
    resultCardSelectors: string[];
    titleSelectors: string[];
    priceSelectors: string[];
    ratingSelectors: string[];
    productLinkSelectors: string[];
    addButtonSelectors: string[];
    productPageAddButtonSelectors: string[];
    unitPriceSelectors?: string[];
    readySelectors?: string[];
    dismissButtonTexts?: string[];
}

function buildSummary(candidate: Omit<ProductCandidate, "summary">): string {
    const parts = [candidate.title];

    if (candidate.price !== null) {
        parts.push(`$${candidate.price.toFixed(2)}`);
    }

    if (candidate.unitPrice !== null) {
        parts.push(`$${candidate.unitPrice.toFixed(4)}/unit`);
    }

    if (candidate.rating !== null) {
        parts.push(`${candidate.rating.toFixed(1)} stars`);
    }

    return parts.join(" • ");
}

export class GenericSiteAdapter implements SiteAdapter {
    public readonly id: SupportedSite;

    public constructor(private readonly config: GenericAdapterConfig) {
        this.id = config.id;
    }

    public async search(query: string): Promise<void> {
        const input = await waitForSelectors<HTMLInputElement>(this.config.searchInputSelectors, { timeoutMs: 12000 });
        const previousUrl = window.location.href;

        input.focus();
        dispatchTextInput(input, query);
        await humanDelay(150, 350);

        const submitButton = queryFirst<HTMLElement>(this.config.searchSubmitSelectors);

        if (submitButton) {
            submitButton.click();
        } else if (input.form) {
            input.form.requestSubmit();
        } else {
            input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
            input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
        }

        try {
            await Promise.race([
                waitForUrlChange(previousUrl, { timeoutMs: 5000 }),
                waitForSelectors(this.config.readySelectors ?? this.config.resultCardSelectors, { timeoutMs: 8000 })
            ]);
        } catch {
            await waitForSelectors(this.config.resultCardSelectors, { timeoutMs: 10000 });
        }

        await humanDelay(350, 700);
    }

    public async getTopProducts(limit: number): Promise<ScrapedProduct[]> {
        await waitForSelectors(this.config.resultCardSelectors, { timeoutMs: 12000 });

        const cards = queryAll<HTMLElement>(this.config.resultCardSelectors).slice(0, limit * 3);
        const products: ScrapedProduct[] = [];

        for (const [index, card] of cards.entries()) {
            const title = this.extractText(card, this.config.titleSelectors) ?? this.extractLinkText(card);

            if (!title) {
                continue;
            }

            const link = queryFirst<HTMLAnchorElement>(this.config.productLinkSelectors, card) ?? card.querySelector<HTMLAnchorElement>("a[href]");
            const addButton =
                queryFirst<HTMLElement>(this.config.addButtonSelectors, card) ??
                findButtonByText(["add to cart", "add"], card);

            const price = parsePrice(this.extractText(card, this.config.priceSelectors) ?? card.textContent);
            const unitPrice = this.config.unitPriceSelectors?.length
                ? parseUnitPrice(this.extractText(card, this.config.unitPriceSelectors))
                : null;
            const rating = parseRating(this.extractText(card, this.config.ratingSelectors) ?? card.textContent);

            const baseCandidate = {
                id: `${this.id}-${index}`,
                title,
                price,
                unitPrice,
                rating,
                productUrl: link?.href ?? null,
                hasDirectAdd: Boolean(addButton)
            };

            products.push({
                candidate: {
                    ...baseCandidate,
                    summary: buildSummary(baseCandidate)
                },
                container: card,
                link,
                addButton
            });

            if (products.length >= limit) {
                break;
            }
        }

        return products;
    }

    private findAddToCartButton(selectors: string[]): HTMLElement | null {
        return queryFirst<HTMLElement>(selectors) ?? findButtonByText(["add to cart"]);
    }

    public async addToCart(product: ScrapedProduct): Promise<void> {
        await this.dismissInterruptions();

        if (product.addButton && document.contains(product.addButton)) {
            product.addButton.click();
            await humanDelay(600, 1000);
            await this.dismissInterruptions();
            return;
        }

        if (product.link) {
            const previousUrl = window.location.href;
            product.link.click();

            try {
                await waitForUrlChange(previousUrl, { timeoutMs: 5000 });
            } catch {
                console.debug("CartPilot: URL did not change after link click; continuing.");
            }

            await humanDelay(450, 900);
        }

        const addButton = await waitForCondition(
            () => this.findAddToCartButton(this.config.productPageAddButtonSelectors),
            { timeoutMs: 15000, intervalMs: 500 }
        ).catch(() => null);

        if (!addButton) {
            throw new Error(`Unable to find an add-to-cart button on ${this.id}.`);
        }

        addButton.click();
        await humanDelay(700, 1200);
        await this.dismissInterruptions();
    }

    public async dismissInterruptions(): Promise<void> {
        const buttonTexts = this.config.dismissButtonTexts ?? ["no thanks", "not now", "skip", "continue", "close"];

        for (let attempt = 0; attempt < 3; attempt += 1) {
            const dismissButton = findButtonByText(buttonTexts);

            if (!dismissButton) {
                return;
            }

            dismissButton.click();
            await humanDelay(250, 500);
        }
    }

    public highlightProduct(product: ScrapedProduct): () => void {
        return highlightElement(product.container);
    }

    private extractText(root: ParentNode, selectors: string[]): string | null {
        for (const selector of selectors) {
            const element = root.querySelector<HTMLElement>(selector);
            const text = normalizeWhitespace(element?.textContent);

            if (text) {
                return text;
            }
        }

        return null;
    }

    private extractLinkText(root: ParentNode): string | null {
        const link = root.querySelector<HTMLAnchorElement>("a[href]");
        return normalizeWhitespace(link?.textContent) || null;
    }
}