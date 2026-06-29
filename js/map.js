// ─────────────────────────────────────────────────────────
// Map
//
// Two views: 3D globe (globe.gl) and flat map (Leaflet).
// Globe is the default. Clicking a pin, or zooming in very
// close, transitions to Atlas flat map at that location.
//
// CSS approach: #globe-container sits at z-index 50, above
// the Leaflet map (z-index 1). To show flat map, the globe
// container gets class "flat-mode" (display:none). The map
// is always rendered so Leaflet tiles stay loaded.
//
// Reads:  locations, connectedUIDs, currentUser, selectedUids
// Writes: map, clusterGroup, activeStyle, selectedUids,
//         allUploaders, globeActive, globeInstance
// ─────────────────────────────────────────────────────────
let selectedUids  = new Set();
let allUploaders  = new Map();
let globeActive   = true;
let globeInstance = null;

// ── Flat map ──────────────────────────────────────────────
const map = L.map('map', { center: [40, -96], zoom: 3, zoomControl: false });
L.control.zoom({ position: 'bottomleft' }).addTo(map);

var tileSets = {
  streets: L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    { attribution: '©OpenStreetMap ©CartoDB', maxZoom: 19, subdomains: 'abcd' }
  ),
  topo: L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    { attribution: '©Esri, DeLorme, NAVTEQ', maxZoom: 19 }
  ),
  satellite: L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution: '©Esri, Earthstar Geographics', maxZoom: 19 }
  )
};

var activeStyle = 'topo';
tileSets[activeStyle].addTo(map);

// ── Globe ─────────────────────────────────────────────────
function initGlobe() {
  if (!window.Globe) {
    console.warn('globe.gl not loaded — falling back to flat map.');
    return;
  }

  var container = document.getElementById('globe-container');

  globeInstance = Globe()
    .backgroundColor('#060d1f')
    .showAtmosphere(true)
    .atmosphereColor('#4a90d9')
    .atmosphereAltitude(0.18)
    .globeImageUrl('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg')
    .bumpImageUrl('https://unpkg.com/three-globe/example/img/earth-topology.png')
    // HTML markers so we get real location-pin shapes
    .htmlElementsData([])
    .htmlLat(function(d) { return d.lat; })
    .htmlLng(function(d) { return d.lng; })
    .htmlAltitude(0.01)
    .htmlElement(function(d) {
      var el = document.createElement('div');
      el.style.cssText =
        'cursor:pointer;transform:translate(-50%,-100%);user-select:none;' +
        'filter:drop-shadow(0 2px 4px rgba(0,0,0,0.55))';
      el.innerHTML =
        '<svg width="22" height="30" viewBox="0 0 22 30" xmlns="http://www.w3.org/2000/svg">' +
          '<path d="M11 0C4.93 0 0 4.93 0 11c0 8.25 11 19 11 19S22 19.25 22 11C22 4.93 17.07 0 11 0z"' +
               ' fill="#ef4444"/>' +
          '<circle cx="11" cy="11" r="4.5" fill="white"/>' +
        '</svg>';
      el.title = d.name + (d.count > 0 ? ' · ' + d.count + ' photo' + (d.count !== 1 ? 's' : '') : '');
      el.addEventListener('click', function() {
        enterFlatMap(d.lat, d.lng);
        // Open the viewer for this location after transition settles
        setTimeout(function() {
          var match = locations.find(function(l) {
            return Math.abs(l.lat - d.lat) < 0.001 && Math.abs(l.lng - d.lng) < 0.001;
          });
          if (match) openViewer(match);
        }, 650);
      });
      return el;
    })
    (container);

  globeInstance.pointOfView({ lat: 38, lng: -98, altitude: 2 });
  globeInstance.controls().autoRotate      = true;
  globeInstance.controls().autoRotateSpeed = 0.25;

  // Pause auto-rotate when user grabs the globe
  container.addEventListener('pointerdown', function() {
    if (globeInstance) globeInstance.controls().autoRotate = false;
  }, { passive: true });

  // OrbitControls 'change' fires every animation frame during zoom/pan.
  // Start timer once below threshold; cancel only if user zooms back out.
  var zoomInTimer = null;

  globeInstance.controls().addEventListener('change', function() {
    if (!globeActive || !globeInstance) return;
    var pov = globeInstance.pointOfView();
    if (!pov) return;

    if (pov.altitude < GLOBE_TO_FLAT_ALTITUDE) {
      if (zoomInTimer === null) {
        zoomInTimer = setTimeout(function() {
          zoomInTimer = null;
          var latest = globeInstance.pointOfView();
          if (globeActive && latest && latest.altitude < GLOBE_TO_FLAT_ALTITUDE) {
            enterFlatMap(latest.lat, latest.lng, latest.altitude);
          }
        }, 150);
      }
    } else {
      if (zoomInTimer !== null) { clearTimeout(zoomInTimer); zoomInTimer = null; }
    }
  });

  // Also fix the marker click to pass altitude
  // (handled above in htmlElement click listener)
}

function updateGlobeMarkers() {
  if (!globeInstance) return;
  globeInstance.htmlElementsData(locations.map(function(loc) {
    return {
      lat:   loc.lat,
      lng:   loc.lng,
      name:  loc.name,
      count: loc.photos ? loc.photos.length : 0
    };
  }));
}

// ── View switching ────────────────────────────────────────
// ── Altitude ↔ Leaflet zoom conversion ───────────────────
// Keeps the view scale continuous when crossing between views.
// alt 0.60 → zoom 5  (continent)
// alt 0.30 → zoom 7  (country)
// alt 0.10 → zoom 9  (region)
var GLOBE_TO_FLAT_ALTITUDE = 0.60;
var FLAT_TO_GLOBE_ZOOM     = 4;

function altitudeToZoom(alt) {
  return Math.max(3, Math.min(10, Math.round(5 + Math.log2(0.60 / alt) * 2)));
}
function zoomToAltitude(zoom) {
  return Math.max(0.15, 0.60 * Math.pow(0.5, (zoom - 5) / 2));
}

// Track flat-map position so globe can return to the right place
var lastFlatCenter = { lat: 40, lng: -98 };
var lastFlatZoom   = 5;

map.on('move', function() {
  var c = map.getCenter();
  lastFlatCenter = { lat: c.lat, lng: c.lng };
  lastFlatZoom   = map.getZoom();
});

// Zoom out far enough → return to globe
map.on('zoomend', function() {
  if (globeActive) return;
  if (map.getZoom() <= FLAT_TO_GLOBE_ZOOM) {
    var c = map.getCenter();
    enterGlobe(c.lat, c.lng, map.getZoom());
  }
});

function enterFlatMap(lat, lng, globeAlt) {
  if (!globeActive) return;
  globeActive = false;

  // Position Leaflet BEFORE the globe fades out so the map is already
  // in the right place when it becomes visible underneath.
  var zoom = globeAlt ? altitudeToZoom(globeAlt) : 5;
  map.invalidateSize();
  if (lat !== undefined && lng !== undefined) {
    map.setView([lat, lng], zoom, { animate: false });
  }

  // Switch tile style
  map.removeLayer(tileSets[activeStyle]);
  activeStyle = 'topo';
  tileSets['topo'].addTo(map);
  document.querySelectorAll('.ms-btn').forEach(function(b) {
    b.classList.toggle('active', b.dataset.style === 'topo');
  });

  // Fade the globe out (CSS opacity transition in layout.css handles smoothness)
  document.getElementById('globe-container').classList.add('flat-mode');
}

function enterGlobe(fromLat, fromLng, fromZoom) {
  globeActive = true;

  var lat = (fromLat !== undefined) ? fromLat : lastFlatCenter.lat;
  var lng = (fromLng !== undefined) ? fromLng : lastFlatCenter.lng;
  var alt = fromZoom ? zoomToAltitude(fromZoom) : 1.5;

  if (globeInstance) {
    // CRITICAL: Snap the globe to the target position INSTANTLY while it is
    // still hidden (opacity 0 / flat-mode). This prevents the "wrong side of
    // globe" jump — the globe will already be in the right place when it
    // fades in, so the user only ever sees the correct location.
    globeInstance.controls().autoRotate = false;
    globeInstance.pointOfView({ lat: lat, lng: lng, altitude: alt }); // no animation

    updateGlobeMarkers();
  }

  // Fade the globe in — CSS handles the smooth opacity transition
  document.getElementById('globe-container').classList.remove('flat-mode');

  document.querySelectorAll('.ms-btn').forEach(function(b) { b.classList.remove('active'); });
  var gb = document.querySelector('.ms-btn[data-style="globe"]');
  if (gb) gb.classList.add('active');
}

function setMapStyle(style) {
  if (style === 'globe') {
    if (globeActive) return;
    var c = map.getCenter();
    enterGlobe(c.lat, c.lng, map.getZoom());
    return;
  }

  if (globeActive) {
    globeActive = false;
    document.getElementById('globe-container').classList.add('flat-mode');
    setTimeout(function() { map.invalidateSize(); }, 60);
  }

  if (style === activeStyle) return;
  map.removeLayer(tileSets[activeStyle]);
  tileSets[style].addTo(map);
  activeStyle = style;

  document.querySelectorAll('.ms-btn').forEach(function(b) {
    b.classList.toggle('active', b.dataset.style === style);
  });
}

// ── Init globe after page loads ───────────────────────────
// Brief delay lets Leaflet initialize with a visible container.
// Globe then takes over as the default view.
window.addEventListener('load', function() {
  setTimeout(function() {
    initGlobe();

    if (globeInstance) {
      // Globe loaded — switch to globe view
      enterGlobe();
    } else {
      // globe.gl didn't load — stay on flat Atlas map
      globeActive = false;
      document.getElementById('globe-container').classList.add('flat-mode');
      document.querySelector('.ms-btn[data-style="topo"]').classList.add('active');
      document.querySelector('.ms-btn[data-style="globe"]').classList.remove('active');
    }
  }, 400);
});

// ── Marker cluster ────────────────────────────────────────
const clusterGroup = L.markerClusterGroup({
  maxClusterRadius: 70,
  showCoverageOnHover: false,
  iconCreateFunction: function(c) {
    var photos = c.getAllChildMarkers().reduce(function(acc, k) {
      return acc.concat(k.options.loc ? k.options.loc.photos || [] : []);
    }, []);
    var p1 = photos[0] ? photos[0].url : '';
    var p2 = photos[1] ? photos[1].url : p1;
    return L.divIcon({
      html: '<div class="pm-stack">' +
            '<div class="pm-back"><img src="' + p1 + '" onerror="this.style.visibility=\'hidden\'"/></div>' +
            '<div class="pm-front"><img src="' + p2 + '" onerror="this.style.visibility=\'hidden\'"/></div>' +
            '<div class="pm-count">' + photos.length + ' photos</div></div>',
      className: '', iconSize: [64, 54], iconAnchor: [32, 27]
    });
  }
});

function buildIcon(loc) {
  var url = loc.photos[0] ? loc.photos[0].url : '';
  var n   = loc.photos.length;
  return L.divIcon({
    html: '<div class="pm-wrap"><div class="pm-ring"><img src="' + url +
          '" onerror="this.style.visibility=\'hidden\'"/></div>' +
          (n > 1 ? '<div class="pm-count">' + n + '</div>' : '') + '</div>',
    className: '', iconSize: [52, 52], iconAnchor: [26, 26]
  });
}

function getFilteredPhotos(loc) {
  if (!loc.photos) return [];
  if (selectedUids.size === 0) return loc.photos;
  return loc.photos.filter(function(p) { return selectedUids.has(p.uploadedBy); });
}

function renderMarkers() {
  clusterGroup.clearLayers();
  locations.forEach(function(loc) {
    if (!locationMatchesEventFilter(loc)) return;
    var visible = getFilteredPhotos(loc);
    if (!visible.length) return;
    var fl = Object.assign({}, loc, { photos: visible });
    var m  = L.marker([loc.lat, loc.lng], { icon: buildIcon(fl), loc: fl });
    m.on('click', function() { openViewer(fl); });
    clusterGroup.addLayer(m);
  });
  map.addLayer(clusterGroup);
  updateGlobeMarkers();
}

// ── Uploader filter bar ───────────────────────────────────
function buildUploaderMap() {
  var up = new Map();
  locations.forEach(function(loc) {
    (loc.photos || []).forEach(function(ph) {
      if (ph.uploadedBy && !up.has(ph.uploadedBy)) {
        up.set(ph.uploadedBy, {
          uid:         ph.uploadedBy,
          displayName: ph.uploaderName  || 'Someone',
          photoURL:    ph.uploaderPhoto || null
        });
      }
    });
  });
  return up;
}

function renderFilter() {
  allUploaders = buildUploaderMap();
  var row = document.getElementById('filter-row');
  if (allUploaders.size < 2) { row.style.display = 'none'; return; }

  row.style.display = 'flex';
  row.innerHTML = '<span class="filter-row-label">Show</span>';

  allUploaders.forEach(function(u, uid) {
    var active = selectedUids.size === 0 || selectedUids.has(uid);
    var btn = document.createElement('button');
    btn.className = 'filter-btn' + (active ? '' : ' inactive');
    btn.title     = u.displayName;
    btn.setAttribute('data-name', u.displayName.split(' ')[0]);
    btn.onclick   = function() { toggleFilter(uid); };
    btn.innerHTML = u.photoURL
      ? '<img src="' + u.photoURL + '" alt="' + u.displayName + '"/>'
      : '<div class="filter-initial">' + (u.displayName[0] || '?').toUpperCase() + '</div>';
    row.appendChild(btn);
  });
}

function toggleFilter(uid) {
  if      (selectedUids.size === 0)   selectedUids = new Set([uid]);
  else if (selectedUids.has(uid))     { selectedUids.delete(uid); }
  else {
    selectedUids.add(uid);
    if (selectedUids.size === allUploaders.size) selectedUids = new Set();
  }
  renderFilter(); renderEventFilter(); renderMarkers();
}
