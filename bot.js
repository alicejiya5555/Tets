require('dotenv').config();
const { Telegraf } = require('telegraf');
const axios = require('axios');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

// Telegram Bot
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN || '8384983472:AAFHyO9a33HtLqDnJ94G_cSQ1iVAA8kIzZg');

// Economic API keys
const FRED_API_KEY = 'abcdefghijklmnopqrstuvwxyz123456';

// --- Helper: Compare actual vs expected ---
function scoreNews(actual, expected) {
    if (actual > expected) return 1;      // USD likely up
    if (actual < expected) return -1;     // USD likely down
    return 0;                             // Neutral
}

// --- Fetch Observations (example: CPI, Unemployment, etc.) ---
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

// --- Main function to generate USD summary ---
async function generateUsdSummary() {
    // Expected values (you can update these dynamically if needed)
    const expectedValues = {
        CPI_MM: 0.2,              // Example expected
        CORE_CPI_MM: 0.15,
        CPI_YY: 3.0,
        UNEMPLOYMENT: 230000
    };

    // Fetch latest actual values (replace series IDs with correct ones)
    const CPI_MM = await fetchObservation('CPIAUCSL');        // CPI m/m
    const CORE_CPI_MM = await fetchObservation('CPILFESL');   // Core CPI
    const CPI_YY = await fetchObservation('CPIAUCNS');        // CPI y/y
    const UNEMPLOYMENT = await fetchObservation('ICSA');      // Unemployment claims

    // Score each
    const scores = {
        'CPI m/m': scoreNews(CPI_MM, expectedValues.CPI_MM),
        'Core CPI m/m': scoreNews(CORE_CPI_MM, expectedValues.CORE_CPI_MM),
        'CPI y/y': scoreNews(CPI_YY, expectedValues.CPI_YY),
        'Unemployment Claims': scoreNews(expectedValues.UNEMPLOYMENT, UNEMPLOYMENT) // reverse logic for unemployment
    };

    // Sum scores
    const totalScore = Object.values(scores).reduce((a,b)=>a+b,0);
    const usdTrend = totalScore > 0 ? '✅ USD Likely Up' : totalScore < 0 ? '❌ USD Likely Down' : '🟡 USD Neutral';
    const cryptoTrend = totalScore > 0 ? '📉 Crypto Likely Down' : totalScore < 0 ? '📈 Crypto Likely Up' : '🟡 Crypto Neutral';

    // Format output
    let message = 'USD News Impact Summary:\n';
    for (const key in scores) {
        let val = scores[key];
        let text = val === 1 ? 'Higher than expected' : val === -1 ? 'Lower than expected' : 'As expected';
        message += `📊 ${key}: ${val} (${text})\n`;
    }
    message += `\n💵 Total Score: ${totalScore}\n${usdTrend}\n${cryptoTrend}`;

    return message;
}

// --- Telegram command ---
bot.command('usdnews', async (ctx) => {
    ctx.reply('Fetching latest USD news...');
    const summary = await generateUsdSummary();
    ctx.reply(summary);
});

// --- Express server to keep bot alive ---
app.get('/', (req, res) => res.send('USD News Bot is running...'));
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// --- Launch bot ---
bot.launch().then(() => console.log('Telegram Bot started!'));

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
