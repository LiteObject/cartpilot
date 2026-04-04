# CartPilot

**AI-powered browser agent that builds your shopping cart for you.**

CartPilot is a Chrome extension that uses a hybrid approach: LLM intelligence + deterministic DOM automation to search, select, and add items to your online grocery cart on supported sites like Walmart and H-E-B.

---

## Features

* **Smart Search**
  Converts simple inputs like `"milk"` into better queries like `"whole milk 1 gallon"`

* **AI Product Selection**
  Picks the best product based on relevance, price, and ratings

* **One-Click Cart Building**
  Automatically adds items to your cart

* **Clarification Prompts**
  Asks questions when items are ambiguous

* **Works With Your Session**
  Runs directly in your browser while you're logged in

---

## What It Does NOT Do

* No checkout or payment handling
* No login automation
* No CAPTCHA bypassing

---

## How It Works

CartPilot uses a hybrid architecture:

* **LLM (AI layer)**

  * Normalizes queries
  * Selects best products
  * Asks clarifying questions

* **Browser Automation (DOM layer)**

  * Uses the website's search bar
  * Scrapes product results
  * Clicks "Add to Cart"

LLM = *decision-making*
DOM = *execution*

---

## Architecture

```text
User Input
  |
  v
LLM -> Normalize Query
  |
  v
Content Script -> Perform Search
  |
  v
DOM Scraper -> Extract Products
  |
  v
LLM -> Select Best Product
  |
  v
Content Script -> Add to Cart
```

---

## Supported Sites

* Walmart
* H-E-B

> Designed with a **site adapter pattern** so more stores can be added easily.

---

## Project Structure

```text
cartpilot/
|-- .github/
|   `-- copilot-instructions.md
|-- manifest.json
|-- package.json
|-- tsconfig.json
|-- scripts/
|   `-- build.mjs
|-- src/
|   |-- background/
|   |   `-- background.ts
|   |-- content/
|   |   `-- content.ts
|   |-- llm/
|   |   `-- llm.ts
|   |-- popup/
|   |   |-- popup.html
|   |   `-- popup.ts
|   |-- shared/
|   |   |-- config.ts
|   |   |-- messages.ts
|   |   |-- site.ts
|   |   `-- types.ts
|   |-- siteAdapters/
|   |   |-- base.ts
|   |   |-- index.ts
|   |   |-- walmart.ts
|   |   `-- heb.ts
|   `-- utils/
|       `-- dom.ts
|-- dist/          <-- built output (load this in Chrome)
`-- INSTRUCTIONS.md
```

---

## Getting Started

### 1. Clone the repo

```
git clone https://github.com/your-username/cartpilot.git
cd cartpilot
```

---

### 2. Install dependencies and build

```bash
npm install
npm run build
```

### 3. Load extension in Chrome

1. Open Chrome
2. Go to `chrome://extensions/`
3. Enable **Developer mode**
4. Click **Load unpacked**
5. Select the **`dist/`** folder (not the project root)

---

### 4. Configure LLM

The extension currently supports **Ollama** as the LLM provider. Configure the endpoint and model in the extension popup settings panel.

Defaults:
* Endpoint: `http://127.0.0.1:11434/api/generate`
* Model: `llama3.1:8b`

If Ollama is unavailable, the extension falls back to heuristic scoring.

---

### 5. Use It

1. Go to Walmart or H-E-B
2. Make sure you're logged in
3. Open the extension
4. Enter items:

   ```
   milk, eggs, bread
   ```
5. Let CartPilot build your cart

---

## Example Flow

Input:

```
milk, eggs
```

Output:

* Searches for "whole milk 1 gallon"
* Picks best match
* Adds to cart
* Repeats for eggs

---

## Limitations

* Site UI changes may break selectors
* Product availability varies by location
* Some popups/modals may require handling updates

---

## Development

### Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Single production build to `dist/` |
| `npm run dev` | Watch mode — rebuilds on file changes |
| `npm run typecheck` | TypeScript type check (no emit) |

### Key Concepts

* **TypeScript + esbuild** — strict-mode TS compiled to IIFE bundles targeting Chrome 120+
* **Content Scripts** — interact with page DOM via site adapters
* **Site Adapters** — config-driven `GenericSiteAdapter` instances with CSS selector arrays per site
* **Message Protocol** — typed messages flow Popup → Background → Content (see `src/shared/messages.ts`)
* **LLM Wrapper** — Ollama integration with heuristic fallback

---

## Roadmap

* Saved shopping lists
* Budget-aware optimization
* Dietary preferences (e.g., halal, vegan)
* Multi-store comparison
* Mobile support

---

## Contributing

Contributions are welcome!

* Add support for new stores
* Improve selectors
* Enhance product ranking logic

---

## License

MIT License

---

## Philosophy

CartPilot is designed with a simple principle:

> Use AI for decisions, not for control.

This keeps the system:

* More reliable
* Easier to debug
* Faster to execute

---

## Support

If you find this useful, consider starring the repo!

