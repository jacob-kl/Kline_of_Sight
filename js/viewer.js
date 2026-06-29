// ─────────────────────────────────────────────────────────
// Viewer — photo grid for a single location
// ─────────────────────────────────────────────────────────
let currentLoc        = null;

function openViewer(loc) {
  currentLoc         = loc;
  currentViewerLocId = loc.id;
  renderViewer(loc);
  document.getElementById('viewer-overlay').classList.add('open');
}

function maybeCloseViewer(e) {
  if (e.target === document.getElementById('viewer-overlay'))
    document.getElementById('viewer-overlay').classList.remove('open');
}

// Swipe-down to close
(function() {
  var sheet = document.querySelector('#viewer-overlay .sheet');
  if (!sheet) return;
  var sy = 0;
  sheet.addEventListener('touchstart', function(e) { sy = e.touches[0].clientY; }, { passive: true });
  sheet.addEventListener('touchend', function(e) {
    if (sheet.scrollTop > 10) return;
    if (e.changedTouches[0].clientY - sy > 80)
      document.getElementById('viewer-overlay').classList.remove('open');
  }, { passive: true });
})();

function renderViewer(loc) {
  // Location name with rename / delete buttons (owner only)
  var nameEl = document.getElementById('vwr-location');
  if (nameEl) {
    nameEl.innerHTML =
      '<span id="vwr-name-text">' + escHtml(loc.name) + '</span>' +
      (currentUser && loc.ownedBy === currentUser.uid
        ? ' <button class="vwr-icon-btn" title="Rename" onclick="startRenameLocation()">✏️</button>' +
          ' <button class="vwr-icon-btn" title="Delete pin" onclick="deleteLocation()">🗑️</button>'
        : '');
  }

  // Event badge
  var badgeEl = document.getElementById('vwr-event-badge');
  if (badgeEl) {
    if (loc.eventName) {
      badgeEl.textContent = '📅 ' + loc.eventName;
      badgeEl.style.display = '';
    } else {
      badgeEl.style.display = 'none';
    }
  }

  // Title / caption (show location coords if nothing else)
  var titleEl = document.getElementById('vwr-title');
  if (titleEl) titleEl.textContent = '';

  // Add-to-event button
  var evtBtn = document.getElementById('vwr-add-event-btn');
  if (evtBtn) {
    evtBtn.textContent = loc.eventName ? '📅 Change event' : '📅 Add to event';
  }

  // Photo grid
  var grid = document.getElementById('vwr-grid');
  if (!grid) return;
  grid.innerHTML = '';
  (loc.photos || []).forEach(function(ph, i) {
    var thumb = document.createElement('div');
    thumb.className = 'vwr-thumb';
    var img = document.createElement('img');
    img.src     = ph.url;
    img.loading = 'lazy';
    img.onclick = (function(idx) {
      return function() { openLightbox(loc.photos, idx, loc); };
    })(i);
    thumb.appendChild(img);
    grid.appendChild(thumb);
  });
}

// ── Rename location ───────────────────────────────────────
function startRenameLocation() {
  var nameEl = document.getElementById('vwr-location');
  var current = currentLoc ? currentLoc.name : '';
  nameEl.innerHTML =
    '<input id="rename-input" class="rename-input" value="' + escHtml(current) + '" maxlength="80"/>' +
    ' <button class="btn-outline-sm" style="font-size:12px;padding:5px 10px" onclick="saveRenameLocation()">Save</button>' +
    ' <button class="btn-outline-sm" style="font-size:12px;padding:5px 10px" onclick="renderViewer(currentLoc)">Cancel</button>';
  var inp = document.getElementById('rename-input');
  inp.focus(); inp.select();
  inp.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') saveRenameLocation();
    if (e.key === 'Escape') renderViewer(currentLoc);
  });
}

async function saveRenameLocation() {
  var inp  = document.getElementById('rename-input');
  var name = inp ? inp.value.trim() : '';
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
  if (!confirm('Delete "' + currentLoc.name + '" and all its photos?')) return;
  try {
    await db.collection('locations').doc(currentLoc.id).delete();
    document.getElementById('viewer-overlay').classList.remove('open');
    toast('Location deleted.');
  } catch(err) {
    console.error(err); toast('Delete failed. Check Firestore rules.');
  }
}

function escHtml(s) {
  return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
