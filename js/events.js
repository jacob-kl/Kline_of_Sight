// ─────────────────────────────────────────────────────────
// Events
//
// Reads:  db, currentUser, connectedUIDs, accessibleEvents,
//         locations, map, pendingLat, pendingLng
// Writes: events, selectedEventId, selectedEventFilter
// ─────────────────────────────────────────────────────────
let events              = [];
let selectedEventId     = 'daytoday';
let newEventName        = '';
let newEventDate        = '';
let selectedEventFilter = null;
let currentViewerLocId  = null;

// ── Real-time listener ───────────────────────────────────
function startEventsListener() {
  if (!currentUser) return;

  var allUIDs = [currentUser.uid].concat(connectedUIDs);
  db.collection('events')
    .where('createdBy', 'in', allUIDs.slice(0, 30))
    .onSnapshot(function(snap) {
      events = snap.docs.map(function(doc) {
        return Object.assign({ id: doc.id }, doc.data());
      });
      events.sort(function(a, b) {
        var da  = (a.date || '').split('/').reverse().join('');
        var db2 = (b.date || '').split('/').reverse().join('');
        return db2.localeCompare(da);
      });
      renderEventPickerIfOpen();
      renderEventFilter();
      // Refresh trip select in sharing panel if open
      if (document.getElementById('sharing-overlay').classList.contains('open')) {
        populateShareEventSelect();
      }
    }, function(err) {
      console.error('Events listener:', err);
    });
}

// ── All events visible to this user (owned + trip access) ─
function allVisibleEvents() {
  var result = events.slice();
  // Add events from trip access that aren't already in the list
  (accessibleEvents || []).forEach(function(a) {
    if (!result.find(function(e) { return e.id === a.eventId; })) {
      result.push({ id: a.eventId, name: a.eventName, date: '', createdBy: a.grantedBy, tripOnly: true });
    }
  });
  return result;
}

// ── Nearby events (within 100 miles of pending location) ──
function getNearbyEvents() {
  if (pendingLat === null || pendingLng === null) return [];
  var RADIUS_M  = 160934;
  var nearbyIds = new Set();
  (locations || []).forEach(function(loc) {
    if (loc.eventId) {
      try {
        if (map.distance([loc.lat, loc.lng], [pendingLat, pendingLng]) < RADIUS_M)
          nearbyIds.add(loc.eventId);
      } catch(_) {}
    }
  });
  return allVisibleEvents().filter(function(evt) { return nearbyIds.has(evt.id); });
}

// ── Event picker (upload modal) ───────────────────────────
function renderEventPicker() {
  var container = document.getElementById('event-picker-options');
  if (!container) return;
  container.innerHTML = '';

  var hasLocation = (pendingLat !== null && pendingLng !== null);
  var nearbyEvts  = hasLocation ? getNearbyEvents() : [];
  var all         = allVisibleEvents();

  container.appendChild(makeEventPill('daytoday', '📅 Day to Day', selectedEventId === 'daytoday'));

  if (!hasLocation) {
    var hint = document.createElement('span');
    hint.className   = 'event-picker-hint';
    hint.textContent = 'Set a location above to see nearby events';
    container.appendChild(hint);
  } else if (nearbyEvts.length > 0) {
    nearbyEvts.forEach(function(evt) {
      var label = evt.name + (evt.date ? ' (' + evt.date + ')' : '') + (evt.tripOnly ? ' 🗺️' : '');
      container.appendChild(makeEventPill(evt.id, label, selectedEventId === evt.id));
    });
  } else if (all.length > 0) {
    var hint = document.createElement('span');
    hint.className   = 'event-picker-hint';
    hint.textContent = 'No events within 100 mi — showing all';
    container.appendChild(hint);
    all.forEach(function(evt) {
      var label = evt.name + (evt.date ? ' (' + evt.date + ')' : '') + (evt.tripOnly ? ' 🗺️' : '');
      container.appendChild(makeEventPill(evt.id, label, selectedEventId === evt.id));
    });
  }

  container.appendChild(makeEventPill('new', '+ New Event', selectedEventId === 'new'));
  document.getElementById('new-event-form').style.display =
    selectedEventId === 'new' ? 'block' : 'none';
}

function renderEventPickerIfOpen() {
  if (document.getElementById('upload-overlay').classList.contains('open')) renderEventPicker();
}

function makeEventPill(id, label, active) {
  var btn = document.createElement('button');
  btn.className   = 'event-pill' + (active ? ' active' : '');
  btn.textContent = label;
  btn.type        = 'button';
  btn.onclick     = function() { selectedEventId = id; renderEventPicker(); };
  return btn;
}

function onEventNameInput(e) { newEventName = e.target.value.trim(); }

function onEventDateInput(e) {
  var raw = e.target.value.replace(/[^0-9]/g, '');
  if (raw.length > 2) raw = raw.slice(0, 2) + '/' + raw.slice(2, 6);
  e.target.value = raw; newEventDate = raw;
}

function resetEventPicker() {
  selectedEventId = 'daytoday'; newEventName = ''; newEventDate = '';
  var n = document.getElementById('new-event-name');
  var d = document.getElementById('new-event-date');
  if (n) n.value = '';
  if (d) d.value = '';
  renderEventPicker();
}

async function resolveSelectedEvent() {
  if (selectedEventId === 'daytoday') return null;
  if (selectedEventId === 'new') {
    if (!newEventName) return null;
    if (newEventDate && !isValidDate(newEventDate)) {
      toast('Enter a valid date in MM/YYYY format.'); throw new Error('invalid-date');
    }
    var ref = await db.collection('events').add({
      name:      newEventName,
      date:      newEventDate || '',
      createdBy: currentUser.uid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    return { id: ref.id, name: newEventName, date: newEventDate || '' };
  }
  // Check both owned events and trip-access events
  var evt = allVisibleEvents().find(function(e) { return e.id === selectedEventId; });
  return evt ? { id: evt.id, name: evt.name, date: evt.date || '' } : null;
}

function isValidDate(d) {
  if (!d) return true;
  var parts = d.split('/');
  if (parts.length !== 2 || parts[1].length !== 4) return false;
  var m = parseInt(parts[0]), y = parseInt(parts[1]);
  return m >= 1 && m <= 12 && y >= 2000 && y <= 2099;
}

// ── Event filter (single dropdown in filter row) ──────────
function renderEventFilter() {
  var row = document.getElementById('filter-row');
  if (!row) return;
  var old = row.querySelector('.event-filter-wrap');
  if (old) old.parentNode.removeChild(old);

  var seen = new Map();
  (locations || []).forEach(function(loc) {
    if (loc.eventId && loc.eventName && !seen.has(loc.eventId))
      seen.set(loc.eventId, { id: loc.eventId, name: loc.eventName });
  });
  if (seen.size === 0) return;

  var currentName = selectedEventFilter
    ? (seen.has(selectedEventFilter) ? seen.get(selectedEventFilter).name : 'Trip')
    : 'All trips';

  var wrap = document.createElement('div');
  wrap.className = 'event-filter-wrap';
  var btn = document.createElement('button');
  btn.className   = 'event-filter-pill' + (selectedEventFilter ? ' active' : '');
  btn.textContent = '📅 ' + currentName + ' ▾';
  btn.onclick     = function(e) { e.stopPropagation(); toggleEventDropdown(seen, btn); };
  wrap.appendChild(btn);
  row.appendChild(wrap);
  if (row.style.display === 'none') row.style.display = 'flex';
}

function toggleEventDropdown(eventsMap, anchorBtn) {
  var existing = document.getElementById('event-dropdown');
  if (existing) { existing.remove(); return; }

  var dropdown = document.createElement('div');
  dropdown.id = 'event-dropdown'; dropdown.className = 'event-dropdown';

  function makeItem(id, label) {
    var item = document.createElement('button');
    item.className   = 'event-drop-item' + (selectedEventFilter === id ? ' active' : '');
    item.textContent = label;
    item.onclick     = function() { applyEventFilter(id); };
    return item;
  }
  dropdown.appendChild(makeItem(null, '📅 All trips'));
  eventsMap.forEach(function(evt) { dropdown.appendChild(makeItem(evt.id, evt.name)); });

  document.body.appendChild(dropdown);
  var row  = document.getElementById('filter-row');
  var rect = row.getBoundingClientRect();
  dropdown.style.top  = (rect.bottom + 6) + 'px';
  dropdown.style.left = Math.min(rect.left + 8, window.innerWidth - 220) + 'px';

  setTimeout(function() {
    document.addEventListener('click', function close() {
      var dd = document.getElementById('event-dropdown');
      if (dd) dd.remove();
      document.removeEventListener('click', close);
    });
  }, 10);
}

function applyEventFilter(id) {
  selectedEventFilter = id;
  var dd = document.getElementById('event-dropdown');
  if (dd) dd.remove();
  renderEventFilter(); renderMarkers();
}

function locationMatchesEventFilter(loc) {
  if (selectedEventFilter === null) return true;
  return loc.eventId === selectedEventFilter;
}

// ── Add to Event (from viewer) ────────────────────────────
function openAddEventOverlay(locId) {
  currentViewerLocId = locId;
  var list = document.getElementById('add-event-list');
  list.innerHTML = '';
  var visible = allVisibleEvents();
  if (!visible.length) {
    list.innerHTML = '<p class="ae-empty">No events yet. Create one when uploading a photo.</p>';
  } else {
    visible.forEach(function(evt) {
      var item = document.createElement('button');
      item.className = 'ae-item';
      item.innerHTML = '<span class="ae-name">' + evt.name + (evt.tripOnly ? ' 🗺️' : '') + '</span>' +
                       (evt.date ? '<span class="ae-date">' + evt.date + '</span>' : '');
      item.onclick = function() { assignLocationToEvent(locId, evt); };
      list.appendChild(item);
    });
    var rm = document.createElement('button');
    rm.className = 'ae-item ae-remove';
    rm.innerHTML = '<span class="ae-name">Remove from event</span>';
    rm.onclick   = function() { assignLocationToEvent(locId, null); };
    list.appendChild(rm);
  }
  document.getElementById('add-event-overlay').classList.add('open');
}

async function assignLocationToEvent(locId, evt) {
  try {
    await db.collection('locations').doc(locId).update({
      eventId:   evt ? evt.id   : null,
      eventName: evt ? evt.name : null,
      eventDate: evt ? (evt.date || null) : null
    });
    document.getElementById('add-event-overlay').classList.remove('open');
    toast(evt ? 'Added to ' + evt.name + '!' : 'Removed from event.');
  } catch(err) { console.error(err); toast('Something went wrong. Try again.'); }
}

function maybeCloseAddEvent(e) {
  if (e.target === document.getElementById('add-event-overlay'))
    document.getElementById('add-event-overlay').classList.remove('open');
}
