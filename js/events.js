// ─────────────────────────────────────────────────────────
// Events
// ─────────────────────────────────────────────────────────
let events                    = [];
let selectedEventId           = 'daytoday';
let newEventName              = '';
let newEventDate              = '';
let newEventPrivate           = false;
let selectedEventFilter       = null;
let selectedPersonEventFilter = null;
let currentViewerLocId        = null;
var _dropdownEventsMap        = null;

function startEventsListener() {
  if (!currentUser) return;
  var allUIDs = [currentUser.uid].concat(connectedUIDs);
  db.collection('events')
    .where('createdBy', 'in', allUIDs.slice(0,30))
    .onSnapshot(function(snap) {
      events = snap.docs.map(function(doc) {
        return Object.assign({ id: doc.id }, doc.data());
      }).filter(function(e) {
        return e.createdBy === currentUser.uid || !e.private;
      });
      events.sort(function(a,b) {
        return ((b.date||'').split('/').reverse().join('')).localeCompare(
               ((a.date||'').split('/').reverse().join('')));
      });
      renderEventPickerIfOpen();
      renderEventFilter();
      if (document.getElementById('sharing-overlay').classList.contains('open'))
        populateShareEventSelect();
    });
}

function allVisibleEvents() {
  var result = events.slice();
  (accessibleEvents||[]).forEach(function(a) {
    if (!result.find(function(e){return e.id===a.eventId;}))
      result.push({id:a.eventId,name:a.eventName,date:'',createdBy:a.grantedBy,tripOnly:true});
  });
  return result;
}

function getNearbyEvents() {
  if (pendingLat===null||pendingLng===null) return [];
  var ids=new Set();
  (locations||[]).forEach(function(loc){
    if (loc.eventId && haversineDistance([loc.lat,loc.lng],[pendingLat,pendingLng])<160934)
      ids.add(loc.eventId);
  });
  return allVisibleEvents().filter(function(e){return ids.has(e.id);});
}

// ── Upload event picker ───────────────────────────────────
function renderEventPicker() {
  var c=document.getElementById('event-picker-options'); if(!c) return;
  c.innerHTML='';
  var hasLoc=(pendingLat!==null&&pendingLng!==null);
  var nearby=hasLoc?getNearbyEvents():[];
  var all=allVisibleEvents();
  c.appendChild(makeEventPill('daytoday','📅 Day to Day',selectedEventId==='daytoday'));
  if (!hasLoc) {
    var h=document.createElement('span'); h.className='event-picker-hint';
    h.textContent='Set a location to see nearby events'; c.appendChild(h);
  } else if (nearby.length) {
    nearby.forEach(function(e){
      c.appendChild(makeEventPill(e.id,(e.private?'🔒 ':'')+e.name+(e.date?' ('+e.date+')':''),selectedEventId===e.id));
    });
  } else if (all.length) {
    var h=document.createElement('span'); h.className='event-picker-hint';
    h.textContent='No events nearby — showing all'; c.appendChild(h);
    all.forEach(function(e){
      c.appendChild(makeEventPill(e.id,(e.private?'🔒 ':'')+e.name+(e.date?' ('+e.date+')':''),selectedEventId===e.id));
    });
  }
  c.appendChild(makeEventPill('new','+ New Event',selectedEventId==='new'));
  document.getElementById('new-event-form').style.display=selectedEventId==='new'?'block':'none';
}
function renderEventPickerIfOpen() {
  if (document.getElementById('upload-overlay').classList.contains('open')) renderEventPicker();
}
function makeEventPill(id,label,active) {
  var b=document.createElement('button');
  b.className='event-pill'+(active?' active':''); b.textContent=label; b.type='button';
  b.onclick=function(){selectedEventId=id; renderEventPicker();}; return b;
}
function onEventNameInput(e)    { newEventName=e.target.value.trim(); }
function onEventDateInput(e)    {
  var r=e.target.value.replace(/[^0-9]/g,'');
  if(r.length>2) r=r.slice(0,2)+'/'+r.slice(2,6);
  e.target.value=r; newEventDate=r;
}
function onEventPrivateInput(e) { newEventPrivate=e.target.checked; }
function resetEventPicker() {
  selectedEventId='daytoday'; newEventName=''; newEventDate=''; newEventPrivate=false;
  ['new-event-name','new-event-date'].forEach(function(id){var el=document.getElementById(id);if(el)el.value='';});
  var p=document.getElementById('new-event-private'); if(p) p.checked=false;
  renderEventPicker();
}
async function resolveSelectedEvent() {
  if (selectedEventId==='daytoday') return null;
  if (selectedEventId==='new') {
    if (!newEventName) return null;
    if (newEventDate && !isValidDate(newEventDate)) {
      toast('Enter date as MM/YYYY.'); throw new Error('invalid-date');
    }
    var ref=await db.collection('events').add({
      name:newEventName, date:newEventDate||'', private:newEventPrivate||false,
      createdBy:currentUser.uid, createdAt:firebase.firestore.FieldValue.serverTimestamp()
    });
    return {id:ref.id,name:newEventName,date:newEventDate||''};
  }
  var e=allVisibleEvents().find(function(e){return e.id===selectedEventId;});
  return e?{id:e.id,name:e.name,date:e.date||''}:null;
}
function isValidDate(d) {
  if(!d) return true;
  var p=d.split('/');
  return p.length===2&&p[1].length===4&&+p[0]>=1&&+p[0]<=12&&+p[1]>=2000&&+p[1]<=2099;
}

// ── Map event filter dropdown ─────────────────────────────
function renderEventFilter() {
  var row=document.getElementById('filter-row'); if(!row) return;
  var old=row.querySelector('.event-filter-wrap'); if(old) old.remove();
  var seen=new Map();
  (locations||[]).forEach(function(loc){
    if(loc.eventId&&loc.eventName&&!seen.has(loc.eventId)){
      var priv=(events||[]).some(function(e){return e.id===loc.eventId&&e.private;});
      seen.set(loc.eventId,{id:loc.eventId,name:loc.eventName,date:loc.eventDate||'',private:priv});
    }
  });
  if(!seen.size) return;
  _dropdownEventsMap=seen;
  var label=selectedEventFilter&&seen.has(selectedEventFilter)?seen.get(selectedEventFilter).name:'All trips';
  var wrap=document.createElement('div'); wrap.className='event-filter-wrap';
  var btn=document.createElement('button');
  btn.className='event-filter-pill'+(selectedEventFilter?' active':'');
  btn.textContent='📅 '+label+' ▾';
  btn.onclick=function(e){e.stopPropagation();buildEventDropdown(_dropdownEventsMap,btn);};
  wrap.appendChild(btn); row.appendChild(wrap);
  if(row.style.display==='none') row.style.display='flex';
}

function buildEventDropdown(eventsMap,anchorBtn) {
  var ex=document.getElementById('event-dropdown'); if(ex){ex.remove();return;}
  var dd=document.createElement('div'); dd.id='event-dropdown'; dd.className='event-dropdown';

  // Person filter bar
  if(allUploaders&&allUploaders.size>1){
    var bar=document.createElement('div'); bar.className='event-drop-person-bar';
    function makePill(uid,label,photo){
      var b=document.createElement('button');
      b.className='event-drop-person-pill'+(selectedPersonEventFilter===uid?' active':'');
      b.title=label;
      b.innerHTML=photo?'<img src="'+photo+'" alt="'+label+'"/>':label;
      b.onclick=function(e){e.stopPropagation();selectedPersonEventFilter=uid;buildEventDropdown(eventsMap,anchorBtn);};
      return b;
    }
    bar.appendChild(makePill(null,'All',null));
    allUploaders.forEach(function(u){bar.appendChild(makePill(u.uid,u.displayName,u.photoURL));});
    dd.appendChild(bar);
  }

  dd.appendChild(makeDropItem(null,'📅 All trips'));

  // Filter by person
  var visible=eventsMap;
  if(selectedPersonEventFilter){
    var ids=new Set();
    (locations||[]).forEach(function(loc){
      if(loc.eventId)(loc.photos||[]).forEach(function(p){
        if(p.uploadedBy===selectedPersonEventFilter) ids.add(loc.eventId);
      });
    });
    visible=new Map(); eventsMap.forEach(function(e){if(ids.has(e.id)) visible.set(e.id,e);});
  }

  // Group by year
  var byYear={}, noYear=[];
  visible.forEach(function(e){
    var yr=(e.date||'').split('/')[1]||'';
    if(yr){if(!byYear[yr])byYear[yr]=[];byYear[yr].push(e);}
    else noYear.push(e);
  });
  Object.keys(byYear).sort(function(a,b){return b-a;}).forEach(function(yr,i){
    byYear[yr].sort(function(a,b){return a.name.localeCompare(b.name);});
    var hasActive=byYear[yr].some(function(e){return e.id===selectedEventFilter;});
    var isOpen=hasActive;
    var hdr=document.createElement('button'); hdr.type='button';
    hdr.className='event-drop-year-header'+(isOpen?' open':'');
    hdr.innerHTML='<span>'+yr+'</span><span class="year-arrow">▶</span>';
    var grp=document.createElement('div');
    grp.className='event-drop-year-group'+(isOpen?'':' closed');
    hdr.onclick=function(e){e.stopPropagation();hdr.classList.toggle('open');grp.classList.toggle('closed');};
    byYear[yr].forEach(function(e){
      var item=makeDropItem(e.id,(e.private?'🔒 ':'')+e.name);
      var editBtn=document.createElement('button');
      editBtn.className='drop-edit-btn'; editBtn.textContent='✏️'; editBtn.title='Edit event';
      editBtn.onclick=function(ev){ev.stopPropagation();dd.remove();openEditEventOverlay(e);};
      item.appendChild(editBtn);
      grp.appendChild(item);
    });
    dd.appendChild(hdr); dd.appendChild(grp);
  });
  if(noYear.length){
    noYear.sort(function(a,b){return a.name.localeCompare(b.name);});
    var hdr=document.createElement('button'); hdr.type='button';
    hdr.className='event-drop-year-header open';
    hdr.innerHTML='<span>No date</span><span class="year-arrow">▶</span>';
    var grp=document.createElement('div'); grp.className='event-drop-year-group';
    hdr.onclick=function(e){e.stopPropagation();hdr.classList.toggle('open');grp.classList.toggle('closed');};
    noYear.forEach(function(e){grp.appendChild(makeDropItem(e.id,(e.private?'🔒 ':'')+e.name));});
    dd.appendChild(hdr); dd.appendChild(grp);
  }

  document.body.appendChild(dd);
  var rect=document.getElementById('filter-row').getBoundingClientRect();
  dd.style.top=(rect.bottom+6)+'px';
  dd.style.left=Math.min(rect.left+8,window.innerWidth-240)+'px';
  setTimeout(function(){
    document.addEventListener('click',function close(){
      var d=document.getElementById('event-dropdown'); if(d) d.remove();
      document.removeEventListener('click',close);
    });
  },10);
}

function makeDropItem(id,label) {
  var b=document.createElement('button'); b.className='event-drop-item'+(selectedEventFilter===id?' active':'');
  b.textContent=label; b.onclick=function(){applyEventFilter(id);}; return b;
}
function applyEventFilter(id) {
  selectedEventFilter=id;
  var d=document.getElementById('event-dropdown'); if(d) d.remove();
  renderEventFilter(); renderMarkers();
}
function locationMatchesEventFilter(loc) {
  return selectedEventFilter===null || loc.eventId===selectedEventFilter;
}

// ── Edit / delete event ───────────────────────────────────
var editingEventId = null;

function openEditEventOverlay(evt) {
  editingEventId = evt.id;
  var nameEl = document.getElementById('edit-event-name');
  var dateEl = document.getElementById('edit-event-date');
  if (nameEl) nameEl.value = evt.name || '';
  if (dateEl) dateEl.value = evt.date || '';
  document.getElementById('edit-event-overlay').classList.add('open');
}

function maybeCloseEditEvent(e) {
  if (e.target === document.getElementById('edit-event-overlay'))
    document.getElementById('edit-event-overlay').classList.remove('open');
}

async function saveEditEvent() {
  var name = (document.getElementById('edit-event-name').value||'').trim();
  var date = (document.getElementById('edit-event-date').value||'').trim();
  if (!name) { toast('Event name is required.'); return; }
  if (date && !isValidDate(date)) { toast('Enter date as MM/YYYY.'); return; }
  var btn = document.getElementById('btn-save-event-edit');
  btn.disabled=true; btn.textContent='Saving…';
  try {
    await db.collection('events').doc(editingEventId).update({ name:name, date:date });
    // Also update any locations tagged to this event
    var batch = db.batch();
    (locations||[]).forEach(function(loc){
      if(loc.eventId===editingEventId)
        batch.update(db.collection('locations').doc(loc.id),{eventName:name,eventDate:date});
    });
    await batch.commit();
    document.getElementById('edit-event-overlay').classList.remove('open');
    toast('Event updated.');
  } catch(err) {
    console.error(err); toast('Update failed.');
  } finally { btn.disabled=false; btn.textContent='Save'; }
}

async function deleteEditEvent() {
  if (!editingEventId) return;
  if (!confirm('Delete this event? Locations tagged to it will become Day to Day.')) return;
  try {
    var batch = db.batch();
    (locations||[]).forEach(function(loc){
      if(loc.eventId===editingEventId)
        batch.update(db.collection('locations').doc(loc.id),{eventId:null,eventName:null,eventDate:null});
    });
    await batch.commit();
    await db.collection('events').doc(editingEventId).delete();
    document.getElementById('edit-event-overlay').classList.remove('open');
    toast('Event deleted.');
  } catch(err) {
    console.error(err); toast('Delete failed.');
  }
}

// ── Add to Event (from viewer) ────────────────────────────
function openAddEventOverlay(locId) {
  currentViewerLocId=locId;
  var list=document.getElementById('add-event-list'); list.innerHTML='';
  var all=allVisibleEvents();
  if(!all.length){
    list.innerHTML='<p class="ae-empty">No events yet.</p>';
  } else {
    all.forEach(function(e){
      var item=document.createElement('button'); item.className='ae-item';
      item.innerHTML='<span class="ae-name">'+(e.private?'🔒 ':'')+e.name+(e.tripOnly?' 🗺️':'')+'</span>'+(e.date?'<span class="ae-date">'+e.date+'</span>':'');
      item.onclick=function(){assignLocationToEvent(locId,e);};
      list.appendChild(item);
    });
    var rm=document.createElement('button'); rm.className='ae-item ae-remove';
    rm.innerHTML='<span class="ae-name">Remove from event</span>';
    rm.onclick=function(){assignLocationToEvent(locId,null);};
    list.appendChild(rm);
  }
  document.getElementById('add-event-overlay').classList.add('open');
}
async function assignLocationToEvent(locId,evt) {
  try {
    await db.collection('locations').doc(locId).update({
      eventId:evt?evt.id:null, eventName:evt?evt.name:null, eventDate:evt?(evt.date||null):null
    });
    document.getElementById('add-event-overlay').classList.remove('open');
    toast(evt?'Added to '+evt.name+'!':'Removed from event.');
  } catch(err){console.error(err);toast('Failed.');}
}
function maybeCloseAddEvent(e) {
  if(e.target===document.getElementById('add-event-overlay'))
    document.getElementById('add-event-overlay').classList.remove('open');
}
