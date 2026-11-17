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

  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    console.error("Missing GROQ_API_KEY environment variable.");
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
      mode,
      topic,
      extra = "",
      platform,
      tone,
      language
    } = body;

    if (!["hook", "bio"].includes(mode)) {
      return res.status(400).json({
        error: "Please select a valid generation mode."
      });
    }

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

    const hookPlatforms = [
      "Instagram Reels/YouTube Shorts",
      "LinkedIn Post",
      "Twitter/X Thread",
      "YouTube Long Video",
      "WhatsApp/Cold Outreach"
    ];

    const bioPlatforms = [
      "Instagram Bio",
      "LinkedIn Headline & Short Bio",
      "Twitter/X Bio",
      "Bumble/Dating Profile Bio",
      "Portfolio/Freelancer Bio"
    ];

    const allowedPlatforms =
      mode === "hook" ? hookPlatforms : bioPlatforms;

    if (!allowedPlatforms.includes(platform)) {
      return res.status(400).json({
        error: "Please select a valid platform."
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
        error: "Please select a valid tone."
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

    const platformRules = {
      "Instagram Reels/YouTube Shorts":
        "Create a spoken opening line that grabs attention immediately. Make it natural to say aloud. Avoid long sentences.",

      "LinkedIn Post":
        "Create a strong professional opening that makes readers want to expand the post. Be specific and credible. Avoid engagement bait.",

      "Twitter/X Thread":
        "Create a concise first-post hook that creates curiosity and gives readers a reason to continue the thread.",

      "YouTube Long Video":
        "Create an opening hook for a longer video. Establish the topic, create curiosity, and give viewers a reason to stay.",

      "WhatsApp/Cold Outreach":
        "Create a natural, respectful opening message. Do not sound spammy, pushy, or overly promotional.",

      "Instagram Bio":
        "Write a clear Instagram bio. Keep each option within 150 characters, including spaces and emojis.",

      "LinkedIn Headline & Short Bio":
        "Write a professional LinkedIn headline and a short supporting bio. Make the person's role, value, or expertise clear. Keep each option concise and within 300 characters.",

      "Twitter/X Bio":
        "Write a distinctive X profile bio. Keep each option within 160 characters, including spaces and emojis.",

      "Bumble/Dating Profile Bio":
        "Write an authentic, appealing dating profile bio. Show personality and specificity without sounding cheesy. Keep each option within 300 characters.",

      "Portfolio/Freelancer Bio":
        "Write a concise portfolio or freelancer bio. Explain what the person does and the value they offer. Keep each option within 300 characters."
    };

    const safeTopic = JSON.stringify(topic.trim());
    const safeExtra = JSON.stringify(extra.trim() || "None");

    const commonRules = `
      WRITING QUALITY RULES:
      - Generate exactly 3 distinct options.
      - Sound natural, specific, and human.
      - Avoid generic filler and repetitive phrasing.
      - Do not invent qualifications, achievements, statistics, or personal experiences not provided by the user.
      - Avoid robotic clichés such as "unleash", "elevate", "delve", "unlock", "tapestry", "realm", "game-changer", "revolutionize", "skyrocket", and "embark".
      - Follow the selected language and tone.
      - Do not add labels such as Option 1 or Option 2 inside the generated text.
      - CRITICAL: Return ONLY a valid JSON object in this exact structure:
        {
          "results": ["option 1 text", "option 2 text", "option 3 text"]
        }
    `;

    let prompt;

    if (mode === "bio") {
      prompt = `You are an expert social media profile copywriter.
      TASK: Create 3 different profile bio options.
      PLATFORM: ${platform}
      PLATFORM REQUIREMENTS: ${platformRules[platform]}
      USER TOPIC: ${safeTopic}
      EXTRA CONTEXT: ${safeExtra}
      SELECTED TONE: ${tone}
      LANGUAGE: ${languageRules[language]}
      ${commonRules}`;
    } else {
      prompt = `You are an expert social media hook writer.
      TASK: Create 3 different opening hooks.
      PLATFORM: ${platform}
      PLATFORM REQUIREMENTS: ${platformRules[platform]}
      USER TOPIC: ${safeTopic}
      TARGET AUDIENCE / KEYWORDS: ${safeExtra}
      SELECTED TONE: ${tone}
      LANGUAGE: ${languageRules[language]}
      ${commonRules}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: "openai/gpt-oss-120b",
        messages: [
          { role: "user", content: prompt }
        ],
        temperature: 0.85,
        response_format: { type: "json_object" }
      })
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Groq API failed:", errorText);
      return res.status(502).json({
        error: "Unable to generate content right now. Please try again in a moment."
      });
    }

    const data = await response.json();
    const rawText = data.choices?.[0]?.message?.content?.trim();

    if (!rawText) {
      return res.status(502).json({
        error: "Unable to generate content right now. Please try again in a moment."
      });
    }

    let parsedData;
    try {
      parsedData = JSON.parse(rawText);
    } catch (parseError) {
      console.error("Failed to parse Groq JSON output:", rawText);
      return res.status(502).json({
        error: "Unable to generate content right now. Please try again in a moment."
      });
    }

    const results = parsedData.results;

    if (!Array.isArray(results) || results.length === 0) {
      return res.status(502).json({
        error: "Unable to generate content right now. Please try again in a moment."
      });
    }

    const cleanResults = results
      .filter((item) => typeof item === "string" && item.trim().length > 0)
      .map((item) => item.trim())
      .slice(0, 3);

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
