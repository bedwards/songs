# Vibe Engine — Semantic Song Search

## What It Is
A web app that lets musicians search **2,352 original songs** by vibe, mood, scene, or style using AI-powered semantic search. Describe what you want to play, and the engine surfaces songs with full chord sheets — ready to perform.

**Live:** https://vibe-engine.pages.dev

## How It Works

```
Kevin types: "a heartbroken waltz for an empty barstool"
     ↓
[Cloudflare Worker] → HuggingFace embeds query → 384-dim vector
     ↓
[Qdrant Cloud] → finds 10 nearest songs by cosine similarity
     ↓
Kevin gets ranked results with vibe match %, full chord sheets
```

1. **Embedding (HuggingFace):** The query is converted to a 384-dimensional vector using `all-MiniLM-L6-v2`. This model understands synonyms, emotion, and context — "melancholy" and "sad" land near each other in vector space.
2. **Search (Qdrant Cloud):** The vector is compared against 2,352 pre-embedded songs. Each song was embedded with its title, artist style, key, tempo, and lyrics combined.
3. **Results:** Songs are ranked by cosine similarity and returned with the **exact raw content** from the source markdown files — chords, sections, everything.

No LLM involved. No hallucinations. Pure vector math.

## Architecture — Free Forever

| Component | Service | Cost |
|---|---|---|
| Frontend | Cloudflare Pages | $0 |
| API Proxy | Cloudflare Worker | $0 (100K req/day) |
| Embeddings | HuggingFace Inference API | $0 (free credits) |
| Vector DB | Qdrant Cloud (1GB free) | $0 |
| Song Storage | Qdrant payload + GitHub | $0 |

**Why Cloudflare Workers?** GitHub Pages would expose API keys client-side. The Worker keeps HuggingFace and Qdrant credentials server-side.

## Features

### Search
- **Semantic search** — type vibes, moods, scenes, styles, or artist names
- **10 results** ranked by vibe match percentage
- **Full chord sheets** displayed exactly as stored in source files

### Surprise Me
- **150+ curated discovery queries** across 5 categories: moods, scenes, styles, themes, specific use cases
- Shows the query used — so Kevin sees what kinds of searches work
- Category filter pills (All / Moods / Scenes / Styles / Themes / Specific)

### Favorites
- Heart any song to save it (localStorage)
- View all favorites in the sidebar

### Setlists (Albums)
- Create named setlists
- Add songs from search results or favorites
- Drag-to-reorder songs within a setlist
- **Export** — downloads a plain text file with setlist name, numbered songs, and full chord sheets

### Recent Searches
- Last 20 searches saved (localStorage)
- Click to re-run any past search

## Song Catalog

| Directory | Songs | Styles |
|---|---|---|
| `songs/` | 638 | Billy Strings, Townes Van Zandt, Guy Clark, and more |
| `songs1/` | 714 | Todd Snider, Jesse Welles, and more |
| `songs2/` | 1000 | Son Volt, and more |
| **Total** | **2,352** | — |

Each song is a markdown file with Ultimate Guitar-style format: title, style, key, tempo, chords, lyrics, and sections.

## Project Structure

```
songs/
├── frontend/          # Static site (Cloudflare Pages)
│   ├── index.html
│   ├── index.css
│   ├── app.js
│   └── images/
├── worker/            # API proxy (Cloudflare Worker)
│   ├── src/index.js   # /api/search, /api/suggest, /api/stats
│   ├── src/queries.js # 150+ curated discovery queries
│   ├── wrangler.toml
│   └── package.json
├── scripts/           # One-time ingestion
│   ├── ingest.py      # Parse songs → embed via HF → upload to Qdrant
│   ├── setup_qdrant.py
│   └── requirements.txt
├── songs/             # 638 songs
├── songs1/            # 714 songs
├── songs2/            # 1000 songs
├── .env               # Secrets (gitignored)
└── .gitignore
```

## Re-ingestion

If songs are added or changed:
```bash
pip install -r scripts/requirements.txt
python scripts/setup_qdrant.py    # recreate collection if needed
python scripts/ingest.py          # embed & upload all songs (~60s)
```

## Deployment

```bash
# Worker
cd worker && npx wrangler deploy

# Frontend
npx wrangler pages deploy frontend --project-name vibe-engine
```

Secrets are set via `wrangler secret put` (HUGGINGFACE_TOKEN, QDRANT_URL, QDRANT_API_KEY).
