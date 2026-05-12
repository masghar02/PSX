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
const stockHistory = {};
const CACHE_DURATION = 5 * 60 * 1000;

function calculateAIScore(stock) {
  let score = 0;

  const change = parseFloat(stock.changePercent);
  const volume = parseInt(stock.volume);

  // Momentum
  if (change > 5) score += 40;
  else if (change > 3) score += 25;
  else if (change > 1) score += 10;

  // Volume strength
  if (volume > 5000000) score += 30;
  else if (volume > 1000000) score += 20;
  else if (volume > 500000) score += 10;

  // Bullish movement
  if (stock.price > stock.open) score += 15;

  // Near day high
  if (stock.price >= stock.high * 0.98) score += 15;

  return Math.min(score, 100);
}

async function getDataWithCache() {
  const now = Date.now();

  if (
    cache.data &&
    cache.timestamp &&
    (now - cache.timestamp < CACHE_DURATION)
  ) {
    console.log('📦 Serving from cache');
    return cache;
  }

  console.log('🔍 Fetching fresh data from PSX...');

  const response = await axios.get(
    'https://www.psx.com.pk/market-summary/',
    {
      headers: HEADERS,
      timeout: 15000,
    }
  );

  const stocks = await scrapePSX();
  const summary = await scrapeMarketSummary(response.data);

  // 1️⃣ SAVE CACHE FIRST
  cache = {
    data: stocks,
    summary,
    timestamp: now,
  };

  // 2️⃣ THEN STORE HISTORY (IMPORTANT PART)
  stocks.forEach(stock => {
    if (!stockHistory[stock.symbol]) {
  stockHistory[stock.symbol] = [];
}

stockHistory[stock.symbol].push({
  time: now,
  price: Number(stock.price),
  volume: Number(stock.volume),
  changePercent: Number(stock.changePercent),
});

// keep MUCH more data for long-term (IMPORTANT)
if (stockHistory[stock.symbol].length > 3000) {
  stockHistory[stock.symbol].shift();
}
  });

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
app.get('/api/ai-recommendations', async (req, res) => {
  try {
    const { data } = await getDataWithCache();

    if (!data || !data.length) {
      return res.json({ recommendations: [] });
    }

    // Simple scoring model (short-term momentum)
    const scored = data.map(stock => {
      const change = Number(stock.changePercent) || 0;
      const volume = Number(stock.volume) || 0;

      // basic AI-like score (you will improve later)
      const score =
        (change * 2) +
        (volume / 1000000) +
        (Number(stock.price) / 1000);

      return {
        symbol: stock.symbol,
        sector: stock.sector,
        price: stock.price,
        changePercent: stock.changePercent,
        aiScore: Math.min(99, Math.max(0, score.toFixed(2)))
      };
    });

    const top = scored
      .sort((a, b) => b.aiScore - a.aiScore)
      .slice(0, 6);

    res.json({
      recommendations: top
    });

  } catch (err) {
    console.error('AI error:', err.message);
    res.status(500).json({ error: 'AI recommendation failed' });
  }
});
// ── Start ──────────────────────────────────────────────────────────────────────
app.get('/api/history-long/:symbol', (req, res) => {
  const symbol = req.params.symbol.toUpperCase();

  const data = stockHistory[symbol] || [];

  if (data.length < 100) {
    return res.json({
      symbol,
      history: [],
      message: "Not enough data yet"
    });
  }

  // simulate long-term grouping (daily candles)
  const grouped = [];

  let bucket = [];
  let lastDay = null;

  data.forEach(point => {
    const day = new Date(point.time).toDateString();

    if (day !== lastDay && bucket.length) {
      const closes = bucket.map(x => x.price);
      grouped.push({
        time: bucket[0].time,
        close: closes[closes.length - 1],
        avg: closes.reduce((a,b)=>a+b,0)/closes.length
      });
      bucket = [];
    }

    bucket.push(point);
    lastDay = day;
  });

  res.json({
    symbol,
    history: grouped.slice(-600) // ~2 years equivalent approximation
  });
});
function calculateLongTermSignal(history) {
  if (!history || history.length < 50) return null;

  const closes = history.map(h => h.close || h.price);

  const last = closes[closes.length - 1];

  const ma20 = average(closes.slice(-20));
  const ma100 = average(closes.slice(-100));

  let score = 50;

  // trend
  if (ma20 > ma100) score += 20;
  else score -= 20;

  // momentum
  const recent = closes.slice(-10);
  const momentum = (recent[9] - recent[0]) / recent[0];
  score += momentum * 100;

  // clamp
  score = Math.max(0, Math.min(100, score));

  return {
    score: score.toFixed(2),
    trend: ma20 > ma100 ? "Bullish" : "Bearish",
    horizon: "6–24 months"
  };
}
function average(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function standardDeviation(arr) {
  const avg = average(arr);
  return Math.sqrt(
    average(arr.map(x => Math.pow(x - avg, 2)))
  );
}
app.get('/api/ai-longterm', (req, res) => {
  const results = [];

  Object.keys(stockHistory).forEach(symbol => {
    const history = stockHistory[symbol];

    const analysis = calculateLongTermSignal(history);

    if (analysis) {
      results.push({
        symbol,
        aiScore: analysis.score,
        trend: analysis.trend,
        horizon: analysis.horizon
      });
    }
  });

  const top = results
    .sort((a,b)=>b.aiScore-a.aiScore)
    .slice(0, 6);

  res.json({ recommendations: top });
});
if (require.main === module) {
  app.listen(3000, () => console.log('✅ Server running on http://localhost:3000'));
}
// ── AI Predictions API (6–24 months simple trend model) ───────────────
app.get('/api/ai-predictions', async (req, res) => {
  try {
    const { data } = await getDataWithCache();

    const predictions = data.map(stock => {
      const price = Number(stock.price) || 0;
      const change = Number(stock.changePercent) || 0;
      const volume = Number(stock.volume) || 0;

      // ── SIMPLE LONG TERM SCORE (6–24 months)
      const longTermScore =
        (change * 0.6) +
        (volume > 100000 ? 5 : 0) +
        (price > 50 ? 3 : 1);

      // ── SHORT TERM SCORE (1–3 months)
      const shortTermScore =
        (change * 1.2) +
        (volume > 50000 ? 3 : 0);

      return {
        symbol: stock.symbol,
        sector: stock.sector,
        price,
        longTermScore: Number(longTermScore.toFixed(2)),
        shortTermScore: Number(shortTermScore.toFixed(2)),
        longTermSignal: longTermScore > 8 ? "BUY" : "HOLD",
        shortTermSignal: shortTermScore > 5 ? "BUY" : "HOLD"
      };
    });

    res.json({
      success: true,
      predictions
    });

  } catch (err) {
    console.error("AI API error:", err.message);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});
// ── Gold & Silver ─────────────────────────────────────────────────────────────
let goldCache = { data: null, ts: null };

app.get('/api/gold-silver', async (req, res) => {
  try {
    const now = Date.now();
    if (goldCache.data && goldCache.ts && (now - goldCache.ts < 15 * 60 * 1000)) {
      return res.json({ ...goldCache.data, cached: true });
    }

    const r = await axios.get('https://gold.pk/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.google.com/',
      },
      timeout: 12000,
    });

    const $ = cheerio.load(r.data);

    // ── Method 1: Get from XAUP table row (most reliable — full integers) ──
    let gold24kTola = 0;
    let silverTola  = 0;

    $('.table-row').each((i, row) => {
      const text = $(row).text().replace(/\s+/g, ' ').trim();
      if (text.includes('XAUP') || (text.includes('Gold') && /\d{5,}/.test(text))) {
        const nums = text.match(/\d{5,}/g);
        if (nums && !gold24kTola) gold24kTola = parseInt(nums[0]);
      }
      if (text.includes('XAGP') || (text.includes('Silver') && /\d{4,}/.test(text))) {
        const nums = text.match(/\d{4,}/g);
        if (nums && !silverTola) silverTola = parseInt(nums[0]);
      }
    });

    // ── Method 2: Fallback — scan all text for large numbers ──────────────
    if (!gold24kTola) {
      $('*').each((i, el) => {
        if ($(el).children().length > 0) return;
        const text = $(el).text().trim();
        const num  = parseInt(text.replace(/[^0-9]/g, ''));
        if (num >= 400000 && num <= 700000 && !gold24kTola) {
          gold24kTola = num;
        }
      });
    }

    // ── Method 3: goldratehome with smart normalization ───────────────────
    if (!gold24kTola) {
      const raw = parseFloat($('p.goldratehome').eq(0).text().replace(/[^0-9.]/g, '')) || 0;
      if      (raw >= 400000)  gold24kTola = Math.round(raw);
      else if (raw >= 400)     gold24kTola = Math.round(raw * 1000);
      else if (raw >= 0.4)     gold24kTola = Math.round(raw * 1000000);
    }

    if (!gold24kTola) throw new Error('Could not parse gold price from gold.pk');

    // ── City prices ───────────────────────────────────────────────────────
    const cityPrices = [];
    ['Karachi','Lahore','Islamabad','Quetta','Peshawar'].forEach(city => {
      $('.table-row').each((i, row) => {
        const text = $(row).text();
        if (text.includes(city)) {
          const nums = text.match(/\d{5,}/g);
          if (nums && !cityPrices.find(c => c.city === city)) {
            cityPrices.push({ city, bid: parseInt(nums[0]), ask: parseInt(nums[1] || nums[0]) });
          }
        }
      });
    });

    // ── Calculations ──────────────────────────────────────────────────────
    const TOLA  = 11.664;
    const perG  = Math.round(gold24kTola / TOLA);
    const per10g = Math.round(gold24kTola / TOLA * 10);
    const silG  = silverTola ? Math.round(silverTola / TOLA) : 0;

    const result = {
      success:   true,
      source:    'gold.pk',
      timestamp: new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' }),
      gold: {
        pkrPerTola: gold24kTola,
        pkrPerGram: perG,
        pkrPer10g:  per10g,
        byKarat: {
          '24K': { perTola: gold24kTola,                    perGram: perG,                    per10g: per10g },
          '22K': { perTola: Math.round(gold24kTola * 0.9167), perGram: Math.round(perG * 0.9167), per10g: Math.round(per10g * 0.9167) },
          '21K': { perTola: Math.round(gold24kTola * 0.8750), perGram: Math.round(perG * 0.8750), per10g: Math.round(per10g * 0.8750) },
          '18K': { perTola: Math.round(gold24kTola * 0.7500), perGram: Math.round(perG * 0.7500), per10g: Math.round(per10g * 0.7500) },
        },
        cityPrices,
      },
      silver: {
        pkrPerTola: silverTola,
        pkrPerGram: silG,
      },
    };

    goldCache = { data: result, ts: now };
    console.log(`✅ Gold: PKR ${gold24kTola.toLocaleString()} / tola | Silver: PKR ${silverTola.toLocaleString()} / tola`);
    res.json(result);

  } catch (err) {
    console.error('❌ Gold error:', err.message);
    if (goldCache.data) return res.json({ ...goldCache.data, cached: true, stale: true });
    res.status(500).json({ success: false, error: err.message });
  }
});
app.get('/api/hbl-funds', async (req, res) => {
  try {

    const response = await axios.get(
      'https://www.mufap.com.pk/Home/FundByAMC?Id=31',
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
        }
      }
    );

    const $ = cheerio.load(response.data);

    const funds = [];

    $('.fund-item, .card, .col-md-4').each((i, el) => {

      const text =
        $(el).text().replace(/\s+/g, ' ').trim();

      if (!text.includes('NAV')) return;

      const name =
        $(el).find('h3,h4,h5').first().text().trim()
        || text.split('NAV')[0].trim();

      // NAV
      const navMatch =
        text.match(/([\d,.]+)\s*NAV/i);

      // Offer Price
      const offerMatch =
        text.match(/([\d,.]+)\s*Offer Price/i);

      // Category
      const categoryMatch =
        text.match(/Offer Price\s*(.*?)\s*Category/i);

      // Risk
      const riskMatch =
        text.match(/(Low|Medium|High|Low to High|NA)\s*Risk/i);

      funds.push({
        name,
        nav: navMatch ? navMatch[1] : '--',
        offer: offerMatch ? offerMatch[1] : '--',
        category: categoryMatch ? categoryMatch[1] : 'N/A',
        risk: riskMatch ? riskMatch[1] : 'N/A'
      });

    });

    res.json({
      success: true,
      funds
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      success: false,
      error: err.message
    });

  }
});
module.exports = app; // ← must be at the END
