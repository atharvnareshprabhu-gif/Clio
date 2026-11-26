const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute window
const MAX_REQUESTS_PER_WINDOW = 12; // Normal users won't hit this; bots/spammers will
const DUPLICATE_COOLDOWN_MS = 15 * 1000; // 15s cooldown for exact repeated spam

// In-memory tracking per warm serverless instance
const ipHitsMap = new Map();
const lastRequestMap = new Map();

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "unknown-ip";
}

function isRateLimited(ip) {
  const now = Date.now();
  const entry = ipHitsMap.get(ip);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    ipHitsMap.set(ip, { windowStart: now, count: 1 });
    return false;
  }

  entry.count += 1;
  if (entry.count > MAX_REQUESTS_PER_WINDOW) {
    return true;
  }

  return false;
}

function isRapidDuplicate(ip, payloadSignature) {
  const now = Date.now();
  const prev = lastRequestMap.get(ip);

  if (prev && prev.sig === payloadSignature && now - prev.time < DUPLICATE_COOLDOWN_MS) {
    return true;
  }

  lastRequestMap.set(ip, { sig: payloadSignature, time: now });
  return false;
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json({
      error: "Only POST requests are allowed."
    });
  }

  // Guard against huge payloads from bots/scripts
  const contentLength = Number(req.headers["content-length"] || 0);
  if (contentLength > 25000) {
    return res.status(413).json({
      error: "Request payload is too large."
    });
  }

  const clientIp = getClientIp(req);

  if (isRateLimited(clientIp)) {
    return res.status(429).json({
      error: "Oops, sorry about that! Please be a little patient for the next response."
    });
  }

  const groqApiKey = process.env.GROQ_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;

  if (!groqApiKey && !geminiApiKey) {
    console.error("Missing both GROQ_API_KEY and GEMINI_API_KEY environment variables.");
    return res.status(500).json({
      error: "Configuration error. Please try again later."
    });
  }

  try {
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body;

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return res.status(400).json({
        error: "Invalid request format."
      });
    }

    const {
      topic,
      extra = "",
      platform = "Instagram Reels & YouTube Shorts",
      tone,
      language
    } = body;

    if (typeof topic !== "string" || !topic.trim()) {
      return res.status(400).json({
        error: "Please enter a topic."
      });
    }

    if (topic.length > 2000) {
      return res.status(400).json({
        error: "Topic must be 2000 characters or fewer."
      });
    }

    if (typeof extra !== "string" || extra.length > 300) {
      return res.status(400).json({
        error: "Extra context must be 300 characters or fewer."
      });
    }

    const hookPlatformRules = {
      "Instagram Reels":
        "Write a punchy opening hook for an Instagram Reel that stops scrolling in the first 2-3 seconds. Easy to speak aloud naturally and works well as short on-screen text.",

      "YouTube Shorts":
        "Write a crisp, high-retention opening hook for a YouTube Short. Hook the viewer immediately in the first 2-3 seconds without slow throat-clearing.",

      "Instagram Reels & YouTube Shorts":
        "Write a high-retention opening hook that works smoothly for both Instagram Reels and YouTube Shorts in the first 2-3 seconds. Keep it spoken-friendly and sharp.",

      "Instagram Reels/YouTube Shorts":
        "Write a high-retention opening hook that works smoothly for both Instagram Reels and YouTube Shorts in the first 2-3 seconds. Keep it spoken-friendly and sharp.",

      "YouTube Video Intro":
        "Write an engaging opening hook for a YouTube video. Set up the core payoff, spark curiosity quickly, and give viewers a clear reason to keep watching.",

      "YouTube Long Video":
        "Write an engaging opening hook for a longer YouTube video. Set up the core payoff, spark curiosity quickly, and give viewers a clear reason to keep watching."
    };

    if (!Object.prototype.hasOwnProperty.call(hookPlatformRules, platform)) {
      return res.status(400).json({
        error: "Please select a valid video format."
      });
    }

    const allowedTones = [
      "Curiosity & Scroll-Stopping",
      "Bold & Controversial",
      "Witty & Relatable",
      "Storytelling & Emotional",
      "Direct Value & Actionable"
    ];

    if (!allowedTones.includes(tone)) {
      return res.status(400).json({
        error: "Please select a valid hook style."
      });
    }

    const languageRules = {
      "Simple English":
        "Write in clear, natural, everyday conversational English. Avoid textbook language and corporate jargon.",

      "Professional English":
        "Write in polished, confident, concise English. Sound credible and human, not like a corporate brochure.",

      "Hinglish":
        "Write in natural Indian Hinglish using Roman script. Mix Hindi and English smoothly, like a real Indian creator. Avoid awkward literal translations."
    };

    if (!Object.prototype.hasOwnProperty.call(languageRules, language)) {
      return res.status(400).json({
        error: "Please select a valid language."
      });
    }

    // Block identical back-to-back spam within 15s from the same IP
    const signature = `hook|${topic.trim().toLowerCase()}|${extra.trim().toLowerCase()}|${platform}|${tone}|${language}`;
    if (isRapidDuplicate(clientIp, signature)) {
      return res.status(429).json({
        error: "Oops, sorry about that! Please be a little patient for the next response."
      });
    }

    const safeTopic = JSON.stringify(topic.trim());
    const safeExtra = JSON.stringify(extra.trim() || "None");

    const prompt = `You are an expert short-form video hook writer for Instagram Reels and YouTube Shorts.
    TASK: Create 3 distinct opening hooks for a short-form video.
    VIDEO FORMAT: ${platform}
    FORMAT RULES: ${hookPlatformRules[platform]}
    VIDEO TOPIC: ${safeTopic}
    TARGET AUDIENCE / KEYWORDS: ${safeExtra}
    HOOK STYLE / TONE: ${tone}
    LANGUAGE: ${languageRules[language]}

    HOOK & WRITING QUALITY RULES:
    - Generate exactly 3 distinct hooks with different angles.
    - Each hook must work in the first 2-3 seconds and sound natural when spoken out loud.
    - Keep sentences tight, clear, and easy to follow on mobile.
    - Do not invent personal results, stats, achievements, or experiences not provided by the user.
    - Avoid generic filler and robotic clichés such as "unleash", "elevate", "delve", "unlock", "tapestry", "realm", "game-changer", "revolutionize", "skyrocket", and "embark".
    - Do not add labels such as "Hook 1:", "Option 1:", or quotes around the whole hook unless natural to the line.
    - CRITICAL: Return ONLY a valid JSON object in this exact structure:
      {
        "results": ["hook 1 text", "hook 2 text", "hook 3 text"]
      }`;

    // Helper function to validate and clean JSON output from either AI
    const extractCleanResults = (rawText) => {
      if (!rawText) throw new Error("Empty response from AI provider.");
      const parsed = JSON.parse(rawText);
      if (!Array.isArray(parsed.results) || parsed.results.length === 0) {
        throw new Error("Invalid JSON structure from AI provider.");
      }
      const clean = parsed.results
        .filter((item) => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim())
        .slice(0, 3);

      if (clean.length === 0) {
        throw new Error("No valid strings in results array.");
      }
      return clean;
    };

    // 1. PRIMARY ENGINE: GROQ (openai/gpt-oss-120b)
    async function callGroq() {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      try {
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${groqApiKey}`
          },
          signal: controller.signal,
          body: JSON.stringify({
            model: "openai/gpt-oss-120b",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.85,
            response_format: { type: "json_object" }
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Groq HTTP ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        const rawText = data.choices?.[0]?.message?.content?.trim();
        return extractCleanResults(rawText);
      } finally {
        clearTimeout(timeout);
      }
    }

    // 2. BACKUP ENGINE: GEMINI (gemini-3.8-flash)
    async function callGemini() {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);

      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${geminiApiKey}`;
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [
              {
                parts: [{ text: prompt }]
              }
            ],
            generationConfig: {
              temperature: 0.85,
              responseMimeType: "application/json"
            }
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Gemini HTTP ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        return extractCleanResults(rawText);
      } finally {
        clearTimeout(timeout);
      }
    }

    // EXECUTION WITH AUTOMATIC FAILOVER
    let cleanResults = null;

    if (groqApiKey) {
      try {
        cleanResults = await callGroq();
      } catch (groqError) {
        console.warn("Groq failed, triggering Gemini fallback:", groqError.message);
      }
    }

    if (!cleanResults && geminiApiKey) {
      try {
        cleanResults = await callGemini();
      } catch (geminiError) {
        console.error("Gemini fallback also failed:", geminiError.message);
      }
    }

    if (!cleanResults) {
      return res.status(502).json({
        error: "Unable to generate hooks right now. Please try again in a moment."
      });
    }

    return res.status(200).json({
      results: cleanResults
    });

  } catch (error) {
    console.error("Unexpected server error:", error);
    return res.status(500).json({
      error: "Something went wrong. Please try again."
    });
  }
}
