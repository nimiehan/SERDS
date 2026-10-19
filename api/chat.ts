import { GoogleGenAI, Type } from "@google/genai";

export default async function handler(req: any, res: any) {
  // 1. CORS headers for cross-origin or same-origin requests
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization"
  );

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ success: false, error: "Method not allowed. Use POST." });
    return;
  }

  try {
    // 2. Parse request payload
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const { messages, context } = body;

    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ success: false, error: "Messages array is required." });
      return;
    }

    const aimlApiKey = process.env.AIMLAPI_KEY;
    const geminiApiKey = process.env.GEMINI_API_KEY;

    const userContextSnippet = context ? `
User Context:
- Caller Name: ${context.callerName || "Unknown"}
- Address / Location: ${context.location || "Not specified"}
- Blood Type: ${context.bloodType || "Unknown"}
- Known Allergies: ${Array.isArray(context.allergies) && context.allergies.length > 0 ? context.allergies.join(", ") : "None reported"}
` : "";

    const systemInstruction = `You are Serdy, the clinical Smart Emergency Response Dispatch (SERD) AI triage assistant powered by google/gemma-3-4b-it.
Your mission is to rapidly evaluate emergency situations, triage severity using universal emergency triage standards (P1 Critical through P4 Non-Urgent), give clear step-by-step life preservation instructions, and determine required emergency services.

Triage Standards:
- P1_CRITICAL: Immediate life threat (respiratory failure, cardiac arrest, severe hemorrhage, unconsciousness, stroke, major trauma, active structure fire, violent assault).
- P2_URGENT: Serious condition requiring rapid dispatch (fractures with pulse, controlled deep laceration, head trauma with consciousness, smoke inhalation).
- P3_MODERATE: Non-life-threatening medical or minor security issues (minor burns, sprains, stable symptoms).
- P4_NON_URGENT: General first-aid questions or minor conditions that do not require emergency dispatch.

Rules:
1. Speak in a calm, decisive, reassuring tone.
2. If dispatch is needed, designate the correct service: 'ambulance', 'police', or 'fire'.
3. Always provide concrete, numbered, immediate first-aid actions (e.g. "1. Apply firm, direct pressure...", "2. Keep patient lying down...").
4. Check caller known allergies and situation risks for safety precautions.
5. If situation is minor or self-limiting, reassure the user and state self-care guidelines without false alarm.
6. If emergency dispatch is needed, include the action tag at the very end in this exact format:
[ACTION: Dispatch Ambulance] OR [ACTION: Dispatch Police] OR [ACTION: Dispatch Fire & Rescue]
${userContextSnippet}`;

    // Priority 1: Use AIMLAPI with google/gemma-3-4b-it if AIMLAPI_KEY is configured
    if (aimlApiKey) {
      try {
        const firstUserIndex = messages.findIndex((m: any) => m.role === 'user');
        const relevantHistory = firstUserIndex !== -1 ? messages.slice(firstUserIndex) : messages;

        const aimlMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

        for (let i = 0; i < relevantHistory.length; i++) {
          const m = relevantHistory[i];
          const isUser = !(m.role === 'bot' || m.role === 'model' || m.role === 'assistant');
          const role: 'user' | 'assistant' = isUser ? 'user' : 'assistant';
          let content = String(m.text || m.content || '').trim();

          // Embed system instruction into the initial user prompt (Gemma 3 only accepts 'user' | 'assistant')
          if (i === 0 && role === 'user') {
            content = `${systemInstruction}\n\n[Emergency Caller]:\n${content}`;
          }

          if (aimlMessages.length > 0 && aimlMessages[aimlMessages.length - 1].role === role) {
            aimlMessages[aimlMessages.length - 1].content += `\n${content}`;
          } else {
            aimlMessages.push({ role, content });
          }
        }

        if (aimlMessages.length === 0) {
          aimlMessages.push({
            role: 'user',
            content: `${systemInstruction}\n\n[Emergency Caller]:\nHello, I need emergency triage assistance.`
          });
        }

        const r = await fetch("https://api.aimlapi.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${aimlApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemma-3-4b-it",
            messages: aimlMessages,
          }),
        });

        if (!r.ok) {
          const errText = await r.text();
          console.error("[AIMLAPI Vercel] Error response from API:", r.status, errText);
          throw new Error(`AIMLAPI responded with status ${r.status}: ${errText}`);
        }

        const data: any = await r.json();
        const replyContent: string = data.choices?.[0]?.message?.content || "";

        const actionMatch = replyContent.match(/\[ACTION:\s*([^\]]+)\]/i);
        const actionLabel = actionMatch ? actionMatch[1].trim() : undefined;
        const cleanText = replyContent.replace(/\[ACTION:\s*([^\]]+)\]/i, '').trim();

        let recService: 'ambulance' | 'police' | 'fire' | undefined = undefined;
        if (actionLabel) {
          const lower = actionLabel.toLowerCase();
          if (lower.includes('police')) recService = 'police';
          else if (lower.includes('fire')) recService = 'fire';
          else if (lower.includes('ambulance') || lower.includes('medic') || lower.includes('ems')) recService = 'ambulance';
        }

        let urgency: 'P1_CRITICAL' | 'P2_URGENT' | 'P3_MODERATE' | 'P4_NON_URGENT' = 'P3_MODERATE';
        let urgencyLabel = 'P3 - Moderate';
        const contentLower = replyContent.toLowerCase();
        if (contentLower.includes('p1') || contentLower.includes('critical') || contentLower.includes('life-threatening') || contentLower.includes('cardiac') || contentLower.includes('unconscious')) {
          urgency = 'P1_CRITICAL';
          urgencyLabel = 'P1 - Critical';
        } else if (contentLower.includes('p2') || contentLower.includes('urgent') || contentLower.includes('fracture') || contentLower.includes('deep laceration')) {
          urgency = 'P2_URGENT';
          urgencyLabel = 'P2 - Urgent';
        } else if (contentLower.includes('p4') || contentLower.includes('non-urgent') || contentLower.includes('minor')) {
          urgency = 'P4_NON_URGENT';
          urgencyLabel = 'P4 - Non-Urgent';
        }

        const stepMatches = cleanText.match(/(?:^|\n)\s*(\d+[\.\)]\s*[^\n]+)/g);
        const firstAidSteps = stepMatches ? stepMatches.map(s => s.trim().replace(/^\d+[\.\)]\s*/, '')) : [];

        res.status(200).json({
          success: true,
          text: replyContent,
          guidance: cleanText,
          model: "google/gemma-3-4b-it",
          provider: "aimlapi",
          triage: actionLabel ? {
            urgency,
            urgencyLabel,
            chiefComplaint: "Emergency Assessment",
            dispatchNeeded: true,
            recommendedService: recService,
            dispatchLabel: actionLabel,
            firstAidSteps,
            precautions: []
          } : undefined
        });
        return;
      } catch (aimlErr: any) {
        console.warn("[AIMLAPI Vercel] Request failed, checking Gemini fallback:", aimlErr.message);
        if (!geminiApiKey) {
          res.status(502).json({
            success: false,
            error: aimlErr.message,
            text: "Error communicating with AIMLAPI google/gemma-3-4b-it. Please verify your AIMLAPI_KEY in Vercel environment variables."
          });
          return;
        }
      }
    }

    // Priority 2: Gemini API fallback if GEMINI_API_KEY is configured
    if (geminiApiKey) {
      try {
        const ai = new GoogleGenAI({ apiKey: geminiApiKey });
        const contents = messages.map((m: any) => ({
          role: m.role === 'bot' || m.role === 'model' || m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.text }]
        }));

        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents,
          config: {
            systemInstruction,
            temperature: 0.2,
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                guidance: {
                  type: Type.STRING,
                  description: "Conversational, calm, professional guidance from Serdy to the caller."
                },
                urgency: {
                  type: Type.STRING,
                  description: "One of: P1_CRITICAL, P2_URGENT, P3_MODERATE, P4_NON_URGENT"
                },
                urgencyLabel: {
                  type: Type.STRING,
                  description: "Short human label: e.g. 'P1 - Critical', 'P2 - Urgent', 'P3 - Moderate', 'P4 - Non-Urgent'"
                },
                chiefComplaint: {
                  type: Type.STRING,
                  description: "Concise emergency summary (e.g. 'Acute Chest Pain', 'Severe Bleeding', 'Residential Fire')"
                },
                dispatchNeeded: {
                  type: Type.BOOLEAN,
                  description: "True if emergency unit dispatch is needed"
                },
                recommendedService: {
                  type: Type.STRING,
                  description: "One of: 'ambulance', 'police', 'fire', 'none'"
                },
                dispatchLabel: {
                  type: Type.STRING,
                  description: "Button label, e.g. 'Dispatch Ambulance', 'Dispatch Police', 'Dispatch Fire & Rescue'"
                },
                firstAidSteps: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: "Ordered, concrete first aid steps for the user to follow right now."
                },
                precautions: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: "Crucial clinical precautions, allergy warnings, or environmental hazards."
                }
              },
              required: ["guidance", "urgency", "urgencyLabel", "chiefComplaint", "dispatchNeeded", "recommendedService", "firstAidSteps"]
            }
          }
        });

        let parsed: any = null;
        try {
          parsed = JSON.parse(response.text || "{}");
        } catch (parseErr) {
          console.warn("[Gemini API] Failed to parse triage JSON:", parseErr);
        }

        if (parsed && parsed.guidance) {
          let combinedText = parsed.guidance;
          if (parsed.dispatchNeeded && parsed.dispatchLabel) {
            combinedText += `\n\n[ACTION: ${parsed.dispatchLabel}]`;
          }

          res.status(200).json({
            success: true,
            text: combinedText,
            guidance: parsed.guidance,
            provider: "gemini",
            triage: {
              urgency: parsed.urgency,
              urgencyLabel: parsed.urgencyLabel,
              chiefComplaint: parsed.chiefComplaint,
              dispatchNeeded: parsed.dispatchNeeded,
              recommendedService: parsed.recommendedService === 'none' ? undefined : parsed.recommendedService,
              dispatchLabel: parsed.dispatchLabel,
              firstAidSteps: parsed.firstAidSteps || [],
              precautions: parsed.precautions || []
            }
          });
          return;
        }

        const fallbackText = response.text || "Emergency assessment received. Stay calm and follow safety protocols.";
        res.status(200).json({
          success: true,
          text: fallbackText,
          guidance: fallbackText,
          provider: "gemini"
        });
        return;
      } catch (geminiErr: any) {
        console.error("[Gemini API] Error generating content:", geminiErr);
        res.status(502).json({
          success: false,
          error: geminiErr.message,
          text: "Emergency triage assistant service temporarily unavailable."
        });
        return;
      }
    }

    // Neither key configured
    res.status(500).json({
      success: false,
      error: "No AI API key configured.",
      text: "AIMLAPI_KEY is not configured in Vercel environment variables. Please add AIMLAPI_KEY in Vercel Project Settings > Environment Variables."
    });
  } catch (err: any) {
    console.error("[Vercel /api/chat error]:", err);
    res.status(500).json({
      success: false,
      error: err.message || "Internal server error"
    });
  }
}
