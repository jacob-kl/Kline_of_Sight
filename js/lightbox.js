// ─────────────────────────────────────────────────────────
// Lightbox
//
// Full-screen photo viewer with pinch-zoom, nav, save,
// share (Web Share API), and delete.
//
// Reads:  db, currentUser, locations
// Writes: lbPhotos, lbIndex, lbLoc, lbZoom
// ─────────────────────────────────────────────────────────
let lbPhotos = [];
let lbIndex  = 0;
let lbLoc    = null;
let lbZoom   = false;
let lbScale  = 1;

// ── Open / close ──────────────────────────────────────────
function openLightbox(photos, startIndex, loc) {
  lbPhotos = photos; lbIndex = startIndex || 0; lbLoc = loc;
  lbZoom = false; lbScale = 1;
  renderLightbox();
  document.getElementById('lightbox').classList.add('open');
}

function closeLightbox() {
  document.getElementById('lightbox').classList.remove('open');
  lbZoom = false; lbScale = 1;
}

// ── Render ────────────────────────────────────────────────
function renderLightbox() {
  var photo = lbPhotos[lbIndex];
  if (!photo) return;

  var img = document.getElementById('lb-img');
  img.src = photo.url;
  img.style.transform = 'scale(1)';
  lbScale = 1; lbZoom = false;

  document.getElementById('lb-caption').textContent =
    photo.caption || (lbLoc ? lbLoc.name : '');
  document.getElementById('lb-uploader').textContent =
    photo.uploaderName ? 'Added by ' + photo.uploaderName : '';
  document.getElementById('lb-counter').textContent =
    lbPhotos.length > 1 ? (lbIndex+1) + ' / ' + lbPhotos.length : '';

  // Nav arrows
  var prev = document.getElementById('lb-prev');
  var next = document.getElementById('lb-next');
  prev.style.display = lbIndex > 0 ? 'flex' : 'none';
  next.style.display = lbIndex < lbPhotos.length-1 ? 'flex' : 'none';

  // Delete button — only show if owner
  var delBtn = document.getElementById('lb-delete');
  if (currentUser && photo.uploadedBy === currentUser.uid) {
    delBtn.style.display = 'flex';
    delBtn.textContent = 'Delete';
    delBtn.onclick = deleteLightboxPhoto;
  } else {
    delBtn.style.display = 'none';
  }
}

function lightboxNav(dir, e) {
  if (e) e.stopPropagation();
  var next = lbIndex + dir;
  if (next < 0 || next >= lbPhotos.length) return;
  lbIndex = next; renderLightbox();
}

// ── Pinch zoom ────────────────────────────────────────────
var pinchStartDist = 0;
var pinchStartScale = 1;

document.getElementById('lb-img').addEventListener('touchstart', function(e) {
  if (e.touches.length === 2) {
    pinchStartDist  = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
    pinchStartScale = lbScale;
  }
}, { passive: true });

document.getElementById('lb-img').addEventListener('touchmove', function(e) {
  if (e.touches.length === 2) {
    e.preventDefault();
    var dist = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
    lbScale = Math.min(4, Math.max(1, pinchStartScale * (dist / pinchStartDist)));
    e.currentTarget.style.transform = 'scale(' + lbScale + ')';
    lbZoom = lbScale > 1.05;
  }
}, { passive: false });

function toggleZoom(e) {
  e.stopPropagation();
  var img = document.getElementById('lb-img');
  if (lbZoom) {
    lbScale = 1; lbZoom = false;
    img.style.transition = 'transform .25s';
    img.style.transform  = 'scale(1)';
    setTimeout(function() { img.style.transition = ''; }, 260);
  } else {
    lbScale = 2; lbZoom = true;
    img.style.transition = 'transform .25s';
    img.style.transform  = 'scale(2)';
    setTimeout(function() { img.style.transition = ''; }, 260);
  }
}

// ── Swipe to close ────────────────────────────────────────
(function() {
  var lb = document.getElementById('lightbox');
  var startY = 0;
  lb.addEventListener('touchstart', function(e) {
    startY = e.touches[0].clientY;
  }, { passive: true });
  lb.addEventListener('touchend', function(e) {
    if (lbZoom) return;
    var dy = e.changedTouches[0].clientY - startY;
    if (dy > 90) closeLightbox();
  }, { passive: true });
})();

// ── Save / Share / Delete ─────────────────────────────────
async function saveLightboxPhoto() {
  var photo = lbPhotos[lbIndex];
  if (!photo) return;
  var btn = document.getElementById('lb-save');
  btn.textContent = 'Saving…';
  try {
    var res   = await fetch(photo.url);
    var blob  = await res.blob();
    var a     = document.createElement('a');
    a.href    = URL.createObjectURL(blob);
    a.download= (lbLoc ? lbLoc.name.replace(/[^a-z0-9]/gi,'_') : 'photo') + '.jpg';
    a.click();
    URL.revokeObjectURL(a.href);
    btn.textContent = 'Saved!';
  } catch(err) {
    btn.textContent = 'Failed';
  }
  setTimeout(function() { btn.textContent = 'Save'; }, 2500);
}

async function shareLightboxPhoto() {
  var photo = lbPhotos[lbIndex];
  if (!photo) return;

  // Prefer native share (mobile) — fall back to clipboard copy
  if (navigator.share) {
    try {
      var res  = await fetch(photo.url);
      var blob = await res.blob();
      var file = new File([blob], 'photo.jpg', { type: blob.type });
      var data = { title: lbLoc ? lbLoc.name : 'Kline of Sight' };
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        data.files = [file];
      } else {
        data.url = photo.url;
      }
      await navigator.share(data);
      return;
    } catch(err) {
      if (err.name === 'AbortError') return; // user cancelled
    }
  }
  // Fallback: copy photo URL
  navigator.clipboard && navigator.clipboard.writeText(photo.url)
    .then(function() { toast('Link copied!'); })
    .catch(function() { toast('Copy the URL from your browser address bar.'); });
}

async function deleteLightboxPhoto() {
  var photo = lbPhotos[lbIndex];
  if (!photo || !lbLoc) return;
  if (!confirm('Delete this photo? This cannot be undone.')) return;

  var btn = document.getElementById('lb-delete');
  btn.textContent = 'Deleting…'; btn.disabled = true;

  try {
    var remaining = lbLoc.photos.filter(function(p) { return p.url !== photo.url; });
    if (remaining.length === 0) {
      await db.collection('locations').doc(lbLoc.id).delete();
      closeLightbox();
      document.getElementById('viewer-overlay').classList.remove('open');
      toast('Location removed.');
      return;
    }
    await db.collection('locations').doc(lbLoc.id).update({ photos: remaining });
    lbLoc   = Object.assign({}, lbLoc, { photos: remaining });
    lbPhotos= remaining;
    if (lbIndex >= lbPhotos.length) lbIndex = lbPhotos.length - 1;
    renderLightbox();
    toast('Photo deleted.');
  } catch(err) {
    console.error(err);
    btn.textContent = 'Delete'; btn.disabled = false;
    toast('Delete failed. Check Firestore rules.');
  }
}
