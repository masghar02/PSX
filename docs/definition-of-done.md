# Definition of Done (DoD)

This DoD is mapped to your roadmap and current implementation in `server.js` and `public/index.html`.

## v1 Features (Current)

### v1.1 Backend: scraping + normalization
Acceptance checks:
- `server.js` contains `scrapePSX()` that returns an array of stock objects with at least:
  - `name`, `symbol`, `sector`, `price`, `ldcp`, `open`, `high`, `low`, `change`, `changePercent`, `volume`
- `scrapeMarketSummary()` returns an object with keys:
  - `status`, `volume`, `value`, `trades`, `advanced`, `declined`, `unchanged`
- If scrape fails, `GET /api/stocks` returns:
  - HTTP 500 and `{ success: false, error: <message> }`

### v1.2 Backend: `GET /api/stocks` API contract
Acceptance checks:
- Endpoint returns JSON with:
  - `success: true`
  - `data` (stock array)
  - `summary` (market summary object)
  - `total` (stock count)
  - `updated` (string formatted for `Asia/Karachi`)

### v1.3 Backend: caching + TTL behavior
Acceptance checks:
- In-memory cache is used via `cache = { data, summary, timestamp }`
- TTL constant is:
  - `CACHE_DURATION = 5 * 60 * 1000`
- Requests within TTL return cached dataset (no second scrape)

### v1.4 Frontend: rendering + filtering + sorting
Acceptance checks:
- `public/index.html` loads Tailwind and fetches data via:
  - `fetch('/api/stocks')`
- Sector dropdown is populated from `allStocks`:
  - `populateSectors(allStocks)` creates options from `s.sector`
- Search + filter:
  - `applyFilters()` filters by `#search` and `#sectorFilter`
- Sorting:
  - `applyFilters()` sorts according to `#sortBy` options:
    - `changePercent_desc`, `changePercent_asc`, `price_desc`, `price_asc`, `volume_desc`

### v1.5 Frontend: top gainers/losers widgets
Acceptance checks:
- `loadStocks()` calls `renderGainersLosers(allStocks)`
- Widgets render based on:
  - gainers: top 5 by highest `changePercent`
  - losers: bottom 5 by lowest `changePercent` (presented as “▼ abs(changePercent)”)

### v1.6 Frontend: refresh cycle + countdown
Acceptance checks:
- `loadStocks()` is called immediately and again every `300000ms` (5 minutes)
- Countdown updates `#countdown` and resets after reaching 0

## v2 Features (Planned)

### v2.1 Consistent widgets with active filters (or explicit labeling)
Acceptance checks:
- Either:
  - Widgets recompute from the filtered/sorted set used in the cards, OR
  - UI labels widgets clearly as global/top-absolute (not filtered)

### v2.2 Performance improvements for client rendering
Acceptance checks:
- Search input is debounced (prevents excessive re-renders)
- For ~586 cards, interaction does not noticeably freeze the UI

### v2.3 Additional operational endpoints
Acceptance checks:
- Backend provides `GET /api/health` with scrape/cache status

### v2.4 Refresh controls
Acceptance checks:
- A “Refresh now” control triggers a guarded server refresh
- UI handles “refresh in progress” state without breaking

## v3 Features (Planned)

### v3.1 Stock details view
Acceptance checks:
- A details page/modal uses `GET /api/stock/:symbol`
- Missing stock returns an explicit UI error state (404)

### v3.2 Historical charts
Acceptance checks:
- Chart data source is defined and validated
- Chart rendering handles missing data points

### v3.3 Notifications + watchlists
Acceptance checks:
- Watchlist works without auth first (local storage)
- Notifications require explicit opt-in and do not spam

