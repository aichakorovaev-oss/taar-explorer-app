import express from "express";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { GoogleGenAI, Type } from "@google/genai";
import { createServer as createViteServer } from "vite";
import { uploadFiles, type RepoDesignation } from "@huggingface/hub";

// --- User feedback / reports persistence ------------------------------------
// Ported from the "Ami" app's feedback system. Two things get collected:
//   - "reports": someone flags one specific recommendation (movie/novel/
//     artist) as offensive, mismatched, or otherwise off.
//   - "app_feedback": general, not-tied-to-one-item feedback about the app
//     (star rating, whether the analysis felt accurate, would-recommend...).
// Both are appended as JSONL — one JSON object per line — under
// feedback_data/, which keeps things simple and diffable.
//
// Local disk is EPHEMERAL on both Render's free tier and a Hugging Face
// Docker Space (wiped on every restart/redeploy; Render free services also
// spin down after ~15min idle). So — same pattern Ami uses on the Python
// side via huggingface_hub's CommitScheduler — the two JSONL files are
// additionally pushed to a private Hugging Face Dataset repo, both on a
// 5-minute timer and shortly after any new entry comes in. There's no
// direct JS equivalent of CommitScheduler, so this reimplements its core
// idea (debounced push of changed files, one last push on shutdown) by
// hand using @huggingface/hub's uploadFiles().
//
// Setup (optional, but recommended for anything beyond local dev): create
// a private dataset repo (e.g. "yourusername/taar-explorer-feedback") and
// set two secrets/env vars:
//   FEEDBACK_DATASET_REPO = "yourusername/taar-explorer-feedback"
//   HF_TOKEN              = <a token with WRITE access to that repo>
// Without them, feedback still works but only lives on local (ephemeral)
// disk and WILL BE LOST on the next restart/redeploy.
const FEEDBACK_DIR = path.join(process.cwd(), "feedback_data");
try {
  fs.mkdirSync(FEEDBACK_DIR, { recursive: true });
} catch (error) {
  console.error("[feedback] could not create feedback_data/:", error);
}
const REPORTS_FILE = path.join(FEEDBACK_DIR, "reports.jsonl");
const APP_FEEDBACK_FILE = path.join(FEEDBACK_DIR, "app_feedback.jsonl");

// Writes are chained through this promise so two requests arriving close
// together can never interleave and corrupt a line.
let feedbackWriteQueue: Promise<void> = Promise.resolve();

function appendFeedback(file: string, entry: Record<string, unknown>): Promise<string> {
  const id = randomUUID();
  const record = { id, ts: Date.now(), ...entry };
  const line = JSON.stringify(record) + "\n";
  const write = feedbackWriteQueue.then(() => fs.promises.appendFile(file, line, "utf-8"));
  feedbackWriteQueue = write.catch(() => {});
  return write.then(() => id);
}

// ── Durable off-box sync to a private HF Dataset repo ───────────────────
const FEEDBACK_DATASET_REPO = process.env.FEEDBACK_DATASET_REPO || "";
const HF_TOKEN = process.env.HF_TOKEN || "";
const FEEDBACK_SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 min, same cadence as Ami's CommitScheduler
const FEEDBACK_QUICK_SYNC_DELAY_MS = 30 * 1000; // debounce a burst of new entries

const feedbackSyncEnabled = !!(FEEDBACK_DATASET_REPO && HF_TOKEN);
const lastSyncedMtimeMs: Record<string, number> = {};
let quickSyncTimer: ReturnType<typeof setTimeout> | null = null;

async function syncFeedbackToHub(reason: string): Promise<void> {
  if (!feedbackSyncEnabled) return;
  const changedFiles: { path: string; content: Blob }[] = [];
  for (const filePath of [REPORTS_FILE, APP_FEEDBACK_FILE]) {
    try {
      const stat = fs.statSync(filePath);
      if (lastSyncedMtimeMs[filePath] === stat.mtimeMs) continue; // nothing new since last push
      const buf = fs.readFileSync(filePath);
      changedFiles.push({ path: `data/${path.basename(filePath)}`, content: new Blob([buf]) });
      lastSyncedMtimeMs[filePath] = stat.mtimeMs;
    } catch {
      // File doesn't exist yet — nothing collected for it so far, skip.
    }
  }
  if (changedFiles.length === 0) return;
  try {
    const repo: RepoDesignation = { type: "dataset", name: FEEDBACK_DATASET_REPO };
    await uploadFiles({
      repo,
      accessToken: HF_TOKEN,
      files: changedFiles,
      commitTitle: `Sync feedback (${reason})`,
    });
    console.log(`[feedback] synced ${changedFiles.length} file(s) to ${FEEDBACK_DATASET_REPO} (${reason})`);
  } catch (error) {
    // Never let a sync failure affect the request that triggered it — this
    // always runs detached from the response. Just retry on the next cycle.
    console.error("[feedback] Hub sync failed, will retry next cycle:", error);
  }
}

// Called after every successful append: pushes soon (debounced) rather
// than waiting for the full interval, so a burst of feedback right before
// a Render free-tier idle spin-down isn't lost.
function scheduleQuickFeedbackSync(): void {
  if (!feedbackSyncEnabled || quickSyncTimer) return;
  quickSyncTimer = setTimeout(() => {
    quickSyncTimer = null;
    void syncFeedbackToHub("new entry");
  }, FEEDBACK_QUICK_SYNC_DELAY_MS);
  quickSyncTimer.unref?.();
}

if (feedbackSyncEnabled) {
  const intervalTimer = setInterval(() => void syncFeedbackToHub("interval"), FEEDBACK_SYNC_INTERVAL_MS);
  intervalTimer.unref?.();
  // Best-effort final push if the process gets a graceful shutdown signal
  // (e.g. Render redeploying the service).
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      void syncFeedbackToHub("shutdown").finally(() => process.exit(0));
    });
  }
} else {
  console.warn(
    "[feedback] WARNING: FEEDBACK_DATASET_REPO and/or HF_TOKEN not set — " +
      "feedback/reports are only written to the local (ephemeral) disk and " +
      "WILL BE LOST on the next restart/redeploy. Set both env vars to persist them."
  );
}
// -----------------------------------------------------------------------------

// --- Safety guardrail ------------------------------------------------------
// A dedicated, conservative moderation pass that runs on every uploaded
// image BEFORE the playful aesthetic-analysis prompt. Its only job is to
// tell whether a photo needs to be routed to a supportive/safety message
// (or an outright block) instead of the normal "Discover Vibe" flow.
//
// Categories, in escalation order (most severe wins if several apply):
//  - "minor_safety": the photo appears to show a real person who looks
//                 under 18 in a sexual, intimate, or otherwise sexualized
//                 context. Highest priority — always wins over every other
//                 category, and the app never renders "vibe" content for it.
//  - "self_harm": the photo suggests a REAL, personal risk of suicide or
//                 self-harm (visible self-harm injuries, a suicide note,
//                 a means clearly staged for an attempt, etc.).
//  - "dangerous": real weapons/violence/gore/extremist content not tied to
//                 self-harm.
//  - "death":     a real deceased person / graphic aftermath of death /
//                 explicit funerary imagery of a body. No self-harm risk
//                 implied — just not something to turn into a "vibe".
//  - "safe":      everything else (the overwhelming majority of uploads).
//
// Deliberately conservative: costumes, movie/game stills, historical or
// documentary photography, dark fashion/art (skulls, gothic, memento mori,
// gravestones without a visible body), and ordinary non-sexualized photos
// of minors (family photos, school photos, sports, everyday swimwear)
// should stay "safe" — the goal is to catch content that is genuinely,
// literally about a real safety/legal concern, not anything merely dark,
// thematically adjacent, or a normal photo that happens to include a child.
//
// IMPORTANT — this is a best-effort AI classifier, NOT a substitute for a
// certified CSAM detection/reporting pipeline (e.g. hash-matching against
// known-CSAM databases via Thorn Safer, Google CSAI Match, or Microsoft
// PhotoDNA), and it does NOT fulfill any legal reporting obligation (e.g.
// US providers must report apparent CSAM to NCMEC's CyberTipline under 18
// U.S.C. §2258A). If this app takes real user uploads in production, get
// a dedicated provider and legal counsel involved before launch — see the
// README note left alongside this function.
type SafetyFlag = "safe" | "self_harm" | "dangerous" | "death" | "minor_safety";

const SAFETY_CLASSIFIER_PROMPT = `You are a careful, conservative content-safety classifier for a public image-upload app (people upload personal photos, fashion shots, art, screenshots, etc. to get a fun "aesthetic" analysis). Look ONLY at the image(s) provided and classify them into exactly ONE of these categories:

- "minor_safety": the image shows a REAL person who appears to be under 18 in a sexual, intimate, partially/fully nude, or otherwise sexualized context — this includes suggestive posing or a sexual/intimate framing even without nudity, when the depicted person appears to be a minor. Be conservative and err toward flagging this category whenever there is genuine, real doubt about age combined with sexual/intimate content. Do NOT flag ordinary, non-sexualized photos of children or teens: family photos, portraits, school photos, sports, everyday swimwear/beach photos, medical or educational imagery. Only flag when the content is genuinely sexual/intimate in nature AND the subject appears to be a minor.
- "self_harm": the image shows REAL self-harm (cuts, burns, or other injuries consistent with self-harm), a person in the act of a suicide attempt, a suicide note, a noose/ligature staged for suicide, or pills/blades/other means arranged in a way that clearly signals a real suicide attempt or plan — i.e. anything that would make a careful viewer genuinely worried the person who took or uploaded this photo may be in personal danger right now.
- "dangerous": REAL weapons pointed at or used against a person, real graphic violence or gore, extremist symbols/propaganda, or other real-world dangerous harm that is NOT about self-harm/suicide.
- "death": a REAL deceased human body, graphic real aftermath of death, or explicit funerary imagery showing a body (e.g. open casket). No suicide/self-harm risk implied.
- "safe": none of the above.

Be conservative and literal, not thematic. Do NOT flag: costumes (Halloween, cosplay), movie/TV/video-game stills, historical or documentary photography without graphic real injury, dark/gothic fashion or art, skull motifs or jewelry, memento mori imagery, or a gravestone/cemetery with no visible body. Those all stay "safe" even though they may reference death or danger as a theme. Only escalate when the image is genuinely, literally showing a real instance of that category.

If several images are provided, evaluate the whole set and return the single most severe category found, using this priority if more than one applies: minor_safety > self_harm > dangerous > death > safe.

Respond with only the classification.`;

async function classifyImageSafety(ai: GoogleGenAI, imageParts: any[]): Promise<SafetyFlag> {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-lite",
      contents: {
        parts: [{ text: SAFETY_CLASSIFIER_PROMPT }, ...imageParts],
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            flag: {
              type: Type.STRING,
              format: "enum",
              enum: ["safe", "self_harm", "dangerous", "death", "minor_safety"],
              description: "The single most severe safety category that genuinely, literally applies to the image(s).",
            },
          },
          required: ["flag"],
        },
      },
    });

    const text = response.text;
    if (!text) return "safe";

    const parsed = JSON.parse(text.trim());
    const flag = parsed?.flag;
    if (flag === "self_harm" || flag === "dangerous" || flag === "death" || flag === "minor_safety" || flag === "safe") {
      return flag;
    }
    return "safe";
  } catch (error) {
    // Fail OPEN on a classifier error (network hiccup, malformed response, etc.):
    // we log it, but we don't want a transient error in the safety pass to
    // block the entire app. This is a deliberate trade-off — see README.
    // NOTE: this now also applies to minor_safety. Given the stakes, consider
    // switching to fail-CLOSED (reject the request with a generic "try again"
    // error instead of proceeding) if/when this app handles real user uploads.
    console.error("Safety classifier error:", error);
    return "safe";
  }
}
// -----------------------------------------------------------------------------

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  app.use(express.json({ limit: "20mb" }));

  // ── Report an inappropriate/mismatched recommendation ─────────────────
  const REPORT_REASONS = new Set(["offensive", "mismatched", "other"]);

  app.post("/api/report", async (req, res) => {
    try {
      const body = req.body || {};
      const reason = body.reason_category;
      if (!REPORT_REASONS.has(reason)) {
        return res.status(400).json({ error: `reason_category must be one of ${[...REPORT_REASONS].join(", ")}` });
      }
      const id = await appendFeedback(REPORTS_FILE, {
        type: "report",
        category: typeof body.category === "string" ? body.category : null, // 'movies' | 'novels' | 'artists'
        item_title: typeof body.item_title === "string" ? body.item_title : null,
        item_author: typeof body.item_author === "string" ? body.item_author : null,
        item_reason: typeof body.item_reason === "string" ? body.item_reason.slice(0, 1000) : null,
        aesthetic: typeof body.aesthetic === "string" ? body.aesthetic : null,
        moods: Array.isArray(body.moods) ? body.moods : [],
        reason_category: reason,
        reason_text: (typeof body.reason_text === "string" ? body.reason_text : "").trim().slice(0, 1000),
        nonce: typeof body.nonce === "string" ? body.nonce : null,
      });
      scheduleQuickFeedbackSync();
      res.json({ ok: true, id });
    } catch (error) {
      console.error("Error saving report:", error);
      res.status(500).json({ error: "Failed to save report." });
    }
  });

  // ── General app-usage feedback (not tied to one recommendation) ───────
  app.post("/api/feedback", async (req, res) => {
    try {
      const body = req.body || {};
      const rating = body.rating;
      const comment = (typeof body.comment === "string" ? body.comment : "").trim().slice(0, 2000);
      const accurate = typeof body.accurate === "boolean" ? body.accurate : null;
      const usefulRecommendations = typeof body.useful_recommendations === "boolean" ? body.useful_recommendations : null;
      const wouldRecommend = typeof body.would_recommend === "boolean" ? body.would_recommend : null;
      const whyNot = (typeof body.why_not === "string" ? body.why_not : "").trim().slice(0, 1000);

      if (rating !== null && rating !== undefined && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
        return res.status(400).json({ error: "rating must be an integer from 1 to 5" });
      }
      const hasAny = !!(rating || comment || accurate !== null || usefulRecommendations !== null || wouldRecommend !== null);
      if (!hasAny) {
        return res.status(400).json({ error: "provide at least one answer" });
      }

      const id = await appendFeedback(APP_FEEDBACK_FILE, {
        type: "app_feedback",
        rating: rating ?? null,
        accurate,
        useful_recommendations: usefulRecommendations,
        would_recommend: wouldRecommend,
        why_not: whyNot,
        comment,
        last_aesthetic: typeof body.last_aesthetic === "string" ? body.last_aesthetic : null,
        last_moods: Array.isArray(body.last_moods) ? body.last_moods : [],
        nonce: typeof body.nonce === "string" ? body.nonce : null,
      });
      scheduleQuickFeedbackSync();
      res.json({ ok: true, id });
    } catch (error) {
      console.error("Error saving feedback:", error);
      res.status(500).json({ error: "Failed to save feedback." });
    }
  });
  // -----------------------------------------------------------------------

  // API constraints: Only use Gemini if API key is present
  const initGemini = () => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not set.");
    }
    return new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  };

  app.post("/api/analyze", async (req, res) => {
    try {
      const { image, images } = req.body;
      const imageList = images || (image ? [image] : []);

      if (imageList.length === 0) {
        return res.status(400).json({ error: "No image file provided." });
      }

      const ai = initGemini();

      const imageParts: any[] = [];
      for (const img of imageList) {
        const splitParts = img.split(";base64,");
        if (splitParts.length === 2) {
          const mimeType = splitParts[0].split(":")[1];
          const base64Data = splitParts[1];
          imageParts.push({ inlineData: { mimeType, data: base64Data } });
        }
      }

      if (imageParts.length === 0) {
         return res.status(400).json({ error: "Invalid image format." });
      }

      // --- Safety guardrail -------------------------------------------------
      // Classify the image(s) BEFORE running the playful aesthetic prompt.
      // If anything sensitive is detected, short-circuit here: never generate
      // hashtags/mood/movie-recommendations for that content.
      const safetyFlag = await classifyImageSafety(ai, imageParts);
      if (safetyFlag !== "safe") {
        return res.json({ safety: { flag: safetyFlag } });
      }
      // -----------------------------------------------------------------------

      const parts: any[] = [];
      const prompt = `Analyze this image (or collection of images). Determine its overarching moods (e.g., joyful, sad, playful, absurd, comic, awe), its aesthetic, provide short, punchy, absurd, and playful tags describing its artistic style (be creative and dramatic, formatting them as hashtags like #corporate_villain_chic or #sartorial_sociopathy), extract 3 to 5 primary color hex codes used in this image, suggest 2 to 3 exact Google Fonts family names that match this aesthetic, and identify which world continent(s) (e.g. Europe, America, Africa, Asia, Oceania) strongly influence this aesthetic. To accurately spot continent influences, you must closely examine details such as motifs, jewelries, clothing cuts, hairstyles, and fabrics. At the same time, identify if there is a conceptual or visual "twist" in the image(s)—an unexpected element, a subversion of expectations, or something uncanny. If there is a twist, describe it. CRITICAL: Whenever you mention "tradition" or "traditional" anywhere in your analysis or twist, you MUST be precise and specify exactly which country, culture, or continent it originates from. Then, generate relevant, high-quality, and diverse search queries that someone inspired by this image might look up on YouTube, Wikipedia, and Reddit. Make sure these search queries strongly reflect the mood and artistic style tags, not just the literal subject. Even if the visual subject is "Fashion", if the moods are "awe, ethereal, mysterious" and tags are "#botanical_dystopia", you should include queries reflecting broader related themes like "alien forest", "deep sea mysterious creatures", or "unreal ecosystems". Ensure the aesthetic is well reflected across various domains.`;
      
      parts.push({ text: prompt });
      parts.push(...imageParts);

      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-lite",
        contents: {
          parts: parts
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              mood: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "The primary and secondary moods evoked by the image (e.g., joyful, sad, playful, absurd, comic, awe)."
              },
              aesthetic: {
                type: Type.STRING,
                description: "The visual aesthetic of the image (e.g. cyberpunk, minimalist, cottagecore)."
              },
              styleDetails: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "Short, punchy, absurd, and playful tags describing the image's artistic style, formatted as hashtags (e.g., '#corporate_villain_chic', '#90s_minimalist_despair')."
              },
              twist: {
                type: Type.OBJECT,
                properties: {
                  hasTwist: {
                    type: Type.BOOLEAN,
                    description: "True if there is a conceptual or visual twist in the image."
                  },
                  description: {
                    type: Type.STRING,
                    description: "A short description of the twist if present. Empty string if none."
                  }
                },
                required: ["hasTwist", "description"]
              },
              colors: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "3 to 5 primary color hex codes found in the image (e.g. '#FF5733', '#000000')."
              },
              fonts: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "2 to 3 exact Google Fonts family names (e.g. 'Inter', 'Space Grotesk', 'Playfair Display') that match the aesthetic."
              },
              continents: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "World continent(s) (e.g. 'Europe', 'America', 'Africa', 'Asia') that influence this aesthetic."
              },
              searchCategories: {
                type: Type.ARRAY,
                description: "Divide the search links into categories like 'Fashion', 'Architecture & Design', 'Science', 'Cinema', 'Literature', 'History', etc. You MUST include 'Science' and 'History' categories. Order them starting from the most related to the aesthetic to the least related.",
                items: {
                  type: Type.OBJECT,
                  properties: {
                    categoryName: { type: Type.STRING },
                    youtubeQueries: { type: Type.ARRAY, items: { type: Type.STRING } },
                    wikipediaQueries: { type: Type.ARRAY, items: { type: Type.STRING } },
                    redditQueries: { type: Type.ARRAY, items: { type: Type.STRING } }
                  },
                  required: ["categoryName", "youtubeQueries", "wikipediaQueries", "redditQueries"]
                }
              }
            },
            required: ["mood", "aesthetic", "styleDetails", "twist", "colors", "fonts", "continents", "searchCategories"]
          }
        }
      });

      const text = response.text;
      if (!text) {
        throw new Error("Empty response from AI model.");
      }

      const jsonResult = JSON.parse(text.trim());
      res.json(jsonResult);

    } catch (error: any) {
      console.error("Error analyzing image:", error);
      res.status(500).json({ error: error.message || "Failed to analyze image." });
    }
  });

  app.post("/api/annotate", async (req, res) => {
    try {
      const { image } = req.body;
      if (!image) {
        return res.status(400).json({ error: "No image file provided." });
      }

      const ai = initGemini();
      
      const parts = image.split(";base64,");
      if (parts.length !== 2) {
         return res.status(400).json({ error: "Invalid image format." });
      }
      
      const mimeType = parts[0].split(":")[1];
      const base64Data = parts[1];

      const prompt = `Analyze this image and identify 3 to 5 specific visual elements of interest that contribute to its overarching aesthetic. For each element, provide its approximate X and Y coordinates (a point from 0 to 1000, where 0,0 is top left and 1000,1000 is bottom right) and a short comment explaining how it builds the aesthetic.`;

      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-lite", // Use a stronger model for bounding box coords
        contents: {
          parts: [
            { text: prompt },
            { inlineData: { mimeType, data: base64Data } }
          ]
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              annotations: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    x: {
                      type: Type.NUMBER,
                      description: "X coordinate (0 to 1000) from the left edge."
                    },
                    y: {
                      type: Type.NUMBER,
                      description: "Y coordinate (0 to 1000) from the top edge."
                    },
                    comment: {
                      type: Type.STRING,
                      description: "A short, insightful comment about this specific part of the image and its aesthetic."
                    }
                  },
                  required: ["x", "y", "comment"]
                }
              }
            },
            required: ["annotations"]
          }
        }
      });

      const text = response.text;
      if (!text) {
        throw new Error("Empty response from AI model.");
      }

      const jsonResult = JSON.parse(text.trim());
      res.json(jsonResult);
    } catch (error: any) {
      console.error("Error annotating image:", error);
      res.status(500).json({ error: error.message || "Failed to annotate image." });
    }
  });

  app.post("/api/mismatch", async (req, res) => {
    try {
      const { images, context } = req.body;
      if (!images || images.length < 2) {
        return res.status(400).json({ error: "Requires at least 2 images." });
      }

      const ai = initGemini();
      
      const parts: any[] = [];
      const prompt = `Analyze this collection of images. We have decoded this general aesthetic for the collection:
Moods: ${context?.mood?.join(', ') || 'N/A'}
Aesthetic: ${context?.aesthetic || 'N/A'}
Artistic tags: ${context?.styleDetails?.join(', ') || 'N/A'}
Colors: ${context?.colors?.join(', ') || 'N/A'}
Fonts: ${context?.fonts?.join(', ') || 'N/A'}

Your goal is to determine if ANY of the provided images DOES NOT MATCH this aesthetic. Do not look for minor differences like photography angles, aspect ratios or subject matter. Focus entirely on whether an image deviates from the aesthetic vibe. 
If there is an image that breaks this aesthetic cohesion, identify it and describe the aesthetic mismatch clearly in 1-2 sentences. 
IMPORTANT INSTRUCTIONS FOR YOUR RESPONSE:
- Write naturally as an aesthetic analyst.
- DO NOT use phrases like "based on the established aesthetic context," "given the artistic tags," or "from the provided metadata." 
- Do not explicitly mention that you were given specific moods, tags, colors, etc. Just explain how the image is an aesthetic mismatch relative to the rest of the collection.
- If all images share the same aesthetic, your entire response must be exactly "No aesthetic mismatch".`;
      
      parts.push({ text: prompt });

      for (const img of images) {
        const splitParts = img.split(";base64,");
        if (splitParts.length === 2) {
          const mimeType = splitParts[0].split(":")[1];
          const base64Data = splitParts[1];
          parts.push({ inlineData: { mimeType, data: base64Data } });
        }
      }

      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-lite",
        contents: {
          parts: parts
        }
      });

      res.json({ text: response.text });
    } catch (error: any) {
      console.error(error);
      res.status(500).json({ error: "Mismatch analysis failed." });
    }
  });

  app.post("/api/recommend", async (req, res) => {
    try {
      const { target, context, images } = req.body;
      if (!target || !context) {
        return res.status(400).json({ error: "Missing required fields." });
      }

      const ai = initGemini();

      let prompt = '';
      if (target === 'movies') {
        prompt = `Based on the following aesthetic context: Moods: ${context.mood?.join(', ') || 'N/A'}. Aesthetic: ${context.aesthetic || 'N/A'}. Artistic tags: ${context.styleDetails?.join(', ') || 'N/A'}. Recommend 3 to 5 movies or TV series that visually and thematically match this aesthetic.`;
      } else if (target === 'novels') {
        prompt = `Based on the following aesthetic context: Moods: ${context.mood?.join(', ') || 'N/A'}. Aesthetic: ${context.aesthetic || 'N/A'}. Artistic tags: ${context.styleDetails?.join(', ') || 'N/A'}. Recommend 3 to 5 novels or books that share this aesthetic and thematic mood.`;
      } else if (target === 'artists') {
         prompt = `Based on the following aesthetic context: Moods: ${context.mood?.join(', ') || 'N/A'}. Aesthetic: ${context.aesthetic || 'N/A'}. Artistic tags: ${context.styleDetails?.join(', ') || 'N/A'}. Recommend 3 to 5 artists (designers, fashion designers, architects, digital artists, etc.) who produce work aligned with this aesthetic. DO NOT include the continent or country in the profession field (e.g. use "Fashion Designer", not "Fashion Designer (Asia)").`;
      } else {
        return res.status(400).json({ error: "Invalid target." });
      }

      prompt += `\nCRITICAL REQUIREMENT: Make sure these recommendations strongly reflect the provided moods and artistic style tags, exploring concepts and parallels beyond just the literal subject matter. For example, if the aesthetic strongly implies "mysterious, ethereal" or tags like "#botanical_dystopia", branch out into recommendations about "alien forests", "unreal ecosystems", "deep sea creatures", etc., rather than just giving more of the same literal surface-level themes. Ensure the vibe is well reflected across various domains.`;

      const existingTitles = req.body.existingTitles;
      if (existingTitles && existingTitles.length > 0) {
        prompt += `\nGenerate AT LEAST 5 MORE recommendations. They MUST be entirely DIFFERENT from the following existing recommendations: ${existingTitles.join(', ')}.`;
      }

      if (context.continents && context.continents.length > 0) {
        prompt += `\n\nCRITICAL REQUIREMENT: The following continent(s) heavily influence this aesthetic: ${context.continents.join(', ')}. You MUST ensure that for EVERY continent listed here, there is at least ONE recommendation that originates from, is created by an artist/author from, or strongly represents that continent. Whenever you mention "tradition", "traditional" or its influence, you MUST be as precise as possible by specifying the exact country, culture, or continent. However, DO NOT explicitly state that a recommendation is "a representative of [Continent]" or that it was included to fulfill a continent requirement in the explanation.`;
      }

      if (images && images.length > 0) {
        prompt += ' The provided image(s) visually exemplify this aesthetic context. Use them to further guide your recommendations.';
      }

      const parts: any[] = [{ text: prompt }];

      if (images && images.length > 0) {
        for (const img of images) {
          const splitParts = img.split(";base64,");
          if (splitParts.length === 2) {
            const mimeType = splitParts[0].split(":")[1];
            const base64Data = splitParts[1];
            parts.push({ inlineData: { mimeType, data: base64Data } });
          }
        }
      }

      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-lite",
        contents: {
          parts: parts
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            description: "List of recommendations",
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING, description: "Title of the work OR Name of the artist" },
                authorOrDirector: { type: Type.STRING, description: "Author OR Director OR Profession of the artist (e.g. Fashion Designer)" },
                reason: { type: Type.STRING, description: "Short explanation of why it matches this aesthetic" }
              },
              required: ["title", "authorOrDirector", "reason"]
            }
          }
        }
      });

      const text = response.text;
      if (!text) {
        throw new Error("Empty response from AI model.");
      }

      let parsedRecommendations = JSON.parse(text.trim());
      
      // Fetch illustrative images from Wikipedia for each recommendation
      const enrichWithImages = async (recs: any[]) => {
        return Promise.all(recs.map(async (rec) => {
          try {
            let searchStr = "";
            if (target === 'movies') searchStr = `${rec.title} film`;
            else if (target === 'novels') searchStr = `${rec.title} novel`;
            else searchStr = `${rec.title} ${rec.authorOrDirector}`;

            const query = encodeURIComponent(searchStr);
            
            // Step 1: Search for the exact page title
            const searchRes = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${query}&srlimit=1&format=json`, {
              headers: { 'User-Agent': 'AestheticExplorerBot/1.0 (contact: aichakorovaev@gmail.com)' }
            });
            const searchData = await searchRes.json();
            
            let imageUrl = undefined;
            if (searchData?.query?.search?.length > 0) {
              const exactTitle = searchData.query.search[0].title;
              
              // Step 2: Fetch the page summary via REST API, which provides non-free poster images as well
              const summaryRes = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(exactTitle.replace(/ /g, '_'))}`, {
                headers: { 'User-Agent': 'AestheticExplorerBot/1.0 (contact: aichakorovaev@gmail.com)' }
              });
              
              if (summaryRes.ok) {
                const summaryData = await summaryRes.json();
                imageUrl = summaryData.originalimage?.source || summaryData.thumbnail?.source;
              }
            }
            
            return { ...rec, imageUrl };
          } catch (e) {
            console.error("Failed to fetch image for", rec.title, e);
            return rec;
          }
        }));
      };

      parsedRecommendations = await enrichWithImages(parsedRecommendations);

      res.json(parsedRecommendations);
    } catch (error: any) {
      console.error("Error fetching recommendations:", error);
      res.status(500).json({ error: error.message || "Failed to fetch recommendations." });
    }
  });

  app.post("/api/preview", async (req, res) => {
    try {
      const { query, platform } = req.body;
      if (!query || !platform) {
        return res.status(400).json({ error: "Missing required fields." });
      }

      const ai = initGemini();
      const prompt = `Give a 1 to 2 sentence preview summary of what a user would likely find if they search for "${query}" on ${platform}. Keep it engaging, highlighting the typical aesthetics, topics, or content of the results.`;

      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-lite",
        contents: prompt,
      });

      res.json({ text: response.text });
    } catch (error: any) {
      console.error("Error generating preview:", error);
      res.status(500).json({ error: error.message || "Failed to generate preview." });
    }
  });

  app.post("/api/more-queries", async (req, res) => {
    try {
      const { platform, context, existingQueries } = req.body;
      if (!platform || !context) {
        return res.status(400).json({ error: "Missing required fields." });
      }

      const ai = initGemini();

      const prompt = `Based on the following aesthetic context: Moods: ${context.mood?.join(', ') || 'N/A'}. Aesthetic: ${context.aesthetic || 'N/A'}. Artistic tags: ${context.styleDetails?.join(', ') || 'N/A'}. 
Generate at least 15 MORE relevant and highly diverse search queries that someone inspired by this aesthetic might look up on ${platform}. 
They must be different from these existing queries: ${existingQueries?.join(', ') || 'none'}.
Categorize the generated queries into categories (e.g. Fashion, Architecture & Design, Science, Cinema, Literature, History, etc.). You MUST include 'Science' and 'History' categories. Order them starting from the most related to the aesthetic.
CRITICAL REQUIREMENT: Make sure these search queries strongly reflect the provided moods and artistic style tags, exploring concepts and parallels beyond just the literal subject matter. Ensure the vibe is well reflected.`;

      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-lite",
        contents: {
          parts: [{ text: prompt }]
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            description: "Categories of search queries",
            items: {
              type: Type.OBJECT,
              properties: {
                categoryName: { type: Type.STRING },
                queries: { type: Type.ARRAY, items: { type: Type.STRING } }
              },
              required: ["categoryName", "queries"]
            }
          }
        }
      });

      const text = response.text;
      if (!text) throw new Error("Empty response from AI");
      const data = JSON.parse(text);
      res.json(data);
    } catch (error: any) {
      console.error(error);
      res.status(500).json({ error: "Failed to generate more queries." });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
