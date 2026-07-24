// searchinfo.js — Object search, list, and info panel for SkyMap
// Depends on: astromath.js, skyobject.js, skymap.js (loaded before this file)
// References at runtime (defined in index.html inline script):
//   getDateTimeFromFields(), getLocation(), sizeCanvas(), draw()

// ---- Time formatting ----

function _formatJDLocal(jd) {
  var c = calendarDate(jd);
  var utcMs = Date.UTC(c.y, c.m - 1, c.d, floor(c.ut), round((c.ut % 1) * 60));
  try {
    return new Date(utcMs).toLocaleString('en-US', {
      timeZone: selectedTZ, hour: 'numeric', minute: '2-digit', hour12: true
    });
  } catch (e) { return '—'; }
}

// Format a riseTransitSetIterative() result for display.
function _rtsText(r) {
  if (!r) return '—';
  if (r.status === 'never-rises') return 'Never rises';
  if (r.status === 'never-sets') return 'Never sets';
  if (r.status === 'normal' && r.jd != null) return _formatJDLocal(r.jd);
  return '—';
}

// ---- Search index ----

var _starSearchData = null;
var _dsSearchData = null;

function _buildSearchData() {
  if (_starSearchData) return;

  _starSearchData = [];
  for (var i = 0; i < STARS.length; i++) {
    var s = STARS[i];
    var parts = [];
    if (s[S_NAME]) parts.push(s[S_NAME]);
    if (s[S_BAYER]) parts.push(s[S_BAYER]);
    if (s[S_FLAM]) parts.push(s[S_FLAM]);
    if (s[S_HR]) parts.push('HR ' + s[S_HR]);
    if (s[S_HD]) parts.push('HD ' + s[S_HD]);
    if (s[S_HIP]) parts.push('HIP ' + s[S_HIP]);
    if (s[S_DM]) parts.push(s[S_DM]);
    if (parts.length > 0) {
      _starSearchData.push({ text: parts.join('\t').toLowerCase(), idx: i, mag: s[S_MAG] });
    }
  }

  _dsSearchData = [];
  for (var i = 0; i < DEEPSKY.length; i++) {
    var ds = DEEPSKY[i];
    var parts = [];
    if (ds[DS_MC]) parts.push(ds[DS_MC]);
    if (ds[DS_NGC]) parts.push(ds[DS_NGC]);
    if (ds[DS_NGC2]) parts.push(ds[DS_NGC2]);
    if (ds[DS_NAME]) parts.push(ds[DS_NAME]);
    if (parts.length > 0) {
      _dsSearchData.push({ text: parts.join('\t').toLowerCase(), idx: i, mag: ds[DS_MAG] });
    }
  }
}

function searchObjects(query) {
  if (!query || !query.trim()) return [];
  _buildSearchData();
  var q = query.trim().toLowerCase();
  var results = [];

  for (var i = 0; i < _starSearchData.length; i++) {
    var e = _starSearchData[i];
    if (e.text.includes(q)) {
      var s = STARS[e.idx];
      var label = s[S_NAME] || s[S_BAYER] || s[S_FLAM] || (s[S_HR] ? 'HR ' + s[S_HR] : 'HIP ' + s[S_HIP]);
      results.push({ src: 'star', idx: e.idx, label: label, mag: e.mag, text: e.text });
    }
  }

  for (var i = 0; i < _dsSearchData.length; i++) {
    var e = _dsSearchData[i];
    if (e.text.includes(q)) {
      var ds = DEEPSKY[e.idx];
      var label = ds[DS_MC] ? (ds[DS_MC] + (ds[DS_NAME] ? ' - ' + ds[DS_NAME] : '')) : (ds[DS_NAME] || ds[DS_NGC]);
      results.push({ src: 'deepsky', idx: e.idx, label: label, mag: e.mag, text: e.text });
    }
  }

  if (ssCache) {
    for (var i = 0; i < ssCache.length; i++) {
      var e = ssCache[i];
      if (e.name && e.name.toLowerCase().includes(q)) {
        var label = e.name;
        if (e.type === 'planetmoon' && e.parent) label += ' (' + e.parent + ')';
        else if (e.type === 'satellite') label += ' - ' + e.norad;
        results.push({ src: 'ss', ssName: e.name, ssType: e.type, ssNorad: e.norad, label: label, mag: e.mag, text: e.name.toLowerCase() });
      }
    }
  }

  results.sort(function(a, b) {
    var aParts = a.text.split('\t');
    var bParts = b.text.split('\t');
    var aExact = aParts.some(function(n) { return n === q; });
    var bExact = bParts.some(function(n) { return n === q; });
    if (aExact !== bExact) return aExact ? -1 : 1;
    var aStarts = aParts.some(function(n) { return n.startsWith(q); });
    var bStarts = bParts.some(function(n) { return n.startsWith(q); });
    if (aStarts !== bStarts) return aStarts ? -1 : 1;
    return (a.mag || 99) - (b.mag || 99);
  });

  return results.slice(0, 200);
}

// ---- Object list builders ----

function getObjectList(category) {
  var items = [];

  switch (category) {
    case 'planets':
      if (ssCache) {
        for (var i = 0; i < ssCache.length; i++) {
          var e = ssCache[i];
          if (e.type === 'sun' || e.type === 'planet')
            items.push({ src: 'ss', ssName: e.name, ssType: e.type, label: e.name, mag: e.mag });
        }
        var order = { Sun: 0, Mercury: 1, Venus: 2, Mars: 3, Jupiter: 4, Saturn: 5, Uranus: 6, Neptune: 7, Pluto: 8 };
        items.sort(function(a, b) {
          return (order[a.label] != null ? order[a.label] : 99) - (order[b.label] != null ? order[b.label] : 99);
        });
      }
      break;

    case 'moons':
      if (ssCache) {
        for (var i = 0; i < ssCache.length; i++) {
          var e = ssCache[i];
          if (e.type === 'moon' || e.type === 'planetmoon')
            items.push({ src: 'ss', ssName: e.name, ssType: e.type,
              label: e.name, mag: e.mag });
        }
        items.sort(function(a, b) { return a.label.localeCompare(b.label); });
      }
      break;

    case 'asteroids':
      if (ssCache) {
        for (var i = 0; i < ssCache.length; i++) {
          var e = ssCache[i];
          if (e.type === 'asteroid')
            items.push({ src: 'ss', ssName: e.name, ssType: e.type, label: e.name, mag: e.mag, num: e.num || 0 });
        }
        items.sort(function(a, b) { return a.num - b.num; });
      }
      break;

    case 'comets':
      if (ssCache) {
        for (var i = 0; i < ssCache.length; i++) {
          var e = ssCache[i];
          if (e.type === 'comet')
            items.push({ src: 'ss', ssName: e.name, ssType: e.type, label: e.name, mag: e.mag });
        }
        items.sort(function(a, b) {
          var ap = a.label.match(/^(\d+)P\//), bp = b.label.match(/^(\d+)P\//);
          if (ap && bp) return parseInt(ap[1]) - parseInt(bp[1]);
          if (ap) return -1;
          if (bp) return 1;
          return a.label.localeCompare(b.label);
        });
      }
      break;

    case 'satellites':
      if (ssCache) {
        for (var i = 0; i < ssCache.length; i++) {
          var e = ssCache[i];
          if (e.type === 'satellite')
            // Rocket-body/debris names are often reused across launches (e.g.
            // several "SL-16 R/B"); norad disambiguates both the lookup and
            // the label, since otherwise identical-looking entries would be
            // indistinguishable in the list.
            items.push({ src: 'ss', ssName: e.name, ssType: e.type, ssNorad: e.norad,
              label: e.name + ' - ' + e.norad, mag: e.mag });
        }
        items.sort(function(a, b) { return a.label.localeCompare(b.label); });
      }
      break;

    case 'namedStars':
      for (var i = 0; i < STARS.length; i++) {
        var s = STARS[i];
        if (s[S_NAME]) {
          var desig = s[S_BAYER] || s[S_FLAM] || '';
          var label = desig ? s[S_NAME] + ' - ' + desig : s[S_NAME];
          items.push({ src: 'star', idx: i, label: label, mag: s[S_MAG] });
        }
      }
      items.sort(function(a, b) { return a.label.localeCompare(b.label); });
      break;

    case 'brightStars':
      for (var i = 0; i < STARS.length; i++) {
        var s = STARS[i];
        if (s[S_MAG] <= 3.0) {
          var desig = s[S_BAYER] || s[S_FLAM] || (s[S_HR] ? 'HR ' + s[S_HR] : 'HIP ' + s[S_HIP]);
          var label = s[S_NAME] ? desig + ' - ' + s[S_NAME] : desig;
          items.push({ src: 'star', idx: i, label: label, mag: s[S_MAG] });
        }
      }
      items.sort(function(a, b) { return a.label.localeCompare(b.label); });
      break;

    case 'namedDSO':
      for (var i = 0; i < DEEPSKY.length; i++) {
        var ds = DEEPSKY[i];
        if (ds[DS_NAME]) {
          var catId = ds[DS_MC] || ds[DS_NGC] || '';
          var label = catId ? ds[DS_NAME] + ' - ' + catId : ds[DS_NAME];
          items.push({ src: 'deepsky', idx: i, label: label, mag: ds[DS_MAG] });
        }
      }
      items.sort(function(a, b) { return a.label.localeCompare(b.label); });
      break;

    case 'messier':
      for (var i = 0; i < DEEPSKY.length; i++) {
        var ds = DEEPSKY[i];
        if (ds[DS_MC] && ds[DS_MC].startsWith('M ')) {
          var label = ds[DS_MC] + (ds[DS_NAME] ? ' - ' + ds[DS_NAME] : '');
          items.push({ src: 'deepsky', idx: i, label: label, mag: ds[DS_MAG] });
        }
      }
      items.sort(function(a, b) {
        return parseInt(a.label.substring(2)) - parseInt(b.label.substring(2));
      });
      break;

    case 'caldwell':
      for (var i = 0; i < DEEPSKY.length; i++) {
        var ds = DEEPSKY[i];
        if (ds[DS_MC] && ds[DS_MC].startsWith('C ')) {
          var label = ds[DS_MC] + (ds[DS_NAME] ? ' - ' + ds[DS_NAME] : '');
          items.push({ src: 'deepsky', idx: i, label: label, mag: ds[DS_MAG] });
        }
      }
      items.sort(function(a, b) {
        return parseInt(a.label.substring(2)) - parseInt(b.label.substring(2));
      });
      break;

    case 'doubles':
      if (typeof DOUBLES !== 'undefined') {
        for (var k = 0; k < DOUBLES.length; k++) {
          var i = DOUBLES[k];
          var s = STARS[i];
          var desig = s[S_BAYER] || s[S_FLAM] || (s[S_HR] ? 'HR ' + s[S_HR] : s[S_HD] ? 'HD ' + s[S_HD] : 'HIP ' + s[S_HIP]);
          var label = s[S_NAME] ? desig + ' - ' + s[S_NAME] : desig;
          items.push({ src: 'star', idx: i, label: label, mag: s[S_MAG] });
        }
      }
      items.sort(function(a, b) { return a.label.localeCompare(b.label); });
      break;
  }

  return items;
}

function skyObjectFromItem(item) {
  if (item.src === 'star') return SkyObject.fromStar(STARS[item.idx]);
  if (item.src === 'deepsky') return SkyObject.fromDeepSky(DEEPSKY[item.idx]);
  if (item.src === 'ss') {
    var entry = ssCache.find(function(e) {
      if (e.type !== item.ssType) return false;
      return item.ssNorad != null ? e.norad === item.ssNorad : e.name === item.ssName;
    });
    if (entry) return SkyObject.fromSSEntry(entry);
  }
  return null;
}

// ---- Search panel state ----

var _searchCurrentObj = null;
var _lastSelectedObj = null;
var _currentListItems = [];
var _searchResults = [];

// ---- Panel interaction ----

function searchPanelVisible() {
  var panel = document.getElementById('searchPanel');
  return panel && panel.style.display !== 'none';
}

function toggleSearchPanel() {
  var panel = document.getElementById('searchPanel');
  var visible = panel.style.display !== 'none';
  panel.style.display = visible ? 'none' : '';
  sizeCanvas(); draw();
}

function doSearch() {
  var query = document.getElementById('searchInput').value;
  _searchResults = searchObjects(query);
  document.getElementById('objectListSelect').value = 'search';
  _currentListItems = _searchResults;
  populateListBox(_searchResults);
}

function loadObjectList() {
  var category = document.getElementById('objectListSelect').value;
  if (category === 'search') {
    _currentListItems = _searchResults;
    populateListBox(_searchResults);
  } else {
    var items = getObjectList(category);
    var sortRadio = document.querySelector('input[name="listSort"]:checked');
    if (sortRadio && sortRadio.value === 'mag') {
      // NaN would compare false against everything (even other NaNs) and
      // silently scramble the sort order wherever it landed — treat it like
      // "no data" (99) rather than let it through. Infinity (genuinely
      // eclipsed) is a normal, well-behaved sort value and sorts last as-is.
      var magKey = function(v) { return (v != null && !Number.isNaN(v)) ? v : 99; };
      items.sort(function(a, b) { return magKey(a.mag) - magKey(b.mag); });
    }
    _currentListItems = items;
    populateListBox(items);
  }
}

function populateListBox(items) {
  var listBox = document.getElementById('objectListBox');
  listBox.innerHTML = '';
  for (var i = 0; i < items.length; i++) {
    var opt = document.createElement('option');
    opt.value = i;
    opt.textContent = items[i].label;
    listBox.appendChild(opt);
  }
}

function onObjectListSelect() {
  var listBox = document.getElementById('objectListBox');
  var idx = parseInt(listBox.value);
  if (isNaN(idx) || idx < 0 || idx >= _currentListItems.length) return;
  var item = _currentListItems[idx];
  var obj = skyObjectFromItem(item);
  if (!obj) return;

  _searchCurrentObj = obj;

  // Set selectedObject (drawnObjects-compatible format)
  selectedObject = {
    type: obj.type,
    data: obj.type === 'star' ? {name: obj.name, star: obj.data} : obj.data,
    jx: obj.jx, jy: obj.jy, jz: obj.jz,
    hr: obj.type === 'star' ? obj.data[S_HR] : undefined
  };
  _lastSelectedObj = selectedObject;

  draw();
}

// Called from draw() on every frame to keep info panel current
function searchPanelDraw() {
  if (!searchPanelVisible()) return;

  // Detect map click changing selectedObject
  if (selectedObject !== _lastSelectedObj) {
    _lastSelectedObj = selectedObject;
    if (selectedObject) {
      _searchCurrentObj = SkyObject.fromDrawnObject(selectedObject);
    }
  }

  if (_searchCurrentObj) refreshInfoPanel();
}

function refreshInfoPanel() {
  var obj = _searchCurrentObj;
  if (!obj) {
    clearInfoPanel();
    return;
  }

  // For SS objects, refresh position and data from ssCache. Star/deep-sky
  // positions are fixed catalog values (never refreshed, always valid).
  // ssValid is false when a SS object isn't in ssCache this frame — a
  // satellite eclipsed/backlit/TLE-stale (see updateSSCache() in skymap.js;
  // every other SS type is pushed unconditionally so can't go missing today,
  // but a reloaded catalog dropping a comet/asteroid would hit this too).
  // Either way there's no current data for it, so we show placeholders below
  // instead of stale magnitude/position from before it disappeared.
  var ss = (obj.type !== 'star' && obj.type !== 'deepsky') ? obj.ssData : null;
  var ssValid = obj.type === 'star' || obj.type === 'deepsky' || !!ss;
  if (ss) {
    obj.jx = ss.x; obj.jy = ss.y; obj.jz = ss.z;
    if (ss.mag != null) obj.mag = ss.mag;
  } else if (!ssValid) {
    obj.mag = null;
  }

  document.getElementById('centerBtn').disabled = false;
  // frameControls: uncomment to show "Frame selected object" UI (hidden, testing only)
  // document.getElementById('frameControls').style.display = '';
  document.getElementById('info-type').textContent = obj.typeLabel;
  document.getElementById('info-name').textContent = obj.name || '—';

  var catalogLabel = document.getElementById('info-catalog-label');
  if (obj.type === 'satellite') {
    catalogLabel.textContent = 'NORAD ID';
    document.getElementById('info-catalog').textContent = obj.norad != null ? String(obj.norad) : '—';
  } else {
    catalogLabel.textContent = 'Catalog IDs';
    var catalogs = obj.names.filter(function(n) { return n !== obj.name; });
    document.getElementById('info-catalog').innerHTML = catalogs.length
      ? catalogs.map(function(c) { return c.replace(/&/g,'&amp;').replace(/</g,'&lt;'); }).join('<br>') : '—';
  }

  // Coordinates in current frame. Label depends only on the frame, so it's
  // always shown; the value depends on a current position, so it's '—' when !ssValid.
  var lonLabel, latLabel, lonStr, latStr;
  if (viewFrame === 'equatorial') {
    lonLabel = viewJ2000 ? 'RA (J2000)' : 'RA';
    latLabel = viewJ2000 ? 'Dec (J2000)' : 'Dec';
  } else if (viewFrame === 'ecliptic') {
    lonLabel = viewJ2000 ? 'Ecl Lon (J2000)' : 'Ecliptic Lon';
    latLabel = viewJ2000 ? 'Ecl Lat (J2000)' : 'Ecliptic Lat';
  } else if (viewFrame === 'galactic') {
    lonLabel = 'Galactic Lon';
    latLabel = 'Galactic Lat';
  } else {
    lonLabel = 'Azimuth';
    latLabel = 'Altitude';
  }
  if (!ssValid) {
    lonStr = '—'; latStr = '—';
  } else {
    var dt = getDateTimeFromFields();
    var loc = getLocation();
    var jd = julianDate(dt.y, dt.m, dt.d, dt.h + dt.mi / 60 + dt.s / 3600);
    var m = frameMatrix(viewFrame, jd, loc.latRad, loc.lonRad, viewJ2000);
    var fv = mvmul(m, obj.jx, obj.jy, obj.jz);
    var latDeg = asin(max(-1, min(1, fv[2]))) * RAD_TO_DEG;
    var lon = viewFrame === 'horizon' ? atan2pi(fv[0], fv[1]) : atan2pi(fv[1], fv[0]);
    var lonDeg = lon * RAD_TO_DEG;
    if (viewFrame === 'equatorial') {
      lonStr = formatRA(lonDeg);
      latStr = formatDec(latDeg);
    } else {
      lonStr = lonDeg.toFixed(3) + '°';
      latStr = (latDeg >= 0 ? '+' : '') + latDeg.toFixed(3) + '°';
    }
  }
  document.getElementById('info-lon-label').textContent = lonLabel;
  document.getElementById('info-lat-label').textContent = latLabel;
  document.getElementById('info-lon').textContent = lonStr;
  document.getElementById('info-lat').textContent = latStr;

  document.getElementById('info-mag').textContent =
    obj.mag == null ? '—' : !isFinite(obj.mag) ? 'Eclipsed' : (obj.mag >= 0 ? '+' : '') + obj.mag.toFixed(2);
  var bmvRow = document.getElementById('info-bmv-row');
  if (obj.type === 'star' && obj.data[S_BMV]) {
    bmvRow.style.display = '';
    document.getElementById('info-bmv').textContent = (obj.data[S_BMV] >= 0 ? '+' : '') + obj.data[S_BMV].toFixed(2);
  } else {
    bmvRow.style.display = 'none';
  }
  document.getElementById('info-dist').textContent = ssValid ? (obj.distStr() || '—') : '—';
  var smRow = document.getElementById('info-spectmorph-row');
  if (obj.type === 'star' && obj.data[S_SPEC]) {
    smRow.style.display = '';
    document.getElementById('info-spectmorph-label').textContent = 'Spectrum';
    document.getElementById('info-spectmorph').textContent = obj.data[S_SPEC];
  } else if (obj.type === 'deepsky' && obj.data[DS_MORPH]) {
    var dsType = obj.data[DS_TYPE];
    smRow.style.display = '';
    document.getElementById('info-spectmorph-label').textContent =
      (dsType === 'SS' || dsType === 'DS' || dsType === 'VS' || dsType === 'DV' || dsType === 'GC') ? 'Spectrum' : 'Morphology';
    document.getElementById('info-spectmorph').textContent = obj.data[DS_MORPH];
  } else {
    smRow.style.display = 'none';
  }
  var sizeRow = document.getElementById('info-size-row');
  var hasSize = obj.type !== 'star' && obj.type !== 'asteroid' && obj.type !== 'comet' && obj.type !== 'satellite';
  sizeRow.style.display = hasSize ? '' : 'none';
  if (hasSize) document.getElementById('info-size').textContent = ssValid ? (obj.sizeStr() || '—') : '—';

  // Phase (planets and Moon only)
  var phase = ssValid ? obj.phaseStr() : '';
  document.getElementById('info-phase-row').style.display = phase ? '' : 'none';
  if (phase) document.getElementById('info-phase').textContent = phase;

  // Sub-observer (planets and Moon with orientation data)
  var hasSub = ss && ss.subObsLon != null && ss.subObsLat != null;
  document.getElementById('info-sublon-row').style.display = hasSub ? '' : 'none';
  document.getElementById('info-sublat-row').style.display = hasSub ? '' : 'none';
  if (hasSub) {
    // ESAA eq 10.24 uses a left-handed body frame (sec = pm × pole), which gives
    // longitude increasing westward. This matches IAU convention for prograde
    // rotators, but retrograde rotators (Venus) and the Moon (selenographic
    // longitude increases eastward) need negation.
    var lonDeg = ss.subObsLon * RAD_TO_DEG;
    if (ss.type === 'moon' || ss.name === 'Venus') lonDeg = mod360(-lonDeg);
    document.getElementById('info-sublon').textContent = lonDeg.toFixed(1) + '°';
    document.getElementById('info-sublat').textContent = (ss.subObsLat >= 0 ? '+' : '') + (ss.subObsLat * RAD_TO_DEG).toFixed(1) + '°';
  }

  // Rise / Transit / Set. Not shown for satellites: a LEO satellite crosses
  // the sky in minutes and completes many passes per day, so "rises at X /
  // sets at Y" computed from a single instantaneous position (as if it were
  // a fixed star for the day) would be meaningless rather than merely imprecise.
  var showRTS = obj.type !== 'satellite';
  document.getElementById('info-rise-row').style.display = showRTS ? '' : 'none';
  document.getElementById('info-transit-row').style.display = showRTS ? '' : 'none';
  document.getElementById('info-set-row').style.display = showRTS ? '' : 'none';

  if (showRTS) {
    var jd0 = floor(jd - dt.tzOffMin / 1440 + 0.5) + dt.tzOffMin / 1440 - 0.5;
    // h0 = altitude of the body's CENTER at rise/set of its upper limb:
    // -(refraction + semidiameter). solSysObjPosition() already applies full
    // topocentric correction to the Moon's RA/Dec, so — unlike Meeus's textbook
    // shortcut 0.7275*parallax - 34', which substitutes for that correction —
    // we just need refraction plus the Moon's actual current semidiameter here,
    // the same logic as the Sun's -50' (34' refraction + 16' semidiameter).
    var h0 = REFRACTION_ALT;
    if (obj.type === 'sun') h0 = (-50 / 60) * DEG_TO_RAD;
    else if (obj.type === 'moon') {
      var moonSS = obj.ssData;
      var moonSemiDiam = (moonSS && moonSS.angRad) ? moonSS.angRad : (15.5 / 60) * DEG_TO_RAD;
      h0 = REFRACTION_ALT - moonSemiDiam;
    }

    // ssTarget is either a name string (Sun/Moon/planet) or an already-resolved
    // element object (asteroid/comet), looked up here once rather than having
    // solSysObjPosition() search loadedAsteroids/loadedComets on every call.
    var ssTarget = null;
    if (obj.type === 'sun') ssTarget = 'Sun';
    else if (obj.type === 'moon') ssTarget = 'Moon';
    else if (obj.type === 'planet') ssTarget = obj.name;
    else if (obj.type === 'planetmoon') { var ss = obj.ssData; if (ss && ss.parent) ssTarget = ss.parent; }
    else if (obj.type === 'comet') ssTarget = loadedComets && loadedComets.find(function(c) { return c.name === obj.name; });
    else if (obj.type === 'asteroid') ssTarget = loadedAsteroids && loadedAsteroids.find(function(a) { return a.name === obj.name; });
    var lonRad = loc.lonRad;

    var getRaDec, iterations;
    if (ssTarget && solSysObjPosition(ssTarget, jd, loc.latRad, lonRad)) {
      // Solar system objects move measurably during a day (the Moon especially),
      // so getRaDec()'s result changes pass to pass and needs more than one
      // iteration to converge — unlike the fixed-position case below.
      getRaDec = function(t) { return solSysObjPosition(ssTarget, t, loc.latRad, lonRad); };
      iterations = 2;
    } else {
      // Fixed-position objects (stars, deep sky): RA/Dec barely moves in a day,
      // so one pass already converges.
      getRaDec = function(t) {
        var mEq = frameMatrix('equatorial', t, loc.latRad, lonRad, false);
        var eq = mvmul(mEq, obj.jx, obj.jy, obj.jz);
        var eqSph = uxyz2sph(eq[0], eq[1], eq[2]);
        return { ra: eqSph[0], dec: eqSph[1] };
      };
      iterations = 1;
    }

    var rRise = riseTransitSetIterative(getRaDec, jd0, loc.latRad, lonRad, h0, -1, iterations);
    var rTransit = riseTransitSetIterative(getRaDec, jd0, loc.latRad, lonRad, h0, 0, iterations);
    var rSet = riseTransitSetIterative(getRaDec, jd0, loc.latRad, lonRad, h0, 1, iterations);

    document.getElementById('info-rise').textContent = _rtsText(rRise);
    document.getElementById('info-transit').textContent = _rtsText(rTransit);
    document.getElementById('info-set').textContent = _rtsText(rSet);
  }
}

function clearInfoPanel() {
  var ids = ['info-type', 'info-name', 'info-catalog', 'info-lon', 'info-lat',
    'info-mag', 'info-dist', 'info-size', 'info-rise', 'info-transit', 'info-set'];
  for (var i = 0; i < ids.length; i++)
    document.getElementById(ids[i]).textContent = '—';
  document.getElementById('info-catalog-label').textContent = 'Catalog IDs';
  document.getElementById('info-phase-row').style.display = 'none';
  document.getElementById('info-sublon-row').style.display = 'none';
  document.getElementById('info-sublat-row').style.display = 'none';
  document.getElementById('info-bmv-row').style.display = 'none';
  document.getElementById('info-rise-row').style.display = '';
  document.getElementById('info-transit-row').style.display = '';
  document.getElementById('info-set-row').style.display = '';
  document.getElementById('centerBtn').disabled = true;
  document.getElementById('frameControls').style.display = 'none';
  document.getElementById('frameObject').checked = false;
}

function centerOnSelected() {
  var obj = _searchCurrentObj;
  if (!obj) return;

  selectedObject = {
    type: obj.type,
    data: obj.type === 'star' ? {name: obj.name, star: obj.data} : obj.data,
    jx: obj.jx, jy: obj.jy, jz: obj.jz,
    hr: obj.type === 'star' ? obj.data[S_HR] : undefined
  };
  _lastSelectedObj = selectedObject;

  centerObject = {
    type: obj.type,
    name: obj.name,
    norad: obj.norad,
    jx: obj.jx, jy: obj.jy, jz: obj.jz
  };

  draw();
}
