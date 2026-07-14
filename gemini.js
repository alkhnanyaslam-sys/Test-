// gemini.js
// بيستخدم Groq API (سريع جدًا ومجاني، كوتة كبيرة) عشان يحكم: هل في
// الرسالة دي مساعدة حقيقية (شرح سؤال، طريقة حل، تفسير، أو مساعدة
// عادية) ولا لأ. بيتستخدم في حالتين: تقييم زوج سؤال/رد، وتقييم رسالة
// شكر بمفردها (نتأكد إن اللي اتشكر عليه فعلاً مساعدة حقيقية).
// (اسم الملف فضل زي ما هو عشان باقي الملفات مش محتاجة تتغير)

const GROQ_API_KEY = process.env.GROQ_API_KEY;
// موديل أقوى في الفهم والدقة (خصوصًا بالعربي) — أهم من كتر الكوتة هنا
// عشان مننفعش نديّ نقاط غلط. لو الكوتة اليومية بتاعته خلصت، بننزل
// تلقائيًا لموديل أخف كـ احتياطي بدل ما نوقف التقييم خالص.
const PRIMARY_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const FALLBACK_MODEL = "llama-3.1-8b-instant";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

// ---- إعدادات التحكم في معدل الطلبات ----
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

async function callGroqOnce(prompt, model) {
  await waitForRateLimit();

  const body = {
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.1,
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

// المحرك المشترك: بيبعت البرومبت، يتعامل مع rate limiting والتبديل
// التلقائي للموديل الاحتياطي، ويرجع النتيجة متحللة كـ JSON
async function runEvaluation(prompt) {
  let lastError = null;
  let modelToUse = PRIMARY_MODEL;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { text, finishReason } = await callGroqOnce(prompt, modelToUse);

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
        if (modelToUse !== FALLBACK_MODEL) {
          console.warn(
            `🔁 الكوتة اليومية لموديل ${modelToUse} خلصت، هنستخدم ${FALLBACK_MODEL} كاحتياطي.`
          );
          modelToUse = FALLBACK_MODEL;
          continue;
        }
        console.error(
          "🚫 الكوتة اليومية خلصت لكل الموديلات المتاحة — هترجع تتجدد بعد شوية."
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

// تقييم زوج سؤال/رد — بيتستخدم لما مفيش شكر صريح ومحتاجين نتأكد إن
// الرد فعلاً بيعالج نفس موضوع الرسالة الأصلية
async function evaluateHelp(originalMessage, replyMessage) {
  const prompt = `
انت حكم صارم جدًا في جروب تليجرام. مهمتك الوحيدة: تحدد هل الرسالة التانية (الرد) بتمثل "مساعدة حقيقية" على الرسالة الأولى.

المساعدة الحقيقية تقتصر على حاجتين بس:
- حل سؤال (إجابة صحيحة ومباشرة على سؤال محدد)
- تفسير أو شرح (توضيح معلومة أو مفهوم مش واضح، أو شرح طريقة حل مسألة)

أي حاجة تانية غير كده — حتى لو مفيدة أو فيها معلومة صح — لا تعتبر مساعدة تستاهل نقاط. كن متشددًا جدًا. لما تشك، اختار isHelp: false. الهدف إننا مانديش نقاط لأي حد إلا لو حل سؤال أو فسّر حاجة فعلاً وبوضوح.

الرسالة الأولى:
"""${originalMessage}"""

الرد عليها:
"""${replyMessage}"""

رد بصيغة JSON فقط بدون أي كلام تاني وبدون Markdown:
{"isHelp": true/false, "quality": 1/2/3, "reason": "سبب قصير جدا بالعربي"}

قواعد صارمة:
1. لازم الرسالة الأولى تكون سؤال واضح أو مشكلة/غموض محتاج توضيح. لو كلام عام، دردشة، رأي، تعليق، تحية، مجاملة -> isHelp: false
2. لازم الرد يتعامل فعلاً مع نفس الموضوع ده بالذات، مش موضوع تاني حتى لو قريب منه
3. ردود زي "تمام" / "ماشي" / "ok" / رموز تعبيرية بس / "مش عارف" / "حاول تسأل حد تاني" -> isHelp: false
4. لو الرد سؤال إضافي أو استفسار (مش إجابة أو شرح) -> isHelp: false
5. لو الرد إجابة/شرح/تفسير مباشر وواضح (حتى لو قصير، زي إجابة اختيار وحيدة) -> isHelp: true, quality: 1
6. لو الرد فيه إجابة أو شرح واضح مع توضيح بسيط ليه -> isHelp: true, quality: 2
7. لو الرد شرح شامل ومفصل وحل المشكلة فعليًا بشكل واضح -> isHelp: true, quality: 3
8. لو مش متأكد إن الرد فعلاً بيساعد في نفس الموضوع، اختار isHelp: false

رد بـ JSON بس.
`.trim();

  return runEvaluation(prompt);
}

// بيستخدم في حالة الشكر: بنقيّم الرسالة اللي اتشكر عليها بمفردها (من
// غير سؤال واضح قدامنا)، عشان نتأكد إنها فعلاً شرح/مساعدة حقيقية قبل
// ما نديّ نقاط، مش مجرد كلام عادي حد قرر يشكر عليه
async function evaluateStandaloneHelp(messageText) {
  const prompt = `
انت حكم صارم جدًا في جروب تليجرام. حد شكر صاحب الرسالة دي على "مساعدته"، ومهمتك تتأكد هل الرسالة دي فعلاً مساعدة حقيقية تستاهل نقاط، ولا مجرد كلام عادي حد قرر يشكر عليه من باب المجاملة.

المساعدة الحقيقية تقتصر على حاجتين بس: حل سؤال (إجابة صحيحة ومباشرة)، أو تفسير/شرح (توضيح معلومة أو مفهوم مش واضح، أو شرح طريقة حل). أي حاجة تانية غير كده — حتى لو مفيدة أو فيها معلومة صح — لا تعتبر مساعدة تستاهل نقاط.

كن متشددًا جدًا. لما تشك، اختار isHelp: false.

الرسالة:
"""${messageText}"""

رد بصيغة JSON فقط:
{"isHelp": true/false, "reason": "سبب قصير جدا بالعربي"}

قواعد:
- لو الرسالة كلام عادي، دردشة، رأي، تعليق، مجاملة، معلومة عامة، أو أي حاجة مش حل سؤال أو تفسير محدد -> isHelp: false
- لو الرسالة فعلاً بتحل سؤال محدد أو بتفسر/بتوضح حاجة مش واضحة بشكل مباشر -> isHelp: true
- لو مش متأكد -> isHelp: false

رد بـ JSON بس.
`.trim();

  const result = await runEvaluation(prompt);
  return { isHelp: result.isHelp, reason: result.reason };
}

module.exports = { evaluateHelp, evaluateStandaloneHelp };
