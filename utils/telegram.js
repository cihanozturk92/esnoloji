const axios = require("axios");

async function telegramMesajGonder(chatId, mesaj) {
    try {
        await axios.post(
            `https://api.telegram.org/bot${process.env.8639972700:AAGq6jBaoyVCx1zti9sxYBdK1S9Z5FPbqT0}/sendMessage`,
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