// levels.js
// نظام المستويات: من L1 لغايه L10
// tag: بيتستخدم في رسالة الشكر النصية (فيها إيموجي)
// customTitle: بيتستخدم كـ Custom Title جنب الاسم في تليجرام
//   ملاحظة: تليجرام مبيسمحش بإيموجي في الـ custom title، وأقصى طول 16 حرف

const LEVELS = [
  { level: 1, minPoints: 1, tag: "🥉 L1", customTitle: "L1" },
  { level: 2, minPoints: 5, tag: "🥉 L2", customTitle: "L2" },
  { level: 3, minPoints: 12, tag: "🥈 L3", customTitle: "L3" },
  { level: 4, minPoints: 22, tag: "🥈 L4", customTitle: "L4" },
  { level: 5, minPoints: 35, tag: "🥈 L5", customTitle: "L5" },
  { level: 6, minPoints: 55, tag: "🥇 L6", customTitle: "L6" },
  { level: 7, minPoints: 80, tag: "🥇 L7", customTitle: "L7" },
  { level: 8, minPoints: 110, tag: "🥇 L8", customTitle: "L8" },
  { level: 9, minPoints: 150, tag: "💎 L9", customTitle: "L9" },
  { level: 10, minPoints: 200, tag: "👑 L10", customTitle: "L10" },
];

// بيرجع أعلى مستوى وصله المستخدم بناءً على نقاطه
function getLevelForPoints(points) {
  let current = null;
  for (const lvl of LEVELS) {
    if (points >= lvl.minPoints) {
      current = lvl;
    } else {
      break;
    }
  }
  return current; // ممكن يكون null لو النقاط لسه 0
}

// بيرجع تفاصيل المستوى الجاي (عشان نعرض "باقي كام نقطة")
function getNextLevel(points) {
  for (const lvl of LEVELS) {
    if (points < lvl.minPoints) {
      return lvl;
    }
  }
  return null; // يبقى وصل لأعلى مستوى (L10)
}

module.exports = { LEVELS, getLevelForPoints, getNextLevel };
