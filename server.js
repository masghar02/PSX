const express = require('express');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Referer': 'https://www.psx.com.pk/',
};

async function scrapePSX() {
  const response = await axios.get('https://www.psx.com.pk/market-summary/', {
    headers: HEADERS,
    timeout: 15000,
  });

  const $ = cheerio.load(response.data);
  const stocks = [];

  $('table').each((tableIndex, table) => {
    if (tableIndex < 2) return;
    const sectorName = $(table).find('th').first().text().trim();
    $(table).find('tbody tr').each((rowIndex, row) => {
      const cols = $(row).find('td');
      if (cols.length < 8) return;
      const scrip   = $(cols[0]).text().trim();
      const ldcp    = parseFloat($(cols[1]).text().replace(/,/g, '').trim()) || 0;
      const open    = parseFloat($(cols[2]).text().replace(/,/g, '').trim()) || 0;
      const high    = parseFloat($(cols[3]).text().replace(/,/g, '').trim()) || 0;
      const low     = parseFloat($(cols[4]).text().replace(/,/g, '').trim()) || 0;
      const current = parseFloat($(cols[5]).text().replace(/,/g, '').trim()) || 0;
      const change  = parseFloat($(cols[6]).text().replace(/,/g, '').trim()) || 0;
      const volume  = parseInt($(cols[7]).text().replace(/,/g, '').trim()) || 0;
      if (!scrip || scrip === 'SCRIP' || scrip === 'SYMBOL') return;
      if (current === 0 && ldcp === 0) return;
      const changePercent = ldcp > 0 ? ((change / ldcp) * 100).toFixed(2) : '0.00';
      stocks.push({ name: scrip, symbol: scrip, sector: sectorName,
        price: current || ldcp, ldcp, open, high, low,
        change: change.toFixed(2), changePercent, volume });
    });
  });
  return stocks;
}

async function scrapeMarketSummary(html) {
  const $ = cheerio.load(html);
  let summary = { status: 'Unknown', volume: 0, value: 0, trades: 0, advanced: 0, declined: 0, unchanged: 0 };
  $('table').eq(0).find('td').each((i, td) => {
    const text = $(td).text().trim();
    if (text.includes('Status:')) summary.status = text.replace('Status:', '').trim();
    if (text.includes('Volume:')) summary.volume = text.replace('Volume:', '').trim();
    if (text.includes('Value:')) summary.value = text.replace('Value:', '').trim();
    if (text.includes('Trades:')) summary.trades = text.replace('Trades:', '').trim();
  });
  $('table').eq(1).find('td').each((i, td) => {
    const text = $(td).text().trim();
    if (text.includes('Advanced:')) summary.advanced = text.replace('Advanced:', '').trim();
    if (text.includes('Declined:')) summary.declined = text.replace('Declined:', '').trim();
    if (text.includes('Unchanged:')) summary.unchanged = text.replace('Unchanged:', '').trim();
  });
  return summary;
}

let cache = { data: null, summary: null, timestamp: null };
const CACHE_DURATION = 5 * 60 * 1000;

async function getDataWithCache() {
  const now = Date.now();
  if (cache.data && cache.timestamp && (now - cache.timestamp < CACHE_DURATION)) {
    console.log('📦 Serving from cache');
    return cache;
  }
  console.log('🔍 Fetching fresh data from PSX...');
  const response = await axios.get('https://www.psx.com.pk/market-summary/', {
    headers: HEADERS, timeout: 15000,
  });
  const stocks = await scrapePSX();
  const summary = await scrapeMarketSummary(response.data);
  cache = { data: stocks, summary, timestamp: now };
  console.log(`✅ Cached ${stocks.length} stocks`);
  return cache;
}

// ── KSE-100 accumulated history (server memory) ───────────────────────────────
let kseHistory = [];
const MAX_KSE_POINTS = 78; // ~6.5 hours of 5-min candles

function generateSimulatedCandles(basePrice) {
  const candles = [];
  const today = new Date();
  today.setHours(9, 32, 0, 0); // PSX opens 9:30 AM PKT
  const marketOpen = today.getTime();
  const now = Date.now();

  let price = basePrice * 0.998;

  for (let i = 0; i < 78; i++) {
    const t = marketOpen + i * 5 * 60 * 1000;
    if (t > now) break;

    // Realistic random walk with momentum
    const volatility  = basePrice * 0.0018;
    const momentum    = (Math.random() - 0.48) * volatility;
    const open        = price;
    const close       = Math.max(price + momentum, basePrice * 0.97);
    const wickUp      = Math.random() * volatility * 0.6;
    const wickDown    = Math.random() * volatility * 0.6;
    const high        = Math.max(open, close) + wickUp;
    const low         = Math.min(open, close) - wickDown;

    candles.push({
      t,
      o: +open.toFixed(2),
      h: +high.toFixed(2),
      l: +low.toFixed(2),
      c: +close.toFixed(2),
    });

    price = close;
  }
  return candles;
}

app.get('/api/kse100', async (req, res) => {
  const YF_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://finance.yahoo.com/quote/%5EKSE100/',
  };

  // ── Try Yahoo Finance ────────────────────────────────────────────────────────
  const YF_URLS = [
    'https://query2.finance.yahoo.com/v8/finance/chart/%5EKSE100?interval=5m&range=1d&includePrePost=false',
    'https://query1.finance.yahoo.com/v8/finance/chart/%5EKSE100?interval=5m&range=1d&includePrePost=false',
    'https://query2.finance.yahoo.com/v8/finance/chart/%5EKSE100?interval=15m&range=5d',
    'https://query1.finance.yahoo.com/v8/finance/chart/%5EKSE100?interval=1d&range=1mo',
  ];

  for (const url of YF_URLS) {
    try {
      const response = await axios.get(url, { headers: YF_HEADERS, timeout: 8000 });
      const result   = response.data?.chart?.result?.[0];
      if (!result) continue;

      const timestamps = result.timestamp || [];
      const quotes     = result.indicators.quote[0];
      const meta       = result.meta;

      const candles = timestamps.map((t, i) => ({
        t: t * 1000,
        o: quotes.open[i],
        h: quotes.high[i],
        l: quotes.low[i],
        c: quotes.close[i],
      })).filter(c => c.o != null && c.c != null && c.c > 50000);

      if (candles.length < 2) continue;

      const prevClose    = meta.previousClose || meta.chartPreviousClose || 0;
      const currentPrice = meta.regularMarketPrice || candles[candles.length - 1].c;
      kseHistory = candles.slice(-MAX_KSE_POINTS);

      console.log(`✅ KSE100 from Yahoo: ${currentPrice.toLocaleString()}`);
      return res.json({
        success: true,
        source: 'yahoo',
        meta: {
          currentPrice,
          high:          meta.regularMarketDayHigh || Math.max(...candles.map(c => c.h)),
          low:           meta.regularMarketDayLow  || Math.min(...candles.map(c => c.l)),
          previousClose: prevClose,
          change:        +(currentPrice - prevClose).toFixed(2),
          changePercent: prevClose ? +(((currentPrice - prevClose) / prevClose) * 100).toFixed(2) : 0,
          volume:        meta.regularMarketVolume || 0,
        },
        candles: kseHistory,
      });
    } catch (e) {
      console.log(`⚠️  Yahoo KSE100 failed: ${e.message}`);
    }
  }

  // ── Fallback: simulated with CORRECT base price ───────────────────────────────
  // Use cached history if available, otherwise generate fresh
  console.log('📊 KSE100: using simulated data (base: 171,000)');
  const BASE      = 171000; // ← correct PKR value as of May 2026
  const simulated = kseHistory.length >= 5 ? kseHistory : generateSimulatedCandles(BASE);
  const first     = simulated[0];
  const last      = simulated[simulated.length - 1];

  return res.json({
    success: true,
    source: 'simulated',
    meta: {
      currentPrice:  last.c,
      high:          Math.max(...simulated.map(c => c.h)),
      low:           Math.min(...simulated.map(c => c.l)),
      previousClose: first.o,
      change:        +(last.c - first.o).toFixed(2),
      changePercent: +(((last.c - first.o) / first.o) * 100).toFixed(2),
      volume:        0,
    },
    candles: simulated,
  });
});
// ── Stock APIs ─────────────────────────────────────────────────────────────────
app.get('/api/stocks', async (req, res) => {
  try {
    const { data, summary } = await getDataWithCache();
    res.json({ success: true, data, summary, total: data.length,
      updated: new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' }) });
  } catch (err) {
    console.error('❌ Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/stock/:symbol', async (req, res) => {
  try {
    const { data } = await getDataWithCache();
    const stock = data.find(s => s.symbol.toUpperCase() === req.params.symbol.toUpperCase());
    if (!stock) return res.status(404).json({ success: false, error: 'Stock not found' });
    res.json({ success: true, data: stock });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/sector/:name', async (req, res) => {
  try {
    const { data } = await getDataWithCache();
    const stocks = data.filter(s => s.sector.toUpperCase().includes(req.params.name.toUpperCase()));
    res.json({ success: true, data: stocks, total: stocks.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Start ──────────────────────────────────────────────────────────────────────
if (require.main === module) {
  app.listen(3000, () => console.log('✅ Server running on http://localhost:3000'));
}

module.exports = app; // ← must be at the END