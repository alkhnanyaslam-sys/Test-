// telegram.js
// كل الدوال اللي بتتكلم مع Telegram Bot API، مجمّعة في مكان واحد
// عشان index.js و commands.js يقدروا يستخدموها من غير تكرار كود.

const BOT_TOKEN = process.env.BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function getUpdates(offset) {
  const allowedUpdates = encodeURIComponent(JSON.stringify(["message"]));
  const url = `${TELEGRAM_API}/getUpdates?offset=${offset}&timeout=0&allowed_updates=${allowedUpdates}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram getUpdates error: ${JSON.stringify(data)}`);
  return data.result;
}

async function sendMessage(chatId, text, replyToMessageId) {
  const url = `${TELEGRAM_API}/sendMessage`;
  const body = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_to_message_id: replyToMessageId,
    allow_sending_without_reply: true,
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) console.error("⚠️ فشل إرسال رسالة:", data);
  return data.ok;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function customEmoji(emojiId, fallback) {
  return `<tg-emoji emoji-id="${emojiId}">${fallback}</tg-emoji>`;
}

function buildDisplayName(from) {
  if (from.username) return `@${from.username}`;
  return from.first_name || "المستخدم";
}

function buildMention(from) {
  const name = escapeHtml(from.first_name || from.username || "المستخدم");
  return `<a href="tg://user?id=${from.id}">${name}</a>`;
}

// تليجرام ضاف method جديد اسمه setChatMemberTag: بيدي لقب (Tag) لعضو
// عادي في الجروب من غير ما يترفع أدمن خالص. الشرط الوحيد إن "البوت نفسه"
// (مش العضو) يبقى أدمن وعنده صلاحية can_manage_tags بس (اسمها في واجهة
// تليجرام "Edit Member Tags"). العضو نفسه بيفضل عضو عادي 100%.
async function setMemberTag(chatId, userId, tag) {
  const url = `${TELEGRAM_API}/setChatMemberTag`;
  const body = { chat_id: chatId, user_id: userId, tag };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) {
    console.error(
      "⚠️ فشل وضع التاج (تأكد إن البوت أدمن وعنده صلاحية Edit Member Tags):",
      data
    );
    return false;
  }
  return true;
}

async function removeMemberTag(chatId, userId) {
  return setMemberTag(chatId, userId, "");
}

module.exports = {
  getUpdates,
  sendMessage,
  escapeHtml,
  customEmoji,
  buildDisplayName,
  buildMention,
  setMemberTag,
  removeMemberTag,
};
