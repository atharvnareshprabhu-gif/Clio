export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Only POST requests allowed' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Server error: Missing GEMINI_API_KEY' });

  try {
    const { mode, topic, extra, platform, tone, language } = req.body;
    if (!topic) return res.status(400).json({ error: 'Topic is required' });

    const languageRules = {
      "Simple English": "Write in clear, natural, everyday conversational English. Sound like a real human talking, not a textbook or corporate brochure.",
      "Professional English": "Write in sharp, confident, and polished English suitable for real founders and industry leaders. Keep it crisp, specific, and human—zero corporate buzzwords.",
      "Hinglish": "Write in natural, street-smart Hinglish (a smooth mix of Hindi and English written in English/Roman script, just like top Indian creators speak on Instagram Reels and YouTube). Keep it punchy, relatable, and avoid awkward literal translations."
    };

    const antiRoboticRule = `
      CRITICAL WRITING RULES:
      - Sound 100% authentic, human, and scroll-stopping.
      - STRICTLY BANNED WORDS: Never use robotic AI clichés like 'unleash', 'elevate', 'delve', 'unlock', 'tapestry', 'realm', 'game-changer', 'revolutionize', 'skyrocket', or 'embark'.
      - Avoid generic fluff; focus on curiosity, specificity, and real human emotion.
    `;

    let prompt = "";

    if (mode === 'bio') {
      prompt = `
        Generate 3 catchy, scroll-stopping, and human-sounding social media bios/captions for ${platform} based on the user's topic: "${topic}" and selected vibe: "${tone}".
        Extra context/CTA: ${extra || 'None'}.
        Language Style: ${languageRules[language] || languageRules['Hinglish']}
        ${antiRoboticRule}
        - Keep bios strictly under 150 characters with clean line breaks and minimal, relevant emojis.
        - Make each of the 3 options distinctly different in angle.
      `;
    } else {
      prompt = `
        Generate 3 catchy, scroll-stopping, and human-sounding opening hooks for ${platform} about the topic: "${topic}" with the selected vibe: "${tone}".
        Target audience/keywords: ${extra || 'None'}.
        Language Style: ${languageRules[language] || languageRules['Hinglish']}
        ${antiRoboticRule}
        - Keep each hook punchy (1 to 2 short lines max) so it stops the scroll in the first 2 seconds.
        - Make each of the 3 options use a unique psychological angle (e.g., curiosity gap, relatable truth, bold take).
      `;
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { 
            temperature: 0.9,
            topP: 0.95,
            responseMimeType: "application/json",
            responseSchema: {
              type: "ARRAY",
              items: { type: "STRING" }
            }
          }
        })
      }
    );

    if (!response.ok) {
      const errData = await response.text();
      console.error('Gemini API Error:', errData);
      return res.status(502).json({ error: 'Failed to generate from Gemini API' });
    }

    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!rawText) {
      return res.status(502).json({ error: 'Empty response from AI' });
    }

    const results = JSON.parse(rawText);
    return res.status(200).json({ results });

  } catch (error) {
    console.error('Serverless Error:', error);
    return res.status(500).json({ error: 'Something went wrong on the server' });
  }
}
