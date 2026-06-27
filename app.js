// ─────────────────────────────────────────────────────────
// FIREBASE INIT
// ─────────────────────────────────────────────────────────
firebase.initializeApp(FIREBASE_CONFIG);
const db   = firebase.firestore();
const auth = firebase.auth();

// ─────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────
let currentUser      = null;
let pendingUpload    = false;
let locations        = [];
let connectedUIDs    = [];   // UIDs of people I'm connected with
let locationListener = null; // Firestore unsubscribe

let selectedUids = new Set();
let allUploaders = new Map();

let pendingLat    = null;
let pendingLng    = null;
let selectedFiles = [];
let selectedURLs  = [];
let pinMode       = false;
let tempPinMarker = null;

// Lightbox
let lbPhotos  = [];   // all photos in the current viewer location
let lbIndex   = 0;    // which photo is open
let lbLoc     = null; // location object (id, name, etc.)

let currentInviteCode   = null;
let inviteTimerInterval = null;

// ─────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────
auth.onAuthStateChanged(function(user) {
  currentUser = user;
  updateAuthUI(user);

  if (user) {
    // Save / refresh profile so others can look up display name
    db.collection('users').doc(user.uid).set({
      displayName: user.displayName || '',
      photoURL:    user.photoURL    || null
    }, { merge: true });

    document.getElementById('fab').style.display        = 'flex';
    document.getElementById('invite-btn').style.display = 'flex';
    startConnectionsListener();

    if (pendingUpload) { pendingUpload = false; openUpload(); }
  } else {
    document.getElementById('fab').style.display        = 'none';
    document.getElementById('invite-btn').style.display = 'none';
    if (locationListener) { locationListener(); locationListener = null; }
    locations = []; connectedUIDs = [];
    renderMarkers();
  }
});

function signIn() {
  var provider = new firebase.auth.GoogleAuthProvider();
  auth.signInWithPopup(provider).catch(function(err) {
    if (err.code !== 'auth/popup-closed-by-user') toast('Sign-in failed. Please try again.');
    pendingUpload = false;
  });
}

function signOut() { auth.signOut(); }

function handleAuthClick() {
  if (currentUser) {
    if (confirm('Sign out of ' + (currentUser.displayName || 'your account') + '?')) signOut();
  } else {
    signIn();
  }
}

function updateAuthUI(user) {
  var btn = document.getElementById('auth-btn');
  if (user) {
    btn.innerHTML = user.photoURL
      ? '<img src="' + user.photoURL + '" class="auth-avatar" title="Sign out"/>'
      : '<span class="auth-initials">' + ((user.displayName || '?')[0]).toUpperCase() + '</span>';
  } else {
    btn.textContent = 'Sign in';
  }
}

// ─────────────────────────────────────────────────────────
// FAB
// ─────────────────────────────────────────────────────────
function handleFabClick() {
  if (!currentUser) { pendingUpload = true; signIn(); return; }
  openUpload();
}

// ─────────────────────────────────────────────────────────
// MAP
// ─────────────────────────────────────────────────────────
const map = L.map('map', { center: [40, -96], zoom: 3, zoomControl: false });
L.control.zoom({ position: 'bottomleft' }).addTo(map);
L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
  { attribution: 'OpenStreetMap, CartoDB', maxZoom: 19, subdomains: 'abcd' }).addTo(map);

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

// ─────────────────────────────────────────────────────────
// FILTER
// ─────────────────────────────────────────────────────────
function getFilteredPhotos(loc) {
  if (!loc.photos) return [];
  if (selectedUids.size === 0) return loc.photos;
  return loc.photos.filter(function(p) { return selectedUids.has(p.uploadedBy); });
}

function renderMarkers() {
  clusterGroup.clearLayers();
  locations.forEach(function(loc) {
    var visible = getFilteredPhotos(loc);
    if (!visible.length) return;
    var fl = Object.assign({}, loc, { photos: visible });
    var m  = L.marker([loc.lat, loc.lng], { icon: buildIcon(fl), loc: fl });
    m.on('click', function() { openViewer(fl); });
    clusterGroup.addLayer(m);
  });
  map.addLayer(clusterGroup);
}

function buildUploaderMap() {
  var map2 = new Map();
  locations.forEach(function(loc) {
    (loc.photos || []).forEach(function(ph) {
      if (ph.uploadedBy && !map2.has(ph.uploadedBy)) {
        map2.set(ph.uploadedBy, { uid: ph.uploadedBy,
          displayName: ph.uploaderName || 'Someone', photoURL: ph.uploaderPhoto || null });
      }
    });
  });
  return map2;
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
  if      (selectedUids.size === 0)    selectedUids = new Set([uid]);
  else if (selectedUids.has(uid))      { selectedUids.delete(uid); }
  else {
    selectedUids.add(uid);
    if (selectedUids.size === allUploaders.size) selectedUids = new Set();
  }
  renderFilter(); renderMarkers();
}

// ─────────────────────────────────────────────────────────
// CONNECTIONS — privacy model
//
// Each person is independent. Two people share photos only
// after both have a /connections/{sortedPair} doc in Firestore.
// Loading uses: .where('ownedBy', 'in', [myUID, ...connectedUIDs])
// ─────────────────────────────────────────────────────────
function startConnectionsListener() {
  if (!currentUser) return;

  db.collection('connections')
    .where('uids', 'array-contains', currentUser.uid)
    .onSnapshot(function(snap) {
      connectedUIDs = snap.docs.map(function(doc) {
        return doc.data().uids.find(function(uid) { return uid !== currentUser.uid; });
      }).filter(Boolean);

      // Restart location listener with updated UID list
      if (locationListener) { locationListener(); locationListener = null; }

      var allUIDs = [currentUser.uid].concat(connectedUIDs);
      locationListener = db.collection('locations')
        .where('ownedBy', 'in', allUIDs)
        .onSnapshot(function(locSnap) {
          locations = locSnap.docs.map(function(doc) {
            return Object.assign({ id: doc.id }, doc.data());
          });
          locations.sort(function(a, b) {
            var ta = a.createdAt && a.createdAt.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
            var tb = b.createdAt && b.createdAt.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
            return ta - tb;
          });
          renderFilter(); renderMarkers();
        }, function(err) {
          console.error('Location listener error:', err);
          toast('Trouble loading photos. Check your config.js.');
        });

      renderConnectionsList();
    });
}

// ─────────────────────────────────────────────────────────
// SHARING PANEL
// ─────────────────────────────────────────────────────────
function openSharingPanel() {
  document.getElementById('connect-error').textContent = '';
  document.getElementById('connect-input').value = '';
  document.getElementById('sharing-overlay').classList.add('open');
  renderConnectionsList();
}

function maybeCloseSharing(e) {
  if (e.target === document.getElementById('sharing-overlay')) {
    document.getElementById('sharing-overlay').classList.remove('open');
    if (inviteTimerInterval) { clearInterval(inviteTimerInterval); inviteTimerInterval = null; }
  }
}

async function generateAndShowCode() {
  var display = document.getElementById('invite-code-display');
  display.innerHTML = '<div class="code-generating">Generating…</div>';
  try {
    var code      = makeRandomCode();
    var expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await db.collection('inviteCodes').doc(code).set({
      createdBy: currentUser.uid, expiresAt: expiresAt.toISOString()
    });
    currentInviteCode = code;
    display.innerHTML =
      '<div class="big-code">' + code + '</div>' +
      '<div class="code-expires" id="code-timer"></div>' +
      '<button class="btn-copy" onclick="copyCode()">Copy Code</button>';
    tickTimer(expiresAt);
    if (inviteTimerInterval) clearInterval(inviteTimerInterval);
    inviteTimerInterval = setInterval(function() { tickTimer(expiresAt); }, 30000);
  } catch(err) {
    display.innerHTML = '<div class="code-generating">Failed. Try again.</div>';
  }
}

function makeRandomCode() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var c = '';
  for (var i = 0; i < 6; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}

function tickTimer(expiresAt) {
  var el = document.getElementById('code-timer');
  if (!el) return;
  var ms = expiresAt - new Date();
  if (ms <= 0) { el.textContent = 'Expired'; return; }
  el.textContent = 'Expires in ' + Math.floor(ms / 3600000) + 'h ' +
                   Math.floor((ms % 3600000) / 60000) + 'm';
}

function copyCode() {
  if (!currentInviteCode) return;
  var fallback = function() {
    var inp = document.createElement('input');
    inp.value = currentInviteCode;
    document.body.appendChild(inp);
    inp.select(); document.execCommand('copy');
    document.body.removeChild(inp);
    toast('Code copied!');
  };
  navigator.clipboard ? navigator.clipboard.writeText(currentInviteCode)
    .then(function() { toast('Code copied!'); }).catch(fallback) : fallback();
}

async function connectWithCode() {
  var code    = document.getElementById('connect-input').value.trim().toUpperCase();
  var errorEl = document.getElementById('connect-error');
  errorEl.textContent = '';

  if (code.length !== 6) { errorEl.textContent = 'Enter the full 6-character code.'; return; }

  var btn = document.getElementById('btn-connect');
  btn.disabled = true; btn.textContent = 'Connecting…';

  try {
    var codeDoc = await db.collection('inviteCodes').doc(code).get();
    if (!codeDoc.exists)                              throw new Error('not-found');
    var data = codeDoc.data();
    if (new Date(data.expiresAt) < new Date())        throw new Error('expired');
    if (data.createdBy === currentUser.uid)            throw new Error('own-code');

    var theirUID = data.createdBy;
    var pairId   = [currentUser.uid, theirUID].sort().join('_');
    var existing = await db.collection('connections').doc(pairId).get();
    if (existing.exists)                              throw new Error('already-connected');

    // Create the mutual connection document
    await db.collection('connections').doc(pairId).set({
      uids: [currentUser.uid, theirUID],
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    document.getElementById('connect-input').value = '';
    toast('Connected! Their photos will appear on your map.');
  } catch(err) {
    var msgs = {
      'not-found':        'Code not found. Double-check it.',
      'expired':          'This code has expired. Ask them for a new one.',
      'own-code':         'That\'s your own code — send it to someone else.',
      'already-connected':'You\'re already connected with this person.'
    };
    errorEl.textContent = msgs[err.message] || 'Something went wrong. Try again.';
  } finally {
    btn.disabled = false; btn.textContent = 'Connect';
  }
}

async function renderConnectionsList() {
  if (!connectedUIDs.length) {
    document.getElementById('connections-section').style.display = 'none';
    return;
  }
  document.getElementById('connections-section').style.display = 'block';
  var list = document.getElementById('connections-list');
  list.innerHTML = '';

  var profiles = await Promise.all(connectedUIDs.map(function(uid) {
    return db.collection('users').doc(uid).get().then(function(doc) {
      return doc.exists ? Object.assign({ uid: uid }, doc.data()) : { uid: uid, displayName: 'Unknown' };
    });
  }));

  profiles.forEach(function(p) {
    var item = document.createElement('div');
    item.className = 'connection-item';
    var avatar = p.photoURL
      ? '<div class="conn-avatar"><img src="' + p.photoURL + '"/></div>'
      : '<div class="conn-avatar">' + (p.displayName[0] || '?').toUpperCase() + '</div>';
    item.innerHTML = avatar + '<span class="conn-name">' + (p.displayName || 'Unknown') + '</span>';
    list.appendChild(item);
  });
}

// ─────────────────────────────────────────────────────────
// VIEWER
// ─────────────────────────────────────────────────────────
function uploaderBadgeHTML(photo) {
  if (photo.uploaderPhoto)
    return '<div class="uploader-badge"><img src="' + photo.uploaderPhoto + '" title="' + (photo.uploaderName || '') + '"/></div>';
  return '<div class="uploader-badge"><div class="uploader-initial">' + ((photo.uploaderName || '?')[0]).toUpperCase() + '</div></div>';
}

function openViewer(loc) {
  if (pinMode) return;
  document.getElementById('vwr-location').textContent = loc.name;
  document.getElementById('vwr-title').textContent =
    loc.photos.length + ' photo' + (loc.photos.length !== 1 ? 's' : '');

  var grid = document.getElementById('vwr-grid');
  grid.innerHTML = '';
  loc.photos.forEach(function(ph, i) {
    var el = document.createElement('div');
    el.className = 'photo-grid-item';
    el.innerHTML = '<img src="' + ph.url + '" alt="' + (ph.caption || '') + '" loading="lazy"/>' +
      (ph.caption ? '<div class="caption-overlay">' + ph.caption + '</div>' : '') +
      uploaderBadgeHTML(ph);
    (function(idx) { el.onclick = function() { openLightbox(loc, idx); }; })(i);
    grid.appendChild(el);
  });
  document.getElementById('viewer-overlay').classList.add('open');
}

function maybeCloseViewer(e) {
  if (e.target === document.getElementById('viewer-overlay'))
    document.getElementById('viewer-overlay').classList.remove('open');
}

// ─────────────────────────────────────────────────────────
// LIGHTBOX — with navigation + delete
// ─────────────────────────────────────────────────────────
function openLightbox(loc, index) {
  lbLoc    = loc;
  lbPhotos = loc.photos.slice(); // local copy
  lbIndex  = index;
  document.getElementById('lightbox').classList.add('open');
  renderLightbox();
}

function renderLightbox() {
  var photo = lbPhotos[lbIndex];
  if (!photo) return;

  document.getElementById('lightbox-img').src = photo.url;

  // Caption
  var parts = [];
  if (photo.uploaderName) parts.push(photo.uploaderName);
  if (photo.caption)      parts.push(photo.caption);
  var cap = document.getElementById('lb-caption');
  cap.textContent   = parts.join(' · ');
  cap.style.display = parts.length ? 'block' : 'none';

  // Counter
  document.getElementById('lb-counter').textContent =
    (lbIndex + 1) + ' / ' + lbPhotos.length;

  // Arrows
  document.getElementById('lb-prev').classList.toggle('hidden', lbIndex === 0);
  document.getElementById('lb-next').classList.toggle('hidden', lbIndex === lbPhotos.length - 1);

  // Delete — only visible if this is your photo
  var delBtn = document.getElementById('lb-delete');
  delBtn.style.display = (currentUser && photo.uploadedBy === currentUser.uid) ? 'flex' : 'none';
}

function lightboxNav(dir, e) {
  e.stopPropagation();
  var next = lbIndex + dir;
  if (next < 0 || next >= lbPhotos.length) return;
  lbIndex = next;
  renderLightbox();
}

function lightboxBackdropClick(e) {
  if (e.target === document.getElementById('lightbox')) closeLightbox();
}

function closeLightbox() {
  document.getElementById('lightbox').classList.remove('open');
}

async function deleteCurrentPhoto() {
  var photo = lbPhotos[lbIndex];
  if (!photo || !currentUser || photo.uploadedBy !== currentUser.uid) return;
  if (!confirm('Delete this photo?')) return;

  var delBtn = document.getElementById('lb-delete');
  delBtn.textContent = 'Deleting…'; delBtn.disabled = true;

  try {
    // Fetch fresh copy so we match exactly what Firestore has
    var locDoc = await db.collection('locations').doc(lbLoc.id).get();
    var fresh  = (locDoc.data().photos || []).filter(function(p) {
      return !(p.url === photo.url && p.createdAt === photo.createdAt && p.uploadedBy === photo.uploadedBy);
    });

    await db.collection('locations').doc(lbLoc.id).update({ photos: fresh });

    // Update local lightbox array
    lbPhotos.splice(lbIndex, 1);

    if (lbPhotos.length === 0) {
      closeLightbox();
      document.getElementById('viewer-overlay').classList.remove('open');
    } else {
      if (lbIndex >= lbPhotos.length) lbIndex = lbPhotos.length - 1;
      renderLightbox();
    }
    toast('Photo deleted.');
  } catch(err) {
    console.error(err);
    toast('Delete failed. Try again.');
    delBtn.textContent = 'Delete'; delBtn.disabled = false;
  }
}

// ─────────────────────────────────────────────────────────
// UPLOAD — open / close / reset
// ─────────────────────────────────────────────────────────
function openUpload()  { resetUpload(); document.getElementById('upload-overlay').classList.add('open'); }

function maybeCloseUpload(e) {
  if (e.target !== document.getElementById('upload-overlay')) return;
  if (pinMode) { cancelPin(); return; }
  document.getElementById('upload-overlay').classList.remove('open');
  resetUpload();
}

function resetUpload() {
  selectedFiles = []; selectedURLs = [];
  pendingLat = null;  pendingLng  = null;
  ['file-input','caption'].forEach(function(id) { document.getElementById(id).value = ''; });
  document.getElementById('caption').placeholder = 'Add a caption… (optional)';
  ['opt-gps','opt-pin','opt-search'].forEach(function(id) { document.getElementById(id).classList.remove('active'); });
  document.getElementById('search-panel').classList.remove('show');
  document.getElementById('search-input').value = '';
  document.getElementById('search-results').classList.remove('show');
  document.getElementById('search-results').innerHTML = '';
  document.getElementById('add-btn').disabled    = true;
  document.getElementById('add-btn').textContent = 'Add to Map';
  var s = document.getElementById('loc-status');
  s.classList.remove('show','warn'); s.textContent = '';
  document.getElementById('dz-content').innerHTML =
    '<div class="dz-icon">📷</div><div class="dz-main">Choose photos</div>' +
    '<div class="dz-sub">Tap here • select one or many</div>';
  document.getElementById('drop-zone').classList.remove('has-file');
  if (tempPinMarker) { map.removeLayer(tempPinMarker); tempPinMarker = null; }
}

// ─────────────────────────────────────────────────────────
// UPLOAD — file selection (multi)
// ─────────────────────────────────────────────────────────
function handleFile(e) {
  var files = Array.from(e.target ? e.target.files : e);
  if (!files.length) return;
  selectedFiles = files;
  selectedURLs  = new Array(files.length);
  var pending   = files.length;
  files.forEach(function(file, i) {
    var r = new FileReader();
    r.onload = function(ev) { selectedURLs[i] = ev.target.result; if (!--pending) updateDropZonePreview(); };
    r.readAsDataURL(file);
  });
}

function updateDropZonePreview() {
  var n = selectedFiles.length;
  document.getElementById('drop-zone').classList.add('has-file');
  if (n === 1) {
    document.getElementById('dz-content').innerHTML =
      '<div class="dz-preview"><img src="' + selectedURLs[0] + '"/></div>' +
      '<div class="dz-main" style="color:#0f172a">' + selectedFiles[0].name + '</div>' +
      '<div class="dz-change">Tap to change</div>';
    document.getElementById('caption').placeholder = 'Add a caption… (optional)';
  } else {
    var thumbs = '';
    for (var i = 0; i < Math.min(n, 5); i++)
      thumbs += '<img src="' + selectedURLs[i] + '" class="dz-multi-thumb"/>';
    if (n > 5) thumbs += '<div class="dz-multi-more">+' + (n - 5) + '</div>';
    document.getElementById('dz-content').innerHTML =
      '<div class="dz-multi-grid">' + thumbs + '</div>' +
      '<div class="dz-main" style="color:#0f172a">' + n + ' photos selected</div>' +
      '<div class="dz-change">Tap to change</div>';
    document.getElementById('caption').placeholder = 'Add a caption… (applies to all)';
  }
  checkReady();
}

var dropZone = document.getElementById('drop-zone');
dropZone.addEventListener('dragover',  function(e) { e.preventDefault(); dropZone.style.borderColor = '#f59e0b'; });
dropZone.addEventListener('dragleave', function()  { dropZone.style.borderColor = ''; });
dropZone.addEventListener('drop', function(e) {
  e.preventDefault(); dropZone.style.borderColor = '';
  var files = Array.from(e.dataTransfer.files).filter(function(f) { return f.type.startsWith('image/'); });
  if (files.length) handleFile(files);
});

// ─────────────────────────────────────────────────────────
// LOCATION — GPS
// ─────────────────────────────────────────────────────────
function useGPS() {
  ['opt-gps'].forEach(function(id) { document.getElementById(id).classList.add('active'); });
  ['opt-pin','opt-search'].forEach(function(id) { document.getElementById(id).classList.remove('active'); });
  document.getElementById('search-panel').classList.remove('show');
  showStatus('Getting your location…', false);
  if (!navigator.geolocation) { showStatus('GPS not available in this browser.', true); return; }
  navigator.geolocation.getCurrentPosition(
    function(pos) {
      pendingLat = pos.coords.latitude; pendingLng = pos.coords.longitude;
      showStatus('Location found: ' + pendingLat.toFixed(4) + ', ' + pendingLng.toFixed(4), false);
      checkReady();
    },
    function() {
      showStatus('GPS permission denied. Try dropping a pin instead.', true);
      document.getElementById('opt-gps').classList.remove('active');
    }
  );
}

// ─────────────────────────────────────────────────────────
// LOCATION — pin drop
// ─────────────────────────────────────────────────────────
function startPin() {
  document.getElementById('opt-pin').classList.add('active');
  ['opt-gps','opt-search'].forEach(function(id) { document.getElementById(id).classList.remove('active'); });
  document.getElementById('search-panel').classList.remove('show');
  document.getElementById('upload-overlay').classList.remove('open');
  enterPinMode();
}

function enterPinMode() {
  pinMode = true;
  document.getElementById('pin-banner').classList.add('show');
  document.body.classList.add('pin-mode');
  map.once('click', onPinClick);
}

function onPinClick(e) {
  pendingLat = e.latlng.lat; pendingLng = e.latlng.lng;
  if (tempPinMarker) map.removeLayer(tempPinMarker);
  tempPinMarker = L.marker([pendingLat, pendingLng], { icon: L.divIcon({
    html: '<div style="width:18px;height:18px;background:#f59e0b;border:3px solid #fff;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,.4)"></div>',
    className: '', iconSize: [18,18], iconAnchor: [9,9]
  })}).addTo(map);
  exitPinMode();
  setTimeout(function() {
    document.getElementById('upload-overlay').classList.add('open');
    showStatus('Pin placed: ' + pendingLat.toFixed(4) + ', ' + pendingLng.toFixed(4), false);
    checkReady();
  }, 120);
}

function cancelPin() { map.off('click', onPinClick); exitPinMode(); }

function exitPinMode() {
  pinMode = false;
  document.getElementById('pin-banner').classList.remove('show');
  document.body.classList.remove('pin-mode');
}

// ─────────────────────────────────────────────────────────
// LOCATION — search
// ─────────────────────────────────────────────────────────
function selectSearch() {
  document.getElementById('opt-search').classList.add('active');
  ['opt-gps','opt-pin'].forEach(function(id) { document.getElementById(id).classList.remove('active'); });
  document.getElementById('search-panel').classList.add('show');
  pendingLat = null; pendingLng = null;
  if (tempPinMarker) { map.removeLayer(tempPinMarker); tempPinMarker = null; }
  checkReady();
  setTimeout(function() { document.getElementById('search-input').focus(); }, 50);
}

function clearSearch() {
  document.getElementById('search-input').value = '';
  document.getElementById('search-results').innerHTML = '';
  document.getElementById('search-results').classList.remove('show');
  pendingLat = null; pendingLng = null;
  if (tempPinMarker) { map.removeLayer(tempPinMarker); tempPinMarker = null; }
  document.getElementById('loc-status').classList.remove('show','warn');
  checkReady();
}

var searchDebounce;
function onSearchInput() {
  var q       = document.getElementById('search-input').value.trim();
  var results = document.getElementById('search-results');
  clearTimeout(searchDebounce);
  if (!q) { results.classList.remove('show'); pendingLat = null; pendingLng = null; checkReady(); return; }
  results.innerHTML = '<div class="search-message">Searching…</div>';
  results.classList.add('show');
  searchDebounce = setTimeout(function() { doSearch(q); }, 420);
}

async function doSearch(q) {
  var results = document.getElementById('search-results');
  try {
    var res  = await fetch('https://nominatim.openstreetmap.org/search?q=' +
      encodeURIComponent(q) + '&format=json&limit=6&addressdetails=1',
      { headers: { 'Accept-Language': 'en' } });
    var data = await res.json();
    if (!data.length) { results.innerHTML = '<div class="search-message">No results found.</div>'; return; }
    results.innerHTML = '';
    data.forEach(function(place) {
      var parts = place.display_name.split(', ');
      var item  = document.createElement('div');
      item.className = 'search-result-item';
      item.innerHTML = '<div class="result-main">' + parts.slice(0,2).join(', ') + '</div>' +
        (parts.length > 2 ? '<div class="result-sub">' + parts.slice(2,5).join(', ') + '</div>' : '');
      item.onclick = function() { pickPlace(parseFloat(place.lat), parseFloat(place.lon), place.display_name); };
      results.appendChild(item);
    });
  } catch(_) { results.innerHTML = '<div class="search-message">Search failed. Check your connection.</div>'; }
}

function pickPlace(lat, lng, fullName) {
  pendingLat = lat; pendingLng = lng;
  document.getElementById('search-input').value = fullName.split(', ').slice(0,3).join(', ');
  document.getElementById('search-results').classList.remove('show');
  if (tempPinMarker) map.removeLayer(tempPinMarker);
  tempPinMarker = L.marker([lat, lng], { icon: L.divIcon({
    html: '<div style="width:18px;height:18px;background:#f59e0b;border:3px solid #fff;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,.4)"></div>',
    className: '', iconSize: [18,18], iconAnchor: [9,9]
  })}).addTo(map);
  map.panTo([lat, lng], { animate: true, duration: 0.8 });
  showStatus('Location set: ' + fullName.split(', ').slice(0,2).join(', '), false);
  checkReady();
}

function showStatus(msg, warn) {
  var el = document.getElementById('loc-status');
  el.textContent = msg; el.classList.add('show'); el.classList.toggle('warn', warn);
}

function checkReady() {
  var n = selectedFiles.length, ready = n > 0 && pendingLat !== null;
  var btn = document.getElementById('add-btn');
  btn.disabled    = !ready;
  btn.textContent = (ready && n > 1) ? 'Add ' + n + ' Photos to Map' : 'Add to Map';
}

// ─────────────────────────────────────────────────────────
// CLOUDINARY UPLOAD
// ─────────────────────────────────────────────────────────
async function uploadToCloudinary(file) {
  var form = new FormData();
  form.append('file', file);
  form.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
  form.append('folder', 'kline-of-sight');
  var res = await fetch('https://api.cloudinary.com/v1_1/' + CLOUDINARY_CLOUD_NAME + '/image/upload',
    { method: 'POST', body: form });
  if (!res.ok) throw new Error('Cloudinary error: ' + res.status);
  return (await res.json()).secure_url;
}

// ─────────────────────────────────────────────────────────
// SAVE PHOTOS
// ─────────────────────────────────────────────────────────
async function savePhoto() {
  if (!selectedFiles.length || pendingLat === null || !currentUser) return;
  var n = selectedFiles.length, btn = document.getElementById('add-btn');
  btn.disabled = true;
  btn.textContent = n > 1 ? 'Uploading 0 of ' + n + '…' : 'Uploading…';

  try {
    var uploaded = 0;
    var photoUrls = await Promise.all(selectedFiles.map(async function(file) {
      var url = await uploadToCloudinary(file);
      if (n > 1) btn.textContent = 'Uploading ' + (++uploaded) + ' of ' + n + '…';
      return url;
    }));

    var caption = document.getElementById('caption').value.trim();

    var locName = pendingLat.toFixed(3) + ', ' + pendingLng.toFixed(3);
    try {
      var geo = await fetch('https://nominatim.openstreetmap.org/reverse?lat=' + pendingLat +
        '&lon=' + pendingLng + '&format=json', { headers: { 'Accept-Language': 'en' } });
      if (geo.ok) {
        var d = await geo.json(), a = d.address;
        locName = a.city || a.town || a.village || a.county || a.state || locName;
        if (a.country && locName !== a.country) locName += ', ' + a.country;
      }
    } catch(_) {}

    var photoEntries = photoUrls.map(function(url) {
      return { url: url, caption: caption,
        uploadedBy: currentUser.uid, uploaderName: currentUser.displayName || 'Someone',
        uploaderPhoto: currentUser.photoURL || null, createdAt: new Date().toISOString() };
    });

    var MERGE_RADIUS_M = 3000;
    var nearby = locations.find(function(l) {
      return map.distance([l.lat, l.lng], [pendingLat, pendingLng]) < MERGE_RADIUS_M;
    });

    if (nearby) {
      await db.collection('locations').doc(nearby.id).update({
        photos: firebase.firestore.FieldValue.arrayUnion.apply(
          firebase.firestore.FieldValue, photoEntries)
      });
    } else {
      await db.collection('locations').add({
        ownedBy:   currentUser.uid,
        name:      locName,
        lat:       pendingLat,
        lng:       pendingLng,
        photos:    photoEntries,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }

    document.getElementById('upload-overlay').classList.remove('open');
    if (tempPinMarker) { map.removeLayer(tempPinMarker); tempPinMarker = null; }
    resetUpload();
    map.flyTo([pendingLat, pendingLng], Math.max(map.getZoom(), 9), { duration: 1.4 });
    toast(n > 1 ? n + ' photos added!' : 'Photo added!');
  } catch(err) {
    console.error('Save failed:', err);
    toast('Upload failed. Check your connection and try again.');
    btn.disabled = false;
    btn.textContent = n > 1 ? 'Add ' + n + ' Photos to Map' : 'Add to Map';
  }
}

// ─────────────────────────────────────────────────────────
// TOAST
// ─────────────────────────────────────────────────────────
var toastTimer;
function toast(msg) {
  var el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function() { el.classList.remove('show'); }, 3500);
}

// ─────────────────────────────────────────────────────────
// KEYBOARD
// ─────────────────────────────────────────────────────────
document.addEventListener('keydown', function(e) {
  var lbOpen = document.getElementById('lightbox').classList.contains('open');
  if (lbOpen) {
    if (e.key === 'ArrowLeft')  { lightboxNav(-1, e); return; }
    if (e.key === 'ArrowRight') { lightboxNav(1,  e); return; }
    if (e.key === 'Escape')     { closeLightbox(); return; }
    return;
  }
  if (e.key !== 'Escape') return;
  document.getElementById('viewer-overlay').classList.remove('open');
  document.getElementById('sharing-overlay').classList.remove('open');
  if (pinMode) cancelPin();
  else document.getElementById('upload-overlay').classList.remove('open');
});
