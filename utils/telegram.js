const axios = require("axios");

async function telegramMesajGonder(chatId, mesaj) {
    try {
        await axios.post(
            `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
            {
                chat_id: chatId,
                text: mesaj
            }
        );

        console.log("Telegram mesajı gönderildi.");
    } catch (err) {
        console.error("Telegram hatası:", err.message);
    }
}

module.exports = telegramMesajGonder;