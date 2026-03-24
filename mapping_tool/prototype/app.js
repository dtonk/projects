// Oakland Zoo center coordinates
const VENUE_CENTER = [-122.1447, 37.7486];
const VENUE_ZOOM = 16;

// Image dimensions (2199x3400 PNG)
const IMG_W = 2199;
const IMG_H = 3400;
const HALF_W = IMG_W / 2;
const HALF_H = IMG_H / 2;

// 9 control points:
// TL  TM  TR
// LM  C   RM   (C = draggable, moves all 4 inner quad corners together)
// BL  BM  BR
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

// The 4 quadrants, each defined by which 9-point keys form its corners.
// MapLibre ImageSource order: [top-left, top-right, bottom-right, bottom-left]
const QUADS = [
  { id: 'quad-tl', corners: ['topLeft',  'topMid',     'center',      'leftMid'     ], srcX: 0,      srcY: 0,      srcW: HALF_W, srcH: HALF_H },
  { id: 'quad-tr', corners: ['topMid',   'topRight',   'rightMid',    'center'      ], srcX: HALF_W, srcY: 0,      srcW: HALF_W, srcH: HALF_H },
  { id: 'quad-br', corners: ['center',   'rightMid',   'bottomRight', 'bottomMid'   ], srcX: HALF_W, srcY: HALF_H, srcW: HALF_W, srcH: HALF_H },
  { id: 'quad-bl', corners: ['leftMid',  'center',     'bottomMid',   'bottomLeft'  ], srcX: 0,      srcY: HALF_H, srcW: HALF_W, srcH: HALF_H },
];

// State: geo coords for all 9 points
let pts = {};

// MapLibre markers for each draggable handle
let markers = {};

// Blob URLs for the 4 sliced quadrant images
let quadUrls = {};

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

// Initialise pts from the CSS overlay's screen position
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

// Slice the full image into 4 quadrant blobs and store their URLs.
// Returns a Promise that resolves when all blobs are ready.
function sliceImage() {
  return new Promise((resolve, reject) => {
    // Revoke any previous blob URLs
    Object.values(quadUrls).forEach(url => URL.revokeObjectURL(url));
    quadUrls = {};

    const img = new Image();
    img.onload = () => {
      const pending = QUADS.length;
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
          if (done === pending) resolve();
        }, 'image/png');
      });
    };
    img.onerror = reject;
    img.src = 'assets/oakland_zoo_map.png';
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

const pdfOverlay  = document.getElementById('pdf-overlay');
const loadingMsg  = document.getElementById('loading-msg');
const step1DoneBtn = document.getElementById('step-1-done');

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
  document.getElementById('step-1').classList.remove('active-step');
  document.getElementById('step-2').classList.add('active-step');
});

document.getElementById('back-btn').addEventListener('click', () => {
  exitAlignmentMode();
  document.getElementById('step-2').classList.remove('active-step');
  document.getElementById('step-1').classList.add('active-step');
});

opacitySlider.addEventListener('input', (e) => {
  const val = parseInt(e.target.value);
  opacityValue.textContent = val + '%';
  pdfOverlay.style.opacity = val / 100;
  setQuadOpacity(val / 100);
});

// ─── Confirm / Reset ─────────────────────────────────────────────────────────

document.getElementById('confirm-btn').addEventListener('click', () => {
  const controlPoints = [
    { point: 'topLeft',     px: 0,      py: 0,      lng: pts.topLeft[0],     lat: pts.topLeft[1] },
    { point: 'topMid',      px: HALF_W, py: 0,      lng: pts.topMid[0],      lat: pts.topMid[1] },
    { point: 'topRight',    px: IMG_W,  py: 0,      lng: pts.topRight[0],    lat: pts.topRight[1] },
    { point: 'leftMid',     px: 0,      py: HALF_H, lng: pts.leftMid[0],     lat: pts.leftMid[1] },
    { point: 'center',      px: HALF_W, py: HALF_H, lng: pts.center[0],      lat: pts.center[1] },
    { point: 'rightMid',    px: IMG_W,  py: HALF_H, lng: pts.rightMid[0],    lat: pts.rightMid[1] },
    { point: 'bottomLeft',  px: 0,      py: IMG_H,  lng: pts.bottomLeft[0],  lat: pts.bottomLeft[1] },
    { point: 'bottomMid',   px: HALF_W, py: IMG_H,  lng: pts.bottomMid[0],   lat: pts.bottomMid[1] },
    { point: 'bottomRight', px: IMG_W,  py: IMG_H,  lng: pts.bottomRight[0], lat: pts.bottomRight[1] },
  ];

  const output = { bearing: map.getBearing(), controlPoints };

  document.getElementById('results').classList.remove('hidden');
  document.getElementById('results-data').textContent = JSON.stringify(output, null, 2);

  console.log('Control Points:', controlPoints);
  console.log('GDAL command:\n' + buildGdalCommand(controlPoints));
});

document.getElementById('reset-btn').addEventListener('click', () => {
  exitAlignmentMode();
  map.setBearing(0);
  rotationSlider.value = 0;
  rotationValue.textContent = '0\u00B0';
  document.getElementById('step-2').classList.remove('active-step');
  document.getElementById('step-1').classList.add('active-step');
  document.getElementById('results').classList.add('hidden');
});

// ─── GDAL output ─────────────────────────────────────────────────────────────

function buildGdalCommand(controlPoints) {
  const gcpArgs = controlPoints
    .map(cp => `-gcp ${cp.px} ${cp.py} ${cp.lng} ${cp.lat}`)
    .join(' ');
  return [
    `gdal_translate ${gcpArgs} input.png gcps.tif`,
    `gdalwarp -tps -r bilinear -t_srs EPSG:4326 gcps.tif warped.tif`,
  ].join('\n');
}
