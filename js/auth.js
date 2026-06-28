// ─────────────────────────────────────────────────────────
// Auth
//
// Reads:  db, auth  (firebase.js)
// Writes: currentUser, pendingUpload, customPhotoURL
// Calls:  startConnectionsListener (connections.js)
//         openUpload (upload.js)
//         openSharingPanel (sharing.js)
// ─────────────────────────────────────────────────────────
let currentUser    = null;
let pendingUpload  = false;
let customPhotoURL = null; // user-uploaded profile photo overrides Google photo

// ── Auth state ───────────────────────────────────────────
auth.onAuthStateChanged(function(user) {
  currentUser = user;
  updateAuthUI(user, customPhotoURL);

  if (user) {
    // Save display name. Don't overwrite customPhotoURL — save Google photo separately.
    db.collection('users').doc(user.uid).set({
      displayName:   user.displayName || '',
      googlePhotoURL: user.photoURL   || null
    }, { merge: true });

    // Check for a user-uploaded custom photo
    db.collection('users').doc(user.uid).get().then(function(doc) {
      if (doc.exists && doc.data().customPhotoURL) {
        customPhotoURL = doc.data().customPhotoURL;
        updateAuthUI(user, customPhotoURL);
      }
    }).catch(function() {});

    document.getElementById('fab').style.display        = 'flex';
    document.getElementById('invite-btn').style.display = 'flex';

    startConnectionsListener();

    if (pendingUpload) { pendingUpload = false; openUpload(); }

  } else {
    customPhotoURL = null;
    document.getElementById('fab').style.display        = 'none';
    document.getElementById('invite-btn').style.display = 'none';
    locations     = [];
    connectedUIDs = [];
    if (typeof locationListener === 'function') { locationListener(); locationListener = null; }
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

function updateAuthUI(user, overridePhoto) {
  var btn   = document.getElementById('auth-btn');
  var photo = overridePhoto || (user && user.photoURL);
  if (user) {
    btn.innerHTML = photo
      ? '<img src="' + photo + '" class="auth-avatar" title="Sign out"/>'
      : '<span class="auth-initials">' + ((user.displayName || '?')[0]).toUpperCase() + '</span>';
  } else {
    btn.textContent = 'Sign in';
  }
}

// ── Profile photo upload ──────────────────────────────────
async function handleAvatarUpload(e) {
  var file = e.target.files[0];
  if (!file || !currentUser) return;

  var wrap = document.getElementById('profile-avatar-wrap');
  if (wrap) wrap.style.opacity = '0.5';
  toast('Uploading photo…');

  try {
    var form = new FormData();
    form.append('file',          file);
    form.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
    form.append('folder',        'kline-of-sight/avatars');

    var res = await fetch(
      'https://api.cloudinary.com/v1_1/' + CLOUDINARY_CLOUD_NAME + '/image/upload',
      { method: 'POST', body: form }
    );
    if (!res.ok) throw new Error('Upload failed: ' + res.status);
    var data = await res.json();

    // Crop to a 200×200 circle-ready image via Cloudinary transformation
    var url = data.secure_url.replace('/upload/', '/upload/w_200,h_200,c_fill,r_max,f_auto,q_auto/');

    await db.collection('users').doc(currentUser.uid).update({ customPhotoURL: url });
    customPhotoURL = url;
    updateAuthUI(currentUser, url);
    renderProfileSection();
    toast('Profile photo updated!');
  } catch(err) {
    console.error(err);
    toast('Photo upload failed. Try again.');
  } finally {
    if (wrap) wrap.style.opacity = '1';
    e.target.value = '';
  }
}

function renderProfileSection() {
  var imgEl  = document.getElementById('profile-avatar-img');
  var nameEl = document.getElementById('profile-name');
  if (!currentUser) return;
  var photo = customPhotoURL || (currentUser && currentUser.photoURL);
  if (imgEl) {
    imgEl.innerHTML = photo
      ? '<img src="' + photo + '" alt="Your photo"/>'
      : '<span class="profile-initial">' + ((currentUser.displayName || '?')[0]).toUpperCase() + '</span>';
  }
  if (nameEl) nameEl.textContent = currentUser.displayName || 'Your account';
}

// ── FAB ──────────────────────────────────────────────────
function handleFabClick() {
  if (!currentUser) { pendingUpload = true; signIn(); return; }
  openUpload();
}

// ── Toast ────────────────────────────────────────────────
var toastTimer;
function toast(msg) {
  var el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function() { el.classList.remove('show'); }, 3500);
}

// ── Keyboard shortcuts ───────────────────────────────────
document.addEventListener('keydown', function(e) {
  var lbOpen = document.getElementById('lightbox').classList.contains('open');
  if (lbOpen) {
    if (lbZoom) {
      if (e.key === 'Escape') toggleZoom({ stopPropagation: function() {} });
      return;
    }
    if (e.key === 'ArrowLeft')  { lightboxNav(-1, e); return; }
    if (e.key === 'ArrowRight') { lightboxNav(1,  e); return; }
    if (e.key === 'Escape')     { closeLightbox(); return; }
    return;
  }
  if (e.key !== 'Escape') return;
  document.getElementById('viewer-overlay').classList.remove('open');
  document.getElementById('sharing-overlay').classList.remove('open');
  if (typeof pinMode !== 'undefined' && pinMode) cancelPin();
  else document.getElementById('upload-overlay').classList.remove('open');
});
