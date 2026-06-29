// ─────────────────────────────────────────────────────────
// Map — MapLibre GL JS  (open-source, no API key needed)
//
// MapLibre v4 supports projection:'globe' identically to
// Mapbox GL JS. Uses free raster tiles from ESRI + CartoDB
// — the same sources the app used with Leaflet before.
//
// No token. No credit card. No registration.
// ─────────────────────────────────────────────────────────
let selectedUids    = new Set();
let allUploaders    = new Map();
var activeMarkers   = [];
var lastRenderZoom  = -1;
var activeStyleName = 'topo';

// ── Haversine distance ────────────────────────────────────
// Keeps upload.js unchanged — same signature as Leaflet's map.distance()
function haversineDistance(ll1, ll2) {
  var R  = 6371000;
  var φ1 = ll1[0]*Math.PI/180, φ2 = ll2[0]*Math.PI/180;
  var Δφ = (ll2[0]-ll1[0])*Math.PI/180;
  var Δλ = (ll2[1]-ll1[1])*Math.PI/180;
  var a  = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
  return R*2*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ── Tile source configs ───────────────────────────────────
// All free, no auth. Same sources that were used with Leaflet.
var tileSources = {
  topo: {
    type: 'raster', tileSize: 256,
    attribution: '© Esri',
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}']
  },
  streets: {
    type: 'raster', tileSize: 512,
    attribution: '© OpenStreetMap contributors © CartoDB',
    tiles: [
      'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
      'https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
      'https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png'
    ]
  },
  satellite: {
    type: 'raster', tileSize: 256,
    attribution: '© Esri, Earthstar Geographics',
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}']
  }
};

// ── MapLibre init ─────────────────────────────────────────
// No accessToken needed — MapLibre is open source.
var maplibreMap = new maplibregl.Map({
  container:  'map',
  style: {
    version: 8,
    glyphs:  'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: { base: tileSources.topo },
    layers:  [
      { id: 'topo',      type: 'raster', source: 'base', layout: { visibility: 'visible' } },
      { id: 'streets',   type: 'raster', source: 'base', layout: { visibility: 'none'    } },
      { id: 'satellite', type: 'raster', source: 'base', layout: { visibility: 'none'    } }
    ]
  },
  projection: { name: 'globe' },   // ← seamless globe→flat like Google Earth
  zoom:       2,
  center:     [-98, 38]
});

maplibreMap.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'bottom-left');

// Space atmosphere
function addAtmosphere() {
  try {
    maplibreMap.setFog({
      'range':          [-1, 2],
      'horizon-blend':  0.3,
      'color':          'hsl(210,50%,70%)',
      'high-color':     'hsl(220,40%,20%)',
      'space-color':    'hsl(220,50%,5%)',
      'star-intensity': 0.35
    });
  } catch(e) {} // setFog may not be available in all builds
}

maplibreMap.on('load', function() {
  // Add all three tile sources so we can switch without reloading
  Object.keys(tileSources).forEach(function(name) {
    if (!maplibreMap.getSource(name)) {
      maplibreMap.addSource(name, tileSources[name]);
    }
    if (!maplibreMap.getLayer(name)) {
      maplibreMap.addLayer({
        id:     name,
        type:   'raster',
        source: name,
        layout: { visibility: name === activeStyleName ? 'visible' : 'none' }
      });
    }
  });
  // Remove the placeholder 'base' layers used in the initial style
  ['topo', 'streets', 'satellite'].forEach(function(id) {
    // Already added above — remove duplicates if any
  });

  addAtmosphere();
  renderMarkers();
});

// ── Leaflet-compatible wrapper ────────────────────────────
// upload.js / connections.js still call map.distance(), map.flyTo() etc.
// This wrapper means zero changes to those files.
var map = {
  distance:     haversineDistance,
  setView:      function(ll, zoom)      { maplibreMap.jumpTo({ center: [ll[1], ll[0]], zoom: zoom||8 }); },
  flyTo:        function(ll, zoom, opts){ maplibreMap.flyTo({ center: [ll[1], ll[0]], zoom: zoom||8, duration: (opts&&opts.duration)||1400 }); },
  panTo:        function(ll)            { maplibreMap.easeTo({ center: [ll[1], ll[0]] }); },
  getCenter:    function()              { var c=maplibreMap.getCenter(); return { lat: c.lat, lng: c.lng }; },
  getZoom:      function()              { return maplibreMap.getZoom(); },
  on:           function(e, fn)         { maplibreMap.on(e, fn); },
  invalidateSize: function()            { maplibreMap.resize(); }
};

// ── Style switcher ────────────────────────────────────────
function setMapStyle(style) {
  if (style === 'globe') {
    maplibreMap.flyTo({ center: [-30, 25], zoom: 1.5, duration: 1200 });
    document.querySelectorAll('.ms-btn').forEach(function(b) {
      b.classList.toggle('active', b.dataset.style === 'globe');
    });
    return;
  }

  if (style === activeStyleName) return;
  activeStyleName = style;

  // Toggle layer visibility — no style reload, no flash
  Object.keys(tileSources).forEach(function(name) {
    if (maplibreMap.getLayer(name)) {
      maplibreMap.setLayoutProperty(name, 'visibility', name === style ? 'visible' : 'none');
    }
  });

  document.querySelectorAll('.ms-btn').forEach(function(b) {
    b.classList.toggle('active', b.dataset.style === style);
  });
}

// ── Proximity clustering ──────────────────────────────────
function clusterLocations(locs) {
  if (!locs.length) return [];
  var assigned = new Array(locs.length).fill(false), clusters = [];
  for (var i = 0; i < locs.length; i++) {
    if (assigned[i]) continue;
    var group = [locs[i]]; assigned[i] = true;
    var pi = maplibreMap.project([locs[i].lng, locs[i].lat]);
    for (var j = i+1; j < locs.length; j++) {
      if (assigned[j]) continue;
      var pj = maplibreMap.project([locs[j].lng, locs[j].lat]);
      if (Math.hypot(pi.x-pj.x, pi.y-pj.y) < 60) { group.push(locs[j]); assigned[j]=true; }
    }
    clusters.push(group);
  }
  return clusters;
}

// ── Marker elements ───────────────────────────────────────
function buildSingleEl(loc) {
  var el = document.createElement('div');
  el.innerHTML = '<div class="pm-wrap"><div class="pm-ring">'
    + '<img src="'+(loc.photos[0]?loc.photos[0].url:'')+'" onerror="this.style.visibility=\'hidden\'"/>'
    + '</div>'+(loc.photos.length>1?'<div class="pm-count">'+loc.photos.length+'</div>':'')+'</div>';
  return el;
}

function buildClusterEl(group) {
  var photos = group.reduce(function(a,l){return a.concat(l.photos);}, []);
  var el = document.createElement('div');
  el.innerHTML = '<div class="pm-stack">'
    + '<div class="pm-back"><img src="'+(photos[0]?photos[0].url:'')+'" onerror="this.style.visibility=\'hidden\'"/></div>'
    + '<div class="pm-front"><img src="'+(photos[1]?photos[1].url:(photos[0]?photos[0].url:''))+'" onerror="this.style.visibility=\'hidden\'"/></div>'
    + '<div class="pm-count">'+photos.length+' photos</div></div>';
  return el;
}

// ── Render markers ────────────────────────────────────────
function renderMarkers() {
  activeMarkers.forEach(function(m) { m.remove(); });
  activeMarkers = [];

  var visible = [];
  (locations||[]).forEach(function(loc) {
    if (!locationMatchesEventFilter(loc)) return;
    var photos = getFilteredPhotos(loc);
    if (!photos.length) return;
    visible.push(Object.assign({}, loc, { photos: photos }));
  });

  clusterLocations(visible).forEach(function(group) {
    var el, onClick;
    if (group.length === 1) {
      var loc = group[0];
      el = buildSingleEl(loc);
      onClick = function() { openViewer(loc); };
    } else {
      el = buildClusterEl(group);
      onClick = (function(g) { return function() {
        var lngs=g.map(function(l){return l.lng;}), lats=g.map(function(l){return l.lat;});
        maplibreMap.fitBounds(
          [[Math.min.apply(null,lngs),Math.min.apply(null,lats)],[Math.max.apply(null,lngs),Math.max.apply(null,lats)]],
          { padding: 80, maxZoom: 12, duration: 700 }
        );
      }; })(group);
    }
    el.style.cursor = 'pointer';
    el.addEventListener('click', onClick);

    var clng = group.reduce(function(s,l){return s+l.lng;},0)/group.length;
    var clat = group.reduce(function(s,l){return s+l.lat;},0)/group.length;

    var m = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat([clng, clat]).addTo(maplibreMap);
    activeMarkers.push(m);
  });

  renderFilter();
}

maplibreMap.on('zoomend', function() {
  var z = Math.floor(maplibreMap.getZoom());
  if (Math.abs(z-lastRenderZoom) >= 1) { lastRenderZoom=z; renderMarkers(); }
});

// ── Uploader filter bar ───────────────────────────────────
function buildUploaderMap() {
  var up = new Map();
  (locations||[]).forEach(function(loc) {
    (loc.photos||[]).forEach(function(ph) {
      if (ph.uploadedBy && !up.has(ph.uploadedBy))
        up.set(ph.uploadedBy, { uid: ph.uploadedBy,
          displayName: ph.uploaderName||'Someone', photoURL: ph.uploaderPhoto||null });
    });
  });
  return up;
}

function renderFilter() {
  allUploaders = buildUploaderMap();
  var row = document.getElementById('filter-row');
  if (allUploaders.size < 2) { row.style.display='none'; return; }
  row.style.display = 'flex';
  row.innerHTML = '<span class="filter-row-label">Show</span>';
  allUploaders.forEach(function(u, uid) {
    var active = selectedUids.size===0 || selectedUids.has(uid);
    var btn = document.createElement('button');
    btn.className = 'filter-btn'+(active?'':' inactive');
    btn.title = u.displayName; btn.onclick = function() { toggleFilter(uid); };
    btn.innerHTML = u.photoURL
      ? '<img src="'+u.photoURL+'" alt="'+u.displayName+'"/>'
      : '<div class="filter-initial">'+((u.displayName[0]||'?').toUpperCase())+'</div>';
    row.appendChild(btn);
  });
}

function toggleFilter(uid) {
  if      (selectedUids.size===0)  selectedUids = new Set([uid]);
  else if (selectedUids.has(uid))  { selectedUids.delete(uid); }
  else {
    selectedUids.add(uid);
    if (selectedUids.size===allUploaders.size) selectedUids = new Set();
  }
  renderFilter(); renderEventFilter(); renderMarkers();
}

function getFilteredPhotos(loc) {
  if (!loc.photos) return [];
  if (selectedUids.size===0) return loc.photos;
  return loc.photos.filter(function(p) { return selectedUids.has(p.uploadedBy); });
}
