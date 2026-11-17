export default async function handler(req, res) {
  // CORS Preflight handling
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  // Method check
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json({
      error: "Only POST requests are allowed."
    });
  }

  // Environment API Keys
  const groqApiKey = process.env.GROQ_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;

  if (!groqApiKey && !geminiApiKey) {
    console.error("Missing both GROQ_API_KEY and GEMINI_API_KEY environment variables.");
    return res.status(500).json({
      error: "Configuration error. Please try again later."
    });
  }

  try {
    // Parse request body safely
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

    // Validate generation mode
    if (!["hook", "bio"].includes(mode)) {
      return res.status(400).json({
        error: "Please select a valid generation mode."
      });
    }

    // Validate topic string
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

    // Validate extra context
    if (typeof extra !== "string" || extra.length > 300) {
      return res.status(400).json({
        error: "Extra context must be 300 characters or fewer."
      });
    }

    // Platform definitions
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

    // Tone definitions
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

    // Language mapping rules
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

    // Detailed platform requirements
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

    // Common writing rules block
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

    // Constructing the final prompt based on mode
    let prompt = "";

    if (mode === "bio") {
      prompt = `
        You are an expert social media profile copywriter.
        TASK: Create 3 different profile bio options.
        PLATFORM: ${platform}
        PLATFORM REQUIREMENTS: ${platformRules[platform]}
        USER TOPIC: ${safeTopic}
        EXTRA CONTEXT: ${safeExtra}
        SELECTED TONE: ${tone}
        LANGUAGE: ${languageRules[language]}
        ${commonRules}
      `;
    } else {
      prompt = `
        You are an expert social media hook writer.
        TASK: Create 3 different opening hooks.
        PLATFORM: ${platform}
        PLATFORM REQUIREMENTS: ${platformRules[platform]}
        USER TOPIC: ${safeTopic}
        TARGET AUDIENCE / KEYWORDS: ${safeExtra}
        SELECTED TONE: ${tone}
        LANGUAGE: ${languageRules[language]}
        ${commonRules}
      `;
    }

    let rawText = null;

    // --- STEP 1: PRIMARY ENGINE (GROQ USING OPENAI OSS MODEL) ---
    if (groqApiKey) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);

        const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${groqApiKey}`
          },
          signal: controller.signal,
          body: JSON.stringify({
            model: "openai/gpt-oss-120b",
            messages: [
              {
                role: "user",
                content: prompt
              }
            ],
            temperature: 0.85,
            response_format: {
              type: "json_object"
            }
          })
        });

        clearTimeout(timeout);

        if (groqResponse.ok) {
          const groqData = await groqResponse.json();
          rawText = groqData.choices?.[0]?.message?.content?.trim() || null;
          console.log("Successfully generated response using Groq primary engine.");
        } else {
          const errorBodyText = await groqResponse.text();
          console.warn(`Groq request failed with HTTP status ${groqResponse.status}:`, errorBodyText.slice(0, 200));
        }
      } catch (groqError) {
        console.warn("Groq network or timeout failure, attempting fallback to Gemini...", groqError.message);
      }
    }

    // --- STEP 2: FALLBACK ENGINE (GEMINI 3.8 FLASH) ---
    if (!rawText && geminiApiKey) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 9000);

        const geminiResponse = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${encodeURIComponent(geminiApiKey)}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            signal: controller.signal,
            body: JSON.stringify({
              contents: [
                {
                  role: "user",
                  parts: [
                    {
                      text: prompt
                    }
                  ]
                }
              ],
              generationConfig: {
                temperature: 0.85,
                topP: 0.9,
                maxOutputTokens: 2048,
                responseMimeType: "application/json",
                responseSchema: {
                  type: "OBJECT",
                  properties: {
                    results: {
                      type: "ARRAY",
                      items: {
                        type: "STRING"
                      },
                      description: "Array of exactly 3 generated options."
                    }
                  },
                  required: ["results"]
                }
              }
            })
          }
        );

        clearTimeout(timeout);

        if (geminiResponse.ok) {
          const geminiData = await geminiResponse.json();
          const candidate = geminiData.candidates && geminiData.candidates[0];
          rawText = candidate?.content?.parts?.map((part) => part.text || "").join("").trim() || null;
          console.log("Successfully generated response using Gemini fallback engine.");
        } else {
          const geminiErrorText = await geminiResponse.text();
          console.error("Gemini fallback engine also failed:", geminiErrorText.slice(0, 200));
        }
      } catch (geminiError) {
        console.error("Gemini fallback network or timeout failure:", geminiError.message);
      }
    }

    // Final safety check if both failed
    if (!rawText) {
      return res.status(502).json({
        error: "Unable to generate content right now. Please try again in a moment."
      });
    }

    // --- PARSE AND SANITIZE RESULTS ---
    let parsedData = null;
    try {
      let cleanJsonText = rawText;
      if (cleanJsonText.startsWith("```json")) {
        cleanJsonText = cleanJsonText.replace(/^```json/, "").replace(/```$/, "").trim();
      } else if (cleanJsonText.startsWith("```")) {
        cleanJsonText = cleanJsonText.replace(/^```/, "").replace(/```$/, "").trim();
      }
      parsedData = JSON.parse(cleanJsonText);
    } catch (parseError) {
      console.error("Failed to parse JSON response output:", rawText);
      return res.status(502).json({
        error: "Unable to generate content right now. Please try again in a moment."
      });
    }

    const results = parsedData && parsedData.results;

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
    console.error("Unexpected unhandled server error occurred:", error);
    return res.status(500).json({
      error: "Something went wrong. Please try again."
    });
  }
}
