const API = 'http://localhost:8000';

// Get map ID from URL: viewer.html?id=xxx
const params = new URLSearchParams(window.location.search);
const mapId = params.get('id');

if (!mapId) {
  document.getElementById('loading').style.display = 'none';
  document.getElementById('error').style.display = 'block';
  document.getElementById('error').textContent = 'No map ID provided. Use ?id=xxx';
}

// ─── Inverse bilinear interpolation ─────────────────────────────────────────
//
// Given 4 corners of a quadrilateral in geo-space and the corresponding
// pixel-space corners, find where a GPS lat/lng maps to in pixel space.
//
// Geo quad corners (in order): c00=TL, c10=TR, c01=BL, c11=BR
// A point P inside the quad satisfies:
//   P = (1-u)(1-v)*c00 + u*(1-v)*c10 + (1-u)*v*c01 + u*v*c11
//
// We solve for (u,v) then map to pixel space using the same interpolation.

function inverseBilinear(p, c00, c10, c01, c11) {
  // p = [lng, lat], corners = [lng, lat]
  const ax = c00[0], ay = c00[1];
  const bx = c10[0] - c00[0], by = c10[1] - c00[1];
  const cx = c01[0] - c00[0], cy = c01[1] - c00[1];
  const dx = c00[0] - c10[0] - c01[0] + c11[0];
  const dy = c00[1] - c10[1] - c01[1] + c11[1];

  const ex = p[0] - ax, ey = p[1] - ay;

  // Solve: ex = b*u + c*v + d*u*v, ey = by*u + cy*v + dy*u*v
  // This is a quadratic in v (or u). Solve via quadratic formula.

  const cross_bd = bx * dy - by * dx;
  const cross_be = bx * ey - by * ex;
  const cross_cd = cx * dy - cy * dx;
  const cross_ce = cx * ey - cy * ex;
  const cross_bc = bx * cy - by * cx;

  // Quadratic in v: (cross_cd)*v^2 + (cross_bc + cross_be - cross_cd... )
  // Using the standard form: A*v^2 + B*v + C = 0
  const A = cross_cd;
  const B = cross_bc + cross_be - cross_ce; // Corrected formula
  const C = -cross_ce;

  // Wait, let me use a cleaner derivation.
  // From the two equations:
  //   ex = bx*u + cx*v + dx*u*v
  //   ey = by*u + cy*v + dy*u*v
  // Solve first for u from the first equation:
  //   u = (ex - cx*v) / (bx + dx*v)  [if bx + dx*v != 0]
  // Substitute into second:
  //   ey = by*(ex - cx*v)/(bx + dx*v) + cy*v + dy*v*(ex - cx*v)/(bx + dx*v)
  //   ey*(bx + dx*v) = by*(ex - cx*v) + cy*v*(bx + dx*v) + dy*v*(ex - cx*v)
  //   ey*bx + ey*dx*v = by*ex - by*cx*v + cy*bx*v + cy*dx*v^2 + dy*ex*v - dy*cx*v^2
  //
  // Collect terms:
  //   (cy*dx - dy*cx)*v^2 + (by*(-cx) + cy*bx + dy*ex - ey*dx)*v + (by*ex - ey*bx) = 0

  const Aq = cx * dy - cy * dx;  // note: negated from above
  const Bq = by * cx - cy * bx - dy * ex + ey * dx;  // note: negated
  const Cq = ey * bx - by * ex;

  let v;
  if (Math.abs(Aq) < 1e-12) {
    // Linear
    if (Math.abs(Bq) < 1e-12) return null;
    v = Cq / Bq;
  } else {
    const disc = Bq * Bq - 4 * Aq * Cq;
    if (disc < 0) return null;
    const sqrtDisc = Math.sqrt(disc);
    const v1 = (-Bq + sqrtDisc) / (2 * Aq);
    const v2 = (-Bq - sqrtDisc) / (2 * Aq);
    // Pick the solution in [0, 1]
    if (v1 >= -0.1 && v1 <= 1.1) v = v1;
    else if (v2 >= -0.1 && v2 <= 1.1) v = v2;
    else return null;
  }

  const denom = bx + dx * v;
  if (Math.abs(denom) < 1e-12) return null;
  const u = (ex - cx * v) / denom;

  if (u < -0.1 || u > 1.1 || v < -0.1 || v > 1.1) return null;

  return [u, v];
}

// ─── Coordinate transform: GPS lat/lng → pixel on PDF ───────────────────────

// The 4 quadrants and their geo/pixel corner mappings.
// Built from control points loaded from the API.
let quadMappings = []; // [{geoCornersQuad, pixelCornersQuad}, ...]

function buildQuadMappings(controlPoints, imgW, imgH) {
  const halfW = imgW / 2;
  const halfH = imgH / 2;

  // Index control points by name
  const cp = {};
  controlPoints.forEach(p => { cp[p.point] = p; });

  // Each quad: geo corners in order [TL, TR, BL, BR] and pixel corners same order.
  // Note: inverseBilinear expects c00=TL, c10=TR, c01=BL, c11=BR
  quadMappings = [
    { // Top-left quad
      geo: [[cp.topLeft.lng, cp.topLeft.lat], [cp.topMid.lng, cp.topMid.lat],
            [cp.leftMid.lng, cp.leftMid.lat], [cp.center.lng, cp.center.lat]],
      pix: [[0, 0], [halfW, 0], [0, halfH], [halfW, halfH]],
    },
    { // Top-right quad
      geo: [[cp.topMid.lng, cp.topMid.lat], [cp.topRight.lng, cp.topRight.lat],
            [cp.center.lng, cp.center.lat], [cp.rightMid.lng, cp.rightMid.lat]],
      pix: [[halfW, 0], [imgW, 0], [halfW, halfH], [imgW, halfH]],
    },
    { // Bottom-left quad
      geo: [[cp.leftMid.lng, cp.leftMid.lat], [cp.center.lng, cp.center.lat],
            [cp.bottomLeft.lng, cp.bottomLeft.lat], [cp.bottomMid.lng, cp.bottomMid.lat]],
      pix: [[0, halfH], [halfW, halfH], [0, imgH], [halfW, imgH]],
    },
    { // Bottom-right quad
      geo: [[cp.center.lng, cp.center.lat], [cp.rightMid.lng, cp.rightMid.lat],
            [cp.bottomMid.lng, cp.bottomMid.lat], [cp.bottomRight.lng, cp.bottomRight.lat]],
      pix: [[halfW, halfH], [imgW, halfH], [halfW, imgH], [imgW, imgH]],
    },
  ];
}

function geoToPixel(lng, lat) {
  const p = [lng, lat];
  for (const quad of quadMappings) {
    const uv = inverseBilinear(p, quad.geo[0], quad.geo[1], quad.geo[2], quad.geo[3]);
    if (uv) {
      const [u, v] = uv;
      if (u >= -0.05 && u <= 1.05 && v >= -0.05 && v <= 1.05) {
        // Bilinear interpolation in pixel space
        const px = (1 - u) * (1 - v) * quad.pix[0][0] + u * (1 - v) * quad.pix[1][0]
                 + (1 - u) * v * quad.pix[2][0] + u * v * quad.pix[3][0];
        const py = (1 - u) * (1 - v) * quad.pix[0][1] + u * (1 - v) * quad.pix[1][1]
                 + (1 - u) * v * quad.pix[2][1] + u * v * quad.pix[3][1];
        return [px, py];
      }
    }
  }
  return null; // GPS position is outside the map
}

// ─── Pixel → display coordinates ────────────────────────────────────────────
//
// The PDF image is displayed in MapLibre as a rectangle.
// Display coordinates = a simple linear mapping from pixels.

let displayBounds = {}; // {west, east, south, north}

function setupDisplayBounds(imgW, imgH, centerLng, centerLat) {
  // Create a rectangular region centered on the venue.
  // Size it to roughly match the real venue extent but preserve image aspect ratio.
  const aspectRatio = imgW / imgH;

  // Use ~0.005 degrees latitude (~550m) as the display height
  const dLat = 0.005;
  // Correct for longitude scaling at this latitude
  const cosLat = Math.cos(centerLat * Math.PI / 180);
  const dLng = dLat * aspectRatio / cosLat;

  displayBounds = {
    west: centerLng - dLng,
    east: centerLng + dLng,
    north: centerLat + dLat,
    south: centerLat - dLat,
  };
}

function pixelToDisplay(px, py, imgW, imgH) {
  const u = px / imgW;
  const v = py / imgH;
  return [
    displayBounds.west + u * (displayBounds.east - displayBounds.west),
    displayBounds.north - v * (displayBounds.north - displayBounds.south),
  ];
}

// ─── Main ───────────────────────────────────────────────────────────────────

let map;
let gpsMarker = null;

async function init() {
  if (!mapId) return;

  try {
    // Load map data from API
    const res = await fetch(`${API}/map/${mapId}`);
    if (!res.ok) throw new Error('Map not found');
    const data = await res.json();

    if (data.status !== 'ready') {
      throw new Error('Map is not ready yet (status: ' + data.status + ')');
    }

    const imgW = data.width;
    const imgH = data.height;
    const controlPoints = data.control_points;

    // Build the coordinate transform
    buildQuadMappings(controlPoints, imgW, imgH);

    // Compute venue center from control points
    const allLng = controlPoints.map(cp => cp.lng);
    const allLat = controlPoints.map(cp => cp.lat);
    const centerLng = allLng.reduce((a, b) => a + b) / allLng.length;
    const centerLat = allLat.reduce((a, b) => a + b) / allLat.length;

    setupDisplayBounds(imgW, imgH, centerLng, centerLat);

    // Create MapLibre map with blank style (no basemap)
    map = new maplibregl.Map({
      container: 'map',
      style: {
        version: 8,
        sources: {},
        layers: [{
          id: 'background',
          type: 'background',
          paint: { 'background-color': '#f0f0f0' },
        }],
      },
      center: [centerLng, centerLat],
      zoom: 16,
      maxZoom: 20,
      minZoom: 13,
    });

    map.on('load', () => {
      // Add the original PDF image as a rectangle
      const coords = [
        [displayBounds.west, displayBounds.north],  // TL
        [displayBounds.east, displayBounds.north],  // TR
        [displayBounds.east, displayBounds.south],  // BR
        [displayBounds.west, displayBounds.south],  // BL
      ];

      map.addSource('venue-map', {
        type: 'image',
        url: `${API}${data.image_url}`,
        coordinates: coords,
      });

      map.addLayer({
        id: 'venue-layer',
        type: 'raster',
        source: 'venue-map',
        paint: { 'raster-opacity': 1.0 },
      });

      // Fit to image bounds
      map.fitBounds(
        [[displayBounds.west, displayBounds.south], [displayBounds.east, displayBounds.north]],
        { padding: 20 }
      );

      document.getElementById('loading').style.display = 'none';

      // Click-to-test: simulate GPS at clicked position
      map.on('click', (e) => {
        // The clicked position is in display coordinates.
        // We need to convert display → pixel → verify it's on the map.
        const clickLng = e.lngLat.lng;
        const clickLat = e.lngLat.lat;

        // Convert display coords back to pixel
        const u = (clickLng - displayBounds.west) / (displayBounds.east - displayBounds.west);
        const v = (displayBounds.north - clickLat) / (displayBounds.north - displayBounds.south);
        const clickPx = u * imgW;
        const clickPy = v * imgH;

        // Now convert pixel → geo (forward mapping, using bilinear interpolation)
        // to simulate what GPS would report at this map position
        const simGeo = pixelToGeo(clickPx, clickPy, controlPoints, imgW, imgH);

        if (simGeo) {
          // Now do the round-trip: pretend GPS gave us simGeo, transform back to pixel
          const mappedPixel = geoToPixel(simGeo[0], simGeo[1]);
          if (mappedPixel) {
            placeGpsDot(mappedPixel[0], mappedPixel[1], imgW, imgH);
            document.getElementById('debug-geo').textContent =
              `GPS: ${simGeo[1].toFixed(6)}, ${simGeo[0].toFixed(6)}`;
            document.getElementById('debug-pixel').textContent =
              `Pixel: (${Math.round(mappedPixel[0])}, ${Math.round(mappedPixel[1])})`;
          }
        }
      });

      // Start real GPS tracking
      startGpsTracking(imgW, imgH);
    });

  } catch (err) {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('error').style.display = 'block';
    document.getElementById('error').textContent = err.message;
  }
}

// Forward mapping: pixel → geo (for click-to-test simulation)
function pixelToGeo(px, py, controlPoints, imgW, imgH) {
  const halfW = imgW / 2;
  const halfH = imgH / 2;

  const cp = {};
  controlPoints.forEach(p => { cp[p.point] = p; });

  // Determine which quadrant the pixel is in
  const quads = [
    { pix: [[0,0],[halfW,0],[0,halfH],[halfW,halfH]],
      geo: [[cp.topLeft.lng,cp.topLeft.lat],[cp.topMid.lng,cp.topMid.lat],
            [cp.leftMid.lng,cp.leftMid.lat],[cp.center.lng,cp.center.lat]] },
    { pix: [[halfW,0],[imgW,0],[halfW,halfH],[imgW,halfH]],
      geo: [[cp.topMid.lng,cp.topMid.lat],[cp.topRight.lng,cp.topRight.lat],
            [cp.center.lng,cp.center.lat],[cp.rightMid.lng,cp.rightMid.lat]] },
    { pix: [[0,halfH],[halfW,halfH],[0,imgH],[halfW,imgH]],
      geo: [[cp.leftMid.lng,cp.leftMid.lat],[cp.center.lng,cp.center.lat],
            [cp.bottomLeft.lng,cp.bottomLeft.lat],[cp.bottomMid.lng,cp.bottomMid.lat]] },
    { pix: [[halfW,halfH],[imgW,halfH],[halfW,imgH],[imgW,imgH]],
      geo: [[cp.center.lng,cp.center.lat],[cp.rightMid.lng,cp.rightMid.lat],
            [cp.bottomMid.lng,cp.bottomMid.lat],[cp.bottomRight.lng,cp.bottomRight.lat]] },
  ];

  for (const quad of quads) {
    const uv = inverseBilinear([px, py], quad.pix[0], quad.pix[1], quad.pix[2], quad.pix[3]);
    if (uv && uv[0] >= -0.05 && uv[0] <= 1.05 && uv[1] >= -0.05 && uv[1] <= 1.05) {
      const [u, v] = uv;
      const lng = (1-u)*(1-v)*quad.geo[0][0] + u*(1-v)*quad.geo[1][0]
                + (1-u)*v*quad.geo[2][0] + u*v*quad.geo[3][0];
      const lat = (1-u)*(1-v)*quad.geo[0][1] + u*(1-v)*quad.geo[1][1]
                + (1-u)*v*quad.geo[2][1] + u*v*quad.geo[3][1];
      return [lng, lat];
    }
  }
  return null;
}

// ─── GPS dot ────────────────────────────────────────────────────────────────

function placeGpsDot(px, py, imgW, imgH) {
  const [displayLng, displayLat] = pixelToDisplay(px, py, imgW, imgH);

  if (gpsMarker) {
    gpsMarker.setLngLat([displayLng, displayLat]);
  } else {
    const el = document.createElement('div');
    el.className = 'gps-dot';
    const pulse = document.createElement('div');
    pulse.className = 'gps-dot-pulse';
    el.appendChild(pulse);

    gpsMarker = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat([displayLng, displayLat])
      .addTo(map);
  }
}

function startGpsTracking(imgW, imgH) {
  if (!navigator.geolocation) return;

  navigator.geolocation.watchPosition(
    (pos) => {
      const pixel = geoToPixel(pos.coords.longitude, pos.coords.latitude);
      if (pixel) {
        placeGpsDot(pixel[0], pixel[1], imgW, imgH);
        document.getElementById('debug-geo').textContent =
          `GPS: ${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`;
        document.getElementById('debug-pixel').textContent =
          `Pixel: (${Math.round(pixel[0])}, ${Math.round(pixel[1])})`;
      }
    },
    (err) => {
      console.log('GPS unavailable:', err.message);
    },
    { enableHighAccuracy: true, maximumAge: 5000 }
  );
}

// ─── Start ──────────────────────────────────────────────────────────────────

init();
