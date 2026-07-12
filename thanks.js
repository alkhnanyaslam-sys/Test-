// thanks.js
// كشف بسيط (Regex) لرسائل الشكر. لو حد رد على حد بـ "شكراً" أو أي صيغة
// شكر، إحنا مش بنستهلك طلب Gemini في الحالة دي، وبنديل النقاط لصاحب
// الرسالة الأصلية (اللي اتشكر) مش للشخص اللي بيشكر.

const THANKS_PATTERNS = [
  /شكرا/i,
  /شكراً/i,
  /متشكر/i,
  /متشكرين/i,
  /تسلم/i,
  /تسلموا/i,
  /يعطيك العافيه/i,
  /يعطيك العافية/i,
  /جزاك الله خير/i,
  /جزاكم الله خير/i,
  /مشكور/i,
  /ربنا يخليك/i,
  /\bthanks\b/i,
  /\bthank you\b/i,
  /\bthx\b/i,
  /\bty\b/i,
];

const MAX_WORDS_FOR_PURE_THANKS = 6;

function isThankYouMessage(text) {
  if (!text) return false;
  const trimmed = text.trim();
  const hasThanksWord = THANKS_PATTERNS.some((re) => re.test(trimmed));
  if (!hasThanksWord) return false;

  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  return wordCount <= MAX_WORDS_FOR_PURE_THANKS;
}

module.exports = { isThankYouMessage };
