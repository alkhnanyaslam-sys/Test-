// gemini.js
// بيستخدم Gemini API عشان يحكم: هل الرسالة الأصلية سؤال محتاج مساعدة؟
// وهل الرد اللي جه عليها فعلاً إجابة/مساعدة حقيقية؟

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

// ---- إعدادات التحكم في معدل الطلبات ----
const MIN_INTERVAL_MS = 13000; // أقل مسافة بين كل طلب والتاني
const MAX_RETRIES = 2; // أقصى عدد محاولات إضافية بعد المحاولة الأولى
const MAX_RETRY_WAIT_MS = 20000; // سقف الانتظار لكل محاولة، عشان محاولة واحدة متاكلش وقت التشغيلة كله

let lastCallTime = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRateLimit() {
  const now = Date.now();
  const elapsed = now - lastCallTime;
  if (elapsed < MIN_INTERVAL_MS) {
    await sleep(MIN_INTERVAL_MS - elapsed);
  }
  lastCallTime = Date.now();
}

// بيدور على أول object JSON صحيح في النص حتى لو فيه كلام زيادة حواليه
function extractJson(text) {
  const cleaned = text.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch (_) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (_) {
        return null;
      }
    }
    return null;
  }
}

// بيدور على الوقت اللي جوجل نفسها بتقترحه في رسالة الخطأ
// (مثال: "Please retry in 15.897581271s.") ويرجعه بالميلي ثانية
function extractSuggestedDelayMs(errText) {
  const match = errText.match(/retry in ([\d.]+)s/i);
  if (match) {
    const seconds = parseFloat(match[1]);
    if (Number.isFinite(seconds)) return Math.ceil(seconds * 1000);
  }
  return null;
}

async function callGeminiOnce(prompt) {
  await waitForRateLimit();

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 1000 },
  };

  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    const err = new Error(`Gemini API error (${res.status}): ${errText}`);
    err.status = res.status;
    err.rawText = errText;
    throw err;
  }

  const data = await res.json();
  const candidate = data?.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text?.trim() || "";

  return { text, finishReason: candidate?.finishReason };
}

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

  let lastError = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { text, finishReason } = await callGeminiOnce(prompt);

      if (!text) {
        console.error(
          `⚠️ رد Gemini فاضي (finishReason: ${finishReason || "غير معروف"})`
        );
        return { isHelp: false, quality: 0, reason: "رد فاضي من Gemini" };
      }

      const parsed = extractJson(text);

      if (!parsed) {
        console.error("⚠️ فشل تحليل رد Gemini:", text);
        return { isHelp: false, quality: 0, reason: "تعذر التقييم" };
      }

      return {
        isHelp: !!parsed.isHelp,
        quality: [1, 2, 3].includes(parsed.quality) ? parsed.quality : 1,
        reason: parsed.reason || "",
      };
    } catch (err) {
      lastError = err;

      if (err.status === 429 && attempt < MAX_RETRIES) {
        const suggested = extractSuggestedDelayMs(err.rawText || "");
        // بنستخدم رقم جوجل نفسها لو موجود، وإلا بديل ثابت، وبنحط سقف
        // أقصى عشان رسالة واحدة متاكلش وقت التشغيلة كله
        const wait = Math.min(suggested || 10000, MAX_RETRY_WAIT_MS);
        console.warn(
          `⏳ Gemini rate limit (429)، إعادة محاولة بعد ${Math.round(
            wait / 1000
          )} ثانية... (محاولة ${attempt + 1}/${MAX_RETRIES})`
        );
        await sleep(wait);
        continue;
      }

      break;
    }
  }

  console.error("⚠️ خطأ في تقييم Gemini:", lastError?.message || lastError);
  return { isHelp: false, quality: 0, reason: "تعذر التقييم" };
}

module.exports = { evaluateHelp };
