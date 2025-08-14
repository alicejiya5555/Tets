require('dotenv').config();
const { Telegraf } = require('telegraf');
const axios = require('axios');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

// Telegram Bot
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// FRED API key
const FRED_API_KEY = 'abcdefghijklmnopqrstuvwxyz123456';

// Helper: compare actual vs expected
function scoreNews(actual, expected, reverse = false) {
    if (actual > expected) return reverse ? -1 : 1;
    if (actual < expected) return reverse ? 1 : -1;
    return 0;
}

// Fetch last N observations for a series
async function fetchLastObservations(series_id, count = 7) {
    try {
        const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${series_id}&api_key=${FRED_API_KEY}&file_type=json&frequency=m`;
        const response = await axios.get(url);
        const observations = response.data.observations.slice(-count);
        return observations.map(obs => parseFloat(obs.value));
    } catch (error) {
        console.error('Error fetching observations:', series_id, error.message);
        return Array(count).fill(0);
    }
}

// Main function to generate USD summary
async function generateUsdSummary() {
    const expectedValues = {
        CPI_MM: 0.2,
        CORE_CPI_MM: 0.15,
        CPI_YY: 3.0,
        UNEMPLOYMENT: 230000
    };

    // --- Latest values ---
    const CPI_MM = (await fetchLastObservations('CPIAUCNS', 1))[0];
    const CORE_CPI_MM = (await fetchLastObservations('CPILFENS', 1))[0];
    const CPI_YY = (await fetchLastObservations('CPIAUCNS', 13)).reduce((a, b, i, arr) => i === 0 ? 0 : a + (b - arr[i - 12]), 0) / 12; // rough YoY
    const UNEMPLOYMENT = (await fetchLastObservations('ICSA', 1))[0];

    const scores = {
        'CPI m/m': scoreNews(CPI_MM, expectedValues.CPI_MM),
        'Core CPI m/m': scoreNews(CORE_CPI_MM, expectedValues.CORE_CPI_MM),
        'CPI y/y': scoreNews(CPI_YY, expectedValues.CPI_YY),
        'Unemployment Claims': scoreNews(UNEMPLOYMENT, expectedValues.UNEMPLOYMENT, true)
    };

    const totalScore = Object.values(scores).reduce((a, b) => a + b, 0);
    const usdTrend = totalScore > 0 ? '✅ USD Likely Up' : totalScore < 0 ? '❌ USD Likely Down' : '🟡 USD Neutral';
    const cryptoTrend = totalScore > 0 ? '📉 Crypto Likely Down' : totalScore < 0 ? '📈 Crypto Likely Up' : '🟡 Crypto Neutral';

    // --- Last 1-week trend report ---
    const seriesList = [
        { key: 'CPI m/m', id: 'CPIAUCNS', reverse: false },
        { key: 'Core CPI m/m', id: 'CPILFENS', reverse: false },
        { key: 'CPI y/y', id: 'CPIAUCNS', reverse: false },
        { key: 'Unemployment Claims', id: 'ICSA', reverse: true }
    ];

    const trends = {};
    for (let series of seriesList) {
        const obs = await fetchLastObservations(series.id, 7);
        let positive = 0, negative = 0, neutral = 0;
        for (let val of obs) {
            const expKey = series.key.replace(/\s|\/|y|m/g,'').toUpperCase();
            const s = scoreNews(val, expectedValues[expKey], series.reverse);
            if (s === 1) positive++;
            else if (s === -1) negative++;
            else neutral++;
        }
        trends[series.key] = { positive, negative, neutral };
    }

    // --- Format Telegram message ---
    let message = '💹 *USD News Impact Summary*\n\n';
    for (const key in scores) {
        let val = scores[key];
        let text = val === 1 ? 'Higher than expected' : val === -1 ? 'Lower than expected' : 'As expected';
        message += `📊 ${key}: ${val} (${text})\n`;
    }
    message += `\n💵 Total Score: ${totalScore}\n${usdTrend}\n${cryptoTrend}\n\n`;

    message += '*📅 Last 1-week USD Trend:*\n';
    for (const key in trends) {
        const t = trends[key];
        message += `📊 ${key}: (${t.positive} positive, ${t.negative} negative, ${t.neutral} neutral)\n`;
    }
    message += `💵 Overall Trend: ${usdTrend}`;

    return message;
}

// Telegram command
bot.command('usdnews', async (ctx) => {
    ctx.reply('Fetching latest USD news...');
    const summary = await generateUsdSummary();
    ctx.replyWithMarkdown(summary);
});

// Express server
app.get('/', (req, res) => res.send('USD News Bot is running...'));
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// Launch bot safely
bot.launch({ dropPendingUpdates: true }).then(() => console.log('Telegram Bot started!'));

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
