#!/usr/bin/env python3
"""
Setup Qdrant Cloud cluster for Vibe Engine.

This script uses the Qdrant Cloud management API to:
1. List existing clusters (or create a free-tier cluster)
2. Create a collection for song embeddings (384-dim, cosine similarity)

Prerequisites:
  - pip install -r requirements.txt
  - .env file with QDRANT_URL and QDRANT_API_KEY set

Usage:
  python setup_qdrant.py
"""

import os
import sys
from dotenv import load_dotenv
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

COLLECTION_NAME = "songs"
VECTOR_SIZE = 384  # all-MiniLM-L6-v2 output dimension


def main():
    qdrant_url = os.getenv("QDRANT_URL")
    qdrant_api_key = os.getenv("QDRANT_API_KEY")

    if not qdrant_url or not qdrant_api_key:
        print("ERROR: QDRANT_URL and QDRANT_API_KEY must be set in .env")
        print()
        print("Steps to get these values:")
        print("1. Go to https://cloud.qdrant.io/")
        print("2. Sign up / log in")
        print("3. Create a free-tier cluster (1GB)")
        print("4. Copy the cluster URL (e.g., https://xyz-abc.aws.cloud.qdrant.io:6333)")
        print("5. Go to 'Data Access Control' > 'API Keys' and create a key")
        print("6. Add both to your .env file")
        sys.exit(1)

    print(f"Connecting to Qdrant at {qdrant_url}...")
    client = QdrantClient(url=qdrant_url, api_key=qdrant_api_key)

    # Check if collection exists
    collections = client.get_collections().collections
    collection_names = [c.name for c in collections]

    if COLLECTION_NAME in collection_names:
        info = client.get_collection(COLLECTION_NAME)
        print(f"Collection '{COLLECTION_NAME}' already exists:")
        print(f"  Points: {info.points_count}")
        print(f"  Vectors: {info.vectors_count}")

        response = input("Delete and recreate? (y/N): ").strip().lower()
        if response == 'y':
            client.delete_collection(COLLECTION_NAME)
            print(f"Deleted collection '{COLLECTION_NAME}'")
        else:
            print("Keeping existing collection.")
            return

    # Create collection
    print(f"Creating collection '{COLLECTION_NAME}' (dim={VECTOR_SIZE}, cosine)...")
    client.create_collection(
        collection_name=COLLECTION_NAME,
        vectors_config=VectorParams(
            size=VECTOR_SIZE,
            distance=Distance.COSINE,
        ),
    )
    print(f"Collection '{COLLECTION_NAME}' created successfully!")

    # Verify
    info = client.get_collection(COLLECTION_NAME)
    print(f"  Status: {info.status}")
    print(f"  Optimizer status: {info.optimizer_status}")
    print("Done! Ready for ingestion.")


if __name__ == "__main__":
    main()
