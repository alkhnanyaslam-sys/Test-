// index.js
// السكريبت الرئيسي. بيشتغل جوه الـ workflow لمدة كام دقيقة (مش تشغيلة
// واحدة وخلاص)، وبيستخدم Long Polling طول الفترة دي عشان الأوامر
// والرسايل تتنفذ لحظيًا تقريبًا.
//
// مهم: الأوامر (زي أوامر الأونر، سواء في الجروب أو الخاص) بتتاخد
// أولوية مطلقة — بتتنفذ في أول باس فورًا، قبل أي محاولة تقييم مع
// Gemini. كده لو حصل تأخير أو rate limit مع Gemini، الأوامر برضو
// بترد على طول ومش بتستنى الدور.

const { getOffset, saveOffset, loadUsers, saveUsers } = require("./db");
const { evaluateHelp } = require("./gemini");
const { getUpdates, sendMessage } = require("./telegram");
const { awardPoints } = require("./points");
const { isThankYouMessage } = require("./thanks");
const { handleCommand } = require("./commands");

const THANK_YOU_POINTS = 5;
const HELP_POINTS = 5;

const THANK_YOU_REASON =
  "🌟 حد قدّر مساعدتك وشكرك عليها، وده دليل إنك بتفرق فعلاً مع زمايلك.\n" +
  "استمر كده، كل مساعدة بتقرّبك خطوة لمستوى أقوى 💪";

// الـ workflow بيتشغل كل 5 دقايق. بنسيب هامش أمان عشان الـ job يقفل
// قبل ما التشغيلة الجاية تيجي، ومايحصلش تراكم أو تعارض.
const TOTAL_BUDGET_MS = 4.5 * 60 * 1000; // 4 دقايق ونص
const LONG_POLL_SECONDS = 25; // مدة انتظار تليجرام لكل استعلام (long polling)
const SAFETY_MARGIN_MS = 15000; // بنوقف المعالجة قبل نهاية الميزانية بـ 15 ثانية

function isCommandMessage(msg) {
  return !!(msg && msg.text && msg.text.trim().startsWith("/"));
}

async function processNonCommandMessage(msg, users) {
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
    pointsToAdd: HELP_POINTS,
    users,
  });

  await sendMessage(chatId, text, msg.message_id);
}

// بيعالج دفعة الرسايل اللي رجعت من استعلام واحد. بيرجع الـ offset
// الجديد (آخر update_id اتعالج فعليًا + 1).
async function processBatch(updates, users, currentOffset, startTime) {
  let offset = currentOffset;

  // باس أول: أي رسالة أمر (تبدأ بـ /) بتتاخد فورًا، بغض النظر عن
  // ترتيبها، لإنها سريعة ومفيهاش انتظار مع Gemini.
  const handledIds = new Set();
  for (const update of updates) {
    const msg = update.message;
    if (isCommandMessage(msg)) {
      try {
        await handleCommand(msg, users);
      } catch (err) {
        console.error(`⚠️ خطأ في تنفيذ أمر (update ${update.update_id}):`, err.message);
      }
      handledIds.add(update.update_id);
    }
  }

  // باس تاني: بترتيب وصول الرسايل الأصلي، عشان الـ offset يتقدم صح
  // وأي رسالة اتأجلت بسبب الوقت تفضل موجودة للمرة الجاية.
  for (const update of updates) {
    if (handledIds.has(update.update_id)) {
      offset = update.update_id + 1;
      continue;
    }

    const remaining = TOTAL_BUDGET_MS - (Date.now() - startTime);
    if (remaining < SAFETY_MARGIN_MS) {
      console.log("⏸️ الوقت المتاح خلص، هنكمل الباقي في التشغيلة الجاية");
      break;
    }

    const msg = update.message;
    if (msg) {
      try {
        await processNonCommandMessage(msg, users);
      } catch (err) {
        console.error(`⚠️ خطأ في معالجة update ${update.update_id}:`, err.message);
      }
    }
    offset = update.update_id + 1;
  }

  return offset;
}

async function main() {
  if (!process.env.BOT_TOKEN) throw new Error("BOT_TOKEN مش موجود في الـ environment variables");
  if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY مش موجود");

  let offset = getOffset();
  const users = loadUsers();

  const startTime = Date.now();
  let totalUpdates = 0;
  let cycles = 0;

  console.log(`📥 هبدأ الاستماع اللحظي بداية من offset=${offset}`);

  while (Date.now() - startTime < TOTAL_BUDGET_MS) {
    cycles++;

    const remainingMs = TOTAL_BUDGET_MS - (Date.now() - startTime);
    const pollSeconds = Math.max(1, Math.min(LONG_POLL_SECONDS, Math.floor(remainingMs / 1000)));

    let updates;
    try {
      updates = await getUpdates(offset, pollSeconds);
    } catch (err) {
      console.error("⚠️ خطأ في getUpdates:", err.message);
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }

    if (updates.length > 0) {
      totalUpdates += updates.length;
      console.log(`✅ لقيت ${updates.length} رسالة جديدة (دورة ${cycles})`);

      offset = await processBatch(updates, users, offset, startTime);

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
