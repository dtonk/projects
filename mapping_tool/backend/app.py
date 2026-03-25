import json
import sqlite3
import uuid
from pathlib import Path

import fitz  # PyMuPDF
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ─── Config ──────────────────────────────────────────────────────────────────

DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(exist_ok=True)

DB_PATH = DATA_DIR / "venuemap.db"
DPI = 150  # PDF rasterization resolution

# ─── Database ────────────────────────────────────────────────────────────────

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn

def init_db():
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS maps (
            id TEXT PRIMARY KEY,
            original_filename TEXT,
            image_path TEXT,
            image_width INTEGER,
            image_height INTEGER,
            control_points TEXT,
            bearing REAL,
            corners TEXT,
            status TEXT DEFAULT 'uploaded',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)
    conn.close()

# ─── App ─────────────────────────────────────────────────────────────────────

app = FastAPI(title="VenueMap API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/data", StaticFiles(directory=str(DATA_DIR)), name="data")


@app.on_event("startup")
def startup():
    init_db()


# ─── Models ──────────────────────────────────────────────────────────────────

class ControlPoint(BaseModel):
    point: str
    px: float
    py: float
    lng: float
    lat: float

class GeoreferenceRequest(BaseModel):
    bearing: float
    control_points: list[ControlPoint]


# ─── PDF Upload ──────────────────────────────────────────────────────────────

@app.post("/upload")
async def upload_pdf(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files are supported")

    map_id = str(uuid.uuid4())
    map_dir = DATA_DIR / map_id
    map_dir.mkdir()

    # Save original PDF
    pdf_path = map_dir / "original.pdf"
    content = await file.read()
    pdf_path.write_bytes(content)

    # Rasterize first page to PNG using PyMuPDF
    doc = fitz.open(pdf_path)
    page = doc[0]
    zoom = DPI / 72  # 72 is PDF default DPI
    mat = fitz.Matrix(zoom, zoom)
    pix = page.get_pixmap(matrix=mat, alpha=False)
    png_path = map_dir / "rasterized.png"
    pix.save(str(png_path))
    doc.close()

    # Store in DB
    conn = get_db()
    conn.execute(
        "INSERT INTO maps (id, original_filename, image_path, image_width, image_height, status) VALUES (?, ?, ?, ?, ?, ?)",
        (map_id, file.filename, str(png_path), pix.width, pix.height, "uploaded"),
    )
    conn.commit()
    conn.close()

    return {
        "id": map_id,
        "filename": file.filename,
        "image_url": f"/data/{map_id}/rasterized.png",
        "width": pix.width,
        "height": pix.height,
        "status": "uploaded",
    }


# ─── Georeference (save control points + compute display corners) ────────────

@app.post("/georeference/{map_id}")
async def georeference_map(map_id: str, req: GeoreferenceRequest):
    conn = get_db()
    row = conn.execute("SELECT * FROM maps WHERE id = ?", (map_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Map not found")

    # The 4 outer corner control points define how MapLibre should display the image.
    # MapLibre ImageSource expects: [top-left, top-right, bottom-right, bottom-left]
    # Each as [lng, lat].
    corner_keys = {'topLeft', 'topRight', 'bottomRight', 'bottomLeft'}
    corner_pts = {cp.point: [cp.lng, cp.lat] for cp in req.control_points if cp.point in corner_keys}

    if len(corner_pts) < 4:
        conn.close()
        raise HTTPException(400, "Must include topLeft, topRight, bottomRight, bottomLeft control points")

    corners = [
        corner_pts['topLeft'],
        corner_pts['topRight'],
        corner_pts['bottomRight'],
        corner_pts['bottomLeft'],
    ]

    conn.execute(
        "UPDATE maps SET control_points = ?, bearing = ?, corners = ?, status = 'ready' WHERE id = ?",
        (json.dumps([cp.model_dump() for cp in req.control_points]),
         req.bearing, json.dumps(corners), map_id),
    )
    conn.commit()
    conn.close()

    return {
        "id": map_id,
        "image_url": f"/data/{map_id}/rasterized.png",
        "corners": corners,
        "status": "ready",
    }


# ─── Map metadata (for visitor PWA) ─────────────────────────────────────────

@app.get("/map/{map_id}")
async def get_map(map_id: str):
    conn = get_db()
    row = conn.execute("SELECT * FROM maps WHERE id = ?", (map_id,)).fetchone()
    conn.close()

    if not row:
        raise HTTPException(404, "Map not found")

    result = {
        "id": row["id"],
        "status": row["status"],
        "image_url": f"/data/{map_id}/rasterized.png",
        "width": row["image_width"],
        "height": row["image_height"],
    }

    if row["status"] == "ready":
        result["corners"] = json.loads(row["corners"])
        result["bearing"] = row["bearing"]
        result["control_points"] = json.loads(row["control_points"])

    return result
