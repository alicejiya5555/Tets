require('dotenv').config();
const { Telegraf } = require('telegraf');
const axios = require('axios');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

// Telegram Bot
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN || '8384983472:AAFHyO9a33HtLqDnJ94G_cSQ1iVAA8kIzZg');

// FRED API key
const FRED_API_KEY = 'abcdefghijklmnopqrstuvwxyz123456';

// Yahoo Finance API Key for DXY
const YF_API_KEY = process.env.YF_API_KEY || 'YOUR_RAPIDAPI_KEY';

// Helper: compare actual vs expected
function scoreNews(actual, expected, reverse = false) {
    if (actual > expected) return reverse ? -1 : 1;
    if (actual < expected) return reverse ? 1 : -1;
    return 0;
}

// Fetch latest observation for a series
async function fetchObservation(series_id) {
    try {
        const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${series_id}&api_key=${FRED_API_KEY}&file_type=json`;
        const response = await axios.get(url);
        const observations = response.data.observations;
        const latest = observations[observations.length - 1];
        return parseFloat(latest.value);
    } catch (error) {
        console.error('Error fetching observation:', series_id, error.message);
        return null;
    }
}

// Fetch current DXY price from Yahoo Finance
async function fetchDXY() {
    try {
        const url = 'https://yfapi.net/v8/finance/chart/DX-Y.NYB?interval=1m&range=1d';
        const response = await axios.get(url, {
            headers: { 'X-API-KEY': YF_API_KEY }
        });

        const result = response.data.chart.result[0];
        const meta = result.meta;
        const timestamp = result.timestamp[result.timestamp.length - 1];
        const close = result.indicators.quote[0].close[result.indicators.quote[0].close.length - 1];

        const date = new Date(timestamp * 1000).toUTCString();
        const open = result.indicators.quote[0].open[result.indicators.quote[0].open.length - 1];
        const high = result.indicators.quote[0].high[result.indicators.quote[0].high.length - 1];
        const low = result.indicators.quote[0].low[result.indicators.quote[0].low.length - 1];

        return {
            price: close.toFixed(2),
            open: open.toFixed(2),
            high: high.toFixed(2),
            low: low.toFixed(2),
            time: date
        };
    } catch (error) {
        console.error('Error fetching DXY:', error.message);
        return { price: 'N/A', open: 'N/A', high: 'N/A', low: 'N/A', time: 'N/A' };
    }
}

// Main function to generate USD summary including DXY
async function generateUsdSummary() {
    const expectedValues = {
        CPI_MM: 0.2,
        CORE_CPI_MM: 0.15,
        CPI_YY: 3.0,
        UNEMPLOYMENT: 230000
    };

    const CPI_MM = await fetchObservation('CPIAUCSL');
    const CORE_CPI_MM = await fetchObservation('CPILFESL');
    const CPI_YY = await fetchObservation('CPIAUCSL');
    const UNEMPLOYMENT = await fetchObservation('ICSA');

    const scores = {
        'CPI m/m': scoreNews(CPI_MM, expectedValues.CPI_MM),
        'Core CPI m/m': scoreNews(CORE_CPI_MM, expectedValues.CORE_CPI_MM),
        'CPI y/y': scoreNews(CPI_YY, expectedValues.CPI_YY),
        'Unemployment Claims': scoreNews(UNEMPLOYMENT, expectedValues.UNEMPLOYMENT, true)
    };

    const totalScore = Object.values(scores).reduce((a, b) => a + b, 0);
    const usdTrend = totalScore > 0 ? '✅ USD Likely Up' : totalScore < 0 ? '❌ USD Likely Down' : '🟡 USD Neutral';
    const cryptoTrend = totalScore > 0 ? '📉 Crypto Likely Down' : totalScore < 0 ? '📈 Crypto Likely Up' : '🟡 Crypto Neutral';

    // Fetch DXY
    const dxy = await fetchDXY();

    // Format Telegram message
    let message = '💹 *USD News Impact Summary*\n\n';
    for (const key in scores) {
        let val = scores[key];
        let text = val === 1 ? 'Higher than expected' : val === -1 ? 'Lower than expected' : 'As expected';
        message += `📊 ${key}: ${val} (${text})\n`;
    }

    message += `\n💵 Total Score: ${totalScore}\n${usdTrend}\n${cryptoTrend}\n\n`;
    message += `💵 *U.S. Dollar Index (DXY)*\n`;
    message += `Price: ${dxy.price}\n`;
    message += `Open: ${dxy.open}\n`;
    message += `High: ${dxy.high}\n`;
    message += `Low: ${dxy.low}\n`;
    message += `Last Updated: ${dxy.time}\n`;

    return message;
}

// Telegram command
bot.command('usdnews', async (ctx) => {
    ctx.reply('Fetching latest USD news and DXY...');
    const summary = await generateUsdSummary();
    ctx.replyWithMarkdown(summary);
});

// Express server to keep bot alive
app.get('/', (req, res) => res.send('USD News Bot is running...'));
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// Launch bot
bot.launch().then(() => console.log('Telegram Bot started!'));

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
