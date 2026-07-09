// search.js — Object search, list, and info panel for SkyMap
// Depends on: astromath.js, skymap.js (loaded before this file)
// References at runtime (defined in skymap.html inline script):
//   getDateTimeFromFields(), getLocation(), sizeCanvas(), draw()

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
      case 'moon': return 'Moon (Earth)';
      case 'asteroid': return 'Asteroid';
      case 'comet': return 'Comet';
      case 'satellite': return 'Satellite';
      case 'planetmoon':
        var ss = this.ssData;
        return ss ? ss.parent + ' Moon' : 'Moon';
      case 'deepsky':
        return DS_TYPE_NAMES[this.data[0]] || this.data[0];
      default: return this.type;
    }
  }

  get ssData() {
    if (!ssCache || !ssCache.length) return null;
    for (var i = 0; i < ssCache.length; i++) {
      if (ssCache[i].name === this.name && ssCache[i].type === this.type) return ssCache[i];
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
      if (diamArcsec >= 0.1) return diamArcsec.toFixed(1) + '″';
    }
    return '';
  }

  altAz(jd, latRad, lonDeg) {
    var m = frameMatrix('horizon', jd, latRad, lonDeg, false);
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

  subObsStr() {
    var ss = this.ssData;
    if (!ss || ss.subObsLon == null || ss.subObsLat == null) return '';
    return 'Lon ' + ss.subObsLon.toFixed(1) + '° Lat ' +
      (ss.subObsLat >= 0 ? '+' : '') + ss.subObsLat.toFixed(1) + '°';
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
      type: entry.type, name: entry.name, names: [entry.name],
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
      type: obj.type, name: name, names: names,
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
        results.push({ src: 'ss', ssName: e.name, ssType: e.type, label: label, mag: e.mag, text: e.name.toLowerCase() });
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
          if (e.type === 'sun' || e.type === 'planet' || e.type === 'moon')
            items.push({ src: 'ss', ssName: e.name, ssType: e.type, label: e.name, mag: e.mag });
        }
        var order = { Sun: 0, Moon: 1, Mercury: 2, Venus: 3, Mars: 4, Jupiter: 5, Saturn: 6, Uranus: 7, Neptune: 8, Pluto: 9 };
        items.sort(function(a, b) {
          return (order[a.label] != null ? order[a.label] : 99) - (order[b.label] != null ? order[b.label] : 99);
        });
      }
      break;

    case 'moons':
      if (ssCache) {
        for (var i = 0; i < ssCache.length; i++) {
          var e = ssCache[i];
          if (e.type === 'planetmoon')
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
            items.push({ src: 'ss', ssName: e.name, ssType: e.type, label: e.name, mag: e.mag });
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
    var entry = ssCache.find(function(e) { return e.name === item.ssName && e.type === item.ssType; });
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
    if (sortRadio && sortRadio.value === 'mag')
      items.sort(function(a, b) { return (a.mag != null ? a.mag : 99) - (b.mag != null ? b.mag : 99); });
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

  // For SS objects, refresh position and data from ssCache
  if (obj.type !== 'star' && obj.type !== 'deepsky') {
    var ss = obj.ssData;
    if (ss) {
      obj.jx = ss.x; obj.jy = ss.y; obj.jz = ss.z;
      if (ss.mag != null) obj.mag = ss.mag;
    }
  }

  document.getElementById('centerBtn').disabled = false;
  document.getElementById('info-type').textContent = obj.typeLabel;
  document.getElementById('info-name').textContent = obj.displayName || '—';

  var catalogs = obj.names.filter(function(n) { return n !== obj.name; });
  document.getElementById('info-catalog').textContent = catalogs.length ? catalogs.join(', ') : '—';

  document.getElementById('info-ra').textContent = obj.raStr;
  document.getElementById('info-dec').textContent = obj.decStr;

  // Az/Alt
  var dt = getDateTimeFromFields();
  var loc = getLocation();
  var jd = julianDate(dt.y, dt.m, dt.d, dt.h + dt.mi / 60 + dt.s / 3600);
  var altaz = obj.altAz(jd, loc.latRad, loc.lonDeg);
  document.getElementById('info-azm').textContent = altaz.az.toFixed(1) + '°';
  document.getElementById('info-alt').textContent = (altaz.alt >= 0 ? '+' : '') + altaz.alt.toFixed(1) + '°';

  document.getElementById('info-mag').textContent =
    obj.mag != null ? (obj.mag >= 0 ? '+' : '') + obj.mag.toFixed(2) : '—';
  document.getElementById('info-dist').textContent = obj.distStr() || '—';
  document.getElementById('info-size').textContent = obj.sizeStr() || '—';

  // Phase (planets and Moon only)
  var phase = obj.phaseStr();
  document.getElementById('info-phase-row').style.display = phase ? '' : 'none';
  if (phase) document.getElementById('info-phase').textContent = phase;

  // Sub-observer (planets and Moon with orientation data)
  var subObs = obj.subObsStr();
  document.getElementById('info-subobs-row').style.display = subObs ? '' : 'none';
  if (subObs) document.getElementById('info-subobs').textContent = subObs;
}

function clearInfoPanel() {
  var ids = ['info-type', 'info-name', 'info-catalog', 'info-ra', 'info-dec',
    'info-azm', 'info-alt', 'info-mag', 'info-dist', 'info-size'];
  for (var i = 0; i < ids.length; i++)
    document.getElementById(ids[i]).textContent = '—';
  document.getElementById('info-phase-row').style.display = 'none';
  document.getElementById('info-subobs-row').style.display = 'none';
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
    jx: obj.jx, jy: obj.jy, jz: obj.jz
  };

  draw();
}
