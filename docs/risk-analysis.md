# PSX Dashboard Risk Analysis

This risk analysis is tailored to the current stack:
- Node.js/Express backend
- Cheerio scraping from `psx.com.pk`
- Frontend: Vanilla HTML + Tailwind (`public/index.html`)
- In-memory caching with a fixed TTL (5 minutes)

## Top Risks (Mapped to Current Code)

### R1: Scraping fragility (HTML structure changes)
**What can go wrong**
- PSX updates `market-summary` markup, table indexes, or column ordering.
- Cheerio selectors/table parsing no longer match expected structure.

**Current points of fragility**
- `scrapePSX()`:
  - iterates tables with `$('table').each(...)` and assumes tables indexes >= 2 contain stock rows
  - assumes each row has `td` length >= 8 and specific column mapping (SCRIP, LDCP, OPEN, HIGH, LOW, CURRENT, CHANGE, VOLUME)
  - relies on `sectorName = $(table).find('th').first().text().trim()`
- `scrapeMarketSummary()` assumes:
  - table index `0` has Exchange status text nodes
  - table index `1` has Advances/Declines text nodes

**Impact**
- Empty stock list
- Wrong numeric values displayed
- UI becomes misleading or unusable

**Mitigations**
- Add validation checks:
  - minimum stock count threshold (e.g., if < 400, treat as failure)
  - numeric sanity checks (price > 0, volume >= 0)
- Centralize selectors and column mappings so updates are localized.
- Preserve last cached successful scrape when the current scrape fails.

### R2: Rate limiting / blocking from psx.com.pk
**What can go wrong**
- Too many requests to `market-summary/` cause 429/403 responses.

**Current mitigations**
- In-memory cache TTL of 5 minutes limits scrape frequency.

**Additional mitigations**
- Retry with exponential backoff on transient failures.
- Coalesce concurrent refreshes so multiple API requests during stale TTL don’t trigger multiple scrapes.

### R3: Data correctness and type coercion
**What can go wrong**
- Backend stores `change` and `changePercent` as strings (via `.toFixed(2)`), not numbers.
- Frontend sorts/compares via `parseFloat(...) || 0`, which is mostly safe but can produce misleading ordering if values are missing/non-numeric.

**Mitigations**
- Normalize `change` and `changePercent` as numbers in backend.
- Ensure frontend display formats numeric values consistently.

### R4: Frontend XSS / injection via `innerHTML`
**What can go wrong**
- Frontend uses template strings and assigns to `innerHTML` (stock cards and gainers/losers).
- If scraped values contain unexpected characters, they could be injected into HTML.

**Current reality**
- Values are scraped as text, but they are interpolated into HTML strings without escaping.

**Mitigations**
- Use `textContent`-based rendering or HTML-escape scraped fields before interpolation.

### R5: UI inconsistency: gainers/losers not affected by filters
**What can go wrong**
- Users filter/search/sort the card list, but top gainers/losers widgets remain based on the full dataset (current behavior computes them only in `loadStocks()`).

**Mitigation options**
- Update `renderGainersLosers()` inside `applyFilters()` (to reflect current view)
- Or explicitly label widgets as “Global Top” (not filtered).

### R6: Operational issues (no health endpoint)
**What can go wrong**
- Backend has no `GET /api/health` and relies on console logs only.

**Mitigations**
- Add health/metrics endpoint and structured logging for failures and scrape duration.

## Risk Priority
- Highest priority: R1, R2, R4
- Medium: R3, R5
- Lower: R6 (but useful for operations)

