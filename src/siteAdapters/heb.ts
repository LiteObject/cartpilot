import { GenericSiteAdapter } from "./base";

export const hebAdapter = new GenericSiteAdapter({
    id: "heb",
    searchInputSelectors: [
        'input[type="search"]',
        'input[aria-label*="Search"]',
        'input[name="search"]'
    ],
    searchSubmitSelectors: [
        'button[type="submit"]',
        'button[aria-label*="Search"]',
        'form button'
    ],
    resultCardSelectors: [
        '[data-qe-id*="product-card"]',
        '[class*="product-card"]',
        '[class*="basicGridItem"]',
        'article[data-product-id]',
        'div[role="listitem"]'
    ],
    titleSelectors: [
        '[data-qe-id*="product-title"]',
        '[class*="product-title"]',
        '[class*="Title"]',
        '[class*="productName"]',
        'a[href*="/product-detail/"]',
        'a[href*="/product/"]',
        'h2',
        'h3'
    ],
    priceSelectors: [
        '[data-qe-id*="price"]',
        '[class*="price"]',
        '[data-testid*="price"]'
    ],
    ratingSelectors: [
        '[aria-label*="stars"]',
        '[aria-label*="rating"]'
    ],
    productLinkSelectors: [
        'a[href*="/product-detail/"]',
        'a[href*="/product/"]',
        'a[href]'
    ],
    addButtonSelectors: [
        'button[data-qe-id*="add-to-cart"]',
        'button[aria-label*="Add to cart"]',
        'button[class*="addToCart"]'
    ],
    productPageAddButtonSelectors: [
        'button[data-qe-id*="add-to-cart"]',
        'button[aria-label*="Add to cart"]',
        'button[class*="addToCart"]'
    ],
    unitPriceSelectors: [
        '[data-qe-id*="unit-price"]',
        '[class*="unitPrice"]',
        '[class*="unit-price"]',
        '[class*="pricePerUnit"]'
    ],
    readySelectors: [
        '[data-qe-id*="product-card"]',
        '[class*="basicGridItem"]',
        'div[role="listitem"]',
        '[class*="basicGrid"]'
    ],
    gridContainerSelectors: [
        '[class*="basicGrid"]:not([class*="basicGridItem"])'
    ],
    dismissButtonTexts: ["no thanks", "skip", "continue", "close"]
});