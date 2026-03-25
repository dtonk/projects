const API = 'http://localhost:8000';

// Oakland Zoo center (default — will pan to venue eventually)
const VENUE_CENTER = [-122.1447, 37.7486];
const VENUE_ZOOM = 16;

// 9 control point labels
const POINT_LABELS = {
  topLeft:     'Top-Left',
  topMid:      'Top',
  topRight:    'Top-Right',
  leftMid:     'Left',
  center:      'Center',
  rightMid:    'Right',
  bottomLeft:  'Bottom-Left',
  bottomMid:   'Bottom',
  bottomRight: 'Bottom-Right',
};

// State
let mapId = null;       // from upload response
let imgUrl = '';        // rasterized image URL
let imgW = 0;
let imgH = 0;
let pts = {};           // geo coords for all 9 points
let markers = {};       // MapLibre markers
let quadUrls = {};      // blob URLs for sliced quadrant images

// Derived from image dimensions
let halfW = 0, halfH = 0;
let QUADS = [];

function buildQuads() {
  halfW = imgW / 2;
  halfH = imgH / 2;
  QUADS = [
    { id: 'quad-tl', corners: ['topLeft',  'topMid',     'center',      'leftMid'     ], srcX: 0,     srcY: 0,     srcW: halfW, srcH: halfH },
    { id: 'quad-tr', corners: ['topMid',   'topRight',   'rightMid',    'center'      ], srcX: halfW, srcY: 0,     srcW: halfW, srcH: halfH },
    { id: 'quad-br', corners: ['center',   'rightMid',   'bottomRight', 'bottomMid'   ], srcX: halfW, srcY: halfH, srcW: halfW, srcH: halfH },
    { id: 'quad-bl', corners: ['leftMid',  'center',     'bottomMid',   'bottomLeft'  ], srcX: 0,     srcY: halfH, srcW: halfW, srcH: halfH },
  ];
}

// ─── Map setup ──────────────────────────────────────────────────────────────

const map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    sources: {
      satellite: {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        attribution: '&copy; Esri, Maxar, Earthstar Geographics',
      },
    },
    layers: [{ id: 'satellite-layer', type: 'raster', source: 'satellite', minzoom: 0, maxzoom: 19 }],
  },
  center: VENUE_CENTER,
  zoom: VENUE_ZOOM,
});

// ─── Geometry helpers ────────────────────────────────────────────────────────

function midpoint(a, b) {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function initPointsFromOverlay() {
  const rect = pdfOverlay.getBoundingClientRect();
  function unproj(x, y) {
    const ll = map.unproject([x, y]);
    return [ll.lng, ll.lat];
  }
  const tl = unproj(rect.left,  rect.top);
  const tr = unproj(rect.right, rect.top);
  const br = unproj(rect.right, rect.bottom);
  const bl = unproj(rect.left,  rect.bottom);

  pts.topLeft     = tl;
  pts.topRight    = tr;
  pts.bottomRight = br;
  pts.bottomLeft  = bl;
  pts.topMid      = midpoint(tl, tr);
  pts.rightMid    = midpoint(tr, br);
  pts.bottomMid   = midpoint(br, bl);
  pts.leftMid     = midpoint(bl, tl);
  pts.center      = midpoint(midpoint(tl, br), midpoint(tr, bl));
}

// ─── Image slicing ───────────────────────────────────────────────────────────

function sliceImage() {
  return new Promise((resolve, reject) => {
    Object.values(quadUrls).forEach(url => URL.revokeObjectURL(url));
    quadUrls = {};

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      let done = 0;
      QUADS.forEach(quad => {
        const canvas = document.createElement('canvas');
        canvas.width  = quad.srcW;
        canvas.height = quad.srcH;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, quad.srcX, quad.srcY, quad.srcW, quad.srcH, 0, 0, quad.srcW, quad.srcH);
        canvas.toBlob(blob => {
          quadUrls[quad.id] = URL.createObjectURL(blob);
          done++;
          if (done === QUADS.length) resolve();
        }, 'image/png');
      });
    };
    img.onerror = reject;
    img.src = imgUrl;
  });
}

// ─── MapLibre quad sources/layers ────────────────────────────────────────────

function getQuadCoords(quad) {
  return quad.corners.map(key => pts[key]);
}

function addQuadLayers(opacity) {
  QUADS.forEach(quad => {
    map.addSource(quad.id, {
      type: 'image',
      url: quadUrls[quad.id],
      coordinates: getQuadCoords(quad),
    });
    map.addLayer({
      id: quad.id + '-layer',
      type: 'raster',
      source: quad.id,
      paint: { 'raster-opacity': opacity },
    });
  });
}

function removeQuadLayers() {
  QUADS.forEach(quad => {
    if (map.getLayer(quad.id + '-layer')) map.removeLayer(quad.id + '-layer');
    if (map.getSource(quad.id))           map.removeSource(quad.id);
  });
}

function updateQuadCoords() {
  QUADS.forEach(quad => {
    const source = map.getSource(quad.id);
    if (source) source.setCoordinates(getQuadCoords(quad));
  });
}

function setQuadOpacity(opacity) {
  QUADS.forEach(quad => {
    if (map.getLayer(quad.id + '-layer')) {
      map.setPaintProperty(quad.id + '-layer', 'raster-opacity', opacity);
    }
  });
}

// ─── Markers ─────────────────────────────────────────────────────────────────

function createMarkers() {
  Object.keys(POINT_LABELS).forEach(key => {
    if (markers[key]) {
      markers[key].setLngLat(pts[key]);
      markers[key].getElement().style.display = '';
      return;
    }

    const isCorner = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'].includes(key);
    const isCenter = key === 'center';

    const el = document.createElement('div');
    el.className = isCenter ? 'center-handle' : isCorner ? 'corner-handle' : 'mid-handle';

    const label = document.createElement('div');
    label.className = 'corner-label';
    label.textContent = POINT_LABELS[key];
    el.appendChild(label);

    const marker = new maplibregl.Marker({ element: el, draggable: true, anchor: 'center' })
      .setLngLat(pts[key])
      .addTo(map);

    marker.on('drag', () => {
      const ll = marker.getLngLat();
      pts[key] = [ll.lng, ll.lat];
      updateQuadCoords();
    });

    markers[key] = marker;
  });
}

function hideMarkers() {
  Object.values(markers).forEach(m => {
    m.getElement().style.display = 'none';
  });
}

// ─── Step transitions ────────────────────────────────────────────────────────

const pdfOverlay    = document.getElementById('pdf-overlay');
const loadingMsg    = document.getElementById('loading-msg');
const step1DoneBtn  = document.getElementById('step-1-done');
const opacityGroup  = document.getElementById('opacity-group');

function showStep(stepId) {
  document.querySelectorAll('.step').forEach(s => s.classList.remove('active-step'));
  document.getElementById(stepId).classList.add('active-step');
}

async function enterAlignmentMode() {
  step1DoneBtn.disabled = true;
  loadingMsg.style.display = 'block';

  initPointsFromOverlay();
  await sliceImage();
  const opacity = parseInt(opacitySlider.value) / 100;
  addQuadLayers(opacity);
  createMarkers();

  pdfOverlay.style.display = 'none';
  loadingMsg.style.display = 'none';
  step1DoneBtn.disabled = false;
}

function exitAlignmentMode() {
  hideMarkers();
  removeQuadLayers();
  pdfOverlay.style.display = '';
}

// ─── Upload ─────────────────────────────────────────────────────────────────

const fileInput      = document.getElementById('file-input');
const uploadBtn      = document.getElementById('upload-btn');
const uploadFilename = document.getElementById('upload-filename');
const uploadStatus   = document.getElementById('upload-status');

fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (file) {
    uploadFilename.textContent = file.name;
    uploadBtn.disabled = false;
  }
});

uploadBtn.addEventListener('click', async () => {
  const file = fileInput.files[0];
  if (!file) return;

  uploadBtn.disabled = true;
  uploadStatus.textContent = 'Uploading and processing...';
  uploadStatus.style.display = 'block';

  try {
    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch(`${API}/upload`, { method: 'POST', body: formData });
    if (!res.ok) throw new Error(await res.text());

    const data = await res.json();
    mapId = data.id;
    imgW  = data.width;
    imgH  = data.height;
    imgUrl = `${API}${data.image_url}`;

    buildQuads();

    // Show the rasterized image as the CSS overlay
    pdfOverlay.src = imgUrl;
    pdfOverlay.style.display = '';
    opacityGroup.classList.remove('hidden');

    uploadStatus.style.display = 'none';
    showStep('step-1');
  } catch (err) {
    uploadStatus.textContent = 'Upload failed: ' + err.message;
    uploadBtn.disabled = false;
  }
});

// ─── UI controls ─────────────────────────────────────────────────────────────

const rotationSlider = document.getElementById('rotation-slider');
const rotationValue  = document.getElementById('rotation-value');
const opacitySlider  = document.getElementById('opacity-slider');
const opacityValue   = document.getElementById('opacity-value');

rotationSlider.addEventListener('input', (e) => {
  const bearing = parseInt(e.target.value);
  rotationValue.textContent = bearing + '\u00B0';
  map.setBearing(bearing);
});

step1DoneBtn.addEventListener('click', async () => {
  await enterAlignmentMode();
  showStep('step-2');
});

document.getElementById('back-btn').addEventListener('click', () => {
  exitAlignmentMode();
  showStep('step-1');
});

opacitySlider.addEventListener('input', (e) => {
  const val = parseInt(e.target.value);
  opacityValue.textContent = val + '%';
  pdfOverlay.style.opacity = val / 100;
  setQuadOpacity(val / 100);
});

// ─── Confirm → Warp API ─────────────────────────────────────────────────────

const confirmBtn = document.getElementById('confirm-btn');
const warpStatus = document.getElementById('warp-status');

confirmBtn.addEventListener('click', async () => {
  confirmBtn.disabled = true;
  warpStatus.textContent = 'Saving...';
  warpStatus.style.display = 'block';

  const controlPoints = [
    { point: 'topLeft',     px: 0,     py: 0,     lng: pts.topLeft[0],     lat: pts.topLeft[1] },
    { point: 'topMid',      px: halfW, py: 0,     lng: pts.topMid[0],      lat: pts.topMid[1] },
    { point: 'topRight',    px: imgW,  py: 0,     lng: pts.topRight[0],    lat: pts.topRight[1] },
    { point: 'leftMid',     px: 0,     py: halfH, lng: pts.leftMid[0],     lat: pts.leftMid[1] },
    { point: 'center',      px: halfW, py: halfH, lng: pts.center[0],      lat: pts.center[1] },
    { point: 'rightMid',    px: imgW,  py: halfH, lng: pts.rightMid[0],    lat: pts.rightMid[1] },
    { point: 'bottomLeft',  px: 0,     py: imgH,  lng: pts.bottomLeft[0],  lat: pts.bottomLeft[1] },
    { point: 'bottomMid',   px: halfW, py: imgH,  lng: pts.bottomMid[0],   lat: pts.bottomMid[1] },
    { point: 'bottomRight', px: imgW,  py: imgH,  lng: pts.bottomRight[0], lat: pts.bottomRight[1] },
  ];

  try {
    const res = await fetch(`${API}/georeference/${mapId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bearing: map.getBearing(),
        control_points: controlPoints,
      }),
    });

    if (!res.ok) throw new Error(await res.text());

    // Keep bearing and quad layers — hide markers, lock map, bump opacity.
    hideMarkers();
    setQuadOpacity(0.9);
    opacityGroup.classList.add('hidden');

    document.getElementById('result-map-id').textContent = 'Map ID: ' + mapId;

    warpStatus.style.display = 'none';
    confirmBtn.disabled = false;
    showStep('step-3');
  } catch (err) {
    warpStatus.textContent = 'Failed: ' + err.message;
    confirmBtn.disabled = false;
  }
});

// ─── Reset ──────────────────────────────────────────────────────────────────

document.getElementById('reset-btn').addEventListener('click', () => {
  exitAlignmentMode();
  map.setBearing(0);
  rotationSlider.value = 0;
  rotationValue.textContent = '0\u00B0';
  opacityGroup.classList.add('hidden');
  pdfOverlay.src = '';
  pdfOverlay.style.display = 'none';
  fileInput.value = '';
  uploadFilename.textContent = '';
  uploadBtn.disabled = true;
  mapId = null;
  showStep('step-0');
});
