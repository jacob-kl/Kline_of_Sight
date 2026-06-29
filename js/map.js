// ─────────────────────────────────────────────────────────
// Map — globe.gl (marble globe) + MapLibre GL JS (flat map)
//
// Two layers:
//   #globe-container  z-index 50  — globe.gl 3D marble globe
//   #map              z-index 1   — MapLibre flat tile map
//
// Switching is a CSS opacity cross-fade. The globe is always
// rendered (so it's ready to appear), and the flat map is
// always tiled (so markers and tiles are current).
//
// No token needed. MapLibre uses free ESRI + CartoDB tiles.
// ─────────────────────────────────────────────────────────
let selectedUids   = new Set();
let allUploaders   = new Map();
var activeMarkers  = [];
var lastRenderZoom = -1;
var activeStyleName = 'satellite';

// ── Haversine (replaces Leaflet's map.distance()) ────────
function haversineDistance(ll1, ll2) {
  var R  = 6371000;
  var φ1 = ll1[0]*Math.PI/180, φ2 = ll2[0]*Math.PI/180;
  var Δφ = (ll2[0]-ll1[0])*Math.PI/180;
  var Δλ = (ll2[1]-ll1[1])*Math.PI/180;
  var a  = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

// ── Tile source configs (free, no API key) ────────────────
var tileSources = {
  topo: {
    type:'raster', tileSize:256, attribution:'© Esri',
    tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}']
  },
  streets: {
    type:'raster', tileSize:512, attribution:'© OpenStreetMap © CartoDB',
    tiles:['https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
           'https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
           'https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png']
  },
  satellite: {
    type:'raster', tileSize:256, attribution:'© Esri, Earthstar Geographics',
    tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}']
  }
};

// ── MapLibre flat map ─────────────────────────────────────
var maplibreMap = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    sources: {
      topo:      tileSources.topo,
      streets:   tileSources.streets,
      satellite: tileSources.satellite
    },
    layers: [
      {id:'topo',      type:'raster', source:'topo',      layout:{visibility:'none'}},
      {id:'streets',   type:'raster', source:'streets',   layout:{visibility:'none'}},
      {id:'satellite', type:'raster', source:'satellite', layout:{visibility:'visible'}}
    ]
  },
  zoom:   4,
  center: [-98, 38]
});

maplibreMap.addControl(new maplibregl.NavigationControl({visualizePitch:false}), 'bottom-left');
maplibreMap.on('load', function() { renderMarkers(); });

// Leaflet-compatible wrapper so upload.js / connections.js don't need to change
var map = {
  distance:     haversineDistance,
  setView:      function(ll,z)    { maplibreMap.jumpTo({center:[ll[1],ll[0]],zoom:z||8}); },
  flyTo:        function(ll,z,o)  { maplibreMap.flyTo({center:[ll[1],ll[0]],zoom:z||8,duration:(o&&o.duration)||1400}); },
  panTo:        function(ll)      { maplibreMap.easeTo({center:[ll[1],ll[0]]}); },
  getCenter:    function()        { var c=maplibreMap.getCenter(); return {lat:c.lat,lng:c.lng}; },
  getZoom:      function()        { return maplibreMap.getZoom(); },
  on:           function(e,fn)    { maplibreMap.on(e,fn); },
  invalidateSize: function()      { maplibreMap.resize(); }
};

// ── Globe.gl marble globe ─────────────────────────────────
var globeInstance = null;
var globeActive   = true;

function initGlobe() {
  if (!window.Globe) { console.warn('globe.gl not loaded'); fallbackToFlat(); return; }

  var container = document.getElementById('globe-container');

  globeInstance = Globe()
    .backgroundColor('#060d1f')
    .showAtmosphere(true)
    .atmosphereColor('#4a90d9')
    .atmosphereAltitude(0.18)
    .globeImageUrl('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg')
    .bumpImageUrl('https://unpkg.com/three-globe/example/img/earth-topology.png')
    .htmlElementsData([])
    .htmlLat(function(d){return d.lat;})
    .htmlLng(function(d){return d.lng;})
    .htmlAltitude(0.01)
    .htmlElement(function(d) {
      var el = document.createElement('div');
      el.style.cssText = 'cursor:pointer;transform:translate(-50%,-100%);filter:drop-shadow(0 2px 4px rgba(0,0,0,.55))';
      el.innerHTML =
        '<svg width="22" height="30" viewBox="0 0 22 30" xmlns="http://www.w3.org/2000/svg">' +
        '<path d="M11 0C4.93 0 0 4.93 0 11c0 8.25 11 19 11 19S22 19.25 22 11C22 4.93 17.07 0 11 0z" fill="#ef4444"/>' +
        '<circle cx="11" cy="11" r="4.5" fill="white"/></svg>';
      el.title = d.name;
      el.addEventListener('click', function() {
        var pov = globeInstance.pointOfView();
        enterFlatMap(d.lat, d.lng, pov.altitude);
        setTimeout(function() {
          var loc = locations.find(function(l){ return Math.abs(l.lat-d.lat)<0.001&&Math.abs(l.lng-d.lng)<0.001; });
          if (loc) openViewer(loc);
        }, 550);
      });
      return el;
    })(container);

  globeInstance.pointOfView({lat:25, lng:-30, altitude:2});
  globeInstance.controls().autoRotate      = true;
  globeInstance.controls().autoRotateSpeed = 0.25;

  // Stop rotating when user grabs it
  container.addEventListener('pointerdown', function() {
    if (globeInstance) globeInstance.controls().autoRotate = false;
  }, {passive:true});

  // Zoom-in threshold → switch to flat map
  var zoomTimer = null;
  globeInstance.controls().addEventListener('change', function() {
    if (!globeActive || !globeInstance) return;
    var pov = globeInstance.pointOfView();
    if (!pov) return;

    // Pre-warm: when getting close (alt < 1.0) start positioning MapLibre
    // at the predicted landing view so tiles begin loading in the background.
    // By the time the user actually hits the 0.60 threshold, tiles are cached.
    if (pov.altitude < 1.0 && pov.altitude >= 0.60) {
      setTileStyle('satellite');
      maplibreMap.jumpTo({ center: [pov.lng, pov.lat], zoom: altToZoom(pov.altitude) });
    }

    if (pov.altitude < 0.60) {
      if (!zoomTimer) zoomTimer = setTimeout(function() {
        zoomTimer = null;
        var p = globeInstance.pointOfView();
        if (globeActive && p && p.altitude < 0.60) enterFlatMap(p.lat, p.lng, p.altitude);
      }, 150);
    } else {
      if (zoomTimer) { clearTimeout(zoomTimer); zoomTimer = null; }
    }
  });
}

function updateGlobeMarkers() {
  if (!globeInstance) return;
  globeInstance.htmlElementsData((locations||[]).map(function(loc){
    return {lat:loc.lat, lng:loc.lng, name:loc.name};
  }));
}

// ── View switching ────────────────────────────────────────
// altitude → Leaflet-compatible zoom level
function altToZoom(alt) { return Math.max(3, Math.min(10, Math.round(5 + Math.log2(0.60/alt)*2))); }
// zoom → altitude (for returning to globe at matching scale)
function zoomToAlt(z)   { return Math.max(0.15, 0.60 * Math.pow(0.5, (z-5)/2)); }

var lastFlatCenter = {lat:38, lng:-98};
var lastFlatZoom   = 5;

maplibreMap.on('move', function() {
  var c = maplibreMap.getCenter();
  lastFlatCenter = {lat:c.lat, lng:c.lng};
  lastFlatZoom   = maplibreMap.getZoom();
});

// Zoom out far enough on flat map → return to globe
maplibreMap.on('zoomend', function() {
  if (globeActive) return;
  if (maplibreMap.getZoom() <= 3) {
    var c = maplibreMap.getCenter();
    enterGlobe(c.lat, c.lng, maplibreMap.getZoom());
  }
});

function enterFlatMap(lat, lng, globeAlt) {
  if (!globeActive) return;
  globeActive = false;

  var zoom = globeAlt ? altToZoom(globeAlt) : 6;
  setTileStyle('satellite');
  maplibreMap.resize();
  if (lat !== undefined) maplibreMap.jumpTo({ center: [lng, lat], zoom: zoom });

  // Wait for MapLibre to finish rendering tiles before fading the globe out.
  // 'idle' fires when all tiles are loaded. 400ms is the max we'll wait so
  // the transition doesn't feel slow even on poor connections.
  var fadeTimer = setTimeout(doFade, 400);
  maplibreMap.once('idle', function() { clearTimeout(fadeTimer); doFade(); });

  function doFade() {
    document.getElementById('globe-container').classList.add('flat-mode');
  }

  document.querySelectorAll('.ms-btn').forEach(function(b) {
    b.classList.toggle('active', b.dataset.style === 'satellite');
  });
}

function enterGlobe(fromLat, fromLng, fromZoom) {
  globeActive = true;

  if (globeInstance) {
    var lat = fromLat !== undefined ? fromLat : lastFlatCenter.lat;
    var lng = fromLng !== undefined ? fromLng : lastFlatCenter.lng;
    var alt = fromZoom ? zoomToAlt(fromZoom) : 1.5;
    // Snap to position WHILE still hidden, then fade in
    globeInstance.controls().autoRotate = false;
    globeInstance.pointOfView({lat:lat, lng:lng, altitude:alt});
    updateGlobeMarkers();
  }

  document.getElementById('globe-container').classList.remove('flat-mode');
  document.querySelectorAll('.ms-btn').forEach(function(b){ b.classList.remove('active'); });
  var gb = document.querySelector('.ms-btn[data-style="globe"]');
  if (gb) gb.classList.add('active');
}

function fallbackToFlat() {
  globeActive = false;
  var gc = document.getElementById('globe-container');
  if (gc) gc.classList.add('flat-mode');
  setTileStyle('satellite');
  document.querySelector('.ms-btn[data-style="satellite"]').classList.add('active');
}

// ── Style switcher ────────────────────────────────────────
function setTileStyle(style) {
  if (!tileSources[style]) return;
  Object.keys(tileSources).forEach(function(name) {
    if (maplibreMap.getLayer(name))
      maplibreMap.setLayoutProperty(name, 'visibility', name===style ? 'visible' : 'none');
  });
  activeStyleName = style;
}

function setMapStyle(style) {
  if (style === 'globe') {
    var c = maplibreMap.getCenter();
    enterGlobe(c.lat, c.lng, maplibreMap.getZoom());
    return;
  }
  // Switching to a flat style
  if (globeActive) {
    globeActive = false;
    document.getElementById('globe-container').classList.add('flat-mode');
    maplibreMap.resize();
  }
  setTileStyle(style);
  document.querySelectorAll('.ms-btn').forEach(function(b){
    b.classList.toggle('active', b.dataset.style === style);
  });
}

// ── Init ──────────────────────────────────────────────────
window.addEventListener('load', function() {
  setTimeout(function() {
    initGlobe();
    // globe.gl handles the default globe view; MapLibre starts hidden behind it
  }, 300);
});

// ── Proximity clustering (MapLibre flat map) ──────────────
function clusterLocations(locs) {
  if (!locs.length) return [];
  var assigned = new Array(locs.length).fill(false), clusters = [];
  for (var i=0; i<locs.length; i++) {
    if (assigned[i]) continue;
    var group=[locs[i]]; assigned[i]=true;
    var pi=maplibreMap.project([locs[i].lng,locs[i].lat]);
    for (var j=i+1; j<locs.length; j++) {
      if (assigned[j]) continue;
      var pj=maplibreMap.project([locs[j].lng,locs[j].lat]);
      if (Math.hypot(pi.x-pj.x,pi.y-pj.y)<60) { group.push(locs[j]); assigned[j]=true; }
    }
    clusters.push(group);
  }
  return clusters;
}

function buildSingleEl(loc) {
  var el=document.createElement('div');
  el.innerHTML='<div class="pm-wrap"><div class="pm-ring"><img src="'+(loc.photos[0]?loc.photos[0].url:'')+
    '" onerror="this.style.visibility=\'hidden\'"/></div>'+
    (loc.photos.length>1?'<div class="pm-count">'+loc.photos.length+'</div>':'')+
    '</div>';
  return el;
}

function buildClusterEl(group) {
  var photos=group.reduce(function(a,l){return a.concat(l.photos);},[]);
  var el=document.createElement('div');
  el.innerHTML='<div class="pm-stack">'+
    '<div class="pm-back"><img src="'+(photos[0]?photos[0].url:'')+'" onerror="this.style.visibility=\'hidden\'"/></div>'+
    '<div class="pm-front"><img src="'+(photos[1]?photos[1].url:(photos[0]?photos[0].url:''))+'" onerror="this.style.visibility=\'hidden\'"/></div>'+
    '<div class="pm-count">'+photos.length+' photos</div></div>';
  return el;
}

function renderMarkers() {
  activeMarkers.forEach(function(m){m.remove();}); activeMarkers=[];
  var visible=[];
  (locations||[]).forEach(function(loc){
    if (!locationMatchesEventFilter(loc)) return;
    var photos=getFilteredPhotos(loc);
    if (!photos.length) return;
    visible.push(Object.assign({},loc,{photos:photos}));
  });
  clusterLocations(visible).forEach(function(group){
    var el, onClick;
    if (group.length===1) {
      var loc=group[0]; el=buildSingleEl(loc);
      onClick=function(){openViewer(loc);};
    } else {
      el=buildClusterEl(group);
      onClick=(function(g){return function(){
        var lngs=g.map(function(l){return l.lng;}),lats=g.map(function(l){return l.lat;});
        maplibreMap.fitBounds([[Math.min.apply(null,lngs),Math.min.apply(null,lats)],
          [Math.max.apply(null,lngs),Math.max.apply(null,lats)]],{padding:80,maxZoom:12,duration:700});
      };})(group);
    }
    el.style.cursor='pointer';
    el.addEventListener('click',onClick);
    var clng=group.reduce(function(s,l){return s+l.lng;},0)/group.length;
    var clat=group.reduce(function(s,l){return s+l.lat;},0)/group.length;
    var m=new maplibregl.Marker({element:el,anchor:'center'}).setLngLat([clng,clat]).addTo(maplibreMap);
    activeMarkers.push(m);
  });
  updateGlobeMarkers();
  renderFilter();
}

maplibreMap.on('zoomend',function(){
  var z=Math.floor(maplibreMap.getZoom());
  if (Math.abs(z-lastRenderZoom)>=1){lastRenderZoom=z;renderMarkers();}
});

// ── Uploader filter bar ───────────────────────────────────
function buildUploaderMap(){
  var up=new Map();
  (locations||[]).forEach(function(loc){
    (loc.photos||[]).forEach(function(ph){
      if(ph.uploadedBy&&!up.has(ph.uploadedBy))
        up.set(ph.uploadedBy,{uid:ph.uploadedBy,displayName:ph.uploaderName||'Someone',photoURL:ph.uploaderPhoto||null});
    });
  }); return up;
}
function renderFilter(){
  allUploaders=buildUploaderMap();
  var row=document.getElementById('filter-row');
  if(allUploaders.size<2){row.style.display='none';return;}
  row.style.display='flex'; row.innerHTML='<span class="filter-row-label">Show</span>';
  allUploaders.forEach(function(u,uid){
    var active=selectedUids.size===0||selectedUids.has(uid);
    var btn=document.createElement('button');
    btn.className='filter-btn'+(active?'':' inactive'); btn.title=u.displayName;
    btn.onclick=function(){toggleFilter(uid);};
    btn.innerHTML=u.photoURL?'<img src="'+u.photoURL+'" alt="'+u.displayName+'"/>':'<div class="filter-initial">'+((u.displayName[0]||'?').toUpperCase())+'</div>';
    row.appendChild(btn);
  });
}
function toggleFilter(uid){
  if(selectedUids.size===0) selectedUids=new Set([uid]);
  else if(selectedUids.has(uid)){selectedUids.delete(uid);}
  else{selectedUids.add(uid);if(selectedUids.size===allUploaders.size)selectedUids=new Set();}
  renderFilter();renderEventFilter();renderMarkers();
}
function getFilteredPhotos(loc){
  if(!loc.photos)return[];
  if(selectedUids.size===0)return loc.photos;
  return loc.photos.filter(function(p){return selectedUids.has(p.uploadedBy);});
}
