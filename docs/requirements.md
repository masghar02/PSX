# PSX Dashboard Requirements

## Overview
This dashboard provides a searchable and sortable view of PSX-listed stocks by scraping data from `psx.com.pk` using `cheerio` on a Node.js/Express backend. A static Vanilla HTML + Tailwind frontend consumes backend APIs to display:
- Stock list (full set of scraped instruments)
- Search, sector filtering, and sorting
- Top gainers and top losers
- Market summary banner
- Auto-refresh for “live” updates

## Scope
### In scope (current project)
1. Backend scraping + caching
2. Backend APIs:
   - `GET /api/stocks`
   - `GET /api/stock/:symbol` (not currently used by the frontend UI)
   - `GET /api/sector/:name` (not currently used by the frontend UI)
3. Frontend UI at `public/index.html`:
   - search by stock name and sector
   - sector dropdown
   - sort dropdown
   - stock “cards” grid rendering (not a table)
   - top gainers / losers widgets
   - countdown + periodic refresh

### Out of scope (v1)
- Authentication / user accounts
- Persistent watchlists (server-side)
- Historical time series charts (requires new data source)

## Stakeholders
- Users who want to monitor many PSX stocks and quickly filter/sort them
- Developer/operator maintaining scraping reliability and performance

## Assumptions
- `https://www.psx.com.pk/market-summary/` contains the needed tables and fields.
- Scraped row counts and numeric fields are sufficiently stable for normalization and UI sorting.
- “Live” updates are acceptable at the current refresh interval (5 minutes in the existing frontend).

## Data Contract (Current)
### Stock object (elements of `GET /api/stocks.data`)
The backend constructs stock objects with the following fields:
- `name` (string): equal to the scraped “scrip”
- `symbol` (string): equal to the scraped “scrip”
- `sector` (string): derived from the current table’s first header cell (`th`)
- `price` (number): `current` or fallback to `ldcp`
- `ldcp` (number)
- `open` (number)
- `high` (number)
- `low` (number)
- `change` (string, via `toFixed(2)`): numeric string like `"1.23"` (may be `"0.00"`)
- `changePercent` (string): numeric string formatted to 2 decimals (or `'0.00'` when `ldcp <= 0`)
- `volume` (number): integer volume

### Market summary object (elements of `GET /api/stocks.summary`)
- `status` (string)
- `volume` (string/number-like text as scraped)
- `value` (string/number-like text as scraped)
- `trades` (string)
- `advanced` (string)
- `declined` (string)
- `unchanged` (string)

### API response shape
`GET /api/stocks` returns:
```json
{
  "success": true,
  "data": [ /* Stock[] */ ],
  "summary": { /* Market Summary */ },
  "total": 586,
  "updated": "..."
}
```

On failure, it returns:
```json
{ "success": false, "error": "..." }
```

## Functional Requirements (Mapped to Current Implementation)
### FR-1: Scrape PSX market summary using Cheerio
The backend must:
- Fetch the HTML from `https://www.psx.com.pk/market-summary/` using `axios` with a stable `User-Agent` and headers.
- Parse multiple tables and generate a normalized stock array.
- Extract market summary fields from the first tables (table indexes `0` and `1`).

Acceptance:
- `scrapePSX()` returns an array of stock objects with the fields listed in the Data Contract.
- `scrapeMarketSummary()` returns a summary with keys: `status`, `volume`, `value`, `trades`, `advanced`, `declined`, `unchanged`.

### FR-2: Provide `GET /api/stocks`
The backend must:
- Return the latest cached dataset if within TTL.
- Otherwise re-scrape, update cache, then return fresh data.

Acceptance:
- Response JSON contains `success`, `data`, `summary`, `total`, and `updated`.
- Numeric fields are parsable by the frontend (`price`, `high`, `low`, `volume`, etc.).

### FR-3: Cache + TTL behavior (anti-rate-limit)
The backend must:
- Use an in-memory cache `cache = { data, summary, timestamp }`.
- Re-scrape only when cached data is stale.

Acceptance:
- Cache TTL is `CACHE_DURATION = 5 * 60 * 1000` (5 minutes).

### FR-4: Render stocks with search + sector filter
Frontend must:
- Search matches against `s.name` and `s.sector` (`applyFilters()`).
- Sector dropdown filters by exact match (`s.sector === sector`).

Acceptance:
- Changing `#search` or `#sectorFilter` calls `applyFilters()` and updates rendered stock cards.
- `#stock-count` reflects the filtered count.

### FR-5: Sort stocks
Frontend must:
- Sort by the selected field based on `#sortBy` values:
  - `changePercent_desc`
  - `changePercent_asc`
  - `price_desc`
  - `price_asc`
  - `volume_desc`
- Sorting must use numeric comparison via `parseFloat(...) || 0`.

Acceptance:
- Sort order changes immediately after `#sortBy` changes.

### FR-6: Top gainers / losers widgets
Frontend must:
- Compute top gainers and top losers from all stocks (current behavior uses `volume > 1000`).
- Top gainers = highest `changePercent`.
- Top losers = lowest `changePercent`.

Acceptance:
- Widgets render at initial load (`loadStocks()`) using `renderGainersLosers(allStocks)`.

### FR-7: Market summary banner + updated timestamp
Frontend must:
- Display `json.summary` into:
  - `#mkt-status` (including status color class)
  - `#mkt-volume`
  - `#mkt-adv`
  - `#mkt-trades`
- Display `json.updated` in `#updated`.

Acceptance:
- Banner updates each refresh cycle.

### FR-8: Auto-refresh and countdown
Frontend must:
- Refresh data via `loadStocks()` every 300000ms (5 minutes).
- Update countdown (`#countdown`) using the `refreshTimer` variable.

Acceptance:
- Countdown resets to 300 on each `loadStocks()` fetch success.

## Non-Functional Requirements
### NFR-1: Performance
- UI must remain responsive with ~586 cards (grid layout).

### NFR-2: Reliability
- Backend must return 500 with `{success:false, error:...}` on failures.
- Frontend must show a clear error state when fetch fails (current behavior sets `#updated` text).

### NFR-3: Security
- Scraped values must be treated as text content.
- Current implementation uses template strings and assigns to `innerHTML` for gainers/losers and stock cards; this assumes scraped fields are safe (risk noted in `risk-analysis.md`).

