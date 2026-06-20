const axios = require("axios");

async function telegramMesajGonder(chatId, mesaj) {
    const token = process.env.TELEGRAM_BOT_TOKEN;

    if (!token) {
        throw new Error("TELEGRAM_BOT_TOKEN bulunamadı.");
    }

    const url = `https://api.telegram.org/bot${token}/sendMessage`;

    try {
        await axios.post(url, {
            chat_id: chatId,
            text: mesaj
        });

        console.log("Telegram mesajı gönderildi.");
    } catch (err) {
        console.error("Telegram hatası:", err.response?.data || err.message);
        throw err;
    }
}

module.exports = telegramMesajGonder;