import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";

/**
 * ── Private module notice ──────────────────────────────────────────────
 * The actual AI orchestration for this app — the Gemini prompts, the
 * response schemas that shape each analysis, the aesthetic-mismatch and
 * recommendation logic, and the Wikipedia image-enrichment pipeline — lives
 * in a private module ("./ai/orchestration") that is intentionally NOT
 * included in this public repository. That's the part of the project that
 * took the most iteration, so it's kept closed for now.
 *
 * What you see below is the real route layer: it shows exactly how the
 * frontend talks to the backend (endpoints, inputs, outputs), just not the
 * prompt engineering behind each call.
 *
 * Curious about the internals, or want to run this end-to-end? Reach out:
 * aichakorovaev@gmail.com
 * ────────────────────────────────────────────────────────────────────────
 */
import {
  analyzeImages,
  annotateImage,
  findAestheticMismatch,
  getRecommendations,
  getSearchPreview,
  getMoreQueries,
} from "./ai/orchestration";

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  app.use(express.json({ limit: "20mb" }));

  // POST /api/analyze
  // Body: { image?: string, images?: string[] }  (base64 data URLs)
  // Returns one of:
  //   - { safety: { flag: "minor_safety" | "self_harm" | "dangerous" | "death" } }
  //     if the built-in content-safety classifier flags the upload — no
  //     aesthetic analysis is run in that case, and no other fields are
  //     returned. Checked in priority order minor_safety > self_harm >
  //     dangerous > death; "minor_safety" is a hard block, the others route
  //     to a supportive/neutral notice on the frontend instead of a result.
  //   - { mood, aesthetic, styleDetails, twist, colors, fonts, continents,
  //     searchCategories } otherwise.
  // The classifier prompt itself lives in the private orchestration module,
  // like the rest of the AI logic — see the README note on what's not in
  // this repo. It's a best-effort AI pass, not a certified detection system,
  // and doesn't fulfill any legal reporting obligation on its own.
  app.post("/api/analyze", async (req, res) => {
    try {
      const { image, images } = req.body;
      const imageList = images || (image ? [image] : []);

      if (imageList.length === 0) {
        return res.status(400).json({ error: "No image file provided." });
      }

      const result = await analyzeImages(imageList);
      res.json(result);
    } catch (error: any) {
      console.error("Error analyzing image:", error);
      res.status(500).json({ error: error.message || "Failed to analyze image." });
    }
  });

  // POST /api/annotate
  // Body: { image: string }  (base64 data URL)
  // Returns: { annotations: { x: number, y: number, comment: string }[] }
  app.post("/api/annotate", async (req, res) => {
    try {
      const { image } = req.body;
      if (!image) {
        return res.status(400).json({ error: "No image file provided." });
      }

      const result = await annotateImage(image);
      res.json(result);
    } catch (error: any) {
      console.error("Error annotating image:", error);
      res.status(500).json({ error: error.message || "Failed to annotate image." });
    }
  });

  // POST /api/mismatch
  // Body: { images: string[], context: AnalysisResult }
  // Returns: { text: string }  ("No aesthetic mismatch" if the collection is cohesive)
  app.post("/api/mismatch", async (req, res) => {
    try {
      const { images, context } = req.body;
      if (!images || images.length < 2) {
        return res.status(400).json({ error: "Requires at least 2 images." });
      }

      const result = await findAestheticMismatch(images, context);
      res.json(result);
    } catch (error: any) {
      console.error("Error running mismatch analysis:", error);
      res.status(500).json({ error: error.message || "Mismatch analysis failed." });
    }
  });

  // POST /api/recommend
  // Body: { target: "movies" | "novels" | "artists", context: AnalysisResult, images?: string[], existingTitles?: string[] }
  // Returns: { title, authorOrDirector, reason, imageUrl? }[]
  // Recommendations are cross-referenced with Wikipedia to attach an illustrative image where one exists.
  app.post("/api/recommend", async (req, res) => {
    try {
      const { target, context, images, existingTitles } = req.body;
      if (!target || !context) {
        return res.status(400).json({ error: "Missing required fields." });
      }

      const result = await getRecommendations(target, context, images, existingTitles);
      res.json(result);
    } catch (error: any) {
      console.error("Error fetching recommendations:", error);
      res.status(500).json({ error: error.message || "Failed to fetch recommendations." });
    }
  });

  // POST /api/preview
  // Body: { query: string, platform: string }
  // Returns: { text: string }
  app.post("/api/preview", async (req, res) => {
    try {
      const { query, platform } = req.body;
      if (!query || !platform) {
        return res.status(400).json({ error: "Missing required fields." });
      }

      const result = await getSearchPreview(query, platform);
      res.json(result);
    } catch (error: any) {
      console.error("Error generating preview:", error);
      res.status(500).json({ error: error.message || "Failed to generate preview." });
    }
  });

  // POST /api/more-queries
  // Body: { platform: string, context: AnalysisResult, existingQueries?: string[] }
  // Returns: { categoryName: string, queries: string[] }[]
  app.post("/api/more-queries", async (req, res) => {
    try {
      const { platform, context, existingQueries } = req.body;
      if (!platform || !context) {
        return res.status(400).json({ error: "Missing required fields." });
      }

      const result = await getMoreQueries(platform, context, existingQueries);
      res.json(result);
    } catch (error: any) {
      console.error("Error generating more queries:", error);
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
