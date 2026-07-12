// gemini.js
// بيستخدم Gemini API عشان يحكم: هل الرسالة الأصلية سؤال محتاج مساعدة؟
// وهل الرد اللي جه عليها فعلاً إجابة/مساعدة حقيقية؟

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";

const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

async function evaluateHelp(originalMessage, replyMessage) {
  const prompt = `
انت حكم في جروب تليجرام. مهمتك تحدد بس هل الرسالة التانية (الرد) بتمثل "مساعدة حقيقية" على الرسالة الأولى (سؤال/مشكلة).

الرسالة الأولى (المفروض تكون سؤال أو مشكلة):
"""${originalMessage}"""

الرد عليها:
"""${replyMessage}"""

قيّم الموقف ورد بصيغة JSON فقط بدون أي كلام تاني وبدون Markdown، بالشكل ده بالظبط:
{"isHelp": true/false, "quality": 1/2/3, "reason": "سبب قصير جدا بالعربي"}

قواعد التقييم:
- لو الرسالة الأولى مش سؤال ولا فيها مشكلة أصلا (كلام عادي/تحية/دردشة) -> isHelp: false
- لو الرد مجرد "تمام" أو "ماشي" أو رموز تعبيرية أو مالوش علاقة بالسؤال خالص -> isHelp: false
- **مهم**: لو الرد بيدي إجابة مباشرة للسؤال حتى لو كلمة أو رقم واحد بس
  (مثال: السؤال "الإجابة كام؟" والرد "D" أو "45" أو "لأ")، ده يعتبر مساعدة حقيقية
  -> isHelp: true, quality: 1. مش شرط الرد يكون طويل أو فيه شرح عشان ياخد نقاط.
- لو الرد إجابة واضحة وفيها شرح بسيط -> isHelp: true, quality: 2
- لو الرد إجابة شاملة ومفصلة وحلت المشكلة فعليا -> isHelp: true, quality: 3
`.trim();

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 200 },
  };

  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const text =
    data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";

  const cleaned = text.replace(/```json|```/g, "").trim();

  try {
    const parsed = JSON.parse(cleaned);
    return {
      isHelp: !!parsed.isHelp,
      quality: [1, 2, 3].includes(parsed.quality) ? parsed.quality : 1,
      reason: parsed.reason || "",
    };
  } catch (err) {
    console.error("⚠️ فشل تحليل رد Gemini:", cleaned);
    return { isHelp: false, quality: 0, reason: "تعذر التقييم" };
  }
}

module.exports = { evaluateHelp };
