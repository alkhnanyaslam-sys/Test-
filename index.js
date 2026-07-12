// index.js
// السكريبت الرئيسي. بيتشغل مرة واحدة (Cron)، ياخد الرسايل الجديدة بس،
// يعالجها، يقفل. مفيش bot.launch() ولا Long Polling — ده اللي بيمنع
// الـ 409 Conflict.

const { getOffset, saveOffset, loadUsers, saveUsers } = require("./db");
const { evaluateHelp } = require("./gemini");
const { getUpdates, sendMessage } = require("./telegram");
const { awardPoints } = require("./points");
const { isThankYouMessage } = require("./thanks");
const { handleCommand } = require("./commands");

const THANK_YOU_POINTS = 5;

const THANK_YOU_REASON =
  "🌟 حد قدّر مساعدتك وشكرك عليها، وده دليل إنك بتفرق فعلاً مع زمايلك.\n" +
  "استمر كده، كل مساعدة بتقرّبك خطوة لمستوى أقوى 💪";

async function processUpdate(update, users) {
  const msg = update.message;
  if (!msg) return;

  if (msg.text && msg.text.trim().startsWith("/")) {
    await handleCommand(msg, users);
    return;
  }

  if (!msg.text) return;
  if (!msg.reply_to_message || !msg.reply_to_message.text) return;
  if (msg.from.is_bot) return;
  if (msg.from.id === msg.reply_to_message.from.id) return;
  if (msg.reply_to_message.from.is_bot) return;

  const chatId = msg.chat.id;
  const originalAuthor = msg.reply_to_message.from;

  if (isThankYouMessage(msg.text)) {
    const { text } = await awardPoints({
      chatId,
      targetFrom: originalAuthor,
      pointsToAdd: THANK_YOU_POINTS,
      users,
      reasonText: THANK_YOU_REASON,
    });
    await sendMessage(chatId, text, msg.message_id);
    return;
  }

  let evaluation;
  try {
    evaluation = await evaluateHelp(msg.reply_to_message.text, msg.text);
  } catch (err) {
    console.error("⚠️ خطأ في تقييم Gemini:", err.message);
    return;
  }

  if (!evaluation.isHelp) return;

  const { text } = await awardPoints({
    chatId,
    targetFrom: msg.from,
    pointsToAdd: evaluation.quality,
    users,
  });

  await sendMessage(chatId, text, msg.message_id);
}

async function main() {
  if (!process.env.BOT_TOKEN) throw new Error("BOT_TOKEN مش موجود في الـ environment variables");
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY مش موجود");

  const offset = getOffset();
  const users = loadUsers();

  console.log(`📥 هجيب الرسايل الجديدة بداية من offset=${offset}`);
  const updates = await getUpdates(offset);
  console.log(`✅ لقيت ${updates.length} رسالة جديدة`);

  let lastUpdateId = offset;

  for (const update of updates) {
    try {
      await processUpdate(update, users);
    } catch (err) {
      console.error(`⚠️ خطأ في معالجة update ${update.update_id}:`, err.message);
    }
    lastUpdateId = update.update_id + 1;
  }

  saveUsers(users);
  saveOffset(lastUpdateId);

  console.log("💾 اتحفظت البيانات، هنعمل commit في الـ workflow");
}

main().catch((err) => {
  console.error("❌ خطأ عام:", err);
  process.exit(1);
});
