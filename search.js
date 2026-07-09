// search.js — Object search, list, and info panel for SkyMap
// Depends on: astromath.js, skymap.js (loaded before this file)
// References at runtime (defined in skymap.html inline script):
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

// ---- RA/Dec formatting ----

function formatRA(raDeg) {
  raDeg = ((raDeg % 360) + 360) % 360;
  var totalSec = round(raDeg / 15 * 360000) / 100;
  if (totalSec >= 86400) totalSec = 0;
  var hh = floor(totalSec / 3600);
  var mm = floor((totalSec % 3600) / 60);
  var ss = (totalSec % 60).toFixed(2);
  return String(hh).padStart(2, '0') + 'h ' + String(mm).padStart(2, '0') + 'm ' + ss.padStart(5, '0') + 's';
}

function formatDec(decDeg) {
  var sign = decDeg < 0 ? '−' : '+';
  var totalArcsec = round(abs(decDeg) * 36000) / 10;
  var dd = floor(totalArcsec / 3600);
  var mm = floor((totalArcsec % 3600) / 60);
  var ss = (totalArcsec % 60).toFixed(1);
  return sign + String(dd).padStart(2, '0') + '° ' + String(mm).padStart(2, '0') + '′ ' + ss.padStart(4, '0') + '″';
}

// ---- Type label lookup ----

const DS_TYPE_NAMES = {
  OC: 'Open Cluster', GC: 'Globular Cluster', BN: 'Bright Nebula',
  DN: 'Dark Nebula', PN: 'Planetary Nebula', GX: 'Galaxy'
};

// ---- SkyObject class ----

class SkyObject {
  constructor(opts) {
    this.type = opts.type;
    this.name = opts.name || '';
    this.names = opts.names || [];
    this.jx = opts.jx;
    this.jy = opts.jy;
    this.jz = opts.jz;
    this.mag = opts.mag != null ? opts.mag : null;
    this.data = opts.data || null;
    // Real unique id for satellites — many rocket-body/debris objects share
    // the same generic name across different launches, so name+type alone is
    // ambiguous. undefined for every other type (those names are unique).
    this.norad = opts.norad;
  }

  get ra() { return mod360(atan2(this.jy, this.jx) * RAD); }
  get dec() { return asin(max(-1, min(1, this.jz))) * RAD; }
  get raStr() { return formatRA(this.ra); }
  get decStr() { return formatDec(this.dec); }
  get displayName() { return this.name || (this.names.length ? this.names[0] : '(unnamed)'); }

  get typeLabel() {
    switch (this.type) {
      case 'star': return 'Star';
      case 'sun': return 'Star (Sun)';
      case 'planet': return 'Planet';
      case 'moon': return 'Moon of Earth';
      case 'asteroid': return 'Asteroid';
      case 'comet': return 'Comet';
      case 'satellite': return 'Satellite';
      case 'planetmoon':
        var ss = this.ssData;
        return ss ? 'Moon of ' + ss.parent : 'Moon';
      case 'deepsky':
        return DS_TYPE_NAMES[this.data[0]] || this.data[0];
      default: return this.type;
    }
  }

  get ssData() {
    if (!ssCache || !ssCache.length) return null;
    for (var i = 0; i < ssCache.length; i++) {
      if (ssCache[i].type !== this.type) continue;
      if (this.norad != null ? ssCache[i].norad === this.norad : ssCache[i].name === this.name) return ssCache[i];
    }
    return null;
  }

  distStr() {
    var LY_PER_PC = 3.26156;
    if (this.type === 'star') {
      var pc = this.data[4];
      if (!pc || pc <= 0) return '';
      var ly = pc * LY_PER_PC;
      return ly >= 1000 ? (ly / 1000).toFixed(1) + ' kly' : ly.toFixed(1) + ' ly';
    }
    if (this.type === 'deepsky') {
      var pc = this.data[4];
      if (!pc || pc <= 0) return '';
      var ly = pc * LY_PER_PC;
      if (this.data[0] === 'GX') return (ly / 1e6).toFixed(1) + ' Mly';
      return ly >= 1000 ? (ly / 1000).toFixed(1) + ' kly' : ly.toFixed(1) + ' ly';
    }
    var ss = this.ssData;
    if (!ss) return '';
    if (this.type === 'moon' || this.type === 'satellite') {
      var km = ss.dist;
      if (!km || km <= 0) return '';
      return round(km).toLocaleString() + ' km';
    }
    var au = ss.geoDist || ss.dist;
    if (!au || au <= 0) return '';
    return au.toFixed(3) + ' AU';
  }

  sizeStr() {
    if (this.type === 'deepsky') {
      var major = this.data[5];
      if (!major) return '';
      var minor = this.data[6];
      if (minor && abs(minor - major) > 0.01)
        return major.toFixed(1) + '′ × ' + minor.toFixed(1) + '′';
      return major.toFixed(1) + '′';
    }
    var ss = this.ssData;
    if (ss && ss.angRad) {
      var diamArcsec = ss.angRad * 2 * RAD * 3600;
      if (diamArcsec >= 60) return (diamArcsec / 60).toFixed(1) + '′';
      return diamArcsec.toFixed(1) + '″';
    }
    return '';
  }

  altAz(jd, latRad, lonRad) {
    var m = frameMatrix('horizon', jd, latRad, lonRad, false);
    var h = mvmul(m, this.jx, this.jy, this.jz);
    var alt = asin(max(-1, min(1, h[2]))) * RAD;
    var az = mod360(atan2(h[0], h[1]) * RAD);
    return { alt: alt, az: az };
  }

  phaseStr() {
    var ss = this.ssData;
    if (!ss || ss.phaseAngle == null) return '';
    if (ss.type !== 'planet' && ss.type !== 'moon') return '';
    var illum = (1 + cos(ss.phaseAngle)) / 2 * 100;
    return illum.toFixed(1) + '%';
  }

  static fromStar(s) {
    var names = [];
    if (s[10]) names.push(s[10]);
    if (s[8]) names.push(s[8]);
    if (s[9]) names.push(s[9]);
    if (s[5]) names.push('HR ' + s[5]);
    if (s[6]) names.push('HD ' + s[6]);
    if (s[7]) names.push('HIP ' + s[7]);
    if (s[11]) names.push(s[11]);
    return new SkyObject({
      type: 'star', name: s[10] || '', names: names,
      jx: s[12], jy: s[13], jz: s[14], mag: s[2], data: s
    });
  }

  static fromDeepSky(ds) {
    var names = [];
    if (ds[8]) names.push(ds[8]);
    if (ds[9]) names.push(ds[9]);
    if (ds[10]) names.push(ds[10]);
    if (ds[11]) names.push(ds[11]);
    return new SkyObject({
      type: 'deepsky', name: ds[11] || ds[8] || ds[9] || '', names: names,
      jx: ds[12], jy: ds[13], jz: ds[14], mag: ds[3], data: ds
    });
  }

  static fromSSEntry(entry) {
    return new SkyObject({
      type: entry.type, name: entry.name, names: [entry.name], norad: entry.norad,
      jx: entry.x, jy: entry.y, jz: entry.z, mag: entry.mag, data: entry
    });
  }

  static fromDrawnObject(obj) {
    var names = [];
    var name = '';
    if (obj.type === 'star') {
      var d = obj.data;
      if (d[10]) { names.push(d[10]); name = d[10]; }
      if (d[8]) names.push(d[8]);
      if (d[9]) names.push(d[9]);
      if (d[5]) names.push('HR ' + d[5]);
      if (d[6]) names.push('HD ' + d[6]);
      if (d[7]) names.push('HIP ' + d[7]);
      if (d[11]) names.push(d[11]);
    } else if (obj.type === 'deepsky') {
      var d = obj.data;
      if (d[8]) names.push(d[8]);
      if (d[9]) names.push(d[9]);
      if (d[10]) names.push(d[10]);
      if (d[11]) names.push(d[11]);
      name = d[11] || d[8] || d[9] || '';
    } else {
      name = obj.data.name || obj.name || '';
      if (name) names.push(name);
    }
    var mag = obj.type === 'star' ? obj.data[2] : (obj.data.mag != null ? obj.data.mag : null);
    return new SkyObject({
      type: obj.type, name: name, names: names, norad: obj.data ? obj.data.norad : undefined,
      jx: obj.jx, jy: obj.jy, jz: obj.jz, mag: mag, data: obj.data
    });
  }
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
    if (s[10]) parts.push(s[10]);
    if (s[8]) parts.push(s[8]);
    if (s[9]) parts.push(s[9]);
    if (s[5]) parts.push('HR ' + s[5]);
    if (s[6]) parts.push('HD ' + s[6]);
    if (s[7]) parts.push('HIP ' + s[7]);
    if (s[11]) parts.push(s[11]);
    if (parts.length > 0) {
      _starSearchData.push({ text: parts.join('\t').toLowerCase(), idx: i, mag: s[2] });
    }
  }

  _dsSearchData = [];
  for (var i = 0; i < DEEPSKY.length; i++) {
    var ds = DEEPSKY[i];
    var parts = [];
    if (ds[8]) parts.push(ds[8]);
    if (ds[9]) parts.push(ds[9]);
    if (ds[10]) parts.push(ds[10]);
    if (ds[11]) parts.push(ds[11]);
    if (parts.length > 0) {
      _dsSearchData.push({ text: parts.join('\t').toLowerCase(), idx: i, mag: ds[3] });
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
      var label = s[10] || s[8] || s[9] || (s[5] ? 'HR ' + s[5] : 'HIP ' + s[7]);
      results.push({ src: 'star', idx: e.idx, label: label, mag: e.mag, text: e.text });
    }
  }

  for (var i = 0; i < _dsSearchData.length; i++) {
    var e = _dsSearchData[i];
    if (e.text.includes(q)) {
      var ds = DEEPSKY[e.idx];
      var label = ds[8] ? (ds[8] + (ds[11] ? ' - ' + ds[11] : '')) : (ds[11] || ds[9]);
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
        if (s[10]) {
          var desig = s[8] || s[9] || '';
          var label = desig ? s[10] + ' - ' + desig : s[10];
          items.push({ src: 'star', idx: i, label: label, mag: s[2] });
        }
      }
      items.sort(function(a, b) { return a.label.localeCompare(b.label); });
      break;

    case 'brightStars':
      for (var i = 0; i < STARS.length; i++) {
        var s = STARS[i];
        if (s[2] <= 3.0) {
          var desig = s[8] || s[9] || (s[5] ? 'HR ' + s[5] : 'HIP ' + s[7]);
          var label = s[10] ? desig + ' - ' + s[10] : desig;
          items.push({ src: 'star', idx: i, label: label, mag: s[2] });
        }
      }
      items.sort(function(a, b) { return (a.mag || 99) - (b.mag || 99); });
      break;

    case 'namedDSO':
      for (var i = 0; i < DEEPSKY.length; i++) {
        var ds = DEEPSKY[i];
        if (ds[11]) {
          var catId = ds[8] || ds[9] || '';
          var label = catId ? ds[11] + ' - ' + catId : ds[11];
          items.push({ src: 'deepsky', idx: i, label: label, mag: ds[3] });
        }
      }
      items.sort(function(a, b) { return a.label.localeCompare(b.label); });
      break;

    case 'messier':
      for (var i = 0; i < DEEPSKY.length; i++) {
        var ds = DEEPSKY[i];
        if (ds[8] && ds[8].startsWith('M ')) {
          var label = ds[8] + (ds[11] ? ' - ' + ds[11] : '');
          items.push({ src: 'deepsky', idx: i, label: label, mag: ds[3] });
        }
      }
      items.sort(function(a, b) {
        return parseInt(a.label.substring(2)) - parseInt(b.label.substring(2));
      });
      break;

    case 'caldwell':
      for (var i = 0; i < DEEPSKY.length; i++) {
        var ds = DEEPSKY[i];
        if (ds[8] && ds[8].startsWith('C ')) {
          var label = ds[8] + (ds[11] ? ' - ' + ds[11] : '');
          items.push({ src: 'deepsky', idx: i, label: label, mag: ds[3] });
        }
      }
      items.sort(function(a, b) {
        return parseInt(a.label.substring(2)) - parseInt(b.label.substring(2));
      });
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
  var objName = obj.type === 'star' ? (obj.data[10] || '') : obj.name;
  selectedObject = {
    type: obj.type,
    name: objName,
    data: obj.data,
    jx: obj.jx, jy: obj.jy, jz: obj.jz,
    x: 0, y: 0, r: 5,
    hr: obj.type === 'star' ? obj.data[5] : undefined
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
    var latDeg = asin(max(-1, min(1, fv[2]))) * RAD;
    var lon = viewFrame === 'horizon' ? atan2(fv[0], fv[1]) : atan2(fv[1], fv[0]);
    var lonDeg = mod360(lon * RAD);
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
  if (obj.type === 'star' && obj.data[3]) {
    bmvRow.style.display = '';
    document.getElementById('info-bmv').textContent = (obj.data[3] >= 0 ? '+' : '') + obj.data[3].toFixed(2);
  } else {
    bmvRow.style.display = 'none';
  }
  document.getElementById('info-dist').textContent = ssValid ? (obj.distStr() || '—') : '—';
  document.getElementById('info-size').textContent = ssValid ? (obj.sizeStr() || '—') : '—';

  // Phase (planets and Moon only)
  var phase = ssValid ? obj.phaseStr() : '';
  document.getElementById('info-phase-row').style.display = phase ? '' : 'none';
  if (phase) document.getElementById('info-phase').textContent = phase;

  // Sub-observer (planets and Moon with orientation data)
  var hasSub = ss && ss.subObsLon != null && ss.subObsLat != null;
  document.getElementById('info-sublon-row').style.display = hasSub ? '' : 'none';
  document.getElementById('info-sublat-row').style.display = hasSub ? '' : 'none';
  if (hasSub) {
    document.getElementById('info-sublon').textContent = ss.subObsLon.toFixed(1) + '°';
    document.getElementById('info-sublat').textContent = (ss.subObsLat >= 0 ? '+' : '') + ss.subObsLat.toFixed(1) + '°';
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
    if (obj.type === 'sun') h0 = (-50 / 60) * DEG;
    else if (obj.type === 'moon') {
      var moonSS = obj.ssData;
      var moonSemiDiam = (moonSS && moonSS.angRad) ? moonSS.angRad : (15.5 / 60) * DEG;
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
}

function centerOnSelected() {
  var obj = _searchCurrentObj;
  if (!obj) return;

  var objName = obj.type === 'star' ? (obj.data[10] || '') : obj.name;
  selectedObject = {
    type: obj.type,
    name: objName,
    data: obj.data,
    jx: obj.jx, jy: obj.jy, jz: obj.jz,
    x: 0, y: 0, r: 5,
    hr: obj.type === 'star' ? obj.data[5] : undefined
  };
  _lastSelectedObj = selectedObject;

  centerObject = {
    type: obj.type,
    name: obj.type === 'star' ? objName : (obj.data.name || obj.name),
    norad: obj.norad,
    jx: obj.jx, jy: obj.jy, jz: obj.jz
  };

  draw();
}
