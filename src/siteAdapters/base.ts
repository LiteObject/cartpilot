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
    /** Selectors for the grid/list container holding product cards as direct children. */
    gridContainerSelectors?: string[];
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

const FALLBACK_RESULT_CARD_CONTAINER_SELECTORS = [
    "[data-item-id]",
    "[data-qe-id*='product-card']",
    "article[data-product-id]",
    "div[role='listitem']",
    "[data-testid*='product']",
    "[data-testid*='item']",
    "[class*='product-card']",
    "[class*='ProductCard']",
    "[class*='productCard']",
    "[class*='GridItem']",
    "[class*='gridItem']",
    "[class*='grid-item']",
    "[class*='search-result']",
    "article",
    "li"
].join(", ");

export class GenericSiteAdapter implements SiteAdapter {
    public readonly id: SupportedSite;

    public constructor(private readonly config: GenericAdapterConfig) {
        this.id = config.id;
    }

    public async search(query: string): Promise<void> {
        const input = await waitForSelectors<HTMLInputElement>(this.config.searchInputSelectors, { timeoutMs: 12000 }).catch(() => {
            throw new Error(`Timed out after 12000ms waiting for the ${this.id} search input.`);
        });
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

        // Wait for URL change first — avoids scraping the pre-navigation page.
        // H-E-B and most grocery SPAs navigate via pushState so this resolves quickly.
        const urlChanged = await waitForUrlChange(previousUrl, { timeoutMs: 8000 })
            .then(() => true)
            .catch(() => false);

        if (urlChanged) {
            console.debug(`CartPilot [${this.id}]: URL changed after search submit.`);
        } else {
            console.debug(`CartPilot [${this.id}]: URL unchanged after search submit; looking for result cards in place.`);
        }

        await humanDelay(350, 700);
    }

    public async getTopProducts(limit: number): Promise<ScrapedProduct[]> {
        const cards = (await this.waitForResultCards(12000)).slice(0, limit * 3);
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

            // Try configured price selectors first, then fall back to card text.
            // Two-level fallback: if the selector text is unparseable, try card.textContent.
            const priceText = this.extractText(card, this.config.priceSelectors);
            const price = parsePrice(priceText) ?? parsePrice(card.textContent);

            if (index < 2) {
                console.debug(`CartPilot [${this.id}]: price-debug[${index}] selectorText="${(priceText ?? "null").slice(0, 60)}" parsed=${parsePrice(priceText)} fallback=${parsePrice(card.textContent)}`);
            }

            const unitPrice = this.config.unitPriceSelectors?.length
                ? parseUnitPrice(this.extractText(card, this.config.unitPriceSelectors))
                : null;
            // Only use configured rating selectors — textContent fallback picks up
            // price digits (e.g. "$1.62" → rating 1.6) so never use it.
            const rating = parseRating(this.extractText(card, this.config.ratingSelectors));

            const baseCandidate = {
                id: `${this.id}-${index}`,
                title,
                price,
                unitPrice,
                rating,
                productUrl: link?.href ?? null,
                hasDirectAdd: Boolean(addButton)
            };

            console.debug(`CartPilot [${this.id}]: product[${index}] "${title}" $${price} unit=$${unitPrice} rating=${rating} add=${Boolean(addButton)} class="${card.className?.toString().slice(0, 60)}"`);

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

    private async waitForResultCards(timeoutMs: number): Promise<HTMLElement[]> {
        try {
            return await waitForCondition(() => {
                const cards = this.getResultCards();
                return cards.length > 0 ? cards : null;
            }, { timeoutMs, intervalMs: 250 });
        } catch {
            throw new Error(`Timed out after ${timeoutMs}ms waiting for ${this.id} product results.`);
        }
    }

    private getResultCards(): HTMLElement[] {
        for (const selector of this.config.resultCardSelectors) {
            const raw = document.querySelectorAll(selector);
            if (raw.length > 0) {
                console.debug(`CartPilot [${this.id}]: selector "${selector}" raw=${raw.length}, visible=${Array.from(raw).filter((e) => this.isVisibleElement(e as HTMLElement)).length}`);
            }
        }

        const configuredCards = queryAll<HTMLElement>(this.config.resultCardSelectors)
            .filter((card) => this.isVisibleElement(card));

        console.debug(`CartPilot [${this.id}]: configuredCards=${configuredCards.length}`);

        if (configuredCards.length > 0) {
            return configuredCards;
        }

        // Strategy 2: use configured grid container — get direct children as cards.
        const gridChildren = this.getGridContainerChildren();
        if (gridChildren.length >= 2) {
            console.debug(`CartPilot [${this.id}]: gridContainerChildren=${gridChildren.length}`);
            return gridChildren;
        }

        const fallbackCards = this.findFallbackResultCards();
        console.debug(`CartPilot [${this.id}]: fallbackCards=${fallbackCards.length}`);

        return fallbackCards;
    }

    /**
     * If the adapter config specifies gridContainerSelectors, find the grid and
     * return its visible direct children that contain at least a title or link.
     * This bypasses the fragile walk-up heuristic for sites with known grid layouts.
     */
    private getGridContainerChildren(): HTMLElement[] {
        const selectors = this.config.gridContainerSelectors;

        if (!selectors?.length) {
            return [];
        }

        const grid = queryFirst<HTMLElement>(selectors);

        if (!grid || !this.isVisibleElement(grid)) {
            return [];
        }

        console.debug(`CartPilot [${this.id}]: grid container matched: <${grid.tagName.toLowerCase()}> class="${(grid.className || '').toString().slice(0, 80)}" children=${grid.children.length}`);

        const cards: HTMLElement[] = [];

        for (const child of Array.from(grid.children)) {
            if (!(child instanceof HTMLElement) || !this.isVisibleElement(child)) {
                continue;
            }

            // Relaxed check: does this child look like a product card?
            // Require at least a link or title (not the full viability check).
            const hasLink = Boolean(child.querySelector("a[href]"));
            const hasTitle = Boolean(
                this.extractText(child, this.config.titleSelectors) ??
                this.extractLinkText(child)
            );

            if (hasLink || hasTitle) {
                cards.push(child);
            }
        }

        // Log first 2 children for diagnosis
        for (let i = 0; i < Math.min(2, cards.length); i++) {
            const c = cards[i];
            const r = c.getBoundingClientRect();
            const title = this.extractText(c, this.config.titleSelectors) ?? this.extractLinkText(c);
            console.debug(`CartPilot [${this.id}]: grid card[${i}] <${c.tagName.toLowerCase()}> class="${(c.className || '').toString().slice(0, 60)}" ${Math.round(r.width)}x${Math.round(r.height)} title="${(title ?? '').slice(0, 40)}"`);
        }

        return cards;
    }

    private findFallbackResultCards(): HTMLElement[] {
        const discoveryNodes = this.getFallbackDiscoveryNodes();
        const seen = new Set<HTMLElement>();
        const cards: HTMLElement[] = [];

        let logged = 0;
        for (const node of discoveryNodes) {
            const card = this.findCandidateCardForNode(node, logged < 1);

            if (logged < 5) {
                const cardInfo = card
                    ? `<${card.tagName.toLowerCase()}> ${card.className.slice(0, 80)}`
                    : "null";
                const logTag = logged < 2 ? `walk-up[${logged}]` : "";
                const viable = card ? this.isViableResultCard(card, logTag) : "n/a";
                console.debug(`CartPilot [${this.id}]: walk-up from <${node.tagName.toLowerCase()}> "${normalizeWhitespace(node.textContent).slice(0, 40)}" → card=${cardInfo} viable=${viable}`);
                logged += 1;
            }

            if (!card || seen.has(card) || !this.isViableResultCard(card)) {
                continue;
            }

            console.debug(`CartPilot [${this.id}]: accepted card[${cards.length}] from <${node.tagName.toLowerCase()}> → <${card.tagName.toLowerCase()}> class="${card.className?.toString().slice(0, 80)}" size=${Math.round(card.getBoundingClientRect().width)}x${Math.round(card.getBoundingClientRect().height)}`);

            seen.add(card);
            cards.push(card);
        }

        if (cards.length >= 2) {
            return cards;
        }

        // Strategy 2: find the grid container and use its children as cards.
        const gridCards = this.findCardsFromGridContainer();

        if (gridCards.length >= 2) {
            console.debug(`CartPilot [${this.id}]: grid-children strategy found ${gridCards.length} cards.`);
            return gridCards;
        }

        return cards;
    }

    private findCardsFromGridContainer(): HTMLElement[] {
        // Use configured selectors first, then fall back to text-matched buttons.
        let addButtons = queryAll<HTMLElement>(this.config.addButtonSelectors)
            .filter((b) => this.isVisibleElement(b));

        if (addButtons.length < 2) {
            addButtons = queryAll<HTMLElement>(["button, a[role='button'], a"])
                .filter((el) => {
                    if (!this.isVisibleElement(el)) {
                        return false;
                    }

                    const text = normalizeWhitespace(el.textContent).toLowerCase();
                    return text.includes("add to cart") || text === "add";
                });
        }

        if (addButtons.length < 2) {
            return [];
        }

        // Walk up from button[0] until we find an element that also contains button[1]
        const first = addButtons[0];
        const second = addButtons[1];
        let grid: HTMLElement | null = first;

        while (grid) {
            if (grid.contains(second)) {
                break;
            }
            grid = this.getParentElement(grid);
        }

        if (!grid) {
            return [];
        }

        console.debug(`CartPilot [${this.id}]: grid container found: <${grid.tagName.toLowerCase()}> class="${grid.className?.toString().slice(0, 80)}" children=${grid.children.length}`);

        // Log first 3 direct children for diagnosis
        for (let i = 0; i < Math.min(3, grid.children.length); i++) {
            const child = grid.children[i] as HTMLElement;
            if (child instanceof HTMLElement) {
                const r = child.getBoundingClientRect();
                console.debug(`CartPilot [${this.id}]: grid child[${i}] <${child.tagName.toLowerCase()}> class="${(child.className || '').toString().slice(0, 60)}" ${Math.round(r.width)}x${Math.round(r.height)} vis=${this.isVisibleElement(child)}`);
            }
        }

        // Test direct children as cards
        const cards: HTMLElement[] = [];

        for (const [ci, child] of Array.from(grid.children).entries()) {
            if (!(child instanceof HTMLElement) || !this.isVisibleElement(child)) {
                continue;
            }

            const logTag = ci < 2 ? `grid-child[${ci}]` : "";

            if (this.isViableResultCard(child, logTag)) {
                cards.push(child);
            }
        }

        if (cards.length >= 2) {
            return cards;
        }

        // Try grandchildren (in case of row wrappers)
        const grandCards: HTMLElement[] = [];

        for (const child of Array.from(grid.children)) {
            if (!(child instanceof HTMLElement) || !this.isVisibleElement(child)) {
                continue;
            }

            for (const grandchild of Array.from(child.children)) {
                if (
                    grandchild instanceof HTMLElement &&
                    this.isVisibleElement(grandchild) &&
                    this.isViableResultCard(grandchild)
                ) {
                    grandCards.push(grandchild);
                }
            }
        }

        return grandCards;
    }

    private getFallbackDiscoveryNodes(): HTMLElement[] {
        const configuredButtons = queryAll<HTMLElement>(this.config.addButtonSelectors)
            .filter((element) => this.isVisibleElement(element));
        const textButtons = queryAll<HTMLElement>(["button, a[role='button'], a"])
            .filter((element) => {
                if (!this.isVisibleElement(element)) {
                    return false;
                }

                const text = normalizeWhitespace(element.textContent).toLowerCase();
                return text.includes("add to cart") || text === "add";
            });
        const links = queryAll<HTMLAnchorElement>(this.config.productLinkSelectors)
            .filter((link) => this.isVisibleElement(link));
        const titles = queryAll<HTMLElement>(this.config.titleSelectors)
            .filter((element) => this.isVisibleElement(element));

        console.debug(`CartPilot [${this.id}]: fallback discovery buttons=${configuredButtons.length} textBtns=${textButtons.length} links=${links.length} titles=${titles.length}`);

        return [...configuredButtons, ...textButtons, ...links, ...titles];
    }

    private findCandidateCardForNode(node: Element, trace = false): HTMLElement | null {
        let current = node instanceof HTMLElement ? node : this.getParentElement(node);
        let previous: HTMLElement | null = null;
        const MAX_DEPTH = 10;
        let depth = 0;

        while (current && depth < MAX_DEPTH) {
            if (trace) {
                const r = current.getBoundingClientRect();
                const btns = this.countVisibleAddButtons(current);
                console.debug(`CartPilot [${this.id}]: walk step[${depth}] <${current.tagName.toLowerCase()}> class="${(current.className || '').toString().slice(0, 60)}" ${Math.round(r.width)}x${Math.round(r.height)} btns=${btns}`);
            }

            if (current.matches(FALLBACK_RESULT_CARD_CONTAINER_SELECTORS) || this.looksLikeCardContainer(current)) {
                return current;
            }

            // If we've reached a container that's too large (grid/page level), the
            // previous element is likely the individual card wrapper.
            const rect = current.getBoundingClientRect();
            if (rect.width >= window.innerWidth * 0.8 || rect.height >= window.innerHeight * 0.8) {
                return previous;
            }

            previous = current;
            current = this.getParentElement(current);
            depth += 1;
        }

        // Depth exhausted — return the last reasonable element we saw.
        return previous;
    }

    private getParentElement(node: Element): HTMLElement | null {
        if (node.parentElement instanceof HTMLElement) {
            return node.parentElement;
        }

        const root = node.getRootNode();

        if (root instanceof ShadowRoot && root.host instanceof HTMLElement) {
            return root.host;
        }

        return null;
    }

    private looksLikeCardContainer(element: HTMLElement): boolean {
        const rect = element.getBoundingClientRect();

        if (rect.width <= 0 || rect.height <= 0) {
            return false;
        }

        if (rect.width >= window.innerWidth * 0.95 || rect.height >= window.innerHeight * 0.95) {
            return false;
        }

        // Reject containers with multiple add-to-cart buttons (grids, not cards).
        // Check BOTH configured selectors and text-matched buttons since some sites
        // lack attribute-based selectors on their buttons.
        const addButtonCount = this.countVisibleAddButtons(element);

        if (addButtonCount > 1) {
            return false;
        }

        const hasPrice = parsePrice(this.extractText(element, this.config.priceSelectors) ?? element.textContent) !== null;
        const hasTitle = Boolean(this.extractText(element, this.config.titleSelectors) ?? this.extractLinkText(element));

        return hasPrice && hasTitle;
    }

    /** Count visible add-to-cart buttons using both configured selectors and text matching. */
    private countVisibleAddButtons(root: HTMLElement): number {
        const configured = queryAll<HTMLElement>(this.config.addButtonSelectors, root)
            .filter((b) => this.isVisibleElement(b));

        if (configured.length > 0) {
            return configured.length;
        }

        // Fall back to text matching when no configured selectors match.
        const textMatched = queryAll<HTMLElement>(["button, a[role='button'], a"], root)
            .filter((el) => {
                if (!this.isVisibleElement(el)) {
                    return false;
                }

                const text = normalizeWhitespace(el.textContent).toLowerCase();
                return text.includes("add to cart") || text === "add";
            });

        return textMatched.length;
    }

    private isViableResultCard(card: HTMLElement, logTag = ""): boolean {
        if (!this.isVisibleElement(card)) {
            if (logTag) { console.debug(`CartPilot [${this.id}]: viable-check ${logTag} FAIL: not visible`); }
            return false;
        }

        const title = this.extractText(card, this.config.titleSelectors) ?? this.extractLinkText(card);

        if (!title) {
            if (logTag) { console.debug(`CartPilot [${this.id}]: viable-check ${logTag} FAIL: no title`); }
            return false;
        }

        const hasProductLink = Boolean(
            queryFirst<HTMLAnchorElement>(this.config.productLinkSelectors, card) ??
            card.querySelector<HTMLAnchorElement>("a[href]")
        );

        if (!hasProductLink) {
            if (logTag) { console.debug(`CartPilot [${this.id}]: viable-check ${logTag} FAIL: no product link. title="${title.slice(0, 40)}"`); }
            return false;
        }

        const hasPrice = parsePrice(this.extractText(card, this.config.priceSelectors) ?? card.textContent) !== null;
        const hasAddButton = Boolean(
            queryFirst<HTMLElement>(this.config.addButtonSelectors, card) ??
            findButtonByText(["add to cart", "add"], card)
        );

        if (!(hasPrice || hasAddButton)) {
            if (logTag) { console.debug(`CartPilot [${this.id}]: viable-check ${logTag} FAIL: no price and no add button`); }
        }

        return hasPrice || hasAddButton;
    }

    private isVisibleElement(element: Element | null): element is HTMLElement {
        return element instanceof HTMLElement && element.getClientRects().length > 0;
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
            const element = queryFirst<HTMLElement>([selector], root);
            const text = normalizeWhitespace(element?.textContent);

            if (text) {
                return text;
            }
        }

        return null;
    }

    private extractLinkText(root: ParentNode): string | null {
        const links = queryAll<HTMLAnchorElement>(["a[href]"], root);

        for (const link of links) {
            const text = normalizeWhitespace(link.textContent);

            if (text) {
                return text;
            }
        }

        return null;
    }
}