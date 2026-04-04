import { GenericSiteAdapter } from "./base";

export const walmartAdapter = new GenericSiteAdapter({
    id: "walmart",
    searchInputSelectors: [
        'input[data-automation-id="search-form-input"]',
        'input[aria-label*="Search"]',
        'input[type="search"]'
    ],
    searchSubmitSelectors: [
        'button[aria-label^="Search"]',
        'button[type="submit"][aria-label*="Search"]',
        'form button[type="submit"]'
    ],
    resultCardSelectors: [
        '[data-item-id]',
        '[data-testid="list-view"] [data-item-id]',
        '[data-testid="item-stack"] > div'
    ],
    titleSelectors: [
        '[data-automation-id="product-title"]',
        'span[data-automation-id="product-title"]',
        'a[href*="/ip/"] span',
        'h2'
    ],
    priceSelectors: [
        '[itemprop="price"]',
        '[data-automation-id="product-price"]',
        '[class*="price"]'
    ],
    ratingSelectors: [
        '[aria-label*="stars"]',
        '[aria-label*="rating"]'
    ],
    productLinkSelectors: [
        'a[href*="/ip/"]',
        'a[link-identifier="title"]',
        'a[href*="walmart.com/ip"]'
    ],
    addButtonSelectors: [
        'button[data-automation-id*="add"]',
        'button[aria-label*="Add to cart"]',
        'button[data-testid*="add-to-cart"]'
    ],
    productPageAddButtonSelectors: [
        'button[data-tl-id*="add_to_cart"]',
        'button[data-automation-id*="add"]',
        'button[aria-label*="Add to cart"]',
        'button[data-testid*="add-to-cart"]',
        '[data-testid="add-to-cart-section"] button'
    ],
    unitPriceSelectors: [
        '[data-automation-id="product-price-per-unit"]',
        '[class*="unit-price"]',
        '[class*="unitPrice"]',
        '[class*="per-unit"]'
    ],
    readySelectors: [
        '[data-item-id]',
        '[data-testid="list-view"]'
    ],
    dismissButtonTexts: ["no thanks", "not now", "continue", "close"]
});