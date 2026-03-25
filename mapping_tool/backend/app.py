import json
import sqlite3
import uuid
from pathlib import Path

import fitz  # PyMuPDF
import numpy as np
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from PIL import Image
from scipy.interpolate import RBFInterpolator

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
            warped_image_path TEXT,
            control_points TEXT,
            bearing REAL,
            bounds TEXT,
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

# Serve warped/rasterized images
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

class WarpRequest(BaseModel):
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


# ─── Warp ────────────────────────────────────────────────────────────────────

def tps_warp(src_img: np.ndarray, src_points: np.ndarray, dst_points: np.ndarray,
             output_size: tuple[int, int]) -> np.ndarray:
    """
    Thin Plate Spline warp using scipy RBF interpolation.

    src_points: Nx2 array of pixel coordinates on the source image
    dst_points: Nx2 array of corresponding pixel coordinates on the output image
    output_size: (width, height) of the output
    """
    out_w, out_h = output_size

    # Build grid of all output pixel coordinates
    grid_x, grid_y = np.meshgrid(np.arange(out_w), np.arange(out_h))
    grid_pts = np.column_stack([grid_x.ravel(), grid_y.ravel()])

    # Interpolate: for each output pixel, find where it maps in the source
    interp_x = RBFInterpolator(dst_points, src_points[:, 0], kernel="thin_plate_spline")
    interp_y = RBFInterpolator(dst_points, src_points[:, 1], kernel="thin_plate_spline")

    map_x = interp_x(grid_pts).reshape(out_h, out_w).astype(np.float32)
    map_y = interp_y(grid_pts).reshape(out_h, out_w).astype(np.float32)

    # Sample source image at mapped coordinates (with bounds checking)
    map_x = np.clip(map_x, 0, src_img.shape[1] - 1).astype(int)
    map_y = np.clip(map_y, 0, src_img.shape[0] - 1).astype(int)

    # Create output with alpha channel
    if src_img.ndim == 3:
        output = src_img[map_y, map_x]
    else:
        output = src_img[map_y, map_x]

    # Set out-of-bounds pixels to transparent
    mask = (map_x >= 0) & (map_x < src_img.shape[1]) & (map_y >= 0) & (map_y < src_img.shape[0])

    return output, mask


@app.post("/warp/{map_id}")
async def warp_map(map_id: str, req: WarpRequest):
    conn = get_db()
    row = conn.execute("SELECT * FROM maps WHERE id = ?", (map_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Map not found")

    conn.execute("UPDATE maps SET status = 'processing' WHERE id = ?", (map_id,))
    conn.commit()

    try:
        # Load the rasterized image
        img = Image.open(row["image_path"]).convert("RGBA")
        img_array = np.array(img)
        img_w, img_h = img.size

        # Extract control points
        src_pixels = np.array([[cp.px, cp.py] for cp in req.control_points])
        geo_coords = np.array([[cp.lng, cp.lat] for cp in req.control_points])

        # Compute bounding box in geo coordinates
        min_lng, min_lat = geo_coords.min(axis=0)
        max_lng, max_lat = geo_coords.max(axis=0)

        bounds = {
            "north": float(max_lat),
            "south": float(min_lat),
            "east": float(max_lng),
            "west": float(min_lng),
        }

        # Map geo coords to output pixel coords within the bounding box.
        # Output image will be same resolution as input.
        out_w = img_w
        out_h = img_h

        # Scale geo coords to output pixel space
        dst_pixels = np.zeros_like(src_pixels)
        dst_pixels[:, 0] = (geo_coords[:, 0] - min_lng) / (max_lng - min_lng) * (out_w - 1)
        dst_pixels[:, 1] = (max_lat - geo_coords[:, 1]) / (max_lat - min_lat) * (out_h - 1)  # flip Y

        # Run TPS warp
        warped_rgb, mask = tps_warp(img_array[:, :, :3], src_pixels, dst_pixels, (out_w, out_h))

        # Build RGBA output with transparency outside the map area
        alpha = np.where(mask, 255, 0).astype(np.uint8)
        warped_rgba = np.dstack([warped_rgb, alpha])

        # Save
        warped_path = DATA_DIR / map_id / "warped.png"
        Image.fromarray(warped_rgba).save(str(warped_path))

        # Update DB
        conn.execute(
            "UPDATE maps SET warped_image_path = ?, control_points = ?, bearing = ?, bounds = ?, status = 'ready' WHERE id = ?",
            (str(warped_path), json.dumps([cp.model_dump() for cp in req.control_points]),
             req.bearing, json.dumps(bounds), map_id),
        )
        conn.commit()
        conn.close()

        return {
            "id": map_id,
            "warped_image_url": f"/data/{map_id}/warped.png",
            "bounds": bounds,
            "status": "ready",
        }

    except Exception as e:
        conn.execute("UPDATE maps SET status = 'error' WHERE id = ?", (map_id,))
        conn.commit()
        conn.close()
        raise HTTPException(500, f"Warp failed: {str(e)}")


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
        result["warped_image_url"] = f"/data/{map_id}/warped.png"
        result["bounds"] = json.loads(row["bounds"])
        result["bearing"] = row["bearing"]
        result["control_points"] = json.loads(row["control_points"])

    return result
