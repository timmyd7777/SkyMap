// sgp4.js — TLE/CSV parser and SGP4 near-earth orbit propagator.
// Parses classic 3-line TLE format and CelesTrak OMM CSV format.
// SGP4 based on Spacetrack Report #3 (Hoots & Roehrich 1980).
// All internal units: radians, Earth-radii (WGS72), minutes.

// Parse satellite elements from text (auto-detects TLE vs CSV format).
// Returns array of satellite records.
function parseSatellites(text) {
  const lines = text.split('\n');
  if (lines[0].indexOf('OBJECT_NAME') >= 0)
    return parseSatCSV(lines);
  return parseSatTLE(lines);
}

// Parse classic 3-line TLE format: name line + line 1 + line 2.
function parseSatTLE(lines) {
  const sats = [];
  const temp = TAU / 1440 / 1440;
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].trim()) { i++; continue; }

    let name = '';
    if (lines[i][0] !== '1') {
      name = lines[i].trim();
      i++;
    }
    if (i >= lines.length || lines[i][0] !== '1') { i++; continue; }
    const line1 = lines[i]; i++;
    if (i >= lines.length || lines[i][0] !== '2') { i++; continue; }
    const line2 = lines[i]; i++;

    // Line 1: catalog number, designator, epoch, drag terms
    const norad = parseInt(line1.substring(2, 7)) || 0;
    const desigRaw = line1.substring(9, 17).trim();
    const epochVal = parseFloat(line1.substring(18, 32));
    const ndot2 = parseFloat(line1.substring(33, 43)) || 0;
    const nddot6Man = parseFloat(line1.substring(44, 50)) || 0;
    const nddot6Exp = parseInt(line1.substring(50, 52)) || 0;
    const bstarMan = parseFloat(line1.substring(53, 59)) || 0;
    const bstarExp = parseInt(line1.substring(59, 61)) || 0;
    const elset = parseInt(line1.substring(64, 68)) || 0;

    // Line 2: orbital elements
    const incl = parseFloat(line2.substring(8, 16)) || 0;
    const raan = parseFloat(line2.substring(17, 25)) || 0;
    const ecc = (parseFloat(line2.substring(26, 33)) || 0) * 1e-7;
    const argp = parseFloat(line2.substring(34, 42)) || 0;
    const ma = parseFloat(line2.substring(43, 51)) || 0;
    const mm = parseFloat(line2.substring(52, 63)) || 0;
    const revno = parseInt(line2.substring(63, 68)) || 0;

    // Epoch: 2-digit year + fractional day-of-year → Julian Date
    const epochYear2 = Math.floor(epochVal / 1000);
    const epochDay = epochVal - epochYear2 * 1000;
    const epochYear = epochYear2 > 56 ? 1900 + epochYear2 : 2000 + epochYear2;
    const epoch = julianDate(epochYear, 1, 1, 0) + epochDay - 1;

    // International designator: "63047A" → "1963-047A"
    let desig = desigRaw;
    if (desigRaw.length >= 4) {
      const dy = parseInt(desigRaw.substring(0, 2));
      desig = (dy > 56 ? 1900 + dy : 2000 + dy) + '-' + desigRaw.substring(2);
    }

    // Convert to SGP4 units (radians, rad/min)
    const xno = mm * TAU / 1440;
    const period = mm > 0 ? 1440 / mm : 1e6;

    sats.push({
      name, norad, desig, epoch, elset, revno,
      xincl: incl * DEG,
      xnodeo: raan * DEG,
      eo: ecc,
      omegao: argp * DEG,
      xmo: ma * DEG,
      xno,
      xndt2o: ndot2 * temp,
      xndd6o: nddot6Man * 1e-5 * pow(10, nddot6Exp) * temp / 1440,
      bstar: bstarMan * 1e-5 * pow(10, bstarExp),
      deep: period > 225
    });
  }
  return sats;
}

// Parse CelesTrak OMM CSV format (header + data rows).
function parseSatCSV(lines) {
  const sats = [];
  const temp = TAU / 1440 / 1440;
  const header = lines[0].split(',').map(h => h.trim());

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const fields = splitCSV(lines[i]);
    if (fields.length < 17) continue;

    const row = {};
    for (let j = 0; j < header.length && j < fields.length; j++)
      row[header[j]] = fields[j];

    const mm = parseFloat(row.MEAN_MOTION) || 0;
    if (mm <= 0) continue;
    const norad = parseInt(row.NORAD_CAT_ID) || 0;
    if (norad < 1) continue;

    // ISO 8601 epoch → Julian Date
    const em = row.EPOCH.match(/(\d+)-(\d+)-(\d+)T(\d+):(\d+):([\d.]+)/);
    if (!em) continue;
    const epoch = julianDate(+em[1], +em[2], +em[3], +em[4] + +em[5]/60 + parseFloat(em[6])/3600);

    const xno = mm * TAU / 1440;
    const ndot = parseFloat(row.MEAN_MOTION_DOT) || 0;
    const nddot = parseFloat(row.MEAN_MOTION_DDOT) || 0;
    const period = 1440 / mm;

    sats.push({
      name: row.OBJECT_NAME || '',
      norad,
      desig: row.OBJECT_ID || '',
      epoch, elset: parseInt(row.ELEMENT_SET_NO) || 0,
      revno: parseInt(row.REV_AT_EPOCH) || 0,
      xincl: (parseFloat(row.INCLINATION) || 0) * DEG,
      xnodeo: (parseFloat(row.RA_OF_ASC_NODE) || 0) * DEG,
      eo: parseFloat(row.ECCENTRICITY) || 0,
      omegao: (parseFloat(row.ARG_OF_PERICENTER) || 0) * DEG,
      xmo: (parseFloat(row.MEAN_ANOMALY) || 0) * DEG,
      xno,
      xndt2o: ndot * temp,
      xndd6o: nddot * temp / 1440,
      bstar: parseFloat(row.BSTAR) || 0,
      deep: period > 225
    });
  }
  return sats;
}

// Split a CSV line, respecting quoted fields.
function splitCSV(line) {
  const fields = [];
  let cur = '', inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === ',' && !inQ) { fields.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  fields.push(cur.trim());
  return fields;
}

// ---- SGP4/SDP4 Orbit Propagators ----
// WGS72 constants used by SGP4/SDP4 (NOT the same as WGS84).

const SGP4_KE = 7.43669161e-2;     // sqrt(GM) in ER^1.5 / min
const SGP4_ER = 6378.135;          // Earth equatorial radius, km
const SGP4_J2 = 1.082616e-3;
const SGP4_J3 = -2.53881e-6;
const SGP4_J4 = -1.65597e-6;
const SGP4_CK2 = 0.5 * SGP4_J2;
const SGP4_CK4 = -0.375 * SGP4_J4;
const SGP4_QOMS2T = pow(42 / SGP4_ER, 4);
const SGP4_S = 1 + 78 / SGP4_ER;
const SGP4_THDT = 4.3752691e-3;    // Earth rotation rate, rad/min

// Deep-space solar/lunar perturbation constants
const ZNS = 1.19459e-5;
const C1SS = 2.9864797e-6;
const ZES = 0.01675;
const ZNL = 1.5835218e-4;
const C1L = 4.7968065e-7;
const ZEL = 0.05490;
const ZCOSIS = 0.91744867;
const ZSINIS = 0.39785416;
const ZSINGS = -0.98088458;
const ZCOSGS = 0.1945905;
const Q22 = 1.7891679e-6;
const Q31 = 2.1460748e-6;
const Q33 = 2.2123015e-7;
const G22 = 5.7686396;
const G32 = 0.95240898;
const G44 = 1.8014998;
const G52 = 1.0508330;
const G54 = 4.4108898;
const ROOT22 = 1.7891679e-6;
const ROOT32 = 3.7393792e-7;
const ROOT44 = 7.3636953e-9;
const ROOT52 = 1.1428639e-7;
const ROOT54 = 2.1765803e-9;

function sgp4Fmod2p(x) {
  let r = x % TAU;
  if (r < 0) r += TAU;
  return r;
}

function sgp4Actan(sinx, cosx) {
  const a = atan2(sinx, cosx);
  return a < 0 ? a + TAU : a;
}

// Initialize SGP4 model parameters. Stores them on sat._sgp4.
function sgp4Init(sat) {
  const a1 = pow(SGP4_KE / sat.xno, 2/3);
  const cosio = cos(sat.xincl);
  const theta2 = cosio * cosio;
  const x3thm1 = 3*theta2 - 1;
  const eosq = sat.eo * sat.eo;
  const betao2 = 1 - eosq;
  const betao = sqrt(betao2);
  const del1 = 1.5*SGP4_CK2*x3thm1 / (a1*a1*betao*betao2);
  const ao = a1 * (1 - del1*(1/3 + del1*(1 + 134/81*del1)));
  const delo = 1.5*SGP4_CK2*x3thm1 / (ao*ao*betao*betao2);
  const xnodp = sat.xno / (1 + delo);
  const aodp = ao / (1 - delo);

  const isimp = (aodp*(1 - sat.eo)) < (220/SGP4_ER + 1) ? 1 : 0;

  let s4 = SGP4_S, qoms24 = SGP4_QOMS2T;
  const perige = (aodp*(1 - sat.eo) - 1) * SGP4_ER;
  if (perige < 156) {
    s4 = perige <= 98 ? 20 : perige - 78;
    qoms24 = pow((120 - s4) / SGP4_ER, 4);
    s4 = s4/SGP4_ER + 1;
  }

  const pinvsq = 1 / (aodp*aodp*betao2*betao2);
  const tsi = 1 / (aodp - s4);
  const eta = aodp*sat.eo*tsi;
  const etasq = eta*eta;
  const eeta = sat.eo*eta;
  const psisq = abs(1 - etasq);
  const coef = qoms24 * pow(tsi, 4);
  const coef1 = coef / pow(psisq, 3.5);
  const c2 = coef1*xnodp*(aodp*(1 + 1.5*etasq + eeta*(4 + etasq)) +
    0.75*SGP4_CK2*tsi/psisq*x3thm1*(8 + 3*etasq*(8 + etasq)));
  const c1 = sat.bstar * c2;
  const sinio = sin(sat.xincl);
  const a3ovk2 = -SGP4_J3 / SGP4_CK2;
  const c3 = coef*tsi*a3ovk2*xnodp*sinio / sat.eo;
  const x1mth2 = 1 - theta2;
  const c4 = 2*xnodp*coef1*aodp*betao2*(eta*(2 + 0.5*etasq) +
    sat.eo*(0.5 + 2*etasq) - 2*SGP4_CK2*tsi/(aodp*psisq) *
    (-3*x3thm1*(1 - 2*eeta + etasq*(1.5 - 0.5*eeta)) +
     0.75*x1mth2*(2*etasq - eeta*(1 + etasq)) * cos(2*sat.omegao)));
  const c5 = 2*coef1*aodp*betao2*(1 + 2.75*(etasq + eeta) + eeta*etasq);
  const theta4 = theta2*theta2;
  const temp1 = 3*SGP4_CK2*pinvsq*xnodp;
  const temp2 = temp1*SGP4_CK2*pinvsq;
  const temp3 = 1.25*SGP4_CK4*pinvsq*pinvsq*xnodp;
  const xmdot = xnodp + 0.5*temp1*betao*x3thm1 +
    0.0625*temp2*betao*(13 - 78*theta2 + 137*theta4);
  const x1m5th = 1 - 5*theta2;
  const omgdot = -0.5*temp1*x1m5th +
    0.0625*temp2*(7 - 114*theta2 + 395*theta4) +
    temp3*(3 - 36*theta2 + 49*theta4);
  const xhdot1 = -temp1*cosio;
  const xnodot = xhdot1 +
    (0.5*temp2*(4 - 19*theta2) + 2*temp3*(3 - 7*theta2))*cosio;
  const omgcof = sat.bstar*c3*cos(sat.omegao);
  const xmcof = -2/3*coef*sat.bstar / eeta;
  const xnodcf = 3.5*betao2*xhdot1*c1;
  const t2cof = 1.5*c1;
  const xlcof = 0.125*a3ovk2*sinio*(3 + 5*cosio) / (1 + cosio);
  const aycof = 0.25*a3ovk2*sinio;
  const delmo = pow(1 + eta*cos(sat.xmo), 3);
  const sinmo = sin(sat.xmo);
  const x7thm1 = 7*theta2 - 1;

  let d2 = 0, d3 = 0, d4 = 0, t3cof = 0, t4cof = 0, t5cof = 0;
  if (isimp === 0) {
    const c1sq = c1*c1;
    d2 = 4*aodp*tsi*c1sq;
    const dt = d2*tsi*c1/3;
    d3 = (17*aodp + s4)*dt;
    d4 = 0.5*dt*aodp*tsi*(221*aodp + 31*s4)*c1;
    t3cof = d2 + 2*c1sq;
    t4cof = 0.25*(3*d3 + c1*(12*d2 + 10*c1sq));
    t5cof = 0.2*(3*d4 + 12*c1*d3 + 6*d2*d2 + 15*c1sq*(2*d2 + c1sq));
  }

  sat._sgp4 = {
    aodp, aycof, c1, c4, c5, cosio, d2, d3, d4,
    delmo, omgcof, eta, omgdot, sinio, xnodp, sinmo,
    t2cof, t3cof, t4cof, t5cof,
    x1mth2, x3thm1, x7thm1, xmcof, xmdot, xnodcf, xnodot, xlcof,
    isimp
  };
}

// Propagate satellite position and velocity.
// Dispatches to SGP4 (near-earth) or SDP4 (deep-space) based on sat.deep flag.
// tsince = minutes since TLE epoch.
// Returns { pos: [x,y,z], vel: [vx,vy,vz] }
// in Earth-radii and Earth-radii/min (TEME frame).
function sgp4Propagate(sat, tsince) {
  if (sat.deep) return sdp4Propagate(sat, tsince);
  if (!sat._sgp4) sgp4Init(sat);
  const p = sat._sgp4;

  // Secular gravity and atmospheric drag
  const xmdf = sat.xmo + p.xmdot*tsince;
  const omgadf = sat.omegao + p.omgdot*tsince;
  const xnoddf = sat.xnodeo + p.xnodot*tsince;
  let omega = omgadf;
  let xmp = xmdf;
  const tsq = tsince*tsince;
  let xnode = xnoddf + p.xnodcf*tsq;
  let tempa = 1 - p.c1*tsince;
  let tempe = sat.bstar*p.c4*tsince;
  let templ = p.t2cof*tsq;

  if (p.isimp === 0) {
    const delomg = p.omgcof*tsince;
    const delm = p.xmcof*(pow(1 + p.eta*cos(xmdf), 3) - p.delmo);
    const tmp = delomg + delm;
    xmp = xmdf + tmp;
    omega = omgadf - tmp;
    const tcube = tsq*tsince;
    const tfour = tsince*tcube;
    tempa -= p.d2*tsq + p.d3*tcube + p.d4*tfour;
    tempe += sat.bstar*p.c5*(sin(xmp) - p.sinmo);
    templ += p.t3cof*tcube + tfour*(p.t4cof + tsince*p.t5cof);
  }

  const a = p.aodp*tempa*tempa;
  const e = sat.eo - tempe;
  const xl = xmp + omega + xnode + p.xnodp*templ;
  const beta = sqrt(1 - e*e);
  const xn = SGP4_KE / pow(a, 1.5);

  // Long period periodics
  const axn = e*cos(omega);
  const tmp1 = 1 / (a*beta*beta);
  const xll = tmp1*p.xlcof*axn;
  const aynl = tmp1*p.aycof;
  const xlt = xl + xll;
  const ayn = e*sin(omega) + aynl;

  // Solve Kepler's equation
  const capu = sgp4Fmod2p(xlt - xnode);
  let epw = capu;
  let sinepw, cosepw, ecTmp3, ecTmp4, ecTmp5, ecTmp6;
  for (let i = 0; i <= 10; i++) {
    sinepw = sin(epw);
    cosepw = cos(epw);
    ecTmp3 = axn*sinepw;
    ecTmp4 = ayn*cosepw;
    ecTmp5 = axn*cosepw;
    ecTmp6 = ayn*sinepw;
    const epwNew = (capu - ecTmp4 + ecTmp3 - epw) / (1 - ecTmp5 - ecTmp6) + epw;
    if (abs(epwNew - epw) <= 1e-6) break;
    epw = epwNew;
  }

  // Short period preliminary quantities
  const ecose = ecTmp5 + ecTmp6;
  const esine = ecTmp3 - ecTmp4;
  const elsq = axn*axn + ayn*ayn;
  const pl = a*(1 - elsq);
  const r = a*(1 - ecose);
  const r1 = 1/r;
  const rdot = SGP4_KE*sqrt(a)*esine*r1;
  const rfdot = SGP4_KE*sqrt(pl)*r1;
  const betal = sqrt(1 - elsq);
  const btmp = 1 / (1 + betal);
  const ar = a*r1;
  const cosu = ar*(cosepw - axn + ayn*esine*btmp);
  const sinu = ar*(sinepw - ayn - axn*esine*btmp);
  const u = sgp4Actan(sinu, cosu);
  const sin2u = 2*sinu*cosu;
  const cos2u = 2*cosu*cosu - 1;
  const pl1 = 1/pl;
  const ck2pl = SGP4_CK2*pl1;
  const ck2pl2 = ck2pl*pl1;

  // Short period corrections
  const rk = r*(1 - 1.5*ck2pl2*betal*p.x3thm1) + 0.5*ck2pl*p.x1mth2*cos2u;
  const uk = u - 0.25*ck2pl2*p.x7thm1*sin2u;
  const xnodek = xnode + 1.5*ck2pl2*p.cosio*sin2u;
  const xinck = sat.xincl + 1.5*ck2pl2*p.cosio*p.sinio*cos2u;
  const rdotk = rdot - xn*ck2pl*p.x1mth2*sin2u;
  const rfdotk = rfdot + xn*ck2pl*(p.x1mth2*cos2u + 1.5*p.x3thm1);

  // Orientation vectors
  const sinuk = sin(uk), cosuk = cos(uk);
  const sinik = sin(xinck), cosik = cos(xinck);
  const sinnok = sin(xnodek), cosnok = cos(xnodek);
  const xmx = -sinnok*cosik;
  const xmy = cosnok*cosik;
  const ux = xmx*sinuk + cosnok*cosuk;
  const uy = xmy*sinuk + sinnok*cosuk;
  const uz = sinik*sinuk;
  const vx = xmx*cosuk - cosnok*sinuk;
  const vy = xmy*cosuk - sinnok*sinuk;
  const vz = sinik*cosuk;

  return {
    pos: [rk*ux, rk*uy, rk*uz],
    vel: [rdotk*ux + rfdotk*vx, rdotk*uy + rfdotk*vy, rdotk*uz + rfdotk*vz]
  };
}

// ---- SDP4 Deep-Space Orbit Propagator ----

// Greenwich sidereal angle from Julian Date epoch.
// Returns angle in radians and sets ds50 (days since 1950 Jan 0).
function sdp4Thetag(jdepoch) {
  const ds50 = jdepoch - 2433281.5;
  let theta = 1.72944494 + 6.3003880987 * ds50;
  theta = theta % TAU;
  if (theta < 0) theta += TAU;
  return { thgr: theta, ds50 };
}

// Initialize SDP4 deep-space model parameters.
function sdp4Init(sat) {
  const a1 = pow(SGP4_KE / sat.xno, 2/3);
  const cosio = cos(sat.xincl);
  const theta2 = cosio * cosio;
  const x3thm1 = 3*theta2 - 1;
  const eosq = sat.eo * sat.eo;
  const betao2 = 1 - eosq;
  const betao = sqrt(betao2);
  const del1 = 1.5*SGP4_CK2*x3thm1 / (a1*a1*betao*betao2);
  const ao = a1*(1 - del1*(1/3 + del1*(1 + 134/81*del1)));
  const delo = 1.5*SGP4_CK2*x3thm1 / (ao*ao*betao*betao2);
  const xnodp = sat.xno / (1 + delo);
  const aodp = ao / (1 - delo);

  let s4 = SGP4_S, qoms24 = SGP4_QOMS2T;
  const perige = (aodp*(1 - sat.eo) - 1)*SGP4_ER;
  if (perige < 156) {
    s4 = perige <= 98 ? 20 : perige - 78;
    qoms24 = pow((120 - s4) / SGP4_ER, 4);
    s4 = s4/SGP4_ER + 1;
  }

  const sinio = sin(sat.xincl);
  const pinvsq = 1 / (aodp*aodp*betao2*betao2);
  const sing = sin(sat.omegao);
  const cosg = cos(sat.omegao);
  const tsi = 1 / (aodp - s4);
  const eta = aodp*sat.eo*tsi;
  const etasq = eta*eta;
  const eeta = sat.eo*eta;
  const psisq = abs(1 - etasq);
  const coef = qoms24*pow(tsi, 4);
  const coef1 = coef / pow(psisq, 3.5);
  const c2 = coef1*xnodp*(aodp*(1 + 1.5*etasq + eeta*(4 + etasq)) +
    0.75*SGP4_CK2*tsi/psisq*x3thm1*(8 + 3*etasq*(8 + etasq)));
  const c1 = sat.bstar*c2;
  const x1mth2 = 1 - theta2;
  const c4 = 2*xnodp*coef1*aodp*betao2*(eta*(2 + 0.5*etasq) +
    sat.eo*(0.5 + 2*etasq) - 2*SGP4_CK2*tsi/(aodp*psisq)*
    (-3*x3thm1*(1 - 2*eeta + etasq*(1.5 - 0.5*eeta)) +
     0.75*x1mth2*(2*etasq - eeta*(1 + etasq))*cos(2*sat.omegao)));
  const theta4 = theta2*theta2;
  const temp1 = 3*SGP4_CK2*pinvsq*xnodp;
  const temp2 = temp1*SGP4_CK2*pinvsq;
  const temp3 = 1.25*SGP4_CK4*pinvsq*pinvsq*xnodp;
  const xmdot = xnodp + 0.5*temp1*betao*x3thm1 +
    0.0625*temp2*betao*(13 - 78*theta2 + 137*theta4);
  const x1m5th = 1 - 5*theta2;
  const omgdot = -0.5*temp1*x1m5th +
    0.0625*temp2*(7 - 114*theta2 + 395*theta4) +
    temp3*(3 - 36*theta2 + 49*theta4);
  const xhdot1 = -temp1*cosio;
  const xnodot = xhdot1 +
    (0.5*temp2*(4 - 19*theta2) + 2*temp3*(3 - 7*theta2))*cosio;
  const a3ovk2 = -SGP4_J3 / SGP4_CK2;
  const xnodcf = 3.5*betao2*xhdot1*c1;
  const t2cof = 1.5*c1;
  const xlcof = 0.125*a3ovk2*sinio*(3 + 5*cosio) / (1 + cosio);
  const aycof = 0.25*a3ovk2*sinio;
  const x7thm1 = 7*theta2 - 1;

  // Deep-space initialization (dpinit)
  const tg = sdp4Thetag(sat.epoch);
  let thgr = tg.thgr;
  const eq = sat.eo;
  const xnq = xnodp;
  const aqnv = 1/aodp;
  const xqncl = sat.xincl;
  const xmao = sat.xmo;
  const xpidot = omgdot + xnodot;
  const sinq = sin(sat.xnodeo);
  const cosq = cos(sat.xnodeo);
  const omegaq = sat.omegao;

  // Lunar solar terms
  const day = tg.ds50 + 18261.5;
  const xnodce = 4.5236020 - 9.2422029e-4*day;
  const stem = sin(xnodce);
  const ctem = cos(xnodce);
  const zcosil = 0.91375164 - 0.03568096*ctem;
  const zsinil = sqrt(1 - zcosil*zcosil);
  const zsinhl = 0.089683511*stem / zsinil;
  const zcoshl = sqrt(1 - zsinhl*zsinhl);
  const cDay = 4.7199672 + 0.22997150*day;
  const gam = 5.8351514 + 0.0019443680*day;
  const zmol = sgp4Fmod2p(cDay - gam);
  let zx = 0.39785416*stem / zsinil;
  let zy = zcoshl*ctem + 0.91744867*zsinhl*stem;
  zx = sgp4Actan(zx, zy);
  zx = gam + zx - xnodce;
  const zcosgl = cos(zx);
  const zsingl = sin(zx);
  const zmos = sgp4Fmod2p(6.2565837 + 0.017201977*day);

  // Solar and lunar perturbation coefficients (two-pass loop)
  let sse, ssi, ssl, ssg, ssh;
  let ee2, e3, xi2, xi3, xl2, xl3, xl4, xgh2, xgh3, xgh4, xh2, xh3;
  let se2, si2, sl2, sgh2, sh2, se3, si3, sl3, sgh3, sh3, sl4, sgh4;

  let zcosg = ZCOSGS, zsing = ZSINGS, zcosi = ZCOSIS, zsini = ZSINIS;
  let zcosh = cosq, zsinh = sinq;
  let cc = C1SS, zn = ZNS, ze = ZES, zmo = zmos;
  const xnoi = 1/xnq;

  for (let ls = 0; ; ) {
    const a1L = zcosg*zcosh + zsing*zcosi*zsinh;
    const a3L = -zsing*zcosh + zcosg*zcosi*zsinh;
    const a7L = -zcosg*zsinh + zsing*zcosi*zcosh;
    const a8L = zsing*zsini;
    const a9L = zsing*zsinh + zcosg*zcosi*zcosh;
    const a10L = zcosg*zsini;
    const a2L = cosio*a7L + sinio*a8L;
    const a4L = cosio*a9L + sinio*a10L;
    const a5L = -sinio*a7L + cosio*a8L;
    const a6L = -sinio*a9L + cosio*a10L;
    const x1L = a1L*cosg + a2L*sing;
    const x2L = a3L*cosg + a4L*sing;
    const x3L = -a1L*sing + a2L*cosg;
    const x4L = -a3L*sing + a4L*cosg;
    const x5L = a5L*sing;
    const x6L = a6L*sing;
    const x7L = a5L*cosg;
    const x8L = a6L*cosg;
    const z31L = 12*x1L*x1L - 3*x3L*x3L;
    const z32L = 24*x1L*x2L - 6*x3L*x4L;
    const z33L = 12*x2L*x2L - 3*x4L*x4L;
    const z1L = 3*(a1L*a1L + a2L*a2L) + z31L*eosq;
    const z2L = 6*(a1L*a3L + a2L*a4L) + z32L*eosq;
    const z3L = 3*(a3L*a3L + a4L*a4L) + z33L*eosq;
    const z11L = -6*a1L*a5L + eosq*(-24*x1L*x7L - 6*x3L*x5L);
    const z12L = -6*(a1L*a6L + a3L*a5L) + eosq*(-24*(x2L*x7L + x1L*x8L) - 6*(x3L*x6L + x4L*x5L));
    const z13L = -6*a3L*a6L + eosq*(-24*x2L*x8L - 6*x4L*x6L);
    const z21L = 6*a2L*a5L + eosq*(24*x1L*x5L - 6*x3L*x7L);
    const z22L = 6*(a4L*a5L + a2L*a6L) + eosq*(24*(x2L*x5L + x1L*x6L) - 6*(x4L*x7L + x3L*x8L));
    const z23L = 6*a4L*a6L + eosq*(24*x2L*x6L - 6*x4L*x8L);
    const bz1 = z1L + z1L + betao2*z31L;
    const bz2 = z2L + z2L + betao2*z32L;
    const bz3 = z3L + z3L + betao2*z33L;
    const s3 = cc*xnoi;
    const s2 = -0.5*s3 / betao;
    const sn4 = s3*betao;
    const s1 = -15*eq*sn4;
    const s5 = x1L*x3L + x2L*x4L;
    const s6 = x2L*x3L + x1L*x4L;
    const s7 = x2L*x4L - x1L*x3L;
    const se = s1*zn*s5;
    const si = s2*zn*(z11L + z13L);
    const sl = -zn*s3*(bz1 + bz3 - 14 - 6*eosq);
    const sgh = sn4*zn*(z31L + z33L - 6);
    let sh = -zn*s2*(z21L + z23L);
    if (xqncl < 5.2359877e-2) sh = 0;
    const lee2 = 2*s1*s6;
    const le3 = 2*s1*s7;
    const lxi2 = 2*s2*z12L;
    const lxi3 = 2*s2*(z13L - z11L);
    const lxl2 = -2*s3*bz2;
    const lxl3 = -2*s3*(bz3 - bz1);
    const lxl4 = -2*s3*(-21 - 9*eosq)*ze;
    const lxgh2 = 2*sn4*z32L;
    const lxgh3 = 2*sn4*(z33L - z31L);
    const lxgh4 = -18*sn4*ze;
    const lxh2 = -2*s2*z22L;
    const lxh3 = -2*s2*(z23L - z21L);

    if (ls === 1) {
      // Second pass (lunar terms added)
      ee2 = lee2; e3 = le3; xi2 = lxi2; xi3 = lxi3;
      xl2 = lxl2; xl3 = lxl3; xl4 = lxl4;
      xgh2 = lxgh2; xgh3 = lxgh3; xgh4 = lxgh4;
      xh2 = lxh2; xh3 = lxh3;
      sse = sse + se;
      ssi = ssi + si;
      ssl = ssl + sl;
      ssg = ssg + sgh - cosio/sinio*sh;
      ssh = ssh + sh/sinio;
      break;
    }

    // Save solar terms, set up for lunar pass
    sse = se; ssi = si; ssl = sl;
    ssh = sh/sinio;
    ssg = sgh - cosio*ssh;
    se2 = lee2; si2 = lxi2; sl2 = lxl2; sgh2 = lxgh2; sh2 = lxh2;
    se3 = le3; si3 = lxi3; sl3 = lxl3; sgh3 = lxgh3; sh3 = lxh3;
    sl4 = lxl4; sgh4 = lxgh4;
    zcosg = zcosgl; zsing = zsingl; zcosi = zcosil; zsini = zsinil;
    zcosh = zcoshl*cosq + zsinhl*sinq;
    zsinh = sinq*zcoshl - cosq*zsinhl;
    zn = ZNL; cc = C1L; ze = ZEL; zmo = zmol;
    ls = 1;
  }

  // Geopotential resonance initialization
  let iresfl = 0, isynfl = 0;
  let d2201 = 0, d2211 = 0, d3210 = 0, d3222 = 0, d4410 = 0, d4422 = 0;
  let d5220 = 0, d5232 = 0, d5421 = 0, d5433 = 0;
  let rdel1 = 0, rdel2 = 0, rdel3 = 0;
  let fasx2 = 0, fasx4 = 0, fasx6 = 0;
  let xlamo = 0, xfact = 0, xli, xni;
  let bfact = 0;

  const isSynchronous = xnq < 0.0052359877 && xnq > 0.0034906585;
  const is12Hour = xnq >= 0.00826 && xnq <= 0.00924 && eq >= 0.5;

  if (isSynchronous) {
    // Synchronous resonance (~24h orbit, e.g. GEO)
    iresfl = 1;
    isynfl = 1;
    const g200 = 1 + eosq*(-2.5 + 0.8125*eosq);
    const g310 = 1 + 2*eosq;
    const g300 = 1 + eosq*(-6 + 6.60937*eosq);
    const f220 = 0.75*(1 + cosio)*(1 + cosio);
    const f311 = 0.9375*sinio*sinio*(1 + 3*cosio) - 0.75*(1 + cosio);
    let f330 = 1 + cosio;
    f330 = 1.875*f330*f330*f330;
    let sdel1 = 3*xnq*xnq*aqnv*aqnv;
    rdel2 = 2*sdel1*f220*g200*Q22;
    rdel3 = 3*sdel1*f330*g300*Q33*aqnv;
    rdel1 = sdel1*f311*g310*Q31*aqnv;
    fasx2 = 0.13130908;
    fasx4 = 2.8843198;
    fasx6 = 0.37448087;
    xlamo = xmao + sat.xnodeo + sat.omegao - thgr;
    bfact = xmdot + xpidot - SGP4_THDT;
    bfact = bfact + ssl + ssg + ssh;
  } else if (is12Hour) {
    // 12-hour resonance (e.g. Molniya)
    iresfl = 1;
    const eoc = eq*eosq;
    let g201, g211, g310, g322, g410, g422, g520, g521, g532, g533;
    g201 = -0.306 - (eq - 0.64)*0.440;
    if (eq <= 0.65) {
      g211 = 3.616 - 13.247*eq + 16.290*eosq;
      g310 = -19.302 + 117.390*eq - 228.419*eosq + 156.591*eoc;
      g322 = -18.9068 + 109.7927*eq - 214.6334*eosq + 146.5816*eoc;
      g410 = -41.122 + 242.694*eq - 471.094*eosq + 313.953*eoc;
      g422 = -146.407 + 841.880*eq - 1629.014*eosq + 1083.435*eoc;
      g520 = -532.114 + 3017.977*eq - 5740*eosq + 3708.276*eoc;
    } else {
      g211 = -72.099 + 331.819*eq - 508.738*eosq + 266.724*eoc;
      g310 = -346.844 + 1582.851*eq - 2415.925*eosq + 1246.113*eoc;
      g322 = -342.585 + 1554.908*eq - 2366.899*eosq + 1215.972*eoc;
      g410 = -1052.797 + 4758.686*eq - 7193.992*eosq + 3651.957*eoc;
      g422 = -3581.69 + 16178.11*eq - 24462.77*eosq + 12422.52*eoc;
      g520 = eq <= 0.715 ? 1464.74 - 4664.75*eq + 3763.64*eosq
        : -5149.66 + 29936.92*eq - 54087.36*eosq + 31324.56*eoc;
    }
    if (eq < 0.7) {
      g533 = -919.2277 + 4988.61*eq - 9064.77*eosq + 5542.21*eoc;
      g521 = -822.71072 + 4568.6173*eq - 8491.4146*eosq + 5337.524*eoc;
      g532 = -853.666 + 4690.25*eq - 8624.77*eosq + 5341.4*eoc;
    } else {
      g533 = -37995.78 + 161616.52*eq - 229838.2*eosq + 109377.94*eoc;
      g521 = -51752.104 + 218913.95*eq - 309468.16*eosq + 146349.42*eoc;
      g532 = -40023.88 + 170470.89*eq - 242699.48*eosq + 115605.82*eoc;
    }
    const sini2 = sinio*sinio;
    const f220 = 0.75*(1 + 2*cosio + theta2);
    const f221 = 1.5*sini2;
    const f321 = 1.875*sinio*(1 - 2*cosio - 3*theta2);
    const f322 = -1.875*sinio*(1 + 2*cosio - 3*theta2);
    const f441 = 35*sini2*f220;
    const f442 = 39.3750*sini2*sini2;
    const f522 = 9.84375*sinio*(sini2*(1 - 2*cosio - 5*theta2) +
      0.33333333*(-2 + 4*cosio + 6*theta2));
    const f523 = sinio*(4.92187512*sini2*(-2 - 4*cosio + 10*theta2) +
      6.56250012*(1 + 2*cosio - 3*theta2));
    const f542 = 29.53125*sinio*(2 - 8*cosio + theta2*(-12 + 8*cosio + 10*theta2));
    const f543 = 29.53125*sinio*(-2 - 8*cosio + theta2*(12 + 8*cosio - 10*theta2));
    const xno2 = xnq*xnq;
    const ainv2 = aqnv*aqnv;
    let rtemp1 = 3*xno2*ainv2;
    let rtemp = rtemp1*ROOT22;
    d2201 = rtemp*f220*g201;
    d2211 = rtemp*f221*g211;
    rtemp1 *= aqnv;
    rtemp = rtemp1*ROOT32;
    d3210 = rtemp*f321*g310;
    d3222 = rtemp*f322*g322;
    rtemp1 *= aqnv;
    rtemp = 2*rtemp1*ROOT44;
    d4410 = rtemp*f441*g410;
    d4422 = rtemp*f442*g422;
    rtemp1 *= aqnv;
    rtemp = rtemp1*ROOT52;
    d5220 = rtemp*f522*g520;
    d5232 = rtemp*f523*g532;
    rtemp = 2*rtemp1*ROOT54;
    d5421 = rtemp*f542*g521;
    d5433 = rtemp*f543*g533;
    xlamo = xmao + sat.xnodeo + sat.xnodeo - thgr - thgr;
    bfact = xmdot + xnodot + xnodot - SGP4_THDT - SGP4_THDT;
    bfact = bfact + ssl + ssh + ssh;
  }

  xfact = bfact - xnq;
  xli = xlamo;
  xni = xnq;

  sat._sdp4 = {
    x3thm1, c1, x1mth2, c4, xnodcf, t2cof, xlcof, aycof, x7thm1,
    // deep-space state
    cosio, sinio, theta2, eosq, betao, betao2, aodp, xnodp: xnq,
    xmdot, omgdot, xnodot, sing, cosg,
    sse, ssi, ssl, ssg, ssh,
    ee2, e3, xi2, xi3, xl2, xl3, xl4, xgh2, xgh3, xgh4, xh2, xh3,
    se2, si2, sl2, sgh2, sh2, se3, si3, sl3, sgh3, sh3, sl4, sgh4,
    iresfl, isynfl,
    d2201, d2211, d3210, d3222, d4410, d4422, d5220, d5232, d5421, d5433,
    del1: rdel1, del2: rdel2, del3: rdel3,
    fasx2, fasx4, fasx6,
    xlamo, xfact, xli, xni,
    atime: 0, stepp: 720, stepn: -720, step2: 259200,
    thgr, xnq: xnq, xqncl: xqncl, omegaq,
    zmol, zmos, savtsn: 1e20,
    sghs: 0, sghl: 0, sh1: 0, pinc: 0, pe: 0, shs: 0,
    zsingl, zcosgl, zsinhl, zcoshl, zsinil, zcosil
  };
}

// Deep-space secular effects (dpsec).
function sdp4Secular(dp, tsince) {
  dp.xll += dp.ssl*tsince;
  dp.omgadf += dp.ssg*tsince;
  dp.xnode += dp.ssh*tsince;
  dp.em += dp.sse*tsince;
  dp.xinc += dp.ssi*tsince;
  if (dp.xinc < 0) {
    dp.xinc = -dp.xinc;
    dp.xnode += PI;
    dp.omgadf -= PI;
  }

  if (dp.iresfl === 0) return;

  let {atime, xni, xli, stepp, stepn, step2} = dp;
  let delt, ft;

  outer: do {
    if (atime === 0 || (tsince >= 0 && atime < 0) || (tsince < 0 && atime >= 0)) {
      delt = tsince >= 0 ? stepp : stepn;
      atime = 0;
      xni = dp.xnq;
      xli = dp.xlamo;
    } else {
      if (abs(tsince) >= abs(atime))
        delt = tsince > 0 ? stepp : stepn;
    }

    for (;;) {
      let dl, er;
      if (abs(tsince - atime) >= stepp) {
        dl = 1; er = 0;
      } else {
        ft = tsince - atime;
        dl = 0; er = 0;
      }

      if (abs(tsince) < abs(atime)) {
        delt = tsince >= 0 ? stepn : stepp;
        dl = 1; er = 1;
      }

      let xndot, xnddt;
      if (dp.isynfl) {
        xndot = dp.del1*sin(xli - dp.fasx2) + dp.del2*sin(2*(xli - dp.fasx4)) +
                dp.del3*sin(3*(xli - dp.fasx6));
        xnddt = dp.del1*cos(xli - dp.fasx2) + 2*dp.del2*cos(2*(xli - dp.fasx4)) +
                3*dp.del3*cos(3*(xli - dp.fasx6));
      } else {
        const xomi = dp.omegaq + dp.omgdot*atime;
        const x2omi = xomi + xomi;
        const x2li = xli + xli;
        xndot = dp.d2201*sin(x2omi + xli - G22) + dp.d2211*sin(xli - G22) +
                dp.d3210*sin(xomi + xli - G32) + dp.d3222*sin(-xomi + xli - G32) +
                dp.d4410*sin(x2omi + x2li - G44) + dp.d4422*sin(x2li - G44) +
                dp.d5220*sin(xomi + xli - G52) + dp.d5232*sin(-xomi + xli - G52) +
                dp.d5421*sin(xomi + x2li - G54) + dp.d5433*sin(-xomi + x2li - G54);
        xnddt = dp.d2201*cos(x2omi + xli - G22) + dp.d2211*cos(xli - G22) +
                dp.d3210*cos(xomi + xli - G32) + dp.d3222*cos(-xomi + xli - G32) +
                dp.d5220*cos(xomi + xli - G52) + dp.d5232*cos(-xomi + xli - G52) +
                2*(dp.d4410*cos(x2omi + x2li - G44) + dp.d4422*cos(x2li - G44) +
                   dp.d5421*cos(xomi + x2li - G54) + dp.d5433*cos(-xomi + x2li - G54));
      }

      const xldot = xni + dp.xfact;
      xnddt = xnddt*xldot;

      if (dl === 1) {
        xli = xli + xldot*delt + xndot*step2;
        xni = xni + xndot*delt + xnddt*step2;
        atime = atime + delt;
        if (er === 1) continue outer;
        continue;
      }

      // dl === 0: done integrating
      dp.xn = xni + xndot*ft + xnddt*ft*ft*0.5;
      const xl = xli + xldot*ft + xndot*ft*ft*0.5;
      const temp = -dp.xnode + dp.thgr + tsince*SGP4_THDT;
      dp.xll = dp.isynfl === 0 ? xl + temp + temp : xl - dp.omgadf + temp;
      dp.atime = atime;
      dp.xni = xni;
      dp.xli = xli;
      return;
    }
  } while (true);
}

// Deep-space periodic effects (dpper).
function sdp4Periodic(dp, sat) {
  const sinis = sin(dp.xinc);
  const cosis = cos(dp.xinc);

  if (abs(dp.savtsn - dp.t) >= 30) {
    dp.savtsn = dp.t;
    let zm = dp.zmos + ZNS*dp.t;
    let zf = zm + 2*ZES*sin(zm);
    let sinzf = sin(zf);
    let f2 = 0.5*sinzf*sinzf - 0.25;
    let f3 = -0.5*sinzf*cos(zf);
    const ses = dp.se2*f2 + dp.se3*f3;
    const sis = dp.si2*f2 + dp.si3*f3;
    const sls = dp.sl2*f2 + dp.sl3*f3 + dp.sl4*sinzf;
    dp.sghs = dp.sgh2*f2 + dp.sgh3*f3 + dp.sgh4*sinzf;
    dp.shs = dp.sh2*f2 + dp.sh3*f3;
    zm = dp.zmol + ZNL*dp.t;
    zf = zm + 2*ZEL*sin(zm);
    sinzf = sin(zf);
    f2 = 0.5*sinzf*sinzf - 0.25;
    f3 = -0.5*sinzf*cos(zf);
    const sel = dp.ee2*f2 + dp.e3*f3;
    const sil = dp.xi2*f2 + dp.xi3*f3;
    const sll = dp.xl2*f2 + dp.xl3*f3 + dp.xl4*sinzf;
    dp.sghl = dp.xgh2*f2 + dp.xgh3*f3 + dp.xgh4*sinzf;
    dp.sh1 = dp.xh2*f2 + dp.xh3*f3;
    dp.pe = ses + sel;
    dp.pinc = sis + sil;
    dp.pl = sls + sll;
  }

  const pgh = dp.sghs + dp.sghl;
  const ph = dp.shs + dp.sh1;
  dp.xinc = dp.xinc + dp.pinc;
  dp.em = dp.em + dp.pe;

  if (dp.xqncl >= 0.2) {
    const phr = ph / dp.sinio;
    const pghr = pgh - dp.cosio*phr;
    dp.omgadf = dp.omgadf + pghr;
    dp.xnode = dp.xnode + phr;
    dp.xll = dp.xll + dp.pl;
  } else {
    // Lyddane modification
    const sinok = sin(dp.xnode);
    const cosok = cos(dp.xnode);
    let alfdp = sinis*sinok;
    let betdp = sinis*cosok;
    alfdp = alfdp + ph*cosok + dp.pinc*cosis*sinok;
    betdp = betdp - ph*sinok + dp.pinc*cosis*cosok;
    dp.xnode = sgp4Fmod2p(dp.xnode);
    const xls = dp.xll + dp.omgadf + cosis*dp.xnode;
    const dls = dp.pl + pgh - dp.pinc*dp.xnode*sinis;
    const xnoh = dp.xnode;
    dp.xnode = sgp4Actan(alfdp, betdp);
    if (abs(xnoh - dp.xnode) > PI) {
      dp.xnode += dp.xnode < xnoh ? TAU : -TAU;
    }
    dp.xll = dp.xll + dp.pl;
    dp.omgadf = xls + dls - dp.xll - cos(dp.xinc)*dp.xnode;
  }
}

// Propagate deep-space satellite using SDP4.
function sdp4Propagate(sat, tsince) {
  if (!sat._sdp4) sdp4Init(sat);
  const p = sat._sdp4;

  // Secular gravity and atmospheric drag
  const xmdf = sat.xmo + p.xmdot*tsince;
  const xnoddf = sat.xnodeo + p.xnodot*tsince;
  const tsq = tsince*tsince;
  const tempa = 1 - p.c1*tsince;
  const tempe = sat.bstar*p.c4*tsince;
  const templ = p.t2cof*tsq;

  // Set up deep-space working state
  const dp = {
    xll: xmdf,
    omgadf: sat.omegao + p.omgdot*tsince,
    xnode: xnoddf + p.xnodcf*tsq,
    em: sat.eo,
    xinc: sat.xincl,
    xn: p.xnodp,
    t: tsince,
    // Carry all deep-space params
    ssl: p.ssl, ssg: p.ssg, ssh: p.ssh, sse: p.sse, ssi: p.ssi,
    iresfl: p.iresfl, isynfl: p.isynfl,
    xnq: p.xnq, xqncl: p.xqncl, omegaq: p.omegaq,
    omgdot: p.omgdot, xfact: p.xfact,
    xlamo: p.xlamo, thgr: p.thgr,
    del1: p.del1, del2: p.del2, del3: p.del3,
    fasx2: p.fasx2, fasx4: p.fasx4, fasx6: p.fasx6,
    d2201: p.d2201, d2211: p.d2211, d3210: p.d3210, d3222: p.d3222,
    d4410: p.d4410, d4422: p.d4422, d5220: p.d5220, d5232: p.d5232,
    d5421: p.d5421, d5433: p.d5433,
    atime: p.atime, xni: p.xni, xli: p.xli,
    stepp: p.stepp, stepn: p.stepn, step2: p.step2,
    xnodp: p.xnodp,
    // Periodic terms
    se2: p.se2, si2: p.si2, sl2: p.sl2, sgh2: p.sgh2, sh2: p.sh2,
    se3: p.se3, si3: p.si3, sl3: p.sl3, sgh3: p.sgh3, sh3: p.sh3,
    sl4: p.sl4, sgh4: p.sgh4,
    ee2: p.ee2, e3: p.e3, xi2: p.xi2, xi3: p.xi3,
    xl2: p.xl2, xl3: p.xl3, xl4: p.xl4,
    xgh2: p.xgh2, xgh3: p.xgh3, xgh4: p.xgh4, xh2: p.xh2, xh3: p.xh3,
    zmol: p.zmol, zmos: p.zmos, savtsn: p.savtsn,
    sghs: p.sghs, sghl: p.sghl, sh1: p.sh1,
    pinc: p.pinc, pe: p.pe, shs: p.shs, pl: p.pl,
    cosio: p.cosio, sinio: p.sinio,
    zsingl: p.zsingl, zcosgl: p.zcosgl,
    zsinhl: p.zsinhl, zcoshl: p.zcoshl,
    zsinil: p.zsinil, zcosil: p.zcosil
  };

  // Deep-space secular effects
  sdp4Secular(dp, tsince);

  const xmdf2 = dp.xll;
  const a = pow(SGP4_KE / dp.xn, 2/3)*tempa*tempa;
  dp.em = dp.em - tempe;
  let xmam = xmdf2 + p.xnodp*templ;

  // Deep-space periodic effects
  dp.xll = xmam;
  sdp4Periodic(dp, sat);
  xmam = dp.xll;

  const xl = xmam + dp.omgadf + dp.xnode;
  const beta = sqrt(1 - dp.em*dp.em);
  dp.xn = SGP4_KE / pow(a, 1.5);

  // Long period periodics
  const axn = dp.em*cos(dp.omgadf);
  const tmp1 = 1 / (a*beta*beta);
  const xll = tmp1*p.xlcof*axn;
  const aynl = tmp1*p.aycof;
  const xlt = xl + xll;
  const ayn = dp.em*sin(dp.omgadf) + aynl;

  // Solve Kepler's equation
  const capu = sgp4Fmod2p(xlt - dp.xnode);
  let epw = capu;
  let sinepw, cosepw, ecTmp3, ecTmp4, ecTmp5, ecTmp6;
  for (let i = 0; i <= 10; i++) {
    sinepw = sin(epw);
    cosepw = cos(epw);
    ecTmp3 = axn*sinepw;
    ecTmp4 = ayn*cosepw;
    ecTmp5 = axn*cosepw;
    ecTmp6 = ayn*sinepw;
    const epwNew = (capu - ecTmp4 + ecTmp3 - epw) / (1 - ecTmp5 - ecTmp6) + epw;
    if (abs(epwNew - epw) <= 1e-6) break;
    epw = epwNew;
  }

  // Short period preliminary quantities
  const ecose = ecTmp5 + ecTmp6;
  const esine = ecTmp3 - ecTmp4;
  const elsq = axn*axn + ayn*ayn;
  const pl = a*(1 - elsq);
  const r = a*(1 - ecose);
  const r1 = 1/r;
  const rdot = SGP4_KE*sqrt(a)*esine*r1;
  const rfdot = SGP4_KE*sqrt(pl)*r1;
  const betal = sqrt(1 - elsq);
  const btmp = 1 / (1 + betal);
  const ar = a*r1;
  const cosu = ar*(cosepw - axn + ayn*esine*btmp);
  const sinu = ar*(sinepw - ayn - axn*esine*btmp);
  const u = sgp4Actan(sinu, cosu);
  const sin2u = 2*sinu*cosu;
  const cos2u = 2*cosu*cosu - 1;
  const pl1 = 1/pl;
  const ck2pl = SGP4_CK2*pl1;
  const ck2pl2 = ck2pl*pl1;

  // Short period corrections
  const rk = r*(1 - 1.5*ck2pl2*betal*p.x3thm1) + 0.5*ck2pl*p.x1mth2*cos2u;
  const uk = u - 0.25*ck2pl2*p.x7thm1*sin2u;
  const xnodek = dp.xnode + 1.5*ck2pl2*dp.cosio*sin2u;
  const xinck = dp.xinc + 1.5*ck2pl2*dp.cosio*dp.sinio*cos2u;
  const rdotk = rdot - dp.xn*ck2pl*p.x1mth2*sin2u;
  const rfdotk = rfdot + dp.xn*ck2pl*(p.x1mth2*cos2u + 1.5*p.x3thm1);

  // Orientation vectors
  const sinuk = sin(uk), cosuk = cos(uk);
  const sinik = sin(xinck), cosik = cos(xinck);
  const sinnok = sin(xnodek), cosnok = cos(xnodek);
  const xmx = -sinnok*cosik;
  const xmy = cosnok*cosik;
  const ux = xmx*sinuk + cosnok*cosuk;
  const uy = xmy*sinuk + sinnok*cosuk;
  const uz = sinik*sinuk;
  const vx = xmx*cosuk - cosnok*sinuk;
  const vy = xmy*cosuk - sinnok*sinuk;
  const vz = sinik*cosuk;

  // Save mutable deep-space integrator state back
  p.atime = dp.atime;
  p.xni = dp.xni;
  p.xli = dp.xli;
  p.savtsn = dp.savtsn;
  p.sghs = dp.sghs;
  p.sghl = dp.sghl;
  p.sh1 = dp.sh1;
  p.pinc = dp.pinc;
  p.pe = dp.pe;
  p.shs = dp.shs;
  p.pl = dp.pl;

  return {
    pos: [rk*ux, rk*uy, rk*uz],
    vel: [rdotk*ux + rfdotk*vx, rdotk*uy + rfdotk*vy, rdotk*uz + rfdotk*vz]
  };
}
