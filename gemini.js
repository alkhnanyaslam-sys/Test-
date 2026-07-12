// gemini.js
// بيستخدم Groq API (سريع جدًا ومجاني، كوتة 14,400 طلب/يوم) عشان يحكم:
// هل الرسالة الأصلية سؤال محتاج مساعدة؟ وهل الرد اللي جه عليها فعلاً
// إجابة/مساعدة حقيقية؟
// (اسم الملف فضل زي ما هو عشان باقي الملفات مش محتاجة تتغير)

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.1-8b-instant";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

// ---- إعدادات التحكم في معدل الطلبات ----
// الفري تير بتاع Groq: 30 طلب/دقيقة و 14,400 طلب/يوم لموديل llama-3.1-8b
const MIN_INTERVAL_MS = 2200; // أقل مسافة بين كل طلب والتاني (~27 طلب/دقيقة)
const MAX_RETRIES = 2;
const MAX_RETRY_WAIT_MS = 15000;

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

function extractSuggestedDelayMs(errText) {
  const match = errText.match(/retry.*?([\d.]+)\s*s/i);
  if (match) {
    const seconds = parseFloat(match[1]);
    if (Number.isFinite(seconds)) return Math.ceil(seconds * 1000);
  }
  return null;
}

function isDailyQuotaError(errText) {
  return /day|daily/i.test(errText || "");
}

async function callGroqOnce(prompt) {
  await waitForRateLimit();

  const body = {
    model: GROQ_MODEL,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.2,
    max_tokens: 300,
  };

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    const err = new Error(`Groq API error (${res.status}): ${errText}`);
    err.status = res.status;
    err.rawText = errText;
    throw err;
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content?.trim() || "";
  const finishReason = data?.choices?.[0]?.finish_reason;

  return { text, finishReason };
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

رد بـ JSON بس، من غير أي شرح إضافي.
`.trim();

  let lastError = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { text, finishReason } = await callGroqOnce(prompt);

      if (!text) {
        console.error(
          `⚠️ رد Groq فاضي (finishReason: ${finishReason || "غير معروف"})`
        );
        return { isHelp: false, quality: 0, reason: "رد فاضي من Groq" };
      }

      const parsed = extractJson(text);

      if (!parsed) {
        console.error("⚠️ فشل تحليل رد Groq:", text);
        return { isHelp: false, quality: 0, reason: "تعذر التقييم" };
      }

      return {
        isHelp: !!parsed.isHelp,
        quality: [1, 2, 3].includes(parsed.quality) ? parsed.quality : 1,
        reason: parsed.reason || "",
      };
    } catch (err) {
      lastError = err;

      if (err.status === 429 && isDailyQuotaError(err.rawText || "")) {
        console.error(
          "🚫 الكوتة اليومية لـ Groq خلصت بالكامل — هترجع تتجدد الساعة 12 بالليل بتوقيت UTC. مفيش فايدة من إعادة المحاولة دلوقتي."
        );
        break;
      }

      if (err.status === 429 && attempt < MAX_RETRIES) {
        const suggested = extractSuggestedDelayMs(err.rawText || "");
        const wait = Math.min(suggested || 5000, MAX_RETRY_WAIT_MS);
        console.warn(
          `⏳ Groq rate limit (429)، إعادة محاولة بعد ${Math.round(
            wait / 1000
          )} ثانية... (محاولة ${attempt + 1}/${MAX_RETRIES})`
        );
        await sleep(wait);
        continue;
      }

      break;
    }
  }

  console.error("⚠️ خطأ في تقييم Groq:", lastError?.message || lastError);
  return { isHelp: false, quality: 0, reason: "تعذر التقييم" };
}

module.exports = { evaluateHelp };
