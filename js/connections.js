// ─────────────────────────────────────────────────────────
// Connections & Privacy
//
// Two sharing tiers:
//   Full connection  — mutual, all photos, permanent
//   Trip access      — one event only, view + add photos
//
// Reads:  db, auth, currentUser
// Writes: locations, connectedUIDs, locationListener,
//         accessibleEvents, accessibleEventIds
// Calls:  renderFilter, renderMarkers  (map.js)
//         renderEventFilter, startEventsListener (events.js)
//         renderFamilyList (sharing.js)
// ─────────────────────────────────────────────────────────
let locations           = [];
let connectedUIDs       = [];
let locationListener    = null;
let accessibleEvents    = [];        // [{eventId, eventName, grantedBy}]
let accessibleEventIds  = new Set(); // quick lookup
let eventAccessListener = null;

function startConnectionsListener() {
  if (!currentUser) return;

  // Full connections listener
  db.collection('connections')
    .where('uids', 'array-contains', currentUser.uid)
    .onSnapshot(function(snap) {
      connectedUIDs = snap.docs.map(function(doc) {
        return doc.data().uids.find(function(uid) { return uid !== currentUser.uid; });
      }).filter(Boolean);

      startLocationListener();
      startEventsListener();
      renderFamilyList();
    }, function(err) {
      console.error('Connections listener:', err);
      startLocationListener();
      startEventsListener();
    });

  // Trip-level access listener
  startEventAccessListener();
}

// ── Trip access listener ──────────────────────────────────
function startEventAccessListener() {
  if (eventAccessListener) { eventAccessListener(); eventAccessListener = null; }
  if (!currentUser) return;

  eventAccessListener = db.collection('eventAccess')
    .where('userId', '==', currentUser.uid)
    .onSnapshot(function(snap) {
      accessibleEvents   = snap.docs.map(function(doc) { return doc.data(); });
      accessibleEventIds = new Set(accessibleEvents.map(function(a) { return a.eventId; }));
      // Restart location listener so newly-joined trips appear immediately
      startLocationListener();
      // Refresh event picker if upload sheet is open
      if (typeof renderEventPickerIfOpen === 'function') renderEventPickerIfOpen();
    }, function(err) {
      console.error('EventAccess listener:', err);
    });
}

// ── Location listener ────────────────────────────────────
function startLocationListener() {
  if (locationListener) { locationListener(); locationListener = null; }
  if (!currentUser) return;

  locationListener = db.collection('locations')
    .onSnapshot(function(snap) {
      var all = snap.docs.map(function(doc) {
        return Object.assign({ id: doc.id }, doc.data());
      });

      locations = all.filter(function(loc) {
        if (!loc.ownedBy)                               return true;  // old format
        if (loc.ownedBy === currentUser.uid)            return true;  // my photos
        if (connectedUIDs.indexOf(loc.ownedBy) !== -1)  return true;  // full connection
        if (loc.eventId && accessibleEventIds.has(loc.eventId)) return true; // trip access
        return false;
      });

      locations.sort(function(a, b) {
        var ta = a.createdAt && a.createdAt.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
        var tb = b.createdAt && b.createdAt.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
        return ta - tb;
      });

      renderFilter();
      renderMarkers();
      renderEventFilter();

      // Auto-migrate old docs missing ownedBy
      all.forEach(function(loc) {
        if (!loc.ownedBy) {
          db.collection('locations').doc(loc.id)
            .update({ ownedBy: currentUser.uid })
            .catch(function() {});
        }
      });
    }, function(err) {
      console.error('Location listener:', err);
      toast('Trouble loading photos — check your Firestore rules in the README.');
    });
}
