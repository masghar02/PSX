const express = require('express');
const path = require('path');

const app = express();

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

module.exports = app;
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

  // Tables 2-42 contain stock data
  // Columns: SCRIP, LDCP, OPEN, HIGH, LOW, CURRENT, CHANGE, VOLUME
  $('table').each((tableIndex, table) => {
    if (tableIndex < 2) return; // Skip market summary tables

    const sectorName = $(table).find('th').first().text().trim();

    $(table).find('tbody tr').each((rowIndex, row) => {
      const cols = $(row).find('td');
      if (cols.length < 8) return; // Skip rows without enough columns

      const scrip   = $(cols[0]).text().trim();
      const ldcp    = parseFloat($(cols[1]).text().replace(/,/g, '').trim()) || 0;
      const open    = parseFloat($(cols[2]).text().replace(/,/g, '').trim()) || 0;
      const high    = parseFloat($(cols[3]).text().replace(/,/g, '').trim()) || 0;
      const low     = parseFloat($(cols[4]).text().replace(/,/g, '').trim()) || 0;
      const current = parseFloat($(cols[5]).text().replace(/,/g, '').trim()) || 0;
      const change  = parseFloat($(cols[6]).text().replace(/,/g, '').trim()) || 0;
      const volume  = parseInt($(cols[7]).text().replace(/,/g, '').trim()) || 0;

      // Skip header rows and empty rows
      if (!scrip || scrip === 'SCRIP' || scrip === 'SYMBOL') return;
      if (current === 0 && ldcp === 0) return;

      const changePercent = ldcp > 0 ? ((change / ldcp) * 100).toFixed(2) : '0.00';

      stocks.push({
        name: scrip,
        symbol: scrip,
        sector: sectorName,
        price: current || ldcp,
        ldcp,
        open,
        high,
        low,
        change: change.toFixed(2),
        changePercent,
        volume,
      });
    });
  });

  return stocks;
}

async function scrapeMarketSummary($html) {
  const $ = cheerio.load($html);
  let summary = { status: 'Unknown', volume: 0, value: 0, trades: 0, advanced: 0, declined: 0, unchanged: 0 };

  // Table 0 - Exchange status
  $('table').eq(0).find('td').each((i, td) => {
    const text = $(td).text().trim();
    if (text.includes('Status:')) summary.status = text.replace('Status:', '').trim();
    if (text.includes('Volume:')) summary.volume = text.replace('Volume:', '').trim();
    if (text.includes('Value:')) summary.value = text.replace('Value:', '').trim();
    if (text.includes('Trades:')) summary.trades = text.replace('Trades:', '').trim();
  });

  // Table 1 - Advances/Declines
  $('table').eq(1).find('td').each((i, td) => {
    const text = $(td).text().trim();
    if (text.includes('Advanced:')) summary.advanced = text.replace('Advanced:', '').trim();
    if (text.includes('Declined:')) summary.declined = text.replace('Declined:', '').trim();
    if (text.includes('Unchanged:')) summary.unchanged = text.replace('Unchanged:', '').trim();
  });

  return summary;
}

// Cache to avoid hitting PSX too often
let cache = { data: null, summary: null, timestamp: null };
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

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

// Main stocks API
app.get('/api/stocks', async (req, res) => {
  try {
    const { data, summary } = await getDataWithCache();
    res.json({
      success: true,
      data,
      summary,
      total: data.length,
      updated: new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })
    });
  } catch (err) {
    console.error('❌ Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Search specific stock
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

// Get stocks by sector
app.get('/api/sector/:name', async (req, res) => {
  try {
    const { data } = await getDataWithCache();
    const stocks = data.filter(s => s.sector.toUpperCase().includes(req.params.name.toUpperCase()));
    res.json({ success: true, data: stocks, total: stocks.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

if (require.main === module) {
  app.listen(3000, () => console.log('✅ Server running on http://localhost:3000'));
}