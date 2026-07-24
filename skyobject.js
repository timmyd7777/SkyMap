// skyobject.js — SkyObject class for SkyMap
// Depends on: astromath.js (for formatRA, formatDec, RAD_TO_DEG, etc.)
// Depends on: skymap.js data constants (S_*, DS_*) and ssCache

// ---- Type label lookup ----

var STAR_TYPE_NAMES = {
  SS: 'Star', DS: 'Double Star', VS: 'Variable Star', DV: 'Double Variable Star'
};

var DS_TYPE_NAMES = {
  SS: 'Star', DS: 'Double Star', VS: 'Variable Star', DV: 'Double Variable Star',
  OC: 'Open Cluster', GC: 'Globular Cluster', BN: 'Bright Nebula',
  DN: 'Dark Nebula', PN: 'Planetary Nebula', GX: 'Galaxy'
};

// ---- SkyObject class ----

class SkyObject {
  constructor(opts) {
    this.type = opts.type;
    this.name = opts.name || '';
    this.ids = opts.ids || [];
    this.jx = opts.jx;
    this.jy = opts.jy;
    this.jz = opts.jz;
    this.mag = opts.mag != null ? opts.mag : null;
    this.data = opts.data || null;
    this.norad = opts.norad;
    this.elements = opts.elements || null;
  }

  get ra() { return atan2pi(this.jy, this.jx) * RAD_TO_DEG; }
  get dec() { return asin(max(-1, min(1, this.jz))) * RAD_TO_DEG; }
  get raStr() { return formatRA(this.ra); }
  get decStr() { return formatDec(this.dec); }
  get displayName() { return this.name || (this.ids.length ? this.ids[0] : '(unnamed)'); }

  get typeLabel() {
    switch (this.type) {
      case 'star': return (this.data && STAR_TYPE_NAMES[this.data[S_TYPE]]) || 'Star';
      case 'sun': return 'Star';
      case 'planet': return 'Planet';
      case 'moon': return 'Moon of Earth';
      case 'asteroid': return 'Asteroid';
      case 'comet': return 'Comet';
      case 'satellite': return 'Satellite';
      case 'planetmoon':
        var ss = this.ssData;
        return ss ? 'Moon of ' + ss.parent : 'Moon';
      case 'deepsky':
        return (this.data && (DS_TYPE_NAMES[this.data[DS_TYPE]] || this.data[DS_TYPE])) || 'Deep Sky Object';
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
    if (this.type === 'star') {
      if (!this.data) return '';
      var pc = this.data[S_DIST];
      if (!pc || pc <= 0) return '';
      var ly = pc * LY_PER_PC;
      return ly >= 1000 ? (ly / 1000).toFixed(1) + ' kly' : ly.toFixed(1) + ' ly';
    }
    if (this.type === 'deepsky') {
      if (!this.data) return '';
      var pc = this.data[DS_DIST];
      if (!pc || pc <= 0) return '';
      var ly = pc * LY_PER_PC;
      if (this.data[DS_TYPE] === 'GX') return (ly / 1e6).toFixed(1) + ' Mly';
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
      if (!this.data) return '';
      var major = this.data[DS_MAJ];
      if (!major) return '';
      var minor = this.data[DS_MIN];
      if (minor && abs(minor - major) > 0.01)
        return major.toFixed(1) + '′ × ' + minor.toFixed(1) + '′';
      return major.toFixed(1) + '′';
    }
    var ss = this.ssData;
    if (ss && ss.angRad) {
      var diamArcsec = ss.angRad * 2 * RAD_TO_DEG * 3600;
      if (diamArcsec >= 60) return (diamArcsec / 60).toFixed(1) + '′';
      return diamArcsec.toFixed(1) + '″';
    }
    return '';
  }

  altAz(jd, latRad, lonRad) {
    var m = frameMatrix('horizon', jd, latRad, lonRad, false);
    var h = mvmul(m, this.jx, this.jy, this.jz);
    var alt = asin(max(-1, min(1, h[2]))) * RAD_TO_DEG;
    var az = atan2pi(h[0], h[1]) * RAD_TO_DEG;
    return { alt: alt, az: az };
  }

  phaseStr() {
    var ss = this.ssData;
    if (!ss || ss.phaseAngle == null) return '';
    if (ss.type !== 'planet' && ss.type !== 'moon') return '';
    var illum = (1 + cos(ss.phaseAngle)) / 2 * 100;
    return illum.toFixed(1) + '%';
  }

  // ---- Serialization for Preferences persistence ----

  toJSON() {
    var o = {
      type: this.type,
      name: this.name,
      ids: this.ids,
      jx: this.jx,
      jy: this.jy,
      jz: this.jz,
      mag: this.mag,
      norad: this.norad
    };
    if (this.elements) o.elements = this.elements;
    return o;
  }

  static fromJSON(j) {
    if (!j || !j.type) return null;
    return new SkyObject({
      type: j.type,
      name: j.name || '',
      ids: j.ids || j.names || [],
      jx: j.jx,
      jy: j.jy,
      jz: j.jz,
      mag: j.mag != null ? j.mag : null,
      norad: j.norad,
      elements: j.elements || null
    });
  }

  // ---- Factory methods ----

  static fromStar(s) {
    var ids = [];
    if (s[S_BAYER]) ids.push(s[S_BAYER]);
    if (s[S_FLAM]) ids.push(s[S_FLAM]);
    if (s[S_HR]) ids.push('HR ' + s[S_HR]);
    if (s[S_HD]) ids.push('HD ' + s[S_HD]);
    if (s[S_HIP]) ids.push('HIP ' + s[S_HIP]);
    if (s[S_DM]) ids.push(s[S_DM]);
    return new SkyObject({
      type: 'star', name: s[S_NAME] || '', ids: ids,
      jx: s[S_X], jy: s[S_Y], jz: s[S_Z], mag: s[S_MAG], data: s
    });
  }

  static fromDeepSky(ds) {
    var ids = [];
    if (ds[DS_MC]) ids.push(ds[DS_MC]);
    if (ds[DS_NGC]) ids.push(ds[DS_NGC]);
    if (ds[DS_NGC2]) ids.push(ds[DS_NGC2]);
    return new SkyObject({
      type: 'deepsky', name: ds[DS_NAME] || '', ids: ids,
      jx: ds[DS_X], jy: ds[DS_Y], jz: ds[DS_Z], mag: ds[DS_MAG], data: ds
    });
  }

  static fromSSEntry(entry) {
    var ids = entry.norad != null ? [String(entry.norad)] : [];
    return new SkyObject({
      type: entry.type, name: entry.name, ids: ids, norad: entry.norad,
      jx: entry.x, jy: entry.y, jz: entry.z, mag: entry.mag, data: entry,
      elements: entry.elements || null
    });
  }

  static fromDrawnObject(obj) {
    var ids = [];
    var name = '';
    if (obj.type === 'star') {
      var d = obj.data.star;
      name = d[S_NAME] || '';
      if (d[S_BAYER]) ids.push(d[S_BAYER]);
      if (d[S_FLAM]) ids.push(d[S_FLAM]);
      if (d[S_HR]) ids.push('HR ' + d[S_HR]);
      if (d[S_HD]) ids.push('HD ' + d[S_HD]);
      if (d[S_HIP]) ids.push('HIP ' + d[S_HIP]);
      if (d[S_DM]) ids.push(d[S_DM]);
    } else if (obj.type === 'deepsky') {
      var d = obj.data;
      if (d[DS_MC]) ids.push(d[DS_MC]);
      if (d[DS_NGC]) ids.push(d[DS_NGC]);
      if (d[DS_NGC2]) ids.push(d[DS_NGC2]);
      name = d[DS_NAME] || '';
    } else {
      name = obj.data.name || '';
      if (obj.data.norad != null) ids.push(String(obj.data.norad));
    }
    var s = obj.type === 'star' ? obj.data.star : null;
    var mag = s ? s[S_MAG] : obj.type === 'deepsky' ? obj.data[DS_MAG] : (obj.data.mag != null ? obj.data.mag : null);
    return new SkyObject({
      type: obj.type, name: name, ids: ids, norad: obj.data ? obj.data.norad : undefined,
      jx: obj.jx, jy: obj.jy, jz: obj.jz, mag: mag, data: s || obj.data,
      elements: obj.data ? obj.data.elements : null
    });
  }
}

