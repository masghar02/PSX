# PSX Dashboard Feature Roadmap

This roadmap maps to your current implementation in:
- `server.js` (Express + Cheerio scraping + cached APIs)
- `public/index.html` (Vanilla HTML + Tailwind + in-browser filtering/sorting)

## v1 (Current)
Deliver an end-to-end dashboard that fetches and displays “live” PSX stock data with search, filtering, sorting, and summary widgets.

### v1.1 Implemented Features
1. Scrape PSX market summary and normalize into stock objects (Cheerio)
2. `GET /api/stocks` returns `success`, `data`, `summary`, `total`, `updated`
3. In-memory caching with TTL:
   - `CACHE_DURATION = 5 * 60 * 1000` (5 minutes)
4. Frontend dashboard UI (`public/index.html`):
   - Sector dropdown populated from `stock.sector`
   - Search filtering (`#search`)
   - Sort selection (`#sortBy`)
   - Stock “cards” grid rendering
   - Top gainers and losers widgets
   - Auto-refresh every 5 minutes + countdown

## v2 (Near-term Improvements)
Make v1 more robust and scalable, and improve UI responsiveness.

1. Correctness + UX improvements
   - Keep top gainers/losers widgets in sync with current filters/sort (or explicitly label as “global top”)
   - Add empty/loading states:
     - “No results” message when filters yield zero stocks
2. Performance improvements
   - Debounce `applyFilters()` on search input to avoid excessive re-renders
   - Consider pagination or virtualization if card rendering becomes slow
3. Better API design
   - Add a health endpoint (`GET /api/health`) for operational visibility
   - Add optional parameters to filter/sort on the backend later (if client becomes too slow)
4. Refresh controls
   - Add a “Refresh now” button to force a scrape (guarded server-side)

## v3 (Advanced Features)
Turn it into a more complete monitoring product.

1. Stock details page/modal
   - Use `GET /api/stock/:symbol` to show details
2. Historical charts
   - Requires a stable time-series data source (or repeated sampling + storage)
3. Notifications
   - Threshold alerts (requires storing user preferences + background jobs)
4. Watchlists
   - Local storage watchlist first, then optional server-side persistence

