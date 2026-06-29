// ─────────────────────────────────────────────────────────
// Map
//
// Two views: 3D globe (globe.gl) and flat Leaflet map.
// Transitions work like Google Earth:
//   - Zoom INTO the globe → flat map appears at that location
//   - Zoom OUT on flat map → globe returns, positioned correctly
//   - Globe button → globe centered on where you were looking
//
// Globe altitude thresholds:
//   GLOBE_TO_FLAT : zoom in past this → go flat
//   FLAT_TO_GLOBE : Leaflet zoom level below this → go globe
// ─────────────────────────────────────────────────────────
let selectedUids  = new Set();
let allUploaders  = new Map();
let globeActive   = true;
let globeInstance = null;

// The lat/lng the user was last looking at on the flat map.
// Used to snap the globe back to the right spot when returning.
var lastFlatCenter = { lat: 40, lng: -98 };
var lastFlatZoom   = 5;

// Tuning constants
var GLOBE_TO_FLAT_ALTITUDE = 0.20;  // zoom in past here on globe → flat map
var FLAT_TO_GLOBE_ZOOM     = 2;     // zoom out below this on flat map → globe
var GLOBE_RETURN_ALTITUDE  = 1.5;   // how far out the globe starts when returning

// ── Flat map init ─────────────────────────────────────────
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

// Track flat map position continuously so we can return to it from globe
map.on('move', function() {
  var c = map.getCenter();
  lastFlatCenter = { lat: c.lat, lng: c.lng };
});
map.on('zoom', function() {
  lastFlatZoom = map.getZoom();
});

// Zoom out on flat map → return to globe
map.on('zoomend', function() {
  if (globeActive) return;
  if (map.getZoom() <= FLAT_TO_GLOBE_ZOOM) {
    var c = map.getCenter();
    enterGlobe(c.lat, c.lng, map.getZoom());
  }
});

// ── Globe (globe.gl) ──────────────────────────────────────
var globeZoomTimer  = null; // debounce for globe→flat transition
var latestGlobePov  = { lat: 40, lng: -98, altitude: 2 }; // last known globe POV

function initGlobe() {
  if (!window.Globe) {
    console.warn('globe.gl not loaded — staying on flat map.');
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
        enterFlatMap(d.lat, d.lng, latestGlobePov.altitude);
        setTimeout(function() {
          var match = locations.find(function(l) {
            return Math.abs(l.lat - d.lat) < 0.001 && Math.abs(l.lng - d.lng) < 0.001;
          });
          if (match) openViewer(match);
        }, 700);
      });
      return el;
    })
    (container);

  globeInstance.pointOfView({ lat: 38, lng: -98, altitude: 2 });
  globeInstance.controls().autoRotate      = true;
  globeInstance.controls().autoRotateSpeed = 0.25;

  // Stop auto-rotate when user grabs
  container.addEventListener('pointerdown', function() {
    if (globeInstance) globeInstance.controls().autoRotate = false;
  }, { passive: true });

  // Track POV continuously for accurate flat-map positioning
  globeInstance.onZoom(function(pov) {
    latestGlobePov = pov;
    if (!globeActive) return;

    // Debounce: only transition if the user holds the zoom level for 500ms.
    // This prevents accidental triggers during a fast zoom gesture.
    clearTimeout(globeZoomTimer);
    if (pov.altitude < GLOBE_TO_FLAT_ALTITUDE) {
      globeZoomTimer = setTimeout(function() {
        if (globeActive && latestGlobePov.altitude < GLOBE_TO_FLAT_ALTITUDE) {
          enterFlatMap(latestGlobePov.lat, latestGlobePov.lng, latestGlobePov.altitude);
        }
      }, 500);
    }
  });
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

// altitude → approximate Leaflet zoom level
function altitudeToZoom(altitude) {
  // rough logarithmic mapping:  alt 0.20 → zoom 6,  alt 0.10 → zoom 8
  var zoom = Math.round(6 + Math.log2(GLOBE_TO_FLAT_ALTITUDE / altitude));
  return Math.max(4, Math.min(10, zoom));
}

// Leaflet zoom level → approximate globe altitude
function zoomToAltitude(zoom) {
  // inverse of above
  var alt = GLOBE_TO_FLAT_ALTITUDE * Math.pow(2, 6 - zoom);
  return Math.max(0.2, Math.min(4, alt));
}

function enterFlatMap(lat, lng, globeAltitude) {
  if (!globeActive) return;
  clearTimeout(globeZoomTimer);
  globeActive = false;

  document.getElementById('globe-container').classList.add('flat-mode');

  // Calculate zoom from globe altitude so the view matches what was on-screen
  var zoom = globeAltitude ? altitudeToZoom(globeAltitude) : 6;

  // Land on Atlas
  map.removeLayer(tileSets[activeStyle]);
  activeStyle = 'topo';
  tileSets['topo'].addTo(map);

  document.querySelectorAll('.ms-btn').forEach(function(b) {
    b.classList.toggle('active', b.dataset.style === 'topo');
  });

  setTimeout(function() {
    map.invalidateSize();
    if (lat !== undefined && lng !== undefined) {
      map.setView([lat, lng], zoom, { animate: false });
    }
  }, 60);
}

function enterGlobe(fromLat, fromLng, fromZoom) {
  globeActive = true;
  clearTimeout(globeZoomTimer);

  document.getElementById('globe-container').classList.remove('flat-mode');

  document.querySelectorAll('.ms-btn').forEach(function(b) { b.classList.remove('active'); });
  var gb = document.querySelector('.ms-btn[data-style="globe"]');
  if (gb) gb.classList.add('active');

  if (globeInstance) {
    // Position globe where the user was looking, at an altitude that
    // reflects the zoom level they were at on the flat map.
    var lat = (fromLat !== undefined) ? fromLat : lastFlatCenter.lat;
    var lng = (fromLng !== undefined) ? fromLng : lastFlatCenter.lng;
    var alt = fromZoom ? zoomToAltitude(fromZoom) : GLOBE_RETURN_ALTITUDE;

    // Don't auto-rotate when returning from flat map — user is looking somewhere
    globeInstance.controls().autoRotate = false;
    globeInstance.pointOfView({ lat: lat, lng: lng, altitude: alt }, 800);

    updateGlobeMarkers();
  }
}

function setMapStyle(style) {
  if (style === 'globe') {
    if (globeActive) return; // already on globe
    var c    = map.getCenter();
    var zoom = map.getZoom();
    enterGlobe(c.lat, c.lng, zoom);
    return;
  }

  if (globeActive) {
    // Switching from globe to a specific flat style
    globeActive = false;
    clearTimeout(globeZoomTimer);
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

// ── Init after page load ──────────────────────────────────
window.addEventListener('load', function() {
  setTimeout(function() {
    initGlobe();
    if (globeInstance) {
      enterGlobe();
    } else {
      // Fallback: stay on flat map, update switcher
      globeActive = false;
      document.getElementById('globe-container').classList.add('flat-mode');
      var topoBtn = document.querySelector('.ms-btn[data-style="topo"]');
      var globeBtn = document.querySelector('.ms-btn[data-style="globe"]');
      if (topoBtn)  topoBtn.classList.add('active');
      if (globeBtn) globeBtn.classList.remove('active');
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
