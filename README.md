# Taar Explorer 

Upload an image (or a whole collection) to decode its mood, aesthetic, color palette,
and typography — then dive into curated YouTube, Wikipedia, and Reddit searches, AI-picked
movies/novels/artists, precise visual annotations, and an aesthetic mismatch detector for
multi-image collections. Visual style: cubist / art-deco, ported from the "Cubist Notes"
prototype (animated letter tiles, thick borders, hard drop shadows, a mouse-following eye).

## Run locally

**Prerequisites:** Node.js 20+

```bash
npm install
# GEMINI_API_KEY needs a valid Gemini API key (https://aistudio.google.com/apikey)
echo "GEMINI_API_KEY=your-key-here" > .env.local
npm run dev
```

The app runs at http://localhost:3000.

## Deploy to Render (free tier)

This repo ships with a `render.yaml` Blueprint, so Render can set everything up
automatically:

1. Push this repo to GitHub (or GitLab).
2. On [render.com](https://render.com), click **New → Blueprint** and connect the repo.
   Render reads `render.yaml` and proposes a free "web" service — no credit card needed.
3. When prompted for `GEMINI_API_KEY`, paste your Gemini API key
   ([get one here](https://aistudio.google.com/apikey)). It's stored as a Render **secret**
   (`sync: false` in the Blueprint), never committed to the repo.
4. Click **Deploy Blueprint**. Render runs `npm ci && npm run build`, then starts the app
   with `node dist/server.cjs`. You'll get a `https://aesthetic-explorer.onrender.com`-style
   URL once the build finishes (a couple of minutes).

**About the free tier:** the service spins down after ~15 minutes without traffic and takes
30–60s to wake back up on the next request (cold start) — normal on Render's free plan, no
action needed. If you'd rather avoid that, Render's paid "Starter" plan ($7/mo) keeps it
always-on.

You can also skip the Blueprint and create the Web Service by hand in the Render dashboard;
just set the build command to `npm ci && npm run build`, the start command to
`NODE_ENV=production node dist/server.cjs`, and add `GEMINI_API_KEY` under Environment.

### Note on Hugging Face Spaces

This repo also includes a `Dockerfile` (listens on port 7860) in case you want to deploy it
as a Hugging Face **Docker Space** later — as of mid-2026, HF moved Docker/Gradio Spaces on
the free CPU-basic tier behind a PRO subscription, so it's no longer a free option. The
`Dockerfile` still works as-is (e.g. on Render's Docker runtime, or any other Docker host)
if that ever changes or you decide to subscribe.

## Feedback & reporting

Two lightweight, no-login feedback channels, ported from the "Ami" app:

- **Report a recommendation** — a small flag icon on every artist/movie/novel card lets
  someone mark a pick as offensive, mismatched, or "other", with an optional note.
  `POST /api/report`.
- **General feedback** — a feedback button in the top-left corner (and a one-time
  automatic prompt ~2 minutes after someone's first result) opens a short form: star
  rating, whether the analysis felt accurate, whether the picks were relevant, and a
  would-you-recommend question. `POST /api/feedback`.

Both are appended as JSONL to `feedback_data/reports.jsonl` and
`feedback_data/app_feedback.jsonl` on the server's local disk.

### Making feedback durable

Local disk is **ephemeral** on Render's free tier and on a Hugging Face Docker Space —
it's wiped on every restart/redeploy. So, exactly like Ami does on the Python side with
`huggingface_hub`'s `CommitScheduler`, this server also pushes those two JSONL files to a
private Hugging Face **Dataset** repo — on a 5-minute timer, shortly (30s, debounced)
after any new entry comes in, and once more on a graceful shutdown/redeploy. A sync
failure (bad token, no network) is logged and retried next cycle; it never affects the
person submitting feedback.

To turn this on:

1. Create a private dataset repo on the Hub, e.g. `yourusername/taar-explorer-feedback`.
2. Create an [access token](https://huggingface.co/settings/tokens) with **write** access
   to that repo.
3. Set two env vars / secrets on your host:
   - `FEEDBACK_DATASET_REPO = "yourusername/taar-explorer-feedback"`
   - `HF_TOKEN = <that token>`

Without them, the server logs a one-time warning at startup and feedback still works —
it's just only on local (ephemeral) disk, so it **will be lost** on the next
restart/redeploy. (Render's paid "Starter" plan's persistent disk is the other option, if
you'd rather not use a Hub dataset.)

## Tech

React 19 + Vite + Express (single Node server serving both the API and the built client),
Tailwind CSS v4, Framer Motion, and the Gemini API (`@google/genai`) for image analysis.
