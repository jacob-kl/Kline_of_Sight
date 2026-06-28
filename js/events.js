// ─────────────────────────────────────────────────────────
// Events
//
// Reads:  db, currentUser, connectedUIDs, accessibleEvents,
//         locations, allUploaders, map, pendingLat, pendingLng
// Writes: events, selectedEventId, selectedEventFilter,
//         selectedPersonEventFilter, newEventPrivate
// ─────────────────────────────────────────────────────────
let events                  = [];
let selectedEventId         = 'daytoday';
let newEventName            = '';
let newEventDate            = '';
let newEventPrivate         = false;
let selectedEventFilter     = null;
let selectedPersonEventFilter = null; // person filter inside event dropdown
let currentViewerLocId      = null;

// ── Real-time listener ───────────────────────────────────
function startEventsListener() {
  if (!currentUser) return;

  var allUIDs = [currentUser.uid].concat(connectedUIDs);
  db.collection('events')
    .where('createdBy', 'in', allUIDs.slice(0, 30))
    .onSnapshot(function(snap) {
      events = snap.docs.map(function(doc) {
        return Object.assign({ id: doc.id }, doc.data());
      }).filter(function(evt) {
        // Always show your own events (public or private)
        if (evt.createdBy === currentUser.uid) return true;
        // For others' events, only show non-private ones
        return !evt.private;
      });

      events.sort(function(a, b) {
        var da  = (a.date || '').split('/').reverse().join('');
        var db2 = (b.date || '').split('/').reverse().join('');
        return db2.localeCompare(da);
      });

      renderEventPickerIfOpen();
      renderEventFilter();
      if (document.getElementById('sharing-overlay').classList.contains('open')) {
        populateShareEventSelect();
      }
    }, function(err) {
      console.error('Events listener:', err);
    });
}

// ── All visible events (owned + trip-access) ─────────────
function allVisibleEvents() {
  var result = events.slice();
  (accessibleEvents || []).forEach(function(a) {
    if (!result.find(function(e) { return e.id === a.eventId; })) {
      result.push({ id: a.eventId, name: a.eventName, date: '', createdBy: a.grantedBy, tripOnly: true });
    }
  });
  return result;
}

// ── Nearby events (within 100 miles) ─────────────────────
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

  var hasLoc     = (pendingLat !== null && pendingLng !== null);
  var nearbyEvts = hasLoc ? getNearbyEvents() : [];
  var all        = allVisibleEvents();

  container.appendChild(makeEventPill('daytoday', '📅 Day to Day', selectedEventId === 'daytoday'));

  if (!hasLoc) {
    var hint = document.createElement('span');
    hint.className   = 'event-picker-hint';
    hint.textContent = 'Set a location above to see nearby events';
    container.appendChild(hint);
  } else if (nearbyEvts.length > 0) {
    nearbyEvts.forEach(function(evt) {
      var label = (evt.private ? '🔒 ' : '') + evt.name + (evt.date ? ' (' + evt.date + ')' : '') + (evt.tripOnly ? ' 🗺️' : '');
      container.appendChild(makeEventPill(evt.id, label, selectedEventId === evt.id));
    });
  } else if (all.length > 0) {
    var hint = document.createElement('span');
    hint.className   = 'event-picker-hint';
    hint.textContent = 'No events within 100 mi — showing all';
    container.appendChild(hint);
    all.forEach(function(evt) {
      var label = (evt.private ? '🔒 ' : '') + evt.name + (evt.date ? ' (' + evt.date + ')' : '');
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

function onEventNameInput(e)    { newEventName    = e.target.value.trim(); }
function onEventPrivateInput(e) { newEventPrivate = e.target.checked; }

function onEventDateInput(e) {
  var raw = e.target.value.replace(/[^0-9]/g, '');
  if (raw.length > 2) raw = raw.slice(0, 2) + '/' + raw.slice(2, 6);
  e.target.value = raw; newEventDate = raw;
}

function resetEventPicker() {
  selectedEventId = 'daytoday'; newEventName = ''; newEventDate = ''; newEventPrivate = false;
  var n = document.getElementById('new-event-name');
  var d = document.getElementById('new-event-date');
  var p = document.getElementById('new-event-private');
  if (n) n.value   = '';
  if (d) d.value   = '';
  if (p) p.checked = false;
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
      private:   newEventPrivate || false,
      createdBy: currentUser.uid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    return { id: ref.id, name: newEventName, date: newEventDate || '' };
  }
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

// ── Event filter — dropdown with year groups + person filter ─
var _dropdownEventsMap = null; // kept so person filter can rebuild without re-scanning

function renderEventFilter() {
  var row = document.getElementById('filter-row');
  if (!row) return;
  var old = row.querySelector('.event-filter-wrap');
  if (old) old.parentNode.removeChild(old);

  // Build map of events visible on the map, including date
  var seen = new Map();
  (locations || []).forEach(function(loc) {
    if (loc.eventId && loc.eventName && !seen.has(loc.eventId)) {
      var isPrivate = (events || []).some(function(e) { return e.id === loc.eventId && e.private; });
      seen.set(loc.eventId, {
        id:      loc.eventId,
        name:    loc.eventName,
        date:    loc.eventDate || '',
        private: isPrivate
      });
    }
  });
  if (seen.size === 0) return;

  _dropdownEventsMap = seen;

  var currentName = selectedEventFilter
    ? (seen.has(selectedEventFilter) ? seen.get(selectedEventFilter).name : 'Trip')
    : 'All trips';

  var wrap = document.createElement('div');
  wrap.className = 'event-filter-wrap';
  var btn = document.createElement('button');
  btn.className   = 'event-filter-pill' + (selectedEventFilter ? ' active' : '');
  btn.textContent = '📅 ' + currentName + ' ▾';
  btn.onclick     = function(e) { e.stopPropagation(); buildEventDropdown(_dropdownEventsMap, btn); };
  wrap.appendChild(btn);
  row.appendChild(wrap);
  if (row.style.display === 'none') row.style.display = 'flex';
}

function buildEventDropdown(eventsMap, anchorBtn) {
  var existing = document.getElementById('event-dropdown');
  if (existing) { existing.remove(); return; }

  var dropdown = document.createElement('div');
  dropdown.id = 'event-dropdown'; dropdown.className = 'event-dropdown';

  // ── Person filter bar ───────────────────────────────────
  if (allUploaders && allUploaders.size > 1) {
    var bar = document.createElement('div');
    bar.className = 'event-drop-person-bar';

    function makePersBtn(uid, label, photoURL) {
      var btn = document.createElement('button');
      btn.className = 'event-drop-person-pill' + (selectedPersonEventFilter === uid ? ' active' : '');
      btn.title     = label;
      btn.innerHTML = photoURL
        ? '<img src="' + photoURL + '" alt="' + label + '"/>'
        : label === 'All' ? 'All' : label[0].toUpperCase();
      btn.onclick = function(e) {
        e.stopPropagation();
        selectedPersonEventFilter = uid;
        buildEventDropdown(eventsMap, anchorBtn);
      };
      return btn;
    }

    bar.appendChild(makePersBtn(null, 'All', null));
    allUploaders.forEach(function(u) {
      bar.appendChild(makePersBtn(u.uid, u.displayName, u.photoURL));
    });
    dropdown.appendChild(bar);
  }

  // ── All trips option ────────────────────────────────────
  dropdown.appendChild(makeDropItem(null, '📅 All trips'));

  // ── Apply person filter ─────────────────────────────────
  var visibleMap = eventsMap;
  if (selectedPersonEventFilter) {
    var personEventIds = new Set();
    (locations || []).forEach(function(loc) {
      if (loc.eventId) {
        (loc.photos || []).forEach(function(p) {
          if (p.uploadedBy === selectedPersonEventFilter) personEventIds.add(loc.eventId);
        });
      }
    });
    visibleMap = new Map();
    eventsMap.forEach(function(evt) {
      if (personEventIds.has(evt.id)) visibleMap.set(evt.id, evt);
    });
  }

  // ── Group by year, sort alphabetically within year ──────
  var byYear = {};
  var noYear = [];
  visibleMap.forEach(function(evt) {
    var year = '';
    if (evt.date) {
      var parts = evt.date.split('/');
      if (parts.length === 2 && parts[1].length === 4) year = parts[1];
    }
    if (year) { if (!byYear[year]) byYear[year] = []; byYear[year].push(evt); }
    else       { noYear.push(evt); }
  });

  var years = Object.keys(byYear).sort(function(a, b) { return parseInt(b) - parseInt(a); });

  years.forEach(function(year, idx) {
    byYear[year].sort(function(a, b) { return a.name.localeCompare(b.name); });

    // Auto-expand the most recent year, or whichever contains the active filter
    var hasActive = byYear[year].some(function(e) { return e.id === selectedEventFilter; });
    var isOpen    = (idx === 0) || hasActive;

    var header = document.createElement('button');
    header.type      = 'button';
    header.className = 'event-drop-year-header' + (isOpen ? ' open' : '');
    header.innerHTML = '<span>' + year + '</span><span class="year-arrow">▶</span>';

    var group = document.createElement('div');
    group.className = 'event-drop-year-group' + (isOpen ? '' : ' closed');

    header.onclick = function(e) {
      e.stopPropagation();
      header.classList.toggle('open');
      group.classList.toggle('closed');
    };

    byYear[year].forEach(function(evt) {
      group.appendChild(makeDropItem(evt.id, (evt.private ? '🔒 ' : '') + evt.name));
    });

    dropdown.appendChild(header);
    dropdown.appendChild(group);
  });

  // Events without a date — always expanded
  if (noYear.length > 0) {
    noYear.sort(function(a, b) { return a.name.localeCompare(b.name); });

    var otherHeader = document.createElement('button');
    otherHeader.type      = 'button';
    otherHeader.className = 'event-drop-year-header open';
    otherHeader.innerHTML = '<span>No date</span><span class="year-arrow">▶</span>';

    var otherGroup = document.createElement('div');
    otherGroup.className = 'event-drop-year-group';

    otherHeader.onclick = function(e) {
      e.stopPropagation();
      otherHeader.classList.toggle('open');
      otherGroup.classList.toggle('closed');
    };

    noYear.forEach(function(evt) {
      otherGroup.appendChild(makeDropItem(evt.id, (evt.private ? '🔒 ' : '') + evt.name));
    });

    dropdown.appendChild(otherHeader);
    dropdown.appendChild(otherGroup);
  }

  if (dropdown.querySelectorAll('.event-drop-item').length === 1) {
    // Only "All trips" visible — show a hint
    var empty = document.createElement('div');
    empty.className   = 'event-drop-empty';
    empty.textContent = selectedPersonEventFilter ? 'No events from this person' : 'No events yet';
    dropdown.appendChild(empty);
  }

  document.body.appendChild(dropdown);
  var row  = document.getElementById('filter-row');
  var rect = row.getBoundingClientRect();
  dropdown.style.top  = (rect.bottom + 6) + 'px';
  dropdown.style.left = Math.min(rect.left + 8, window.innerWidth - 240) + 'px';

  setTimeout(function() {
    document.addEventListener('click', function close() {
      var dd = document.getElementById('event-dropdown');
      if (dd) dd.remove();
      document.removeEventListener('click', close);
    });
  }, 10);
}

function makeDropItem(id, label) {
  var item = document.createElement('button');
  item.className   = 'event-drop-item' + (selectedEventFilter === id ? ' active' : '');
  item.textContent = label;
  item.onclick     = function() { applyEventFilter(id); };
  return item;
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
      item.innerHTML = '<span class="ae-name">' + (evt.private ? '🔒 ' : '') + evt.name + (evt.tripOnly ? ' 🗺️' : '') + '</span>' +
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
