// Parse MPC comet and asteroid orbital element files.
// Comet format: Soft00Cmt (Ephemerides and Orbital Elements export)
// Asteroid format: MPCORB (Soft00Ast / Soft00Bright)

// Decode MPC packed epoch (e.g. "K2669") to {y, m, d}.
// Century: I=1800, J=1900, K=2000. Month: 1-9,A=10,B=11,C=12.
// Day: 1-9,A=10,...,V=31.
function mpcUnpackEpoch(s) {
  const centuryCode = s.charAt(0);
  const century = centuryCode === 'I' ? 1800 : centuryCode === 'J' ? 1900 : 2000;
  const y = century + parseInt(s.substring(1, 3), 10);
  const mc = s.charAt(3);
  const m = mc >= '1' && mc <= '9' ? parseInt(mc) : mc.charCodeAt(0) - 55;
  const dc = s.charAt(4);
  const d = dc >= '1' && dc <= '9' ? parseInt(dc) : dc.charCodeAt(0) - 55;
  return { y, m, d };
}

// Parse MPC comet file (Soft00Cmt format).
// Returns array of {name, Ty, Tm, Td, q, e, w, node, inc, H, k}.
// All angles in degrees; q in AU; Td is fractional day of perihelion.
function parseMPCComets(text) {
  const comets = [];
  for (const line of text.split('\n')) {
    if (line.length < 102) continue;
    const Ty = parseInt(line.substring(14, 18));
    if (isNaN(Ty)) continue;
    comets.push({
      name: line.substring(102, 158).trim(),
      Ty,
      Tm:   parseInt(line.substring(19, 21)),
      Td:   parseFloat(line.substring(22, 29)),
      q:    parseFloat(line.substring(30, 39)),
      e:    parseFloat(line.substring(41, 49)),
      w:    parseFloat(line.substring(51, 59)),
      node: parseFloat(line.substring(61, 69)),
      inc:  parseFloat(line.substring(71, 79)),
      H:    parseFloat(line.substring(91, 95)),
      k:    parseFloat(line.substring(96, 100)),
    });
  }
  return comets;
}

// Parse MPC asteroid file (MPCORB format, e.g. Soft00Ast / Soft00Bright).
// Skips the header block. Returns array of
// {name, epoch{y,m,d}, M, w, node, inc, e, n, a, H, G}.
// All angles in degrees; a in AU; n in deg/day.
function parseMPCAsteroids(text) {
  const asteroids = [];
  let inData = false;
  for (const line of text.split('\n')) {
    if (!inData) {
      if (line.startsWith('------')) inData = true;
      continue;
    }
    if (line.length < 103) continue;
    const H = parseFloat(line.substring(8, 13));
    if (isNaN(H)) continue;
    const epochStr = line.substring(20, 25).trim();
    asteroids.push({
      name:  line.substring(166, 194).trim(),
      epoch: mpcUnpackEpoch(epochStr),
      M:     parseFloat(line.substring(26, 35)),
      w:     parseFloat(line.substring(37, 46)),
      node:  parseFloat(line.substring(48, 57)),
      inc:   parseFloat(line.substring(59, 68)),
      e:     parseFloat(line.substring(70, 79)),
      n:     parseFloat(line.substring(80, 91)),
      a:     parseFloat(line.substring(92, 103)),
      H,
      G:     parseFloat(line.substring(14, 19)),
    });
  }
  return asteroids;
}
