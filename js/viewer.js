// ─────────────────────────────────────────────────────────
// Viewer — photo grid for a single location
//
// Reads:  db, currentUser, locations
// Writes: currentLoc
// ─────────────────────────────────────────────────────────
let currentLoc = null;

function openViewer(loc) {
  currentLoc = loc;
  renderViewer(loc);
  document.getElementById('viewer-overlay').classList.add('open');
}

function maybeCloseViewer(e) {
  if (e.target === document.getElementById('viewer-overlay')) {
    document.getElementById('viewer-overlay').classList.remove('open');
  }
}

// Swipe-down to close the viewer sheet
(function() {
  var ov = document.getElementById('viewer-overlay');
  var sh = ov ? ov.querySelector('.sheet') : null;
  if (!sh) return;
  var sy = 0;
  sh.addEventListener('touchstart', function(e) { sy = e.touches[0].clientY; }, { passive: true });
  sh.addEventListener('touchend', function(e) {
    if (sh.scrollTop > 0) return;
    if (e.changedTouches[0].clientY - sy > 80)
      ov.classList.remove('open');
  }, { passive: true });
})();

// ── Render ────────────────────────────────────────────────
function renderViewer(loc) {
  // Location name with rename button
  var nameEl = document.getElementById('vwr-location');
  nameEl.innerHTML =
    '<span id="vwr-name-text">' + escHtml(loc.name) + '</span>' +
    (currentUser && loc.ownedBy === currentUser.uid
      ? ' <button class="vwr-icon-btn" title="Rename" onclick="startRenameLocation()">✏️</button>' +
        ' <button class="vwr-icon-btn" title="Delete location" onclick="deleteLocation()">🗑️</button>'
      : '');

  // Event badge
  var evtEl = document.getElementById('vwr-event');
  evtEl.innerHTML = loc.eventName
    ? '<span class="vwr-event-badge">📅 ' + escHtml(loc.eventName) + '</span>' +
      (currentUser ? ' <button class="vwr-icon-btn" onclick="openAddEventOverlay(\'' + loc.id + '\')">✏️</button>' : '')
    : (currentUser ? '<button class="btn-outline-sm" onclick="openAddEventOverlay(\'' + loc.id + '\')">+ Add to event</button>' : '');

  // Photo grid
  var grid = document.getElementById('vwr-grid');
  grid.innerHTML = '';
  (loc.photos || []).forEach(function(ph, i) {
    var div = document.createElement('div');
    div.className = 'vwr-thumb';
    var img = document.createElement('img');
    img.src     = ph.url;
    img.loading = 'lazy';
    img.onclick = function() { openLightbox(loc.photos, i, loc); };
    div.appendChild(img);
    grid.appendChild(div);
  });
}

// ── Rename location ───────────────────────────────────────
function startRenameLocation() {
  var nameEl = document.getElementById('vwr-location');
  var current = currentLoc.name;
  nameEl.innerHTML =
    '<input id="rename-input" class="rename-input" value="' + escHtml(current) + '" maxlength="80"/>' +
    ' <button class="btn-outline-sm" onclick="saveRenameLocation()">Save</button>' +
    ' <button class="btn-outline-sm" onclick="renderViewer(currentLoc)">Cancel</button>';
  var inp = document.getElementById('rename-input');
  inp.focus(); inp.select();
  inp.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') saveRenameLocation();
    if (e.key === 'Escape') renderViewer(currentLoc);
  });
}

async function saveRenameLocation() {
  var inp  = document.getElementById('rename-input');
  var name = (inp ? inp.value : '').trim();
  if (!name) return;
  try {
    await db.collection('locations').doc(currentLoc.id).update({ name: name });
    currentLoc = Object.assign({}, currentLoc, { name: name });
    renderViewer(currentLoc);
    toast('Location renamed.');
  } catch(err) {
    console.error(err); toast('Rename failed.');
  }
}

// ── Delete location ───────────────────────────────────────
async function deleteLocation() {
  if (!confirm('Delete "' + currentLoc.name + '" and all its photos? This cannot be undone.')) return;
  try {
    await db.collection('locations').doc(currentLoc.id).delete();
    document.getElementById('viewer-overlay').classList.remove('open');
    toast('Location deleted.');
  } catch(err) {
    console.error(err); toast('Delete failed. Check Firestore rules.');
  }
}

function escHtml(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
