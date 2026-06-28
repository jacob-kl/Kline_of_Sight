// ─────────────────────────────────────────────────────────
// Sharing
//
// Three sections:
//   1. YOUR FAMILY     — who has full access
//   2. ADD A PERSON    — full mutual access via person code
//   3. SHARE A TRIP    — event-only access via trip code
//
// After a new full connection is made, if the current user
// has private events, a dialog asks whether to share them.
//
// Reads:  db, currentUser, connectedUIDs, events, accessibleEvents
// Writes: currentPersonCode, currentTripCode, inviteTimerInterval,
//         pendingPrivateConnectionUID
// ─────────────────────────────────────────────────────────
let currentPersonCode          = null;
let currentTripCode            = null;
let selectedShareEventId       = null;
let inviteTimerInterval        = null;
let pendingPrivateConnectionUID = null; // set when dialog is open

// ── Panel open / close ────────────────────────────────────
function openSharingPanel() {
  ['person-connect-error', 'trip-connect-error'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.textContent = '';
  });
  ['person-code-input', 'trip-code-input'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('sharing-overlay').classList.add('open');
  renderProfileSection();
  renderFamilyList();
  populateShareEventSelect();
}

function maybeCloseSharing(e) {
  if (e.target === document.getElementById('sharing-overlay')) {
    document.getElementById('sharing-overlay').classList.remove('open');
    if (inviteTimerInterval) { clearInterval(inviteTimerInterval); inviteTimerInterval = null; }
  }
}

// ── Family list ───────────────────────────────────────────
async function renderFamilyList() {
  var list = document.getElementById('family-list');
  if (!list) return;
  if (!connectedUIDs.length) {
    list.innerHTML = '<p class="family-empty">No one connected yet. Generate a code below to invite someone.</p>';
    return;
  }
  list.innerHTML = '<div class="family-loading">Loading…</div>';
  var profiles = await Promise.all(connectedUIDs.map(function(uid) {
    return db.collection('users').doc(uid).get().then(function(doc) {
      return doc.exists ? Object.assign({ uid: uid }, doc.data()) : { uid: uid, displayName: 'Unknown' };
    });
  }));
  list.innerHTML = '';
  profiles.forEach(function(p) {
    var photo = p.customPhotoURL || p.googlePhotoURL || p.photoURL;
    var avatar = photo
      ? '<div class="family-avatar"><img src="' + photo + '" alt=""/></div>'
      : '<div class="family-avatar family-initials">' + (p.displayName || '?')[0].toUpperCase() + '</div>';
    var item = document.createElement('div');
    item.className = 'family-item';
    item.innerHTML = avatar +
      '<div class="family-info">' +
        '<div class="family-name">' + (p.displayName || 'Unknown') + '</div>' +
        '<div class="family-access">Full access · all photos</div>' +
      '</div>';
    list.appendChild(item);
  });
}

// ── Person codes (full access) ────────────────────────────
async function generatePersonCode() {
  var display = document.getElementById('person-code-display');
  display.innerHTML = '<div class="code-generating">Generating…</div>';
  try {
    var code = makeRandomCode(), expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await db.collection('inviteCodes').doc(code).set({
      createdBy: currentUser.uid, expiresAt: expiresAt.toISOString()
    });
    currentPersonCode = code;
    display.innerHTML =
      '<div class="big-code">' + code + '</div>' +
      '<div class="code-expires" id="person-code-timer"></div>' +
      '<button class="btn-copy" onclick="copyToClipboard(currentPersonCode,\'Code copied!\')">Copy Code</button>';
    startTimer('person-code-timer', expiresAt);
  } catch(err) {
    display.innerHTML = '<div class="code-generating">Failed to generate. Try again.</div>';
  }
}

async function connectWithPersonCode() {
  var code    = document.getElementById('person-code-input').value.trim().toUpperCase();
  var errorEl = document.getElementById('person-connect-error');
  errorEl.textContent = '';
  if (code.length !== 6) { errorEl.textContent = 'Enter the full 6-character code.'; return; }

  var btn = document.getElementById('btn-person-connect');
  btn.disabled = true; btn.textContent = 'Connecting…';
  try {
    var codeDoc = await db.collection('inviteCodes').doc(code).get();
    if (!codeDoc.exists)                          throw new Error('not-found');
    var data = codeDoc.data();
    if (new Date(data.expiresAt) < new Date())   throw new Error('expired');
    if (data.createdBy === currentUser.uid)       throw new Error('own-code');

    var pairId   = [currentUser.uid, data.createdBy].sort().join('_');
    var existing = await db.collection('connections').doc(pairId).get();
    if (existing.exists)                          throw new Error('already-connected');

    await db.collection('connections').doc(pairId).set({
      uids: [currentUser.uid, data.createdBy],
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    document.getElementById('person-code-input').value = '';
    toast('Connected! Their photos will now appear on your map.');
    renderFamilyList();

    // If this user has private events, ask whether to share them
    var myPrivateEvents = (events || []).filter(function(e) {
      return e.private && e.createdBy === currentUser.uid;
    });
    if (myPrivateEvents.length > 0) {
      pendingPrivateConnectionUID = data.createdBy;
      var countEl = document.getElementById('private-event-count');
      var nameEl  = document.getElementById('new-connection-name');
      if (countEl) countEl.textContent = myPrivateEvents.length;
      // Load the other person's name
      db.collection('users').doc(data.createdBy).get().then(function(doc) {
        var name = doc.exists ? (doc.data().displayName || 'your new connection') : 'your new connection';
        if (nameEl) nameEl.textContent = name;
      }).catch(function() {});
      document.getElementById('private-share-overlay').classList.add('open');
    }
  } catch(err) {
    var msgs = {
      'not-found':         'Code not found. Double-check it.',
      'expired':           'This code has expired. Ask them for a new one.',
      'own-code':          "That's your own code — send it to someone else.",
      'already-connected': "You're already connected with this person."
    };
    errorEl.textContent = msgs[err.message] || 'Something went wrong. Try again.';
  } finally {
    btn.disabled = false; btn.textContent = 'Connect';
  }
}

// ── Private event sharing dialog ──────────────────────────
async function sharePrivateEventsWithNew() {
  if (!pendingPrivateConnectionUID) return;
  var uid = pendingPrivateConnectionUID;
  var privateEvts = (events || []).filter(function(e) {
    return e.private && e.createdBy === currentUser.uid;
  });
  try {
    await Promise.all(privateEvts.map(function(evt) {
      var accessId = uid + '_' + evt.id;
      return db.collection('eventAccess').doc(accessId).set({
        userId:    uid,
        eventId:   evt.id,
        eventName: evt.name,
        grantedBy: currentUser.uid,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      }).catch(function() {});
    }));
    toast('Private events shared!');
  } catch(err) {
    console.error(err); toast('Something went wrong sharing private events.');
  }
  closePrivateShareDialog();
}

function closePrivateShareDialog(e) {
  if (e && e.target !== document.getElementById('private-share-overlay')) return;
  document.getElementById('private-share-overlay').classList.remove('open');
  pendingPrivateConnectionUID = null;
}

// ── Trip codes (event-only access) ───────────────────────
function populateShareEventSelect() {
  var sel = document.getElementById('share-event-select');
  if (!sel) return;
  var prev = sel.value;
  sel.innerHTML = '<option value="">Select a trip to share…</option>';
  (events || []).forEach(function(evt) {
    var opt = document.createElement('option');
    opt.value       = evt.id;
    opt.textContent = (evt.private ? '🔒 ' : '') + evt.name + (evt.date ? ' (' + evt.date + ')' : '');
    sel.appendChild(opt);
  });
  if (prev) sel.value = prev;
}

function onShareEventSelect() {
  selectedShareEventId = document.getElementById('share-event-select').value || null;
  var area = document.getElementById('trip-code-area');
  if (area) area.style.display = selectedShareEventId ? 'block' : 'none';
  var display = document.getElementById('trip-code-display');
  if (display) display.innerHTML = '<div class="code-generating">Tap "New Trip Code" to generate one.</div>';
  currentTripCode = null;
}

async function generateTripCode() {
  if (!selectedShareEventId) return;
  var evt = (events || []).find(function(e) { return e.id === selectedShareEventId; });
  if (!evt) return;
  var display = document.getElementById('trip-code-display');
  display.innerHTML = '<div class="code-generating">Generating…</div>';
  try {
    var code = makeRandomCode(), expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await db.collection('eventInviteCodes').doc(code).set({
      eventId: evt.id, eventName: evt.name, createdBy: currentUser.uid,
      expiresAt: expiresAt.toISOString()
    });
    currentTripCode = code;
    display.innerHTML =
      '<div class="big-code">' + code + '</div>' +
      '<div class="code-expires" id="trip-code-timer">📅 ' + evt.name + '</div>' +
      '<button class="btn-copy" onclick="copyToClipboard(currentTripCode,\'Trip code copied!\')">Copy Code</button>';
    startTimer('trip-code-timer', expiresAt, '📅 ' + evt.name + ' · ');
  } catch(err) {
    display.innerHTML = '<div class="code-generating">Failed to generate. Try again.</div>';
  }
}

async function joinWithTripCode() {
  var code    = document.getElementById('trip-code-input').value.trim().toUpperCase();
  var errorEl = document.getElementById('trip-connect-error');
  errorEl.textContent = '';
  if (code.length !== 6) { errorEl.textContent = 'Enter the full 6-character code.'; return; }
  var btn = document.getElementById('btn-trip-connect');
  btn.disabled = true; btn.textContent = 'Joining…';
  try {
    var codeDoc = await db.collection('eventInviteCodes').doc(code).get();
    if (!codeDoc.exists) throw new Error('not-found');
    var data = codeDoc.data();
    if (new Date(data.expiresAt) < new Date()) throw new Error('expired');
    var accessId = currentUser.uid + '_' + data.eventId;
    var existing = await db.collection('eventAccess').doc(accessId).get();
    if (existing.exists) throw new Error('already-member');
    await db.collection('eventAccess').doc(accessId).set({
      userId:    currentUser.uid, eventId:  data.eventId, eventName: data.eventName,
      grantedBy: data.createdBy, createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    document.getElementById('trip-code-input').value = '';
    toast('Joined "' + data.eventName + '"! You can now view and add photos to this trip.');
  } catch(err) {
    var msgs = {
      'not-found':      'Code not found. Double-check it.',
      'expired':        'This code has expired. Ask for a new one.',
      'already-member': 'You already have access to this trip.'
    };
    errorEl.textContent = msgs[err.message] || 'Something went wrong. Try again.';
  } finally {
    btn.disabled = false; btn.textContent = 'Join Trip';
  }
}

// ── Helpers ───────────────────────────────────────────────
function makeRandomCode() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', c = '';
  for (var i = 0; i < 6; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}

function startTimer(elId, expiresAt, prefix) {
  function tick() {
    var el = document.getElementById(elId); if (!el) return;
    var ms = expiresAt - new Date();
    if (ms <= 0) { el.textContent = (prefix || '') + 'Expired'; return; }
    el.textContent = (prefix || '') + 'Expires in ' +
      Math.floor(ms / 3600000) + 'h ' + Math.floor((ms % 3600000) / 60000) + 'm';
  }
  tick();
  if (inviteTimerInterval) clearInterval(inviteTimerInterval);
  inviteTimerInterval = setInterval(tick, 30000);
}

function copyToClipboard(text, successMsg) {
  if (!text) return;
  var fallback = function() {
    var inp = document.createElement('input');
    inp.value = text; document.body.appendChild(inp); inp.select();
    document.execCommand('copy'); document.body.removeChild(inp); toast(successMsg);
  };
  navigator.clipboard ? navigator.clipboard.writeText(text).then(function() { toast(successMsg); }).catch(fallback) : fallback();
}

function renderConnectionsList() { renderFamilyList(); }
