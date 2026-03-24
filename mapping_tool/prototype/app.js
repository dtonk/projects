// Oakland Zoo center coordinates
const VENUE_CENTER = [-122.1447, 37.7486];
const VENUE_ZOOM = 16;

// Initial overlay bounds — roughly placed over Oakland Zoo area.
// The image is portrait (2199x3400), so height > width.
// These coords will be dragged into alignment by the user.
const INITIAL_CORNERS = {
  topLeft:     [-122.1500, 37.7530],
  topRight:    [-122.1400, 37.7530],
  bottomRight: [-122.1400, 37.7440],
  bottomLeft:  [-122.1500, 37.7440],
};

// Corner keys in the order MapLibre expects for ImageSource coordinates:
// [top-left, top-right, bottom-right, bottom-left]
const CORNER_ORDER = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'];
const CORNER_LABELS = {
  topLeft: 'Top-Left',
  topRight: 'Top-Right',
  bottomRight: 'Bottom-Right',
  bottomLeft: 'Bottom-Left',
};

// State
let corners = {};
let markers = {};

// Initialize map with satellite basemap (ESRI World Imagery, free, no key required)
const map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    sources: {
      'satellite': {
        type: 'raster',
        tiles: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
        ],
        tileSize: 256,
        attribution: '&copy; Esri, Maxar, Earthstar Geographics',
      }
    },
    layers: [{
      id: 'satellite-layer',
      type: 'raster',
      source: 'satellite',
      minzoom: 0,
      maxzoom: 19,
    }]
  },
  center: VENUE_CENTER,
  zoom: VENUE_ZOOM,
});

// Read the PDF overlay's screen corners and convert to map coordinates
function getCornersFromOverlay() {
  const rect = pdfOverlay.getBoundingClientRect();
  const screenCorners = {
    topLeft:     [rect.left, rect.top],
    topRight:    [rect.right, rect.top],
    bottomRight: [rect.right, rect.bottom],
    bottomLeft:  [rect.left, rect.bottom],
  };
  const geoCorners = {};
  CORNER_ORDER.forEach(key => {
    const lngLat = map.unproject(screenCorners[key]);
    geoCorners[key] = [lngLat.lng, lngLat.lat];
  });
  return geoCorners;
}

// Convert corners to the coordinate array MapLibre ImageSource expects
function getCoordinatesArray() {
  return CORNER_ORDER.map(key => corners[key]);
}

// Update the ImageSource when a corner marker is dragged
function updateOverlay() {
  const source = map.getSource('venue-map');
  if (source) {
    source.setCoordinates(getCoordinatesArray());
  }
}

// Transition from CSS overlay to MapLibre ImageSource for step 2
function enterAlignmentMode() {
  // Snap corners to where the CSS overlay is on screen
  corners = getCornersFromOverlay();

  // Hide the CSS overlay
  pdfOverlay.style.display = 'none';

  // Add the PDF as a MapLibre ImageSource so it stretches with corner drags
  if (map.getSource('venue-map')) {
    map.getSource('venue-map').setCoordinates(getCoordinatesArray());
  } else {
    map.addSource('venue-map', {
      type: 'image',
      url: 'assets/oakland_zoo_map.png',
      coordinates: getCoordinatesArray(),
    });
    map.addLayer({
      id: 'venue-overlay',
      type: 'raster',
      source: 'venue-map',
      paint: { 'raster-opacity': 0.7 },
    });
  }

  // Create or reposition corner markers
  CORNER_ORDER.forEach(key => {
    if (markers[key]) {
      markers[key].setLngLat(corners[key]);
      markers[key].getElement().style.display = '';
      return;
    }

    const el = document.createElement('div');
    el.className = 'corner-handle';

    const label = document.createElement('div');
    label.className = 'corner-label';
    label.textContent = CORNER_LABELS[key];
    el.appendChild(label);

    const marker = new maplibregl.Marker({
      element: el,
      draggable: true,
      anchor: 'center',
    })
      .setLngLat(corners[key])
      .addTo(map);

    marker.on('drag', () => {
      const lngLat = marker.getLngLat();
      corners[key] = [lngLat.lng, lngLat.lat];
      updateOverlay();
    });

    markers[key] = marker;
  });
}

// Transition back to CSS overlay for step 1
function exitAlignmentMode() {
  // Hide markers
  Object.values(markers).forEach(m => {
    m.getElement().style.display = 'none';
  });

  // Remove the MapLibre image layer/source
  if (map.getLayer('venue-overlay')) map.removeLayer('venue-overlay');
  if (map.getSource('venue-map')) map.removeSource('venue-map');

  // Show the CSS overlay again
  pdfOverlay.style.display = '';
}

// PDF overlay element
const pdfOverlay = document.getElementById('pdf-overlay');

// Rotation slider (Step 1)
const rotationSlider = document.getElementById('rotation-slider');
const rotationValue = document.getElementById('rotation-value');

rotationSlider.addEventListener('input', (e) => {
  const bearing = parseInt(e.target.value);
  rotationValue.textContent = bearing + '\u00B0';
  map.setBearing(bearing);
});

// Step transitions
document.getElementById('step-1-done').addEventListener('click', () => {
  enterAlignmentMode();
  document.getElementById('step-1').classList.remove('active-step');
  document.getElementById('step-2').classList.add('active-step');
});

document.getElementById('back-btn').addEventListener('click', () => {
  exitAlignmentMode();
  document.getElementById('step-2').classList.remove('active-step');
  document.getElementById('step-1').classList.add('active-step');
});

// Opacity slider (Step 2)
const opacitySlider = document.getElementById('opacity-slider');
const opacityValue = document.getElementById('opacity-value');

opacitySlider.addEventListener('input', (e) => {
  const val = parseInt(e.target.value);
  opacityValue.textContent = val + '%';
  // Step 1: control CSS overlay opacity. Step 2: control MapLibre layer opacity.
  pdfOverlay.style.opacity = val / 100;
  if (map.getLayer('venue-overlay')) {
    map.setPaintProperty('venue-overlay', 'raster-opacity', val / 100);
  }
});

// "Looks Good" button — logs the control points
document.getElementById('confirm-btn').addEventListener('click', () => {
  // Build control point data: map pixel corners → lat/lon
  // For a 2199x3400 image, the pixel corners are:
  const imageWidth = 2199;
  const imageHeight = 3400;

  const controlPoints = [
    { corner: 'topLeft',     px: 0,          py: 0,           lng: corners.topLeft[0],     lat: corners.topLeft[1] },
    { corner: 'topRight',    px: imageWidth,  py: 0,           lng: corners.topRight[0],    lat: corners.topRight[1] },
    { corner: 'bottomRight', px: imageWidth,  py: imageHeight, lng: corners.bottomRight[0], lat: corners.bottomRight[1] },
    { corner: 'bottomLeft',  px: 0,          py: imageHeight, lng: corners.bottomLeft[0],  lat: corners.bottomLeft[1] },
  ];

  const output = {
    bearing: map.getBearing(),
    controlPoints,
  };

  const resultsDiv = document.getElementById('results');
  const resultsData = document.getElementById('results-data');

  resultsDiv.classList.remove('hidden');
  resultsData.textContent = JSON.stringify(output, null, 2);

  console.log('Control Points:', controlPoints);
  console.log('GDAL command:');
  console.log(buildGdalCommand(controlPoints));
});

// Reset button
document.getElementById('reset-btn').addEventListener('click', () => {
  exitAlignmentMode();
  map.setBearing(0);
  rotationSlider.value = 0;
  rotationValue.textContent = '0\u00B0';
  document.getElementById('step-2').classList.remove('active-step');
  document.getElementById('step-1').classList.add('active-step');
  document.getElementById('results').classList.add('hidden');
});

// Build a sample GDAL command from the control points (for reference/debugging)
function buildGdalCommand(controlPoints) {
  const gcpArgs = controlPoints
    .map(cp => `-gcp ${cp.px} ${cp.py} ${cp.lng} ${cp.lat}`)
    .join(' ');

  return [
    `gdal_translate ${gcpArgs} input.png gcps.tif`,
    `gdalwarp -tps -r bilinear -t_srs EPSG:4326 gcps.tif warped.tif`,
  ].join('\n');
}
