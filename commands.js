// commands.js
// أوامر خاصة بالأونر بس. أي حد تاني يبعت أمر منها بيتجاهل بهدوء
// (أو ياخد رسالة "مش مسموحلك") من غير ما ياخد أي تأثير فعلي.

const { getLeaderboard } = require("./db");
const { LEVELS, getLevelForPoints, getNextLevel } = require("./levels");
const {
  sendMessage,
  buildMention,
  escapeHtml,
  removeMemberTag,
} = require("./telegram");
const { awardPoints } = require("./points");

const OWNER_ID = 8355232956;

function isOwner(userId) {
  return Number(userId) === OWNER_ID;
}

function parseAmount(arg, fallback = 1) {
  const n = parseInt(arg, 10);
  return Number.isFinite(n) ? n : fallback;
}

async function handleCommand(msg, users) {
  const chatId = msg.chat.id;
  const [rawCommand, ...args] = msg.text.trim().split(/\s+/);
  const command = rawCommand.split("@")[0].toLowerCase();

  const ownerCommands = [
    "/addpoints",
    "/removepoints",
    "/setpoints",
    "/resetuser",
    "/setlevel",
    "/removetag",
    "/leaderboard",
    "/userstats",
    "/ownerhelp",
  ];

  if (!ownerCommands.includes(command)) return;

  if (!isOwner(msg.from.id)) {
    await sendMessage(chatId, "⛔ الأمر ده للأونر بس.", msg.message_id);
    return;
  }

  const target = msg.reply_to_message?.from;

  switch (command) {
    case "/ownerhelp": {
      const text =
        "📋 أوامر الأونر (رد على رسالة الشخص المطلوب، ما عدا /leaderboard):\n\n" +
        "/addpoints [عدد] — إضافة نقاط (افتراضي 1)\n" +
        "/removepoints [عدد] — خصم نقاط (افتراضي 1)\n" +
        "/setpoints [عدد] — تثبيت رصيد النقاط على رقم معين\n" +
        "/resetuser — تصفير رصيد الشخص بالكامل\n" +
        "/setlevel [1-10] — تثبيت مستوى معين مباشرة\n" +
        "/removetag — شيل التاج من الشخص\n" +
        "/userstats — عرض بيانات الشخص (أو بياناتك لو من غير رد)\n" +
        "/leaderboard — أعلى 10 في الجروب";
      await sendMessage(chatId, text, msg.message_id);
      return;
    }

    case "/leaderboard": {
      const top = getLeaderboard(users, chatId, 10);
      if (top.length === 0) {
        await sendMessage(chatId, "لسه مفيش حد أخد نقاط في الجروب ده.", msg.message_id);
        return;
      }
      const lines = top.map((u, i) => {
        const lvl = getLevelForPoints(u.points);
        const tag = lvl ? ` (${escapeHtml(lvl.tag)})` : "";
        return `${i + 1}. ${escapeHtml(u.username || "مستخدم")} — ${u.points} نقطة${tag}`;
      });
      await sendMessage(chatId, `🏆 <b>Top 10</b>\n\n${lines.join("\n")}`, msg.message_id);
      return;
    }

    case "/userstats": {
      const person = target || msg.from;
      const key = `${chatId}:${person.id}`;
      const data = users[key];
      if (!data) {
        await sendMessage(chatId, `${buildMention(person)} لسه ملوش نقاط مسجلة.`, msg.message_id);
        return;
      }
      const lvl = getLevelForPoints(data.points);
      const next = getNextLevel(data.points);
      let text = `📊 إحصائيات ${buildMention(person)}\nالنقاط: ${data.points}\nعدد المساعدات: ${data.helpCount}\nالمستوى الحالي: ${lvl ? escapeHtml(lvl.tag) : "مفيش لسه"}`;
      if (next) {
        text += `\nباقي ${next.minPoints - data.points} نقطة لـ ${escapeHtml(next.tag)}`;
      }
      await sendMessage(chatId, text, msg.message_id);
      return;
    }

    case "/resetuser": {
      if (!target) {
        await sendMessage(chatId, "⚠️ لازم ترد على رسالة الشخص المطلوب تصفير رصيده.", msg.message_id);
        return;
      }
      const key = `${chatId}:${target.id}`;
      if (users[key]) {
        users[key].points = 0;
        users[key].helpCount = 0;
      }
      await sendMessage(
        chatId,
        `✅ اتصفر رصيد ${buildMention(target)} بالكامل.\n⚠️ ملاحظة: التاج اللي أخده قبل كده جنب اسمه في تليجرام مش بيتشال تلقائي — لو عايز تشيله استخدم /removetag.`,
        msg.message_id
      );
      return;
    }

    case "/removetag": {
      if (!target) {
        await sendMessage(chatId, "⚠️ لازم ترد على رسالة الشخص المطلوب شيل التاج منه.", msg.message_id);
        return;
      }
      const ok = await removeMemberTag(chatId, target.id);
      await sendMessage(
        chatId,
        ok
          ? `✅ اتشال التاج من ${buildMention(target)}.`
          : "⚠️ فشلت العملية — تأكد إن البوت أدمن وعنده صلاحية Edit Member Tags.",
        msg.message_id
      );
      return;
    }

    case "/addpoints":
    case "/removepoints":
    case "/setpoints": {
      if (!target) {
        await sendMessage(chatId, "⚠️ لازم ترد على رسالة الشخص المطلوب تعديل نقاطه.", msg.message_id);
        return;
      }
      if (target.is_bot) {
        await sendMessage(chatId, "⚠️ مينفعش تدّي بوت نقاط.", msg.message_id);
        return;
      }

      const key = `${chatId}:${target.id}`;
      const currentPoints = users[key]?.points || 0;
      let delta;

      if (command === "/addpoints") {
        delta = parseAmount(args[0], 1);
      } else if (command === "/removepoints") {
        delta = -Math.abs(parseAmount(args[0], 1));
        if (currentPoints + delta < 0) delta = -currentPoints;
      } else {
        const targetPoints = parseAmount(args[0], currentPoints);
        delta = targetPoints - currentPoints;
      }

      const { text } = await awardPoints({
        chatId,
        targetFrom: target,
        pointsToAdd: delta,
        users,
        reasonText: "تم تعديل رصيدك يدوياً بواسطة إدارة الجروب.",
      });
      await sendMessage(chatId, text, msg.message_id);
      return;
    }

    case "/setlevel": {
      if (!target) {
        await sendMessage(chatId, "⚠️ لازم ترد على رسالة الشخص المطلوب تثبيت مستواه.", msg.message_id);
        return;
      }
      const levelNum = parseInt(args[0], 10);
      const targetLevel = LEVELS.find((l) => l.level === levelNum);
      if (!targetLevel) {
        await sendMessage(chatId, "⚠️ اكتب رقم مستوى من 1 لـ 10 (مثال: /setlevel 5)", msg.message_id);
        return;
      }

      const key = `${chatId}:${target.id}`;
      const currentPoints = users[key]?.points || 0;
      const delta = targetLevel.minPoints - currentPoints;

      const { text } = await awardPoints({
        chatId,
        targetFrom: target,
        pointsToAdd: delta,
        users,
        reasonText: "تم تثبيت مستواك يدوياً بواسطة إدارة الجروب.",
      });
      await sendMessage(chatId, text, msg.message_id);
      return;
    }
  }
}

module.exports = { handleCommand, isOwner, OWNER_ID };
