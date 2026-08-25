const express = require('express');

const router = express.Router();

// Keyless data sources on purpose -- this feeds a decorative home page, not
// a financial product, so the unofficial-but-public Yahoo chart endpoint and
// Google News' public RSS are good enough and need no signup/API key.
const STOCKS = [
  { symbol: 'ULTRACEMCO.NS', name: 'UltraTech Cement' },
  { symbol: 'AMBUJACEM.NS', name: 'Ambuja Cements' },
  { symbol: 'ACC.NS', name: 'ACC' },
  { symbol: 'SHREECEM.NS', name: 'Shree Cement' },
  { symbol: 'DALBHARAT.NS', name: 'Dalmia Bharat' },
  { symbol: 'JKCEMENT.NS', name: 'JK Cement' },
];
const NEWS_QUERY = 'cement industry India';
const STOCKS_TTL_MS = 5 * 60 * 1000;
const NEWS_TTL_MS = 30 * 60 * 1000;

let stocksCache = { data: null, at: 0 };
let newsCache = { data: null, at: 0 };

async function fetchStockQuote({ symbol, name }) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`Yahoo chart ${symbol} returned ${res.status}`);
  const body = await res.json();
  const meta = body?.chart?.result?.[0]?.meta;
  if (!meta || typeof meta.regularMarketPrice !== 'number') {
    throw new Error(`Yahoo chart ${symbol} missing price data`);
  }
  const price = meta.regularMarketPrice;
  const prevClose = meta.previousClose ?? meta.chartPreviousClose ?? price;
  const change = price - prevClose;
  const changePct = prevClose ? (change / prevClose) * 100 : 0;
  return { symbol, name, price, change, changePct };
}

async function getStocks() {
  if (stocksCache.data && Date.now() - stocksCache.at < STOCKS_TTL_MS) {
    return stocksCache.data;
  }
  const results = await Promise.allSettled(STOCKS.map(fetchStockQuote));
  const quotes = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  if (!quotes.length) throw new Error('No stock quotes could be fetched');
  stocksCache = { data: quotes, at: Date.now() };
  return quotes;
}

function decodeXmlEntities(str) {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

// Google News RSS titles arrive as "Headline - Source Name"; split that out
// so the UI can show the source separately instead of it hanging off the end.
function splitTitleSource(rawTitle) {
  const idx = rawTitle.lastIndexOf(' - ');
  if (idx === -1) return { title: rawTitle, source: '' };
  return { title: rawTitle.slice(0, idx), source: rawTitle.slice(idx + 3) };
}

function parseRssItems(xml, limit) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRe.exec(xml)) && items.length < limit) {
    const block = match[1];
    const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/);
    const linkMatch = block.match(/<link>([\s\S]*?)<\/link>/);
    const pubDateMatch = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
    if (!titleMatch || !linkMatch) continue;
    const rawTitle = decodeXmlEntities(titleMatch[1].replace('<![CDATA[', '').replace(']]>', '').trim());
    const { title, source } = splitTitleSource(rawTitle);
    items.push({
      title,
      source,
      link: decodeXmlEntities(linkMatch[1].trim()),
      publishedAt: pubDateMatch ? pubDateMatch[1].trim() : null,
    });
  }
  return items;
}

async function getNews() {
  if (newsCache.data && Date.now() - newsCache.at < NEWS_TTL_MS) {
    return newsCache.data;
  }
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(NEWS_QUERY)}&hl=en-IN&gl=IN&ceid=IN:en`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`Google News RSS returned ${res.status}`);
  const xml = await res.text();
  const items = parseRssItems(xml, 6);
  if (!items.length) throw new Error('No news items parsed from feed');
  newsCache = { data: items, at: Date.now() };
  return items;
}

router.get('/cement/stocks', async (_req, res) => {
  try {
    res.json({ ok: true, stocks: await getStocks() });
  } catch (err) {
    console.error('[cement/stocks]', err.message);
    res.status(502).json({ ok: false, error: 'Stock data unavailable right now' });
  }
});

router.get('/cement/news', async (_req, res) => {
  try {
    res.json({ ok: true, items: await getNews() });
  } catch (err) {
    console.error('[cement/news]', err.message);
    res.status(502).json({ ok: false, error: 'News unavailable right now' });
  }
});

module.exports = router;
