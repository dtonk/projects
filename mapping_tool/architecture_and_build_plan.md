# VenueMap MVP — Architecture & Build Plan

**Concept:** A simple SaaS tool that lets non-technical venue operators (zoos, festivals, botanical gardens) upload their existing PDF map, do a 30-second georeferencing step, and publish an interactive mobile map with GPS "you are here" — no engineering required.

---

## Constraints & Scope

- **Target venues:** Outdoor or semi-outdoor (zoos, music festivals, state fairs, botanical gardens, university open days). Explicitly not indoor-only venues.
- **Target operator:** Non-technical marketing/ops staff. No GIS knowledge assumed.
- **Target visitor:** Anyone on a smartphone, no app install required.
- **MVP cost:** $0–$20/month infrastructure. No funding required.

---

## System Architecture

### High-Level Components

```
┌─────────────────────────────────────────────────────────┐
│                    Operator Web App                      │
│  (Upload PDF → Georeference UI → Pin Editor → Publish)  │
└────────────────────────┬────────────────────────────────┘
                         │ HTTPS
┌────────────────────────▼────────────────────────────────┐
│                     Backend API                          │
│           Node.js (Express) or Python (FastAPI)          │
│                                                          │
│  • PDF ingestion & rasterization (Ghostscript/pdftoppm)  │
│  • Georeferencing transform (GDAL via gdal_translate)    │
│  • Tile/image generation                                 │
│  • Venue & pin CRUD                                      │
│  • Auth (operator accounts)                              │
└──────┬───────────────────────────────┬───────────────────┘
       │                               │
┌──────▼──────┐               ┌────────▼────────┐
│  PostgreSQL  │               │  Object Storage  │
│  + PostGIS   │               │  (Cloudflare R2  │
│              │               │   or AWS S3)     │
│  • venues    │               │                  │
│  • pins      │               │  • original PDFs │
│  • map_meta  │               │  • warped images │
│  • users     │               │  • map tiles     │
└─────────────┘               └─────────────────┘

┌─────────────────────────────────────────────────────────┐
│                   Visitor Web App (PWA)                  │
│         MapLibre GL JS + Browser Geolocation API         │
│  • Displays warped map image as overlay                  │
│  • Blue GPS dot at user's location                       │
│  • Tap pins for info popups                              │
│  • Works offline (cached via Service Worker)             │
└─────────────────────────────────────────────────────────┘
```

---

## Technical Stack (Revised)

| Layer | Technology | Why |
|---|---|---|
| Frontend (Prototype) | Vanilla HTML/JS + MapLibre GL JS | No build step, fast iteration |
| Map library | MapLibre GL JS | Open source fork of Mapbox GL, free |
| Satellite tiles | ESRI World Imagery (free, no key) | No API key required, good quality |
| Backend | Python + FastAPI | Better image processing ecosystem than Node |
| PDF rasterization | PyMuPDF (`fitz`) | Pure Python, no system deps (Ghostscript needs Xcode on macOS) |
| Georeferencing math | scipy RBFInterpolator (TPS) | Pure Python, no system deps (GDAL needs Xcode on macOS) |
| Database | SQLite | Zero infrastructure; migrate to PostgreSQL when needed |
| File storage | Local filesystem | Swap to R2/S3 at deploy time |
| Auth | TBD (Clerk or Supabase Auth) | Phase 2 |
| Hosting | TBD (Railway or Render) | Phase 2+ |

---

## Data Model

```sql
-- Operator accounts
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- A venue with one active map
CREATE TABLE venues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,  -- used in public URL: /map/central-park-zoo
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- The map file and its georeferencing metadata
CREATE TABLE maps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID REFERENCES venues(id),
  pdf_url TEXT,               -- original uploaded PDF
  image_url TEXT,             -- rasterized PNG
  warped_image_url TEXT,      -- GDAL-warped output image
  -- The 4 control points (PDF pixel coords → WGS84 lat/lon)
  -- stored as JSONB: [{px: x, py: y, lng: lon, lat: lat}, ...]
  control_points JSONB,
  -- Bounding box of the warped image for MapLibre overlay
  bounds JSONB,               -- {north, south, east, west}
  status TEXT DEFAULT 'pending', -- pending | processing | ready | error
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Optional info pins
CREATE TABLE pins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  map_id UUID REFERENCES maps(id),
  name TEXT NOT NULL,
  description TEXT,
  hours TEXT,
  category TEXT,              -- e.g. 'exhibit', 'food', 'restroom'
  location GEOGRAPHY(POINT, 4326) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## The Georeferencing UX (Key Product Decision)

Full GCP-based georeferencing (QGIS-style) is too complex for non-technical users. The MVP uses a **4-corner stretch** approach:

**Step 1 — Venue locator**
- Operator types their venue name/address
- Map zooms to the venue (Nominatim geocoder, free)
- Satellite basemap shows actual venue

**Step 2 — Corner alignment**
- PDF is displayed as a semi-transparent overlay on the satellite map
- Operator sees 4 draggable handle dots at the PDF corners
- They drag each corner to align with the matching real-world corner
- Live preview updates as they drag (opacity toggle to check alignment)

**Step 3 — Confirm and process**
- "Looks good" button triggers server-side GDAL warp
- Processing takes ~10–30 seconds for a typical venue map
- Operator is emailed or shown a progress indicator

**The math:** 4-point perspective transform (homography). GDAL's `gdalwarp` with `-tps` (thin plate spline) or `-order 1` handles this. Input: 4 pixel coordinates on the rasterized PDF. Output: 4 WGS84 lat/lon coordinates. GDAL produces a warped GeoTIFF that MapLibre can display as an `ImageSource` overlay.

---

## PDF Processing Pipeline (As Built)

```
User uploads PDF
       │
       ▼
POST /upload
       │
       ▼
Rasterize first page → PNG @ 150 DPI
  (PyMuPDF: fitz.open → page.get_pixmap → save PNG)
       │
       ▼
Store original PDF + rasterized PNG in data/{map_id}/
Store image metadata in SQLite (width, height, status='uploaded')
       │
       ▼
[Operator uses georeferencing UI to set 9 control points]
       │
       ▼
POST /warp/{map_id}  (with 9 GCPs + bearing)
       │
       ▼
Thin Plate Spline warp via scipy RBFInterpolator
  • Map pixel coords → geo coords for all 9 control points
  • Compute bounding box from geo coords
  • Build inverse mapping: for each output pixel, find source pixel
  • Sample source image at mapped coordinates
       │
       ▼
Save warped PNG with alpha transparency (out-of-bounds → transparent)
Store warped_image_url + bounds + control_points in SQLite
Update map status → 'ready'
       │
       ▼
GET /map/{map_id} returns everything the visitor PWA needs
```

---

## Visitor PWA

The visitor experience is a single shareable URL, e.g. `https://venueapp.com/map/oakland-zoo`.

```javascript
// Core MapLibre setup
const map = new maplibregl.Map({
  container: 'map',
  style: 'https://api.maptiler.com/maps/streets/style.json?key=FREE_KEY',
  center: [venueLng, venueLat],
  zoom: 16
});

map.on('load', () => {
  // Add the warped venue map as an image overlay
  map.addSource('venue-map', {
    type: 'image',
    url: mapData.warped_image_url,
    coordinates: [
      [bounds.west, bounds.north],  // top-left
      [bounds.east, bounds.north],  // top-right
      [bounds.east, bounds.south],  // bottom-right
      [bounds.west, bounds.south],  // bottom-left
    ]
  });
  map.addLayer({ id: 'venue-overlay', type: 'raster', source: 'venue-map', paint: { 'raster-opacity': 0.9 } });

  // Add pins
  pins.forEach(pin => {
    new maplibregl.Marker()
      .setLngLat([pin.lng, pin.lat])
      .setPopup(new maplibregl.Popup().setHTML(`<h3>${pin.name}</h3><p>${pin.description}</p>`))
      .addTo(map);
  });

  // GPS "you are here"
  map.addControl(new maplibregl.GeolocateControl({
    positionOptions: { enableHighAccuracy: true },
    trackUserLocation: true,
    showUserHeading: true
  }));
});
```

**PWA features for offline use:**
- Service Worker caches the warped map image and pin data on first load
- Visitor can use the map in airplane mode once cached (important at festivals with poor cell coverage)

---

## Build Plan

### Phase 0 — Validate the core UX (Week 1) ✅ COMPLETE
**Goal:** Prove the georeferencing UX is simple enough for a non-technical person.

- [x] Built static HTML prototype with MapLibre GL JS (not Leaflet — used MapLibre for the whole project)
- [x] Used Oakland Zoo map (PDF + PNG from oaklandzoo.org) as test asset
- [x] Two-step UX flow evolved through testing:
  - **Step 1 — Orientation:** PDF displayed as fixed CSS overlay (always vertical). User rotates the satellite basemap via bearing slider until the venue's orientation matches the PDF. This solved the problem of diagonally-oriented venues (e.g. Oakland Zoo runs SW→NE).
  - **Step 2 — Corner alignment:** PDF is projected onto the map as a MapLibre ImageSource. 9-point warp system: 4 corner handles (blue circles), 4 edge midpoint handles (orange diamonds), and 1 draggable center handle (green circle). Image is split into 4 quadrant ImageSources so each quadrant warps independently for more accurate alignment.
- [x] Opacity slider available in both steps to toggle PDF visibility
- [ ] Test with 3–5 non-technical people
- [ ] Success criteria: they can align the map without help in under 2 minutes

**Key UX decisions from prototyping:**
- Original 4-corner approach worked but couldn't handle venues with non-uniform distortion → added midpoint + center handles (9-point warp)
- Fixed PDF overlay + rotating satellite is much more intuitive than trying to rotate/drag the PDF itself
- Center handle moves all 4 inner quadrant corners together — users found this natural

**Files:** `prototype/index.html`, `prototype/app.js`, `prototype/style.css`, `prototype/assets/oakland_zoo_map.png`

### Phase 1 — Working MVP backend (Weeks 2–3) ✅ COMPLETE
**Goal:** The full pipeline works end-to-end, even if the UI is rough.

**Stack decisions (simplified from original plan):**
- Python + FastAPI (not Node) — better ecosystem for image processing
- SQLite (not PostgreSQL) — zero infrastructure, easy to migrate later
- Local filesystem (not R2) — swap to cloud storage at deploy time
- Inline processing (not BullMQ) — FastAPI handles warp inline, no job queue needed
- PyMuPDF (not Ghostscript) — pure Python PDF rasterization, no system dependency
- scipy RBFInterpolator (not GDAL) — pure Python TPS warp, no system dependency (GDAL requires full Xcode on macOS)

**Endpoints:**
- [x] `POST /upload` — PDF upload → PyMuPDF rasterization @ 150 DPI → PNG stored locally
- [x] `POST /warp/{id}` — accepts 9 control points + bearing → TPS warp via scipy → warped PNG + bounding box
- [x] `GET /map/{id}` — returns map metadata (status, bounds, control points, image URLs)
- [x] Static file serving via `/data/` mount for rasterized and warped images
- [ ] Venue + pin CRUD endpoints (deferred to Phase 2)

**File:** `backend/app.py` (~200 lines, single file), `backend/requirements.txt`

### Phase 2 — Operator UI (Week 3–4)
**Goal:** A real person can go from PDF to published map.

- [ ] Operator signup/login (Clerk or Supabase Auth)
- [ ] PDF upload screen
- [ ] Corner-drag georeferencing UI (the most important screen)
- [ ] Processing status / preview
- [ ] Optional: pin editor (click map to place pin, fill in name/description/hours)
- [ ] Publish button → generates shareable link

### Phase 3 — Visitor PWA (Week 4)
**Goal:** The shareable link works great on a mobile phone.

- [ ] MapLibre map with warped venue image overlay
- [ ] GPS "you are here" dot
- [ ] Pin popups
- [ ] Service Worker for offline caching
- [ ] Mobile-optimized UI (full screen map, minimal chrome)

### Phase 4 — Polish & First Users (Week 5–6)
**Goal:** Get 3 real venues to use it and collect feedback.

- [ ] Basic analytics (page views, GPS permission grant rate)
- [ ] Email notifications when map finishes processing
- [ ] Handle edge cases: landscape vs portrait PDFs, multi-page PDFs (use page 1)
- [ ] Landing page explaining the product
- [ ] Reach out to 10–20 zoos/festivals directly

---

## Cost Estimate at MVP Scale

| Item | Free Tier | Paid |
|---|---|---|
| Hosting (Railway/Render) | 500 hrs/month free | ~$5–20/month |
| PostgreSQL | Free tier (Supabase/Railway) | — |
| Cloudflare R2 storage | 10 GB free | $0.015/GB after |
| MapTiler tiles | 100k requests/month free | $10/month after |
| Clerk auth | 10k monthly active users free | — |
| **Total** | **$0** | **~$35/month at small scale** |

---

## Known Risks & Mitigations

| Risk | Mitigation |
|---|---|
| 4-corner UX is too confusing | Phase 0 prototype test before writing backend code |
| PDF is not a rectangle (decorative borders, irregular shape) | Support 6–8 control points for irregular maps in v1.5 |
| GPS accuracy disappoints users | Label it "approximate location" prominently; set expectations in onboarding |
| Festival maps change daily (stage schedules) | Let operators re-upload/update pins without re-georeferencing |
| MapTiler free tier rate limits hit | Cache aggressively; upgrade to MapTiler paid ($10/month) if needed |
| Venue maps contain copyrighted artwork | ToS: operator represents they have rights to upload; maps stored privately per-venue |

---

## Out of Scope for MVP

- Indoor venues (GPS doesn't work — requires BLE beacons)
- Turn-by-turn wayfinding
- Multilingual support
- Custom branding / white-labeling
- Native iOS/Android apps
- CMS for rich content (photos, videos per exhibit)
- Multi-map venues (e.g. a zoo with a separate children's area map)

---

## Open Questions to Resolve

1. ~~**Backend language:** Node.js or Python?~~ **Resolved: Python + FastAPI.** Better image processing ecosystem (PyMuPDF, scipy, Pillow). No GDAL system dependency needed.
2. ~~**MapTiler dependency:**~~ **Resolved: Using ESRI World Imagery tiles (free, no API key).** Avoids vendor lock-in entirely. Can switch to MapTiler or self-hosted tiles later.
3. **Monetization model:** Per-venue SaaS (~$29–$99/month) vs. per-event (~$199/event) vs. freemium. Festival pricing by event avoids the "we only use it 3 days a year" objection.
