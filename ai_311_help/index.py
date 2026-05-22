"""
Build the vector index from the knowledge base.

Reads every .md file in knowledge_base/, embeds each one with Voyage AI,
and saves the result to index.json. Re-run this whenever the knowledge base changes.
"""

import json
import os
from pathlib import Path

import numpy as np
import voyageai
from dotenv import load_dotenv

load_dotenv()

KNOWLEDGE_BASE_DIR = Path("knowledge_base")
INDEX_FILE = Path("index.json")
EMBED_MODEL = "voyage-3.5-lite"


def load_documents() -> list[dict]:
    docs = []
    for path in sorted(KNOWLEDGE_BASE_DIR.glob("*.md")):
        text = path.read_text(encoding="utf-8")
        docs.append({"filename": path.name, "text": text})
    return docs


def build_index():
    docs = load_documents()
    if not docs:
        raise RuntimeError(f"No .md files found in {KNOWLEDGE_BASE_DIR}/")

    print(f"Embedding {len(docs)} documents with Voyage AI ({EMBED_MODEL})...")

    client = voyageai.Client(api_key=os.environ["VOYAGE_API_KEY"])

    texts = [d["text"] for d in docs]
    result = client.embed(texts, model=EMBED_MODEL, input_type="document")

    index = []
    for doc, embedding in zip(docs, result.embeddings):
        index.append({
            "filename": doc["filename"],
            "text": doc["text"],
            "embedding": embedding,
        })

    INDEX_FILE.write_text(json.dumps(index, indent=2), encoding="utf-8")
    print(f"Saved {len(index)} entries to {INDEX_FILE}")


if __name__ == "__main__":
    build_index()
