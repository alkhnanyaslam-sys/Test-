// index.js
// السكريبت الرئيسي. بيشتغل جوه الـ workflow لمدة كام دقيقة (مش تشغيلة
// واحدة وخلاص)، وبيستخدم Long Polling طول الفترة دي عشان الأوامر
// والرسايل تتنفذ لحظيًا تقريبًا. لسه مفيش bot.launch() ولا استعلامات
// من غير حدود — كل حاجة بتقف لوحدها قبل ما الـ job يتقفل، فمفيش خطر
// 409 Conflict مع تشغيلة تانية.

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

// الـ workflow بيتشغل كل 5 دقايق (300 ثانية). بنسيب هامش أمان كويس
// عشان الـ job يقفل قبل ما التشغيلة الجاية تيجي، ومايحصلش تراكم.
const TOTAL_BUDGET_MS = 4.5 * 60 * 1000; // 4 دقايق ونص
const LONG_POLL_SECONDS = 25; // مدة انتظار تليجرام لكل استعلام (long polling)

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

  let offset = getOffset();
  const users = loadUsers();

  const startTime = Date.now();
  let totalUpdates = 0;
  let cycles = 0;

  console.log(`📥 هبدأ الاستماع اللحظي بداية من offset=${offset}`);

  while (Date.now() - startTime < TOTAL_BUDGET_MS) {
    cycles++;

    // نحسب أقصى وقت ممكن نستنى فيه في الاستعلام ده من غير ما نتخطى
    // الميزانية الكلية بتاعة الـ job
    const remainingMs = TOTAL_BUDGET_MS - (Date.now() - startTime);
    const pollSeconds = Math.max(1, Math.min(LONG_POLL_SECONDS, Math.floor(remainingMs / 1000)));

    let updates;
    try {
      updates = await getUpdates(offset, pollSeconds);
    } catch (err) {
      console.error("⚠️ خطأ في getUpdates:", err.message);
      // لو حصل خطأ شبكة مؤقت، ناخد نفس قصير ونحاول تاني بدل ما نوقف الجوب كله
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }

    if (updates.length > 0) {
      totalUpdates += updates.length;
      console.log(`✅ لقيت ${updates.length} رسالة جديدة (دورة ${cycles})`);
    }

    for (const update of updates) {
      try {
        await processUpdate(update, users);
      } catch (err) {
        console.error(`⚠️ خطأ في معالجة update ${update.update_id}:`, err.message);
      }
      offset = update.update_id + 1;
    }

    // بنحفظ بعد كل دورة (مش بس في الآخر) عشان لو الجوب اتقفل فجأة
    // (timeout أو إلغاء)، أقل قد ما يتفقد من التقدم
    if (updates.length > 0) {
      saveUsers(users);
      saveOffset(offset);
    }
  }

  console.log(`💾 خلصت الميزانية الزمنية بعد ${cycles} دورة، إجمالي ${totalUpdates} رسالة. هيتعمل commit في الـ workflow`);
}

main().catch((err) => {
  console.error("❌ خطأ عام:", err);
  process.exit(1);
});
