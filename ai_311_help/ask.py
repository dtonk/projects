"""
Ask a question answered from the SF 311 knowledge base.

Usage:
    python ask.py "How do I report a pothole?"
    python ask.py "What do I do if my car was towed?"
"""

import json
import os
import sys
from pathlib import Path

import anthropic
import numpy as np
import voyageai
from dotenv import load_dotenv

load_dotenv()

INDEX_FILE = Path("index.json")
EMBED_MODEL = "voyage-3.5-lite"
CLAUDE_MODEL = "claude-opus-4-7"
TOP_K = 3


def cosine_similarity(a: list[float], b: list[float]) -> float:
    a, b = np.array(a), np.array(b)
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))


def load_index() -> list[dict]:
    if not INDEX_FILE.exists():
        raise FileNotFoundError(
            f"{INDEX_FILE} not found. Run `python index.py` first to build the index."
        )
    return json.loads(INDEX_FILE.read_text(encoding="utf-8"))


def retrieve(query: str, index: list[dict]) -> list[dict]:
    voyage = voyageai.Client(api_key=os.environ["VOYAGE_API_KEY"])
    result = voyage.embed([query], model=EMBED_MODEL, input_type="query")
    query_embedding = result.embeddings[0]

    scored = [
        {**doc, "score": cosine_similarity(query_embedding, doc["embedding"])}
        for doc in index
    ]
    scored.sort(key=lambda d: d["score"], reverse=True)
    return scored[:TOP_K]


def answer(query: str, chunks: list[dict]) -> str:
    context = "\n\n---\n\n".join(
        f"[Source: {c['filename']}]\n{c['text']}" for c in chunks
    )

    system = (
        "You are a helpful San Francisco 311 assistant. "
        "Answer the user's question using only the reference documents provided. "
        "If the answer is not covered in the documents, say so clearly — "
        "do not make up information."
    )

    user_message = f"""Reference documents:

{context}

---

Question: {query}"""

    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    response = client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=1024,
        system=system,
        messages=[{"role": "user", "content": user_message}],
    )

    return response.content[0].text


def main():
    if len(sys.argv) < 2:
        print("Usage: python ask.py \"your question here\"")
        sys.exit(1)

    query = " ".join(sys.argv[1:])

    index = load_index()
    chunks = retrieve(query, index)

    print(f"\nQuestion: {query}\n")
    print("=" * 60)

    reply = answer(query, chunks)
    print(reply)

    print("\n" + "=" * 60)
    print("Sources used:")
    for i, c in enumerate(chunks, 1):
        print(f"  {i}. {c['filename']} (similarity: {c['score']:.3f})")


if __name__ == "__main__":
    main()
