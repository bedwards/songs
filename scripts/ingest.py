#!/usr/bin/env python3
"""
Ingest all songs into Qdrant Cloud for the Vibe Engine.

Walks songs/, songs1/, songs2/ directories, parses each markdown file,
generates embeddings via HuggingFace Inference API, and uploads to Qdrant.

Usage:
  python ingest.py [--dry-run] [--limit N]
"""

import os
import re
import sys
import json
import time
import hashlib
import argparse
import requests
from typing import Optional, List
from pathlib import Path
from dotenv import load_dotenv
from tqdm import tqdm
from qdrant_client import QdrantClient
from qdrant_client.models import PointStruct

# Load .env from project root
PROJECT_ROOT = Path(__file__).parent.parent
load_dotenv(PROJECT_ROOT / ".env")

COLLECTION_NAME = "songs"
HF_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
HF_API_URL = f"https://router.huggingface.co/hf-inference/models/{HF_MODEL}/pipeline/feature-extraction"
SONG_DIRS = ["songs", "songs1", "songs2"]
BATCH_SIZE = 64  # HuggingFace batch size for embedding
QDRANT_BATCH_SIZE = 100


def parse_song(filepath: Path) -> Optional[dict]:
    """Parse a song markdown file, extracting metadata and content."""
    try:
        raw = filepath.read_text(encoding="utf-8")
    except Exception as e:
        print(f"  WARN: Could not read {filepath}: {e}")
        return None

    # The full content is the raw file as-is — this is what Kevin sees
    full_content = raw

    # Strip the outer code fence if present
    content = raw.strip()
    if content.startswith("```"):
        # Remove first and last ``` lines
        lines = content.split("\n")
        if lines[0].strip().startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        content = "\n".join(lines)

    lines = content.split("\n")

    # Extract metadata from the header lines
    title = lines[0].strip() if lines else filepath.stem
    style = ""
    key = ""
    tempo = ""

    for line in lines[1:6]:  # Check first few lines for metadata
        line_clean = line.strip()
        if line_clean.lower().startswith("style of:"):
            style = line_clean.split(":", 1)[1].strip()
        elif line_clean.lower().startswith("key:"):
            key = line_clean.split(":", 1)[1].strip()
        elif line_clean.lower().startswith("tempo:"):
            tempo = line_clean.split(":", 1)[1].strip()

    # Extract clean lyrics (strip chords, section markers, metadata)
    lyrics_lines = []
    for line in lines:
        stripped = line.strip()
        # Skip empty lines, section headers, metadata lines
        if not stripped:
            continue
        if stripped.startswith("[") and stripped.endswith("]"):
            continue  # Section marker like [Verse 1]
        if any(stripped.lower().startswith(p) for p in [
            "style of:", "key:", "tempo:", "capo:", "tuning:"
        ]):
            continue
        # Strip chord annotations (letter combos in spaces above/between lyrics)
        # Remove standalone chord lines (lines that are mostly chords)
        clean = re.sub(r'[A-G][#b]?(?:m|maj|min|dim|aug|sus|add|7|9|11|13|6|2|4)*(?:/[A-G][#b]?)?', '', stripped)
        clean = clean.strip()
        if len(clean) > 3:  # Keep lines with actual lyric content
            lyrics_lines.append(clean)

    clean_lyrics = " ".join(lyrics_lines)

    # Build embedding text: rich context for semantic search
    parts = []
    if title:
        parts.append(f"Title: {title}")
    if style:
        parts.append(f"Style: {style}")
    if key:
        parts.append(f"Key: {key}")
    if tempo:
        parts.append(f"Tempo: {tempo}")
    parts.append(clean_lyrics)
    embedding_text = " | ".join(parts)

    # Generate a deterministic UUID from the filepath
    relative_path = str(filepath.relative_to(PROJECT_ROOT))
    point_id = hashlib.md5(relative_path.encode()).hexdigest()
    # Convert to UUID-like format for Qdrant
    uuid_str = f"{point_id[:8]}-{point_id[8:12]}-{point_id[12:16]}-{point_id[16:20]}-{point_id[20:32]}"

    return {
        "id": uuid_str,
        "filename": relative_path,
        "title": title,
        "style": style,
        "key": key,
        "tempo": tempo,
        "full_content": full_content,
        "embedding_text": embedding_text,
    }


def get_embeddings(texts: list[str], hf_token: str) -> list[list[float]]:
    """Get embeddings from HuggingFace Inference API."""
    headers = {"Authorization": f"Bearer {hf_token}"}

    for attempt in range(5):
        response = requests.post(
            HF_API_URL,
            headers=headers,
            json={"inputs": texts, "options": {"wait_for_model": True}},
            timeout=120,
        )

        if response.status_code == 200:
            return response.json()
        elif response.status_code == 503:
            # Model loading, wait and retry
            wait = response.json().get("estimated_time", 30)
            print(f"  Model loading, waiting {wait:.0f}s...")
            time.sleep(min(wait, 60))
        elif response.status_code == 429:
            # Rate limited
            print(f"  Rate limited, waiting 30s...")
            time.sleep(30)
        else:
            print(f"  HF API error {response.status_code}: {response.text}")
            if attempt < 4:
                time.sleep(5 * (attempt + 1))
            else:
                raise RuntimeError(f"HuggingFace API failed after 5 attempts: {response.status_code}")

    raise RuntimeError("HuggingFace API failed after all retries")


def collect_songs() -> list[dict]:
    """Collect and parse all songs from all directories."""
    songs = []
    for song_dir in SONG_DIRS:
        dir_path = PROJECT_ROOT / song_dir
        if not dir_path.exists():
            print(f"  WARN: Directory {song_dir}/ not found, skipping")
            continue

        md_files = sorted(dir_path.glob("*.md"))
        print(f"  {song_dir}/: {len(md_files)} files found")

        for f in md_files:
            song = parse_song(f)
            if song:
                songs.append(song)

    return songs


def main():
    parser = argparse.ArgumentParser(description="Ingest songs into Qdrant")
    parser.add_argument("--dry-run", action="store_true", help="Parse songs but don't embed or upload")
    parser.add_argument("--limit", type=int, default=0, help="Limit number of songs to process")
    args = parser.parse_args()

    hf_token = os.getenv("HUGGINGFACE_TOKEN")
    qdrant_url = os.getenv("QDRANT_URL")
    qdrant_api_key = os.getenv("QDRANT_API_KEY")

    if not args.dry_run:
        if not hf_token:
            print("ERROR: HUGGINGFACE_TOKEN not set in .env")
            sys.exit(1)
        if not qdrant_url or not qdrant_api_key:
            print("ERROR: QDRANT_URL and QDRANT_API_KEY must be set in .env")
            sys.exit(1)

    # Collect all songs
    print("Collecting songs...")
    songs = collect_songs()
    print(f"Total songs parsed: {len(songs)}")

    if args.limit > 0:
        songs = songs[:args.limit]
        print(f"Limited to {len(songs)} songs")

    if not songs:
        print("No songs found!")
        sys.exit(1)

    if args.dry_run:
        print("\n--- DRY RUN ---")
        for s in songs[:5]:
            print(f"  {s['filename']}: {s['title']} (style: {s['style']}, key: {s['key']})")
            print(f"    Embedding text preview: {s['embedding_text'][:120]}...")
        print(f"\n  ... and {len(songs) - 5} more songs")
        return

    # Connect to Qdrant
    print(f"\nConnecting to Qdrant at {qdrant_url}...")
    client = QdrantClient(url=qdrant_url, api_key=qdrant_api_key)

    # Verify collection exists
    try:
        info = client.get_collection(COLLECTION_NAME)
        print(f"Collection '{COLLECTION_NAME}' exists (current points: {info.points_count})")
    except Exception as e:
        print(f"ERROR: Collection '{COLLECTION_NAME}' not found. Run setup_qdrant.py first.")
        sys.exit(1)

    # Process in batches
    print(f"\nEmbedding and uploading {len(songs)} songs...")
    total_uploaded = 0

    for batch_start in tqdm(range(0, len(songs), BATCH_SIZE), desc="Batches"):
        batch = songs[batch_start : batch_start + BATCH_SIZE]

        # Get embeddings for this batch
        texts = [s["embedding_text"] for s in batch]
        try:
            embeddings = get_embeddings(texts, hf_token)
        except RuntimeError as e:
            print(f"\nERROR at batch starting at index {batch_start}: {e}")
            print(f"Successfully uploaded {total_uploaded} songs before error.")
            sys.exit(1)

        # Build Qdrant points
        points = []
        for song, vector in zip(batch, embeddings):
            points.append(
                PointStruct(
                    id=song["id"],
                    vector=vector,
                    payload={
                        "filename": song["filename"],
                        "title": song["title"],
                        "style": song["style"],
                        "key": song["key"],
                        "tempo": song["tempo"],
                        "full_content": song["full_content"],
                    },
                )
            )

        # Upload to Qdrant
        client.upsert(collection_name=COLLECTION_NAME, points=points)
        total_uploaded += len(points)

    print(f"\nDone! Uploaded {total_uploaded} songs to Qdrant.")

    # Verify
    info = client.get_collection(COLLECTION_NAME)
    print(f"Collection '{COLLECTION_NAME}' now has {info.points_count} points.")


if __name__ == "__main__":
    main()
