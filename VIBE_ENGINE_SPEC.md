# Vibe Engine Specification

## Overview
A fully serverless, 100% free-tier application hosted on GitHub Pages that allows musicians and producers to search a catalog of 3,000+ songs not by keyword or title, but by **vibe, emotion, and thematic texture**.

This architecture creates the *illusion* of an intelligent LLM understanding your query, but it is actually powered entirely by vector mathematics (Embeddings) and spatial geometry (Qdrant).

## The Core Concept: "It Feels Like an LLM, But It's Not"

When a user types: *"A melancholic acoustic song about driving through the desert at night regretting a phone call,"* they might assume an AI is reading every song and deciding which one fits. 

**What's actually happening:**
1. **The Translation (Hugging Face API):** We send the user's sentence to a free embedding model (like `all-MiniLM-L6-v2`) via Hugging Face's Inference API. This model is essentially a massive, pre-trained dictionary of human concepts. It doesn't "read" the songs; it translates the *concepts* of "melancholic," "desert," "night," and "regret" into a list of 384 numbers (a vector) representing a specific coordinate in "idea space."
2. **The Geometry (Qdrant Cloud):** We take that coordinate and ask our free Qdrant Cloud database: *"Which of our 3,000 songs are sitting closest to this exact coordinate?"* Qdrant calculates the physical distance between the user's query vector and the song vectors we pre-calculated.
3. **The Result (GitHub Pages):** The database instantly returns the 5 songs that mathematically share the most conceptual overlap with the query.

Because the embedding model understands synonyms, context, and emotional weight, the search results feel incredibly intelligent and nuanced—without the massive compute cost, slow response times, or hallucination risks of actually prompting a generative LLM like ChatGPT or Claude.

## Architecture & "Free Forever" Stack

*   **Frontend Hosting:** GitHub Pages (Static HTML/JS/TailwindCSS) - **$0**
*   **Vector Database:** Qdrant Cloud (1GB Free Tier Cluster) - **$0**
*   **Real-time Embedding API:** Hugging Face Serverless Inference API - **$0**
*   **Pre-computation (Ingestion):** Local Python script using Ollama or Hugging Face locally to embed the 3,000 markdown files once and upload them to Qdrant. - **$0**

## The User Journey (For the Musician/Producer)

1.  **The Landing Page:** A clean, dark-mode interface with a single, massive, auto-expanding text box.
2.  **The Prompt:** The placeholder text suggests: *"Describe the feeling, the scene, or the style. (e.g., 'An upbeat, foot-stomping bluegrass track about whiskey and regret' or 'A quiet, devastating ballad about empty houses')."*
3.  **The Search:** Upon pressing Enter:
    *   *Browser -> Hugging Face API (translates query to vector, ~150ms).*
    *   *Browser -> Qdrant Cloud API (searches 3,000 vectors, ~50ms).*
4.  **The Results:** The UI smoothly transitions to display the Top 5 most relevant songs.
    *   Each result shows the title, a "Vibe Match" percentage (derived from the cosine similarity score), and the first verse/chorus snippet.
    *   Clicking a result expands it to show the full lyrics directly from the Qdrant payload or by fetching the raw markdown from the GitHub repository.

## Data Structure

The pre-computed dataset in Qdrant will look like this:

```json
{
  "id": "UUID-based-on-filename",
  "vector": [0.034, -0.112, 0.443], // 384 dimensions
  "payload": {
    "filename": "songs/001-dust-and-thunder.md",
    "title": "Dust and Thunder",
    "lyrics": "The full text of the song...",
    "chords": "[G] [C] [Dm] [Am]",
    "length": 42 // Number of lines
  }
}
```

## Why This is the Killer App

*   **Zero Maintenance:** No backend servers to patch, no databases to scale, no Docker containers to restart.
*   **Instant Inspiration:** Your brother doesn't need to know the titles of the 3,000 songs you generated. He just needs to know what he wants to *play* today, and the engine surfaces the exact material.
*   **Infinitely Scalable:** Whether you have 3,000 songs or 30,000, Qdrant's HNSW index structure means the search takes almost the exact same amount of time (~50 milliseconds).
