// index.js
// السكريبت ده مش بيعمل bot.launch() ولا Long Polling.
// بيجيب الرسايل الجديدة بس (getUpdates بـ offset محفوظ)، يعالجها، ويقفل.
// ده اللي بيمنع الـ 409 Conflict لأنه مفيش أكتر من عملية بتعمل Polling في نفس الوقت.

const {
  getOffset,
  saveOffset,
  loadUsers,
  saveUsers,
  addPoints,
} = require("./db");
const { evaluateHelp } = require("./gemini");
const { getLevelForPoints, getNextLevel } = require("./levels");

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
}

// بيهرّب الرموز الخاصة بـ HTML عشان أي اسم يوزر فيه &, <, > مايكسرش التنسيق
function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

// بيبني وسم tg-emoji للإيموجي المخصص (Custom Emoji). fallback هو إيموجي
// عادي بيتعرض في الأماكن اللي مبتدعمش Custom Emoji.
function customEmoji(emojiId, fallback) {
  return `<tg-emoji emoji-id="${emojiId}">${fallback}</tg-emoji>`;
}

// الإيموجي المخصص اللي هيتحطوا في رسالة التهنئة عند صعود مستوى جديد
const CELEBRATION_EMOJI_1 = "5433609082319708485";
const CELEBRATION_EMOJI_2 = "5229027828527309057";

// بيرقّي اليوزر لـ "أدمن" لكن بصلاحيات صفر بالكامل (شرط تليجرام الوحيد
// عشان يظهر Custom Title جنب الاسم). الشخص ده مبيقدرش يعمل أي حاجة إدارية.
async function promoteWithNoPermissions(chatId, userId) {
  const url = `${TELEGRAM_API}/promoteChatMember`;
  const body = {
    chat_id: chatId,
    user_id: userId,
    is_anonymous: false,
    can_manage_chat: false,
    can_delete_messages: false,
    can_manage_video_chats: false,
    can_restrict_members: false,
    can_promote_members: false,
    can_change_info: false,
    can_invite_users: false,
    can_pin_messages: false,
    can_post_messages: false,
    can_edit_messages: false,
    can_manage_topics: false,
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) {
    console.error("⚠️ فشل ترقية العضو (تأكد إن البوت أدمن وعنده صلاحية Add New Admins):", data);
    return false;
  }
  return true;
}

async function setCustomTitle(chatId, userId, customTitle) {
  const url = `${TELEGRAM_API}/setChatAdministratorCustomTitle`;
  const body = { chat_id: chatId, user_id: userId, custom_title: customTitle };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) {
    console.error("⚠️ فشل وضع الـ Custom Title:", data);
    return false;
  }
  return true;
}

function buildDisplayName(from) {
  if (from.username) return `@${from.username}`;
  return from.first_name || "المستخدم";
}

// بيبني منشن حقيقي بيشتغل حتى لو الشخص مالوش يوزرنيم عام
// (بيستخدم tg://user?id= فبيبعت له تنبيه فعلي في تليجرام)
function buildMention(from) {
  const name = escapeHtml(from.first_name || from.username || "المستخدم");
  return `<a href="tg://user?id=${from.id}">${name}</a>`;
}

async function processUpdate(update, users) {
  const msg = update.message;
  if (!msg || !msg.text) return;

  // لازم تكون رسالة رد على رسالة تانية
  if (!msg.reply_to_message || !msg.reply_to_message.text) return;

  // متديش نقاط لو اللي رد بوت (يمنع أي بوت تاني أو نسخة من نفس البوت من التلاعب)
  if (msg.from.is_bot) return;

  // متمنعش حد يدي نقاط لنفسه
  if (msg.from.id === msg.reply_to_message.from.id) return;

  // متديش نقاط لو الرد على بوت
  if (msg.reply_to_message.from.is_bot) return;

  // ملاحظة: لما اليوزر يوصل لمستوى جديد، البوت بيرقّيه لـ "أدمن" لكن
  // بصلاحيات صفر بالكامل (شرط تليجرام الوحيد لعرض Custom Title جنب الاسم)،
  // وبعدين بيحط التاج كـ Custom Title. الشخص ده مبيقدرش يعمل أي حاجة إدارية فعلية.

  const originalText = msg.reply_to_message.text;
  const replyText = msg.text;
  const chatId = msg.chat.id;

  let evaluation;
  try {
    evaluation = await evaluateHelp(originalText, replyText);
  } catch (err) {
    console.error("⚠️ خطأ في تقييم Gemini:", err.message);
    return;
  }

  if (!evaluation.isHelp) return;

  const helperId = msg.from.id;
  const helperName = buildDisplayName(msg.from);
  const mention = buildMention(msg.from);
  const pointsToAdd = evaluation.quality; // 1 لـ 3 نقاط حسب جودة المساعدة

  const userBefore = { ...(users[`${chatId}:${helperId}`] || { points: 0 }) };
  const oldLevel = getLevelForPoints(userBefore.points || 0);

  const user = addPoints(users, helperId, chatId, helperName, pointsToAdd);
  const newLevel = getLevelForPoints(user.points);

  // رسالة التهنئة الأساسية
  let thankText = `تهانينا تم إضافة ${pointsToAdd} نقاط في رصيدك: ${mention}\nسبب الإضافة أنك تساعد أصدقائك، إستمر في ذلك.`;

  // لو ترقى لمستوى جديد (أو أول مرة ياخد تاج)
  const leveledUp = (oldLevel?.level || 0) !== (newLevel?.level || 0);
  if (leveledUp && newLevel) {
    const emoji1 = customEmoji(CELEBRATION_EMOJI_1, "🎉");
    const emoji2 = customEmoji(CELEBRATION_EMOJI_2, "🏆");
    thankText += `\n\n${emoji1} مبروك! وصلت لمستوى جديد: ${escapeHtml(newLevel.tag)} ${emoji2}`;

    // نرقّي اليوزر بصلاحيات صفر بالكامل، وبعدين نحط التاج جنب اسمه
    const promoted = await promoteWithNoPermissions(chatId, helperId);
    if (promoted) {
      await setCustomTitle(chatId, helperId, newLevel.customTitle);
    } else {
      thankText +=
        "\n⚠️ (البوت مش قادر يحط التاج جنب الاسم دلوقتي — تأكدوا إن البوت أدمن وعنده صلاحية Add New Admins)";
    }
  } else {
    const next = getNextLevel(user.points);
    if (next) {
      const remaining = next.minPoints - user.points;
      thankText += `\nباقيلك ${remaining} نقطة للوصول لـ ${escapeHtml(next.tag)}`;
    }
  }

  await sendMessage(chatId, thankText, msg.message_id);
}

async function main() {
  if (!BOT_TOKEN) throw new Error("BOT_TOKEN مش موجود في الـ environment variables");
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
