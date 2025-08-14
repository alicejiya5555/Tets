require('dotenv').config();
const { Telegraf } = require('telegraf');
const axios = require('axios');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

// Telegram Bot
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// FRED API key
const FRED_API_KEY = process.env.FRED_API_KEY || 'YOUR_FRED_KEY_HERE';

// Compare actual vs expected
function scoreNews(actual, expected, reverse = false) {
    if (actual === null) return 0;
    if (actual > expected) return reverse ? -1 : 1;
    if (actual < expected) return reverse ? 1 : -1;
    return 0;
}

// Fetch latest observation for a series safely
async function fetchObservation(series_id) {
    try {
        const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${series_id}&api_key=${FRED_API_KEY}&file_type=json`;
        const response = await axios.get(url);
        const observations = response.data.observations;
        if (!observations || observations.length === 0) return null;
        const latest = observations[observations.length - 1];
        const value = parseFloat(latest.value);
        return isNaN(value) ? null : value;
    } catch (error) {
        console.error('Error fetching observation:', series_id, error.message);
        return null;
    }
}

// Generate USD summary
async function generateUsdSummary() {
    const expectedValues = {
        CPI_MM: 0.2,
        CORE_CPI_MM: 0.15,
        UNEMPLOYMENT: 230000
    };

    // Only fetch what is reliable
    const CPI_MM = await fetchObservation('CPIAUCSL');      // CPI m/m
    const CORE_CPI_MM = await fetchObservation('CPILFESL'); // Core CPI m/m
    const UNEMPLOYMENT = await fetchObservation('ICSA');    // Initial claims

    const scores = {
        'CPI m/m': scoreNews(CPI_MM, expectedValues.CPI_MM),
        'Core CPI m/m': scoreNews(CORE_CPI_MM, expectedValues.CORE_CPI_MM),
        'Unemployment Claims': scoreNews(UNEMPLOYMENT, expectedValues.UNEMPLOYMENT, true)
    };

    const totalScore = Object.values(scores).reduce((a, b) => a + b, 0);
    const usdTrend = totalScore > 0 ? '✅ USD Likely Up' : totalScore < 0 ? '❌ USD Likely Down' : '🟡 USD Neutral';
    const cryptoTrend = totalScore > 0 ? '📉 Crypto Likely Down' : totalScore < 0 ? '📈 Crypto Likely Up' : '🟡 Crypto Neutral';

    let message = '💹 *USD News Impact Summary*\n\n';
    for (const key in scores) {
        const val = scores[key];
        const text = val === 1 ? 'Higher than expected' : val === -1 ? 'Lower than expected' : 'As expected';
        message += `📊 ${key}: ${val} (${text})\n`;
    }
    message += `\n💵 Total Score: ${totalScore}\n${usdTrend}\n${cryptoTrend}`;

    return message;
}

// Only one command
bot.command('usdnews', async (ctx) => {
    ctx.reply('Fetching latest USD news...');
    const summary = await generateUsdSummary();
    ctx.replyWithMarkdown(summary);
});

// Express server
app.get('/', (req, res) => res.send('USD News Bot is running...'));
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// Launch bot
bot.launch().then(() => console.log('Telegram Bot started!'));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
