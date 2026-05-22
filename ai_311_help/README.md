# SF 311 Help — A RAG Learning Project

This project is a hands-on example of **Retrieval-Augmented Generation (RAG)**: a technique where you give an LLM access to a private knowledge base so it can answer questions grounded in specific documents rather than just its training data.

The example use case is a SF 311 chatbot. You ask a question like *"How do I report an abandoned car?"* and the tool retrieves the most relevant FAQ documents from a local knowledge base and passes them to Claude to generate an answer.

---

## How RAG Works

Without RAG, an LLM answers from its training data — which may be outdated, generic, or simply unaware of your specific content. RAG solves this by doing two things before calling the LLM:

1. **Index**: Convert each document in your knowledge base into a vector embedding — a list of numbers that captures the document's meaning. Store these alongside the original text.

2. **Retrieve**: When a question arrives, embed the question the same way, then find the documents whose embeddings are most similar (cosine similarity). These are the docs most likely to contain the answer.

3. **Generate**: Pass the retrieved documents as context to the LLM. Instruct it to answer *only from this context*.

```
User question
      │
      ▼
[Embed question] ──► [Cosine similarity vs. all doc embeddings]
                                    │
                       Top-K most similar docs
                                    │
                                    ▼
                    [Prompt: "Answer from these docs: ..."]
                                    │
                                    ▼
                              Claude's answer
```

---

## Project Structure

```
ai_311_help/
├── knowledge_base/          # ~20 Markdown FAQ documents
│   ├── pothole_reporting.md
│   ├── parking_complaints.md
│   └── ...
├── index.py                 # Step 1: build the vector index
├── ask.py                   # Step 2: ask questions
├── requirements.txt
├── .env.example
└── README.md
```

The index is saved locally as `index.json` — a plain JSON file you can open and inspect. Each entry has the document filename, the original text, and its embedding (a list of ~1024 floats).

---

## Setup

### 1. Clone and install dependencies

```bash
cd ai_311_help
pip install -r requirements.txt
```

### 2. Get API keys

You need two API keys:

- **Anthropic**: get one at [console.anthropic.com](https://console.anthropic.com)
- **Voyage AI**: get one at [dash.voyageai.com](https://dash.voyageai.com) — Voyage provides the embedding model. The free tier covers this project easily.

### 3. Create a `.env` file

```bash
cp .env.example .env
```

Edit `.env` and fill in both keys:

```
ANTHROPIC_API_KEY=sk-ant-...
VOYAGE_API_KEY=pa-...
```

### 4. Build the index

```bash
python index.py
```

This reads every `.md` file in `knowledge_base/`, sends them to Voyage AI's embedding API, and saves the resulting vectors to `index.json`. You only need to re-run this when you add or change documents.

### 5. Ask a question

```bash
python ask.py "How do I report a pothole?"
python ask.py "My car was towed. What do I do?"
python ask.py "There's an abandoned vehicle on my street"
```

---

## What Each File Does

### `index.py` — Building the index

```python
result = client.embed(texts, model=EMBED_MODEL, input_type="document")
```

The `input_type="document"` hint tells Voyage to optimize the embedding for storage/retrieval (as opposed to a query). Each document gets a vector of ~1024 floats. These are saved alongside the original text in `index.json`.

### `ask.py` — Answering questions

**Step 1: Embed the question**
```python
result = voyage.embed([query], model=EMBED_MODEL, input_type="query")
```
Using `input_type="query"` here (not "document") — Voyage optimizes the query vector to match against document vectors.

**Step 2: Cosine similarity**
```python
def cosine_similarity(a, b):
    return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))
```
Cosine similarity measures the angle between two vectors. A score of 1.0 means identical direction (perfectly similar); 0.0 means orthogonal (unrelated). We rank all documents and take the top 3.

**Step 3: Prompt Claude with context**
The top-3 documents are injected into the prompt with the instruction: *"Answer only from these documents."* This keeps Claude grounded — it won't hallucinate details that aren't in your knowledge base.

---

## Understanding the Output

```
Question: How do I report a pothole?

============================================================
Potholes are repaired by the San Francisco Department of
Public Works (DPW). You can report them through 311...

============================================================
Sources used:
  1. pothole_reporting.md (similarity: 0.847)
  2. sidewalk_repair.md (similarity: 0.721)
  3. streetlight_outage.md (similarity: 0.634)
```

The similarity scores tell you how relevant each retrieved doc was. A score above ~0.75 is a strong match; below ~0.6 often means the knowledge base doesn't directly cover the topic.

---

## How to Extend This

**Add new topics**: Create a new `.md` file in `knowledge_base/`, then re-run `python index.py`.

**Tune the number of retrieved docs**: Change `TOP_K = 3` in `ask.py`. More docs = more context for Claude (but higher token cost and potential noise).

**Chunk long documents**: This project uses one chunk per file. For larger documents, you'd split each into paragraphs or fixed-size windows, embed each chunk separately, and retrieve at the chunk level. This increases precision for long documents.

**Add a confidence threshold**: If the top similarity score is below some threshold (e.g., 0.6), tell the user the question isn't covered rather than hallucinating an answer.

**Swap in a vector database**: Once your knowledge base grows beyond a few hundred docs, replace the linear scan in `ask.py` with a proper vector DB like [Chroma](https://www.trychroma.com/) or [Pinecone](https://www.pinecone.io/) for fast approximate nearest-neighbor search.

**Build a web UI**: Wrap `ask.py`'s logic in a Flask or FastAPI endpoint and put a simple HTML front end on top.
