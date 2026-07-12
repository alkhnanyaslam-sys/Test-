// points.js
// منطق مشترك: إضافة نقاط + بناء رسالة التهنئة بشكل مرتب + تاج لو صعد مستوى
// (من غير أي ترقية — العضو بيفضل عضو عادي).
// مستخدم من: التقييم التلقائي (Gemini)، كشف رسائل الشكر، وأوامر الأونر.

const { addPoints } = require("./db");
const { getLevelForPoints, getNextLevel } = require("./levels");
const {
  escapeHtml,
  customEmoji,
  buildMention,
  setMemberTag,
} = require("./telegram");

const CELEBRATION_EMOJI_1 = "5433609082319708485";
const CELEBRATION_EMOJI_2 = "5229027828527309057";

const DEFAULT_REASON =
  "لقد قمت بإرسال معلومة صحيحة وساعدت زملائك، جزاك الله خيرًا.\n" +
  "تابع واستمر في مساعدة أصدقائك لتحصل على LVL قوي‼️";

async function awardPoints({ chatId, targetFrom, pointsToAdd, users, reasonText }) {
  const targetId = targetFrom.id;
  const displayName = targetFrom.username
    ? `@${targetFrom.username}`
    : targetFrom.first_name || "المستخدم";
  const mention = buildMention(targetFrom);

  const before = { ...(users[`${chatId}:${targetId}`] || { points: 0 }) };
  const oldLevel = getLevelForPoints(before.points || 0);

  const user = addPoints(users, targetId, chatId, displayName, pointsToAdd);
  const newLevel = getLevelForPoints(user.points);

  const reason = escapeHtml(reasonText || DEFAULT_REASON);

  let text =
    `✅ <b>تم إضافة ${pointsToAdd} نقاط في رصيد</b>\n` +
    `🌱 ${mention}\n\n` +
    `<blockquote>${reason}</blockquote>`;

  const leveledUp = (oldLevel?.level || 0) !== (newLevel?.level || 0);
  if (leveledUp && newLevel) {
    const emoji1 = customEmoji(CELEBRATION_EMOJI_1, "🎉");
    const emoji2 = customEmoji(CELEBRATION_EMOJI_2, "🏆");
    text += `\n\n${emoji1} مبروك! وصلت لمستوى جديد: <b>${escapeHtml(newLevel.tag)}</b> ${emoji2}`;

    const tagged = await setMemberTag(chatId, targetId, newLevel.customTitle);
    if (!tagged) {
      text +=
        "\n⚠️ (البوت مش قادر يحط التاج دلوقتي — تأكدوا إن البوت أدمن وعنده صلاحية Edit Member Tags)";
    }
  } else {
    const next = getNextLevel(user.points);
    if (next) {
      const remaining = next.minPoints - user.points;
      text += `\n\n📊 باقيلك <b>${remaining}</b> نقطة للوصول لـ ${escapeHtml(next.tag)}`;
    }
  }

  return { text, user, leveledUp, newLevel };
}

module.exports = { awardPoints };
