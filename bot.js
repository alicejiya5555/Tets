import { Telegraf } from "telegraf";
import axios from "axios";
import ti from "technicalindicators";
import express from "express";
import WebSocket from "ws";

// ============= CONFIGURATION =============
const BOT_TOKEN = "7965604896:AAHMxS-Q3no5O8B4m0sBa2x-34iehu_diFc"; // Replace with your token
const PORT = process.env.PORT || 3000;
const WS_URL = "wss://stream.binance.com:9443/ws";
const API_URL = "https://api.binance.com/api/v3";

// ============= INITIALIZATION =============
const bot = new Telegraf(BOT_TOKEN);
const app = express();
let socket = null;
let candleData = {};
let priceData = {};

// ============= UTILITY FUNCTIONS =============
function formatNum(num, digits = 2) {
  if (num === undefined || num === null || isNaN(num)) return "N/A";
  return parseFloat(num).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function parseCommand(command) {
  const cmd = command.toLowerCase();
  const match = cmd.match(/^\/(\w+)(15m|1h|4h|6h|12h|1d)$/);
  if (!match) return null;

  const symbolMap = {
    eth: "ETHUSDT",
    btc: "BTCUSDT",
    link: "LINKUSDT",
    sol: "SOLUSDT",
    bnb: "BNBUSDT"
  };

  return {
    symbol: symbolMap[match[1]] || null,
    interval: match[2]
  };
}

// ============= DATA FETCHING =============
async function getLatestPrice(symbol) {
  try {
    const response = await axios.get(`${API_URL}/ticker/24hr?symbol=${symbol}`);
    priceData[symbol] = response.data;
    return response.data;
  } catch (error) {
    console.error('Error fetching price:', error);
    return null;
  }
}

async function getHistoricalData(symbol, interval, limit = 200) {
  try {
    const response = await axios.get(
      `${API_URL}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
    );
    
    return response.data.map(c => ({
      time: c[0],
      open: parseFloat(c[1]),
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
      close: parseFloat(c[4]),
      volume: parseFloat(c[5]),
      isFinal: true
    }));
  } catch (error) {
    console.error('Error fetching historical data:', error);
    return null;
  }
}

// ============= INDICATOR CALCULATIONS =============
function calcVWAP(candles) {
  if (!candles.length) return "N/A";
  
  let cumPV = 0;
  let cumVol = 0;

  for (const bar of candles) {
    const typicalPrice = (bar.high + bar.low + bar.close) / 3;
    cumPV += typicalPrice * bar.volume;
    cumVol += bar.volume;
  }

  return cumVol > 0 ? (cumPV / cumVol).toFixed(2) : "N/A";
}

function getKeltnerChannel(candles, emaPeriod = 20, atrPeriod = 14, multiplier = 2) {
  const close = candles.map(c => c.close);
  const high = candles.map(c => c.high);
  const low = candles.map(c => c.low);

  const ema = ti.EMA.calculate({ period: emaPeriod, values: close }).slice(-1)[0] || 0;
  const atr = ti.ATR.calculate({ period: atrPeriod, high, low, close }).slice(-1)[0] || 0;

  return {
    upper: (ema + multiplier * atr).toFixed(2),
    middle: ema.toFixed(2),
    lower: (ema - multiplier * atr).toFixed(2)
  };
}

function getSuperTrend(candles, period = 10, multiplier = 3) {
  const close = candles.map(c => c.close);
  const high = candles.map(c => c.high);
  const low = candles.map(c => c.low);

  const atr = ti.ATR.calculate({ period, high, low, close });
  if (!atr.length) return { value: "N/A", trend: "N/A" };

  let superTrend = [];
  let upperBand = (high[0] + low[0]) / 2;
  let lowerBand = (high[0] + low[0]) / 2;
  let trend = "bullish";

  for (let i = 0; i < close.length; i++) {
    if (i < period) {
      superTrend.push((high[i] + low[i]) / 2);
      continue;
    }

    const hl2 = (high[i] + low[i]) / 2;
    const currentUpper = hl2 + multiplier * atr[i-1];
    const currentLower = hl2 - multiplier * atr[i-1];

    upperBand = (currentUpper < upperBand || close[i-1] > upperBand) 
      ? currentUpper : upperBand;
    lowerBand = (currentLower > lowerBand || close[i-1] < lowerBand) 
      ? currentLower : lowerBand;

    const currentST = close[i] > superTrend[i-1] 
      ? Math.max(lowerBand, superTrend[i-1])
      : Math.min(upperBand, superTrend[i-1]);

    superTrend.push(currentST);
    trend = close[i] > currentST ? "bullish" : "bearish";
  }

  return {
    value: superTrend.slice(-1)[0].toFixed(2),
    trend
  };
}

// ... [Include all your other indicator functions here] ...

async function calculateAllIndicators(candles) {
  if (!candles || !candles.length) return null;

  const close = candles.map(c => c.close);
  const high = candles.map(c => c.high);
  const low = candles.map(c => c.low);
  const volume = candles.map(c => c.volume);

  // Basic indicators
  const sma20 = ti.SMA.calculate({ period: 20, values: close }).slice(-1)[0];
  const ema20 = ti.EMA.calculate({ period: 20, values: close }).slice(-1)[0];
  const rsi14 = ti.RSI.calculate({ period: 14, values: close }).slice(-1)[0];
  
  // Advanced indicators
  const macd = ti.MACD.calculate({
    values: close,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9
  }).slice(-1)[0];

  const superTrend = getSuperTrend(candles);
  const keltner = getKeltnerChannel(candles);
  const vwap = calcVWAP(candles);

  return {
    price: close.slice(-1)[0],
    sma20: formatNum(sma20),
    ema20: formatNum(ema20),
    rsi14: formatNum(rsi14),
    macd: macd ? {
      value: formatNum(macd.MACD),
      signal: formatNum(macd.signal),
      histogram: formatNum(macd.histogram)
    } : null,
    superTrend,
    keltner,
    vwap,
    // Add other indicators here
  };
}

// ============= WEBSOCKET MANAGEMENT =============
function initWebSocket(symbol, interval) {
  if (socket) socket.close();

  const stream = `${symbol.toLowerCase()}@kline_${interval}`;
  socket = new WebSocket(`${WS_URL}/${stream}`);

  socket.on('open', () => console.log(`Connected to ${symbol} ${interval} stream`));
  
  socket.on('message', (data) => {
    const { k: candle } = JSON.parse(data);
    if (!candle) return;

    if (!candleData[symbol]) candleData[symbol] = {};
    if (!candleData[symbol][interval]) candleData[symbol][interval] = [];

    const newCandle = {
      time: candle.t,
      open: parseFloat(candle.o),
      high: parseFloat(candle.h),
      low: parseFloat(candle.l),
      close: parseFloat(candle.c),
      volume: parseFloat(candle.v),
      isFinal: candle.x
    };

    if (candle.x) {
      // Finalized candle
      candleData[symbol][interval].push(newCandle);
      if (candleData[symbol][interval].length > 200) {
        candleData[symbol][interval].shift();
      }
    } else {
      // Update current candle
      if (candleData[symbol][interval].length > 0) {
        candleData[symbol][interval][candleData[symbol][interval].length - 1] = newCandle;
      } else {
        candleData[symbol][interval].push(newCandle);
      }
    }
  });

  socket.on('error', (err) => console.error('WebSocket error:', err));
  socket.on('close', () => console.log('WebSocket closed'));
}

// ============= MESSAGE GENERATION =============
function generateSignalMessage(symbol, interval, priceData, indicators) {
  const symbolName = symbol.replace('USDT', '');
  const price = formatNum(priceData.lastPrice);
  const change = `${priceData.priceChange} (${priceData.priceChangePercent}%)`;
  
  const trend = indicators.superTrend.trend === "bullish" ? "🟢 Bullish" : "🔴 Bearish";
  const rsiSignal = indicators.rsi14 > 70 ? "Overbought" : indicators.rsi14 < 30 ? "Oversold" : "Neutral";
  
  return `
📈 ${symbolName} ${interval.toUpperCase()} Analysis
────────────────────
💰 Price: $${price}
📊 24h Change: ${change}
📶 Trend: ${trend}
  
🔢 Key Indicators:
- RSI(14): ${indicators.rsi14} (${rsiSignal})
- SuperTrend: ${indicators.superTrend.value} (${indicators.superTrend.trend})
- MACD: ${indicators.macd.value} (Signal: ${indicators.macd.signal})
- VWAP: ${indicators.vwap}
  
💡 Trading Suggestions:
${generateTradingSuggestions(indicators)}
  
🔄 Next update in ${interval}`;
}

function generateTradingSuggestions(indicators) {
  const suggestions = [];
  
  // RSI based suggestions
  if (indicators.rsi14 > 70) {
    suggestions.push("⚠️ RSI indicates overbought condition - Consider taking profits");
  } else if (indicators.rsi14 < 30) {
    suggestions.push("⚠️ RSI indicates oversold condition - Potential buying opportunity");
  }

  // MACD based suggestions
  if (indicators.macd.histogram > 0 && indicators.macd.value > indicators.macd.signal) {
    suggestions.push("✅ MACD shows bullish momentum");
  } else if (indicators.macd.histogram < 0 && indicators.macd.value < indicators.macd.signal) {
    suggestions.push("❌ MACD shows bearish momentum");
  }

  // SuperTrend based suggestions
  if (indicators.superTrend.trend === "bullish") {
    suggestions.push("🟢 SuperTrend indicates uptrend - Look for long opportunities");
  } else {
    suggestions.push("🔴 SuperTrend indicates downtrend - Consider short positions");
  }

  return suggestions.length 
    ? suggestions.map(s => `• ${s}`).join('\n')
    : "• Market appears neutral - Wait for clearer signals";
}

// ============= BOT COMMANDS =============
bot.start((ctx) => ctx.reply(
  `Welcome to Crypto Signals Bot!\n\n` +
  `Available commands:\n` +
  `/eth15m - ETH 15min signals\n` +
  `/btc1h - BTC 1hr signals\n` +
  `/help - Show all commands`
));

bot.help((ctx) => ctx.reply(
  `📊 Available commands:\n\n` +
  `/eth15m - ETH 15min analysis\n` +
  `/eth1h - ETH 1hr analysis\n` +
  `/btc15m - BTC 15min analysis\n` +
  `/btc1h - BTC 1hr analysis\n\n` +
  `Other intervals: 4h, 6h, 12h, 1d`
));

bot.on('text', async (ctx) => {
  const parsed = parseCommand(ctx.message.text);
  if (!parsed) return ctx.reply("Invalid command. Try /eth1h or /btc4h");

  try {
    const { symbol, interval } = parsed;
    
    // Show loading message
    await ctx.replyWithChatAction('typing');
    
    // Initialize WebSocket for real-time data
    initWebSocket(symbol, interval);
    
    // Get historical data as fallback
    const candles = await getHistoricalData(symbol, interval) || [];
    const priceInfo = await getLatestPrice(symbol) || {};
    const indicators = await calculateAllIndicators(candles);
    
    if (!indicators) throw new Error("Failed to calculate indicators");
    
    // Generate and send analysis
    const message = generateSignalMessage(symbol, interval, priceInfo, indicators);
    await ctx.reply(message, { parse_mode: 'Markdown' });
    
  } catch (error) {
    console.error('Command error:', error);
    ctx.reply("⚠️ Error generating analysis. Please try again later.");
  }
});

// ============= SERVER SETUP =============
app.use(express.json());
app.use(bot.webhookCallback('/webhook'));

app.get('/', (req, res) => {
  res.send('Crypto Signals Bot is running');
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  bot.launch()
    .then(() => console.log('Bot started successfully'))
    .catch(err => console.error('Bot failed to start:', err));
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
