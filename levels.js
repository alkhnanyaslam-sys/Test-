// levels.js
// نظام المستويات: من LV1 لغايه LV10
// كل مستوى محتاج 50 نقطة زيادة عن اللي قبله (LV1=50, LV2=100, ... LV10=500)
// tag: بيتستخدم في رسالة التهنئة (فيها إيموجي)
// customTitle: بيتستخدم كـ Tag جنب اسم العضو في تليجرام (عن طريق
// setChatMemberTag) — العضو بيفضل عضو عادي 100%، من غير أي ترقية.

const POINTS_PER_LEVEL = 50;

const LEVELS = [
  { level: 1, minPoints: POINTS_PER_LEVEL * 1, tag: "🥉 LV1", customTitle: "LV1" },
  { level: 2, minPoints: POINTS_PER_LEVEL * 2, tag: "🥉 LV2", customTitle: "LV2" },
  { level: 3, minPoints: POINTS_PER_LEVEL * 3, tag: "🥈 LV3", customTitle: "LV3" },
  { level: 4, minPoints: POINTS_PER_LEVEL * 4, tag: "🥈 LV4", customTitle: "LV4" },
  { level: 5, minPoints: POINTS_PER_LEVEL * 5, tag: "🥈 LV5", customTitle: "LV5" },
  { level: 6, minPoints: POINTS_PER_LEVEL * 6, tag: "🥇 LV6", customTitle: "LV6" },
  { level: 7, minPoints: POINTS_PER_LEVEL * 7, tag: "🥇 LV7", customTitle: "LV7" },
  { level: 8, minPoints: POINTS_PER_LEVEL * 8, tag: "🥇 LV8", customTitle: "LV8" },
  { level: 9, minPoints: POINTS_PER_LEVEL * 9, tag: "💎 LV9", customTitle: "LV9" },
  { level: 10, minPoints: POINTS_PER_LEVEL * 10, tag: "👑 LV10", customTitle: "LV10" },
];

function getLevelForPoints(points) {
  let current = null;
  for (const lvl of LEVELS) {
    if (points >= lvl.minPoints) {
      current = lvl;
    } else {
      break;
    }
  }
  return current;
}

function getNextLevel(points) {
  for (const lvl of LEVELS) {
    if (points < lvl.minPoints) {
      return lvl;
    }
  }
  return null;
}

module.exports = { LEVELS, getLevelForPoints, getNextLevel, POINTS_PER_LEVEL };
