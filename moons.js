// Planetary moon positions from ESAA 3rd Ed. Chapter 9.
// Each function returns an array of {name, x, y, z} where x,y,z are
// planetocentric J2000 equatorial coordinates in AU.

// B1950 → J2000 frame tie matrix (Standish 1982, USNO Circ. 163)
const mB1950J2000 = [
  0.9999256794956877, -0.0111814832204662, -0.0048590038153592,
  0.0111814832391717,  0.9999374848933135, -0.0000271625947142,
  0.0048590037723143, -0.0000271702937440,  0.9999881946023742
];

const epsB1950 = 23.4457889 * DEG;

// Standard orbit→reference-frame position from argument of latitude u,
// ascending node Omega (from ref frame x-axis), and inclination inc.
function orbitPosition(r, u, inc, omega) {
  return [
    r * (cos(omega)*cos(u) - sin(omega)*sin(u)*cos(inc)),
    r * (sin(omega)*cos(u) + cos(omega)*sin(u)*cos(inc)),
    r * sin(u) * sin(inc)
  ];
}

// ---- Mars moons (ESAA3 §9.7, Sinclair 1989) ----
// Elements are absolute longitudes; reference plane ≈ Mars equator.
// Matrix Rz(na)*Rx(ja) converts from Laplacian plane to equatorial (J2000).

function marsMoons(jd) {
  const d = jd - 2441266.5;
  const yr = d / 365.25;
  const moons = [];

  // Phobos
  {
    const na = (47.39 - 0.0014 * yr) * DEG;
    const ja = (37.27 + 0.0008 * yr) * DEG;
    const a = 6.26974e-5;
    const e = 0.0150;
    const gamma = 1.10 * DEG;
    const theta = ((327.90 - 0.43533 * d) % 360) * DEG;
    const P = ((278.96 + 0.43526 * d) % 360) * DEG;
    const l = ((232.41 + 1128.844556 * d + 0.00124 * yr * yr) % 360) * DEG;
    const M = l - P;
    const E = solveKepler(((M % TAU) + TAU) % TAU, e);
    const f = trueAnomaly(E, e);
    const r = a * (1 - e * e) / (1 + e * cos(f));
    const u = f + P - na;
    const xp = r * cos(u);
    const yp = r * sin(u) * cos(gamma);
    const zp = r * sin(u) * sin(gamma);
    const m = mmul(rz(na), rx(ja));
    const [x, y, z] = mvmul(m, xp, yp, zp);
    moons.push({name: 'Phobos', x, y, z});
  }

  // Deimos
  {
    const na = (46.37 - 0.0014 * yr) * DEG;
    const ja = (36.62 + 0.0008 * yr) * DEG;
    const a = 1.56828e-4;
    const e = 0.0004;
    const gamma = 1.79 * DEG;
    const h = ((196.55 - 0.01801 * d) % 360) * DEG;
    const theta = ((240.38 - 0.01801 * d) % 360) * DEG;
    const P = ((111.7 + 0.01798 * d) % 360) * DEG;
    const l = ((28.96 + 285.161888 * d - 0.27 * sin(h)) % 360) * DEG;
    const M = l - P;
    const E = solveKepler(((M % TAU) + TAU) % TAU, e);
    const f = trueAnomaly(E, e);
    const r = a * (1 - e * e) / (1 + e * cos(f));
    const u = f + P - na;
    const xp = r * cos(u);
    const yp = r * sin(u) * cos(gamma);
    const zp = r * sin(u) * sin(gamma);
    const m = mmul(rz(na), rx(ja));
    const [x, y, z] = mvmul(m, xp, yp, zp);
    moons.push({name: 'Deimos', x, y, z});
  }
  return moons;
}

// ---- Jupiter Galilean moons (ESAA3 §9.8.1, Eq. 9.51–9.54) ----

function jupiterMoons(jd) {
  const t = jd - 2443000.5;
  const fmod360 = (v) => ((v % 360) + 360) % 360;

  const l1 = fmod360(106.078590 + 203.488955363064 * t) * DEG;
  const l2 = fmod360(175.733787 + 101.374724556624 * t) * DEG;
  const l3 = fmod360(120.561386 +  50.317609153405 * t) * DEG;
  const l4 = fmod360( 84.455823 +  21.571070875180 * t) * DEG;
  const pl = fmod360(184.415351 +   0.17356902 * t) * DEG;
  const p1 = fmod360( 82.380231 +   0.16102275 * t) * DEG;
  const p2 = fmod360(128.960393 +   0.04645644 * t) * DEG;
  const p3 = fmod360(187.550171 +   0.00712408 * t) * DEG;
  const p4 = fmod360(335.309254 +   0.00183939 * t) * DEG;
  const pj = 13.470395 * DEG;
  const t1 = fmod360(308.365749 -   0.13280610 * t) * DEG;
  const t2 = fmod360(100.438938 -   0.03261535 * t) * DEG;
  const t3 = fmod360(118.908928 -   0.00717678 * t) * DEG;
  const t4 = fmod360(322.746564 -   0.00176018 * t) * DEG;
  const ps = fmod360(316.500101 -   0.00000248 * t) * DEG;
  const gp = fmod360( 31.978528 +   0.03345973 * t) * DEG;
  const G  = fmod360( 30.238021 +   0.08309256178969 * t) * DEG;
  const p2a = 52.14459693 * DEG;

  // Rotation matrix: Jupiter equatorial → B1950 equatorial (Eq. 9.54)
  const eps = 23.4457889 * DEG;
  const omega = 99.99754 * DEG;
  const j = 1.30691 * DEG;
  const phi = 316.500101 * DEG - omega;
  const I = 3.10401 * DEG;
  const mJupEq = mmul(rx(eps), mmul(rz(omega), mmul(rx(j), mmul(rz(phi), rx(I)))));
  const mJupJ2000 = mmul(mB1950J2000, mJupEq);

  const moons = [];

  // Io (Eq. 9.51)
  {
    const a = 0.002819347;
    const xi = -41279e-7 * cos(2*(l1-l2));

    const nu = 82363e-7 * sin(2*(l1-l2))
             - 5596e-7 * sin(p3-p4)
             - 2198e-7 * sin(p1+p3-2*pj-2*G)
             + 1321e-7 * sin(pl)
             - 1940e-7 * sin(l1-2*l2+p3)
             - 1157e-7 * sin(l1-2*l2+p4)
             -  791e-7 * sin(l1-2*l2+p2)
             +  791e-7 * sin(l1-2*l2-p2);

    const zeta = 7038e-7 * sin(l1-t1+nu)
               + 1835e-7 * sin(l1-t2+nu);

    const x = a*(1+xi)*cos(l1-ps+nu);
    const y = a*(1+xi)*sin(l1-ps+nu);
    const z = a*zeta;
    const [xj, yj, zj] = mvmul(mJupJ2000, x, y, z);
    moons.push({name: 'Io', x: xj, y: yj, z: zj});
  }

  // Europa (Eq. 9.51)
  {
    const a = 0.004485872;
    const xi = 93748e-7 * cos(l1-l2)
             - 3187e-7 * cos(l2-p3)
             - 1738e-7 * cos(l2-p4);

    const nu = -185640e-7 * sin(l1-l2)
              + 7571e-7 * sin(l1-2*l2+p3)
              + 6394e-7 * sin(l2-p3)
              + 4159e-7 * sin(l1-2*l2+p4)
              + 3451e-7 * sin(l2-p4)
              - 3172e-7 * sin(pl)
              + 2397e-7 * sin(p3-p4)
              - 1993e-7 * sin(l2-l3)
              - 1846e-7 * sin(G)
              + 1844e-7 * sin(l2-p2)
              + 1715e-7 * sin(-2*pj+t3+ps-2*G)
              - 1491e-7 * sin(l1-2*l2+p2)
              - 1158e-7 * sin(-2*pj+2*ps)
              +  915e-7 * sin(2*(l1-l2))
              -  803e-7 * sin(l1-l3);

    const zeta = 81575e-7 * sin(l2-t2+nu)
               +  4512e-7 * sin(l2-t3+nu)
               -  3286e-7 * sin(l2-ps+nu);

    const x = a*(1+xi)*cos(l2-ps+nu);
    const y = a*(1+xi)*sin(l2-ps+nu);
    const z = a*zeta;
    const [xj, yj, zj] = mvmul(mJupJ2000, x, y, z);
    moons.push({name: 'Europa', x: xj, y: yj, z: zj});
  }

  // Ganymede (Eq. 9.51)
  {
    const a = 0.007155352;
    const xi = -14691e-7 * cos(l3-p3)
             -  7894e-7 * cos(l3-p4)
             -  1758e-7 * cos(2*(l3-l4))
             +  6333e-7 * cos(l2-l3);

    const nu = 29387e-7 * sin(l3-p3)
             + 15800e-7 * sin(l3-p4)
             - 12038e-7 * sin(l2-l3)
             +  6558e-7 * sin(p3-p4)
             +  3218e-7 * sin(2*(l3-l4))
             -  2338e-7 * sin(G)
             -  1488e-7 * sin(-2*pj+2*ps)
             -  1246e-7 * sin(l1-2*l2+p3)
             -   943e-7 * sin(l3-l4)
             +   699e-7 * sin(l1-2*l2+p2)
             -   662e-7 * sin(l1-2*l2+p4)
             +   523e-7 * sin(p1+p3-2*pj-2*G)
             +   411e-7 * sin(-t3+ps)
             +   346e-7 * sin(-t4+ps)
             +   314e-7 * sin(pl)
             +   226e-7 * sin(3*l3-2*l4)
             +   217e-7 * sin(l1-l3);

    const zeta = 32387e-7 * sin(l3-t3+nu)
               - 16876e-7 * sin(l3-ps+nu)
               +  6871e-7 * sin(l3-t4+nu)
               -  2793e-7 * sin(l3-t2+nu);

    const x = a*(1+xi)*cos(l3-ps+nu);
    const y = a*(1+xi)*sin(l3-ps+nu);
    const z = a*zeta;
    const [xj, yj, zj] = mvmul(mJupJ2000, x, y, z);
    moons.push({name: 'Ganymede', x: xj, y: yj, z: zj});
  }

  // Callisto (Eq. 9.51)
  {
    const a = 0.012585436;
    const xi = -73328e-7 * cos(l4-p4)
             +  1656e-7 * cos(l4-p3)
             +   974e-7 * cos(l3-l4)
             -   541e-7 * cos(l4+p4-2*pj-2*G)
             -   269e-7 * cos(2*(l4-p4))
             +   182e-7 * cos(l4-pj);

    const nu = 146673e-7 * sin(l4-p4)
             -  6112e-7 * sin(p3-p4)
             -  5605e-7 * sin(G)
             -  4840e-7 * sin(-2*pj+2*ps)
             -  3318e-7 * sin(l4-p3)
             +  2074e-7 * sin(-t4+ps)
             +  1085e-7 * sin(l4+p4-2*pj-2*G)
             +   672e-7 * sin(2*(l4-p4))
             -   495e-7 * sin(5*gp-2*G+p2a)
             -   407e-7 * sin(-2*p4+2*ps)
             -   390e-7 * sin(l3-l4)
             -   363e-7 * sin(l4-pj)
             +   309e-7 * sin(-2*p4+t4+ps)
             +   234e-7 * sin(p4-pj)
             +   218e-7 * sin(2*(l4-pj-G))
             -   204e-7 * sin(2*G)
             -   195e-7 * sin(2*(l3-l4))
             +   185e-7 * sin(3*l3-7*l4+4*p4)
             +   178e-7 * sin(l4-pj-G)
             +   167e-7 * sin(2*l4-t4-ps)
             +   148e-7 * sin(l3-2*l4+p4)
             -   142e-7 * sin(2*(l4-ps));

    const zeta = -76493e-7 * sin(l4-ps+nu)
               + 44300e-7 * sin(l4-t4+nu)
               -  5075e-7 * sin(l4-t3+nu)
               +   773e-7 * sin(l4-2*pj+ps-2*G+nu);

    const x = a*(1+xi)*cos(l4-ps+nu);
    const y = a*(1+xi)*sin(l4-ps+nu);
    const z = a*zeta;
    const [xj, yj, zj] = mvmul(mJupJ2000, x, y, z);
    moons.push({name: 'Callisto', x: xj, y: yj, z: zj});
  }

  return moons;
}

// ---- Saturn moons (ESAA3 §9.9) ----

function saturnMoons(jd) {
  const moons = [];

  // Saturn equator → B1950 equatorial (fixed pole)
  const je = (90.0 - 83.33) * DEG;
  const neq = (90.0 + 38.40) * DEG;
  const mSatJ2000 = mmul(mB1950J2000, mmul(rz(neq), rx(je)));

  // B1950 ecliptic → J2000 equatorial
  const mEclJ2000 = mmul(mB1950J2000, rx(epsB1950));

  // Saturn's equator on B1950 ecliptic
  const ie = 28.06 * DEG;
  const neEcl = 168.83 * DEG;
  const ab = 41.53 * DEG;

  // ecliptic elements → J2000 equatorial XYZ (full spherical trig)
  function eclipticMoon(a, e, inc, w, node, M) {
    M = ((M % TAU) + TAU) % TAU;
    const E = solveKepler(M, e);
    const f = trueAnomaly(E, e);
    const r = a * (1 - e*e) / (1 + e * cos(f));
    const u = f + w - node;
    const [xe, ye, ze] = orbitPosition(r, u, inc, node);
    return mvmul(mEclJ2000, xe, ye, ze);
  }

  // ---- Inner moons (Saturn equatorial frame, §9.9.2.1) ----
  // Elements θ₁, P₁, l₁ are absolute longitudes measured from ecliptic
  // ascending node of Saturn's equator. Adjust by (-neEcl+ab) to get
  // angle from equatorial ascending node, then u = f + P_adj gives
  // position angle from the matrix x-axis.
  const d = jd - 2411093.0;
  const y = d / 365.25;
  const T = 5.0616 * ((jd - 2433282.423) / 365.25 + 84.0);
  const tRad = ((T % 360 + 360) % 360) * DEG;

  // Mimas (Eq. 9.65)
  {
    const l1 = ((128.839 + 381.994516 * d - 43.415 * sin(tRad) - 0.714 * sin(3*tRad)) % 360) * DEG;
    const P1 = ((107.0 + 365.560 * y) % 360) * DEG;
    const Padj = P1 - neEcl + ab;
    const M = l1 - P1;
    const E2 = solveKepler(((M % TAU) + TAU) % TAU, 0.01986);
    const f = trueAnomaly(E2, 0.01986);
    const r = 0.00124171 * (1 - 0.01986*0.01986) / (1 + 0.01986 * cos(f));
    const u = f + Padj;
    const xp = r * cos(u), yp = r * sin(u) * cos(1.570*DEG), zp = r * sin(u) * sin(1.570*DEG);
    const [x, y2, z] = mvmul(mSatJ2000, xp, yp, zp);
    moons.push({name: 'Mimas', x, y: y2, z});
  }

  // Enceladus (Eq. 9.66)
  {
    const l1 = ((200.155 + 262.7319052 * d) % 360) * DEG;
    const P1 = ((312.7 + 123.42 * y) % 360) * DEG;
    const Padj = P1 - neEcl + ab;
    const M = l1 - P1;
    const E2 = solveKepler(((M % TAU) + TAU) % TAU, 0.00532);
    const f = trueAnomaly(E2, 0.00532);
    const r = 0.00158935 * (1 - 0.00532*0.00532) / (1 + 0.00532 * cos(f));
    const u = f + Padj;
    const xp = r * cos(u), yp = r * sin(u) * cos(0.036*DEG), zp = r * sin(u) * sin(0.036*DEG);
    const [x, y2, z] = mvmul(mSatJ2000, xp, yp, zp);
    moons.push({name: 'Enceladus', x, y: y2, z});
  }

  // Tethys (Eq. 9.67)
  {
    const l1 = ((284.9982 + 190.697920278 * d + 2.0751 * sin(tRad) + 0.0341 * sin(3*tRad)) % 360) * DEG;
    const P1 = ((97 + 72.29 * y) % 360) * DEG;
    const Padj = P1 - neEcl + ab;
    const ec = 0.000212;
    const M = l1 - P1;
    const E2 = solveKepler(((M % TAU) + TAU) % TAU, ec);
    const f = trueAnomaly(E2, ec);
    const r = 0.00197069 * (1 - ec*ec) / (1 + ec * cos(f));
    const u = f + Padj;
    const xp = r * cos(u), yp = r * sin(u) * cos(1.1121*DEG), zp = r * sin(u) * sin(1.1121*DEG);
    const [x, y2, z] = mvmul(mSatJ2000, xp, yp, zp);
    moons.push({name: 'Tethys', x, y: y2, z});
  }

  // Dione (Eq. 9.68)
  {
    const l1 = ((255.1183 + 131.534920026 * d
      - 0.88 * sin((59.4 + 32.73 * y) * DEG)
      - 0.75 * sin((119.2 + 93.18 * y) * DEG)) % 360) * DEG;
    const P1 = ((173.6 + 30.8381 * y) % 360) * DEG;
    const Padj = P1 - neEcl + ab;
    const ec = 0.001715;
    const M = l1 - P1;
    const E2 = solveKepler(((M % TAU) + TAU) % TAU, ec);
    const f = trueAnomaly(E2, ec);
    const r = 0.00252413 * (1 - ec*ec) / (1 + ec * cos(f));
    const u = f + Padj;
    const xp = r * cos(u), yp = r * sin(u) * cos(0.0289*DEG), zp = r * sin(u) * sin(0.0289*DEG);
    const [x, y2, z] = mvmul(mSatJ2000, xp, yp, zp);
    moons.push({name: 'Dione', x, y: y2, z});
  }

  // ---- Outer moons (B1950 ecliptic frame, §9.9.2.2–3) ----

  // Rhea (Eq. 9.76–9.77)
  {
    const dr = jd - 2411093.0;
    const yr = dr / 365.25;
    const p = ((305.0 + 10.2077 * yr) % 360) * DEG;
    const wt = ((276.49 + 0.5219 * (jd - 2411368.0) / 365.25) % 360) * DEG;
    const gamma0 = 0.3305 * DEG;
    const theta0 = ((356.87 - 10.2077 * yr) % 360) * DEG;
    const esinw = 0.000210 * sin(p) + 0.00100 * sin(wt);
    const ecosw = 0.000210 * cos(p) + 0.00100 * cos(wt);
    const lambda = ((359.4727 + 79.6900400700 * dr) % 360) * DEG
                 + sin(gamma0) * sin(theta0) * tan(ie / 2);
    const a = 0.00352400;
    const e = sqrt(esinw*esinw + ecosw*ecosw);
    const w = atan2(esinw, ecosw);
    const inc = ie - 0.0455*DEG + sin(gamma0)*cos(theta0);
    const node = neEcl - 0.0078*DEG + sin(gamma0)*sin(theta0)/sin(ie);
    const M = lambda - w;
    const [x, y2, z] = eclipticMoon(a, e, inc, w, node, M);
    moons.push({name: 'Rhea', x, y: y2, z});
  }

  // Titan (Eq. 9.78–9.80)
  {
    const Tc = (jd - 2415020.0) / 36525.0;
    const dt = jd - 2411368.0;
    const yt = dt / 365.25;
    const is = (2.4891 + 0.002435 * Tc) * DEG;
    const ns = ((113.350 - 0.2597 * Tc) % 360) * DEG;
    const ms = ((175.4762 + 1221.5515 * Tc) % 360) * DEG;
    const ls = ((267.2635 + 1222.1136 * Tc) % 360) * DEG;
    const gamma0 = 0.2990 * DEG;
    const theta0 = ((41.28 - 0.5219 * yt) % 360) * DEG;
    const ia = ie - 0.6204*DEG + sin(gamma0)*cos(theta0);
    const na = neEcl - 0.1418*DEG + sin(gamma0)*sin(theta0)/sin(ie);
    const wa = ((275.837 + 0.5219 * yt) % 360) * DEG;
    const Psi = atan2(sin(is)*sin(na-ns),
                cos(is)*sin(ia) - sin(is)*cos(ia)*cos(na-ns));
    const theta = ns + atan2(sin(ia)*sin(na-ns),
                  cos(is)*sin(ia)*cos(na-ns) - sin(is)*cos(ia));
    const Ls = ls - theta;
    const g = wa - na - Psi;
    let lambda = ((261.3121 + 22.57697385 * dt) % 360) * DEG
               + sin(gamma0)*tan(ie/2)*sin(theta0)
               - 0.000176*sin(ms) - 0.000215*sin(2*Ls)
               + 0.000057*sin(2*Ls+Psi);
    const a = 0.00816765;
    const e = 0.028815 - 0.000184*cos(2*g) + 0.000073*cos(2*(Ls-g));
    const w = wa + 0.00630*sin(2*g) + 0.00250*sin(2*(Ls-g));
    const inc = ia + 0.000232*cos(2*Ls+Psi);
    const node = na + 0.000503*sin(2*Ls+Psi);
    const M = lambda - w;
    const [x, y2, z] = eclipticMoon(a, e, inc, w, node, M);
    moons.push({name: 'Titan', x, y: y2, z});
  }

  // Hyperion (Eq. 9.81)
  {
    const dh = jd - 2415020.0;
    const th = (jd - 2433282.42345905) / 365.2422 + 50.0;
    const tau = ((93.13 + 0.562039 * dh) % 360) * DEG;
    const zeta = ((148.72 - 19.184 * th) % 360) * DEG;
    const th0 = ((105.31 - 2.392 * th) % 360) * DEG;
    const th1 = ((38.73 - 0.5353 * th) % 360) * DEG;
    const th2 = ((13.0 + 24.44 * th) % 360) * DEG;
    const th3 = ((31.9 + 61.7524 * th) % 360) * DEG;
    const th5 = ((176.0 + 12.22 * th) % 360) * DEG;
    const th4 = ((8.0 + 24.44 * th) % 360) * DEG;
    const a = 0.0099040 - 0.00003422 * cos(tau);
    const e = 0.10441 + 0.02321*cos(zeta) - 0.00401*cos(tau)
            - 0.00110*cos(2*zeta) + 0.00013*cos(th3) + 0.00009*cos(zeta-tau);
    const inc = ie + (-0.747 + 0.6200*cos(th0) + 0.315*cos(th1) - 0.018*cos(th2))*DEG;
    const node = neEcl + (-0.061 + 0.6200*sin(th0) + 0.315*sin(th1)
               - 0.018*sin(th2))*DEG / sin(ie - 0.747*DEG);
    const w = ((69.993 - 18.6702*th - 13.36*sin(zeta) + 2.16*sin(2*zeta)
             - 0.47*sin(tau) + 0.1507*sin(th0) + 0.07*sin(th3)) % 360) * DEG;
    const lambda = ((176.7481 + 16.9199514*dh + 9.089*sin(tau) + 0.211*sin(zeta+tau)
                   + 0.192*sin(zeta-tau) + 0.1507*sin(th0) - 0.091*sin(zeta)
                   + 0.017*sin(th4) - 0.014*sin(3*tau) - 0.013*sin(th5)
                   + 0.007*sin(2*tau)) % 360) * DEG;
    const M = lambda - w;
    const [x, y2, z] = eclipticMoon(a, e, inc, w, node, M);
    moons.push({name: 'Hyperion', x, y: y2, z});
  }

  // Iapetus (Eq. 9.82–9.86)
  {
    const di = jd - 2409786.0;
    const ci = di / 36525.0;
    const ci2 = ci*ci, ci3 = ci2*ci;
    const Ti = (jd - 2415020.0) / 36525.0;
    const a0 = 0.02380984;
    let e = 0.0288184 + 0.000575*ci;
    let inc = (18.45959 - 0.9555*ci - 0.0720*ci2 + 0.0054*ci3) * DEG;
    let node = ((143.1294 - 3.797*ci + 0.116*ci2 + 0.008*ci3) % 360) * DEG;
    let w = ((352.905 + 11.65*ci) % 360) * DEG;
    let lambda = ((76.19854 + 4.53795711*di) % 360) * DEG;
    const theta = ((4.367 - 0.195*Ti) % 360) * DEG;
    const lsI = ((267.263 + 1222.114*Ti) % 360) * DEG;
    const wsI = ((91.796 + 0.562*Ti) % 360) * DEG;
    const ltI = ((261.319 + 22.576974*(jd-2411368.0)) % 360) * DEG;
    const wtI = ((277.102 + 0.001389*(jd-2411368.0)) % 360) * DEG;
    const phiI = ((60.470 + 1.521*Ti) % 360) * DEG;
    const l = lambda - w;
    const ls2 = lsI - wsI;
    const lt2 = ltI - wtI;
    const g = w - node - theta;
    const gs = wsI - ((146.819 - 3.918*Ti) % 360)*DEG;
    const gt = wtI - ((205.055 - 2.091*Ti) % 360)*DEG;
    const gl = w - node - phiI;
    w += (0.08077*sin(gl-gt) + 0.03547*sin(lt2+gt-gl) + 0.02139*sin(2*(ls2+gs-g))
        + 0.01632*sin(2*l+gl-lt2-gt) + 0.01380*sin(l) - 0.00676*sin(l+2*(gl-ls2-gs))
        + 0.00028*sin(3*ls2+2*gs-g))*DEG / e;
    node += (0.04204*sin(2*(ls2+gs)+theta) - 0.0142*sin(ls2)
           + 0.00358*sin(l+gl-lt2-gt+phiI) + 0.0028*sin(3*ls2+2*gs)
           - 0.0012*sin(ls2+2*gs) - 0.0006*sin(2*ls2)
           + 0.0003*sin(4*ls2+2*gs))*DEG / sin(inc);
    const a = a0*(1 + 98.79e-5*cos(l+gl-lt2-gt) + 7.87e-5*cos(2*(l+g-ls2-gs)));
    e += -140.97e-5*cos(gl-gt) + 61.90e-5*cos(lt2+gt-gl) + 37.33e-5*cos(2*(ls2+gs-g))
       + 28.49e-5*cos(2*l+gl-lt2-gt) + 24.08e-5*cos(l) + 11.80e-5*cos(l+2*(g-ls2-gs));
    inc += (0.04204*cos(2*(ls2+gs)+theta) + 0.00360*cos(l+gl-lt2-gt+phiI)
          + 0.00235*cos(l+gl+lt2+gt+phiI) + 0.0058*cos(3*ls2+2*gs)
          - 0.0024*cos(ls2+2*gs))*DEG;
    lambda += (-0.06312*sin(ls2) - 0.04299*sin(l+gl-lt2-gt)
             - 0.02231*sin(2*(ls2+gs)) - 0.00789*sin(2*(l+g-ls2-gs))
             + 0.00650*sin(2*(ls2+gs)+theta))*DEG;
    const M = lambda - w;
    const [x, y2, z] = eclipticMoon(a, e, inc, w, node, M);
    moons.push({name: 'Iapetus', x, y: y2, z});
  }

  // ---- Phoebe (§9.9.2.2, Zadunaisky 1954) ----
  // ESAA formula is inaccurate; use JPL mean orbit elements for reliable positions.
  {
    const d9 = jd - 2433282.5;
    const y9 = d9 / 365.25;
    const lambda = ((277.872 - 0.6541068 * d9) % 360) * DEG;
    const a = 0.0865752;
    const e = 0.16326;
    const inc = ((173.949 - 0.020 * y9) % 360) * DEG;
    const w = ((280.165 - 0.19586 * y9) % 360) * DEG;
    const node = ((245.998 - 0.41353 * y9) % 360) * DEG;
    const M = lambda - w;
    const [x, y2, z] = eclipticMoon(a, e, inc, w, node, M);
    moons.push({name: 'Phoebe', x, y: y2, z});
  }

  return moons;
}

// ---- Uranus moons (ESAA3 §9.10, Laskar & Jacobson 1987) ----
// Complex elements z = e*exp(iP), ζ = sin(γ/2)*exp(iθ).
// All in Uranus equatorial frame (B1950). Mean longitude + PI matches AA.

function uranusMoons(jd) {
  const T = jd - 2444239.5;
  const moons = [];

  const je = (90.0 - 15.04) * DEG;
  const neU = (90.0 + 76.72) * DEG;
  const mUranJ2000 = mmul(mB1950J2000, mmul(rz(neU), rx(je)));

  function uranianMoon(a, L, z_re, z_im, zeta_re, zeta_im) {
    const e = sqrt(z_re*z_re + z_im*z_im);
    const P = atan2(z_im, z_re);
    const sinHalfGamma = sqrt(zeta_re*zeta_re + zeta_im*zeta_im);
    const gamma = 2 * asin(sinHalfGamma);
    const theta = atan2(zeta_im, zeta_re);
    const M = ((L - P + PI) % TAU + TAU) % TAU;
    const E = solveKepler(M, e);
    const f = trueAnomaly(E, e);
    const r = a * (1 - e*e) / (1 + e * cos(f));
    const u = f + P;
    const xo = r * cos(u);
    const yo = r * sin(u) * cos(gamma);
    const zo = r * sin(u) * sin(gamma);
    return mvmul(mUranJ2000, xo, yo, zo);
  }

  // Miranda (Eq. 9.97)
  {
    const l1a = -2.18167e-4*T + 1.32;
    const l2a = -4.36336e-4*T + 2.64;
    const l3a = -6.54502e-4*T + 3.97;
    const L = -0.23805158 + 4.44519055*T + 0.02547217*sin(l1a)
            - 0.00308831*sin(l2a) - 3.181e-4*sin(l3a);
    const pa1 = 1.5273e-4*T + 0.61;
    const pa2 = 0.08606*T + 0.15;
    const pa3 = 0.709*T + 6.04;
    const z_re = 1.31238e-3*cos(pa1) - 1.2331e-4*cos(pa2) - 1.9410e-4*cos(pa3);
    const z_im = 1.31238e-3*sin(pa1) - 1.2331e-4*sin(pa2) - 1.9410e-4*sin(pa3);
    const zeta_re = 0.03787171 * cos(-1.54449e-4*T + 5.70);
    const zeta_im = 0.03787171 * sin(-1.54449e-4*T + 5.70);
    const [x, y, z] = uranianMoon(0.00086492, L, z_re, z_im, zeta_re, zeta_im);
    moons.push({name: 'Miranda', x, y, z});
  }

  // Ariel (Eq. 9.98)
  {
    const l1a = -2.18167e-4*T + 1.32;
    const l2a = -4.36336e-4*T + 2.64;
    const L = 3.09804641 + 2.49295252*T - 1.86050e-3*sin(l1a) + 2.1999e-4*sin(l2a);
    const pa1 = 4.727824e-5*T + 2.41;
    const pa2 = 2.179316e-5*T + 2.07;
    const z_re = 1.18763e-3*cos(pa1) + 8.6159e-4*cos(pa2);
    const z_im = 1.18763e-3*sin(pa1) + 8.6159e-4*sin(pa2);
    const ta1 = -4.782474e-5*T + 0.40;
    const ta2 = -2.156628e-5*T + 0.59;
    const zeta_re = 3.5825e-4*cos(ta1) + 2.9008e-4*cos(ta2);
    const zeta_im = 3.5825e-4*sin(ta1) + 2.9008e-4*sin(ta2);
    const [x, y, z] = uranianMoon(0.00127689, L, z_re, z_im, zeta_re, zeta_im);
    moons.push({name: 'Ariel', x, y, z});
  }

  // Umbriel (Eq. 9.99)
  {
    const L = 2.28540169 + 1.51614811*T + 6.6057e-4*sin(-2.18167e-4*T + 1.32);
    const pa1 = 4.727824e-5*T + 2.41;
    const pa2 = 2.179316e-5*T + 2.07;
    const pa3 = 1.580524e-5*T + 0.74;
    const pa4 = 2.9363068e-6*T + 0.43;
    const pa5 = -0.01157*T + 5.71;
    const z_re = -2.2795e-4*cos(pa1) + 3.90469e-3*cos(pa2) + 3.0917e-4*cos(pa3)
               + 2.2192e-4*cos(pa4) + 5.4923e-4*cos(pa5);
    const z_im = -2.2795e-4*sin(pa1) + 3.90469e-3*sin(pa2) + 3.0917e-4*sin(pa3)
               + 2.2192e-4*sin(pa4) + 5.4923e-4*sin(pa5);
    const ta1 = -2.156628e-5*T + 0.59;
    const ta2 = -1.401373e-5*T + 1.75;
    const zeta_re = 1.1136e-3*cos(ta1) + 3.5014e-4*cos(ta2);
    const zeta_im = 1.1136e-3*sin(ta1) + 3.5014e-4*sin(ta2);
    const [x, y, z] = uranianMoon(0.00170811, L, z_re, z_im, zeta_re, zeta_im);
    moons.push({name: 'Umbriel', x, y, z});
  }

  // Titania (Eq. 9.100)
  {
    const L = 0.85635879 + 0.72171851*T;
    const pa1 = 1.580524e-5*T + 0.74;
    const pa2 = 2.9363068e-6*T + 0.43;
    const pa3 = -6.9008e-3*T + 1.82;
    const z_re = 9.3281e-4*cos(pa1) + 1.12089e-3*cos(pa2) + 7.9343e-4*cos(pa3);
    const z_im = 9.3281e-4*sin(pa1) + 1.12089e-3*sin(pa2) + 7.9343e-4*sin(pa3);
    const ta1 = -1.401373e-5*T + 1.75;
    const ta2 = -1.9713918e-6*T + 4.21;
    const zeta_re = 6.8572e-4*cos(ta1) + 3.7832e-4*cos(ta2);
    const zeta_im = 6.8572e-4*sin(ta1) + 3.7832e-4*sin(ta2);
    const [x, y, z] = uranianMoon(0.00291388, L, z_re, z_im, zeta_re, zeta_im);
    moons.push({name: 'Titania', x, y, z});
  }

  // Oberon (Eq. 9.101)
  {
    const L = -0.91559180 + 0.46669212*T;
    const pa1 = 1.580524e-5*T + 0.74;
    const pa2 = 2.9363068e-6*T + 0.43;
    const pa3 = -6.9008e-3*T + 1.82;
    const z_re = -7.5868e-4*cos(pa1) + 1.39734e-3*cos(pa2) - 9.8726e-4*cos(pa3);
    const z_im = -7.5868e-4*sin(pa1) + 1.39734e-3*sin(pa2) - 9.8726e-4*sin(pa3);
    const ta1 = -1.401373e-5*T + 1.75;
    const ta2 = -1.9713918e-6*T + 4.21;
    const zeta_re = -5.9633e-4*cos(ta1) + 4.5196e-4*cos(ta2);
    const zeta_im = -5.9633e-4*sin(ta1) + 4.5196e-4*sin(ta2);
    const [x, y, z] = uranianMoon(0.00390059, L, z_re, z_im, zeta_re, zeta_im);
    moons.push({name: 'Oberon', x, y, z});
  }

  return moons;
}

// ---- Neptune moons (ESAA3 §9.11) ----

function neptuneMoons(jd) {
  const moons = [];

  // Triton (Harris 1984, §9.11.1)
  // J2000 frame with time-dependent pole. γ=159° requires full formula.
  {
    const Tc = (jd - 2451545.0) / 36525.0;
    const N = ((359.28 + 54.308*Tc) % 360) * DEG;
    const ap = 298.72 + 2.58*sin(N) - 0.04*sin(2*N);
    const dp = 42.63 - 1.90*cos(N) + 0.01*cos(2*N);
    const jeT = (90.0 - dp) * DEG;
    const neT = (90.0 + ap) * DEG;
    const mTriton = mmul(rz(neT), rx(jeT));

    const d = jd - 2433282.5;
    const a = 0.002368266;
    const gamma = 158.996 * DEG;
    const theta = ((151.401 + 0.57806 * d / 365.25) % 360) * DEG;
    const l = ((200.913 + 61.2588532 * d) % 360) * DEG;
    const [xr, yr, zr] = orbitPosition(a, l, gamma, theta);
    const [x, y, z] = mvmul(mTriton, xr, yr, zr);
    moons.push({name: 'Triton', x, y, z});
  }

  // Nereid (Jacobson 1990, §9.11.2)
  // B1950 equatorial frame. γ=10° — use full formula.
  {
    const t = jd - 2433680.5;
    const Tc = t / 36525.0;
    const psi = ((289.2 + 2.68*Tc) % 360) * DEG;
    const a = 0.036868;
    const e = 0.74515;
    const gamma = 10.041 * DEG;
    const theta = ((329.3 - 2.4*Tc + 19.7*sin(2*psi) - 3.3*sin(4*psi)) % 360) * DEG;
    const P = psi - (19.25*sin(2*psi) + 3.23*sin(4*psi))*DEG;
    const M = ((358.91 + 0.999552*t) % 360) * DEG;
    const E = solveKepler(((M % TAU) + TAU) % TAU, e);
    const f = trueAnomaly(E, e);
    const r = a * (1 - e*e) / (1 + e * cos(f));

    const JeN = 22.313 * DEG;
    const NeN = 3.522 * DEG;
    const u = f + P - theta;
    const [xr, yr, zr] = orbitPosition(r, u, gamma, theta);
    const mNereid = mmul(mB1950J2000, mmul(rz(NeN), rx(JeN)));
    const [x, y, z] = mvmul(mNereid, xr, yr, zr);
    moons.push({name: 'Nereid', x, y, z});
  }

  return moons;
}

// ---- Pluto's Charon (ESAA3 §9.12) ----
// B1950 equatorial frame. J=94° (retrograde) — needs full formula.

function plutoMoons(jd) {
  const d = jd - 2445000.5;
  const a = 0.00012788;
  const J = 94.3 * DEG;
  const N = 223.7 * DEG;
  const u = ((78.6 + 56.3625 * d) % 360) * DEG;
  const m = mmul(mB1950J2000, mmul(rz(N), rx(J)));
  const [x, y, z] = mvmul(m, a*cos(u), a*sin(u), 0);
  return [{name: 'Charon', x, y, z}];
}

// JPL mean orbital and physical parameters (March 2020).
// Generated by data/gen_moondata.py from docs/jpl/moon_orbits.pdf and moon_phys.pdf.
// a: semi-major axis (km), e: eccentricity, w: arg of periapsis (deg),
// M: mean anomaly (deg), i: inclination (deg), node: long of asc node (deg),
// epoch: Julian Ephemeris Date, n: mean motion (deg/day),
// Pw: periapsis precession period (yr), Pnode: node precession period (yr),
// RA/Dec: J2000 pole of reference plane (deg), radius: mean radius (km),
// H: absolute visual magnitude (converted from V0 in physical params PDF).
const MOON_DATA = {
  Moon: {a:384400, e:0.0554, w:318.150, M:135.270, i:5.160, node:125.080, epoch:2451545.0, n:12.9590141, Pw:5.997, Pnode:18.600, RA:270.000, Dec:66.561, radius:1737.5, H:0.2},
  Phobos: {a:9376, e:0.0151, w:150.057, M:91.059, i:1.075, node:207.784, epoch:2433282.5, n:1127.5379645, Pw:1.132, Pnode:2.262, RA:317.671, Dec:52.893, radius:11.1, H:11.9},
  Deimos: {a:23458, e:0.0002, w:260.729, M:325.329, i:1.788, node:24.525, epoch:2433282.5, n:285.1077955, Pw:27.370, Pnode:54.537, RA:316.657, Dec:53.529, radius:6.2, H:12.9},
  Io: {a:421800, e:0.0041, w:84.129, M:342.021, i:0.036, node:43.977, epoch:2450464.5, n:202.7495853, Pw:1.625, Pnode:7.420, RA:268.057, Dec:64.495, radius:1821.6, H:-1.7},
  Europa: {a:671100, e:0.0094, w:88.970, M:171.016, i:0.466, node:219.106, epoch:2450464.5, n:100.6350213, Pw:1.394, Pnode:30.184, RA:268.084, Dec:64.506, radius:1560.8, H:-1.4},
  Ganymede: {a:1070400, e:0.0013, w:192.417, M:317.540, i:0.177, node:63.552, epoch:2450464.5, n:50.2946674, Pw:63.549, Pnode:132.654, RA:268.168, Dec:64.543, radius:2631.2, H:-2.1},
  Callisto: {a:1882700, e:0.0074, w:52.643, M:181.408, i:0.192, node:298.848, epoch:2450464.5, n:21.5633734, Pw:205.750, Pnode:338.820, RA:268.639, Dec:64.749, radius:2410.3, H:-1.0},
  Mimas: {a:185539, e:0.0196, w:332.499, M:14.848, i:1.574, node:173.027, epoch:2451545.0, n:378.9956319, Pw:0.493, Pnode:0.986, RA:40.589, Dec:83.536, radius:198.2, H:3.2},
  Enceladus: {a:238042, e:0.0000, w:0.076, M:199.686, i:0.003, node:342.507, epoch:2451545.0, n:261.4818049, Pw:1.184, Pnode:2.360, RA:40.586, Dec:83.536, radius:252.1, H:2.2},
  Tethys: {a:294672, e:0.0001, w:45.202, M:243.367, i:1.091, node:259.842, epoch:2451545.0, n:190.1042396, Pw:2.490, Pnode:4.982, RA:40.578, Dec:83.537, radius:533.0, H:0.6},
  Dione: {a:377415, e:0.0022, w:284.315, M:322.232, i:0.028, node:290.415, epoch:2451545.0, n:131.2823283, Pw:5.852, Pnode:11.709, RA:40.544, Dec:83.540, radius:561.7, H:0.8},
  Rhea: {a:527068, e:0.0002, w:241.619, M:179.781, i:0.333, node:351.042, epoch:2451545.0, n:79.6075958, Pw:17.939, Pnode:35.832, RA:40.328, Dec:83.559, radius:764.3, H:0.0},
  Titan: {a:1221865, e:0.0288, w:180.532, M:163.310, i:0.306, node:28.060, epoch:2451545.0, n:22.5727776, Pw:352.120, Pnode:704.600, RA:36.214, Dec:83.949, radius:2574.7, H:-1.2},
  Hyperion: {a:1500933, e:0.0232, w:303.178, M:86.342, i:0.615, node:263.847, epoch:2451545.0, n:16.9058766, Pw:127.990, Pnode:154.660, RA:36.372, Dec:83.862, radius:135.0, H:4.8},
  Iapetus: {a:3560854, e:0.0293, w:271.606, M:201.789, i:8.298, node:81.105, epoch:2451545.0, n:4.5370671, Pw:1676.690, Pnode:3438.730, RA:284.715, Dec:78.749, radius:735.6, H:1.4},
  Phoebe: {a:12947918, e:0.1634, w:342.500, M:53.038, i:175.243, node:241.086, epoch:2451545.0, n:0.6534101, Pw:460.920, Pnode:723.170, RA:275.954, Dec:67.455, radius:106.5, H:6.8},
  Ariel: {a:190900, e:0.0012, w:115.349, M:219.481, i:0.041, node:22.394, epoch:2444239.5, n:142.7842037, Pw:28.788, Pnode:57.248, RA:77.311, Dec:15.175, radius:578.9, H:1.0},
  Umbriel: {a:266000, e:0.0039, w:84.709, M:192.469, i:0.128, node:33.485, epoch:2444239.5, n:86.8455154, Pw:63.146, Pnode:126.951, RA:77.311, Dec:15.175, radius:584.7, H:1.7},
  Titania: {a:436300, e:0.0011, w:284.400, M:204.614, i:0.079, node:99.771, epoch:2444239.5, n:41.3402776, Pw:161.525, Pnode:195.369, RA:77.311, Dec:15.175, radius:788.9, H:0.8},
  Oberon: {a:583500, e:0.0014, w:104.400, M:103.088, i:0.068, node:279.771, epoch:2444239.5, n:26.7283417, Pw:161.520, Pnode:195.370, RA:77.311, Dec:15.175, radius:761.4, H:1.0},
  Miranda: {a:129900, e:0.0013, w:68.312, M:131.330, i:4.338, node:326.438, epoch:2444239.5, n:254.5244743, Pw:8.913, Pnode:17.727, RA:77.311, Dec:15.175, radius:235.8, H:3.1},
  Triton: {a:354759, e:0.0000, w:66.142, M:352.257, i:156.865, node:177.608, epoch:2451545.0, n:61.2532791, Pw:386.371, Pnode:687.446, RA:299.456, Dec:43.414, radius:1353.4, H:-1.2},
  Nereid: {a:5513818, e:0.7507, w:281.117, M:216.692, i:7.090, node:335.570, epoch:2451545.0, n:0.9994016, Pw:8091.450, Pnode:9455.730, RA:269.302, Dec:69.117, radius:170.0, H:4.5},
  Charon: {a:19591, e:0.0002, w:146.106, M:131.070, i:0.080, node:26.928, epoch:2452800.5, n:56.3623149, Pw:10178.040, Pnode:9020.398, RA:132.993, Dec:-6.163, radius:603.6, H:1.4},
};

// Compute planetocentric J2000 equatorial position {x, y, z} in AU
// from MOON_DATA Keplerian elements, propagated to Julian Ephemeris Date jde.
function moonPositionKepler(name, jde) {
  const md = MOON_DATA[name];
  if (!md) return null;
  const dt = jde - md.epoch;
  const wRate = md.Pw > 0 ? 360.0 / md.Pw : 0;
  const nRate = md.Pnode > 0 ? 360.0 / md.Pnode : 0;
  const M = ((md.M + md.n * dt) % 360 + 360) % 360 * DEG;
  const w = ((md.w + wRate * dt / 365.25) % 360 + 360) % 360 * DEG;
  const N = ((md.node + nRate * dt / 365.25) % 360 + 360) % 360 * DEG;
  const inc = md.i * DEG;

  const E = solveKepler(M, md.e);
  const nu = trueAnomaly(E, md.e);
  const r = md.a * (1 - md.e * cos(E));
  const u = nu + w;

  // Position in reference plane (z along pole, x toward ascending node of J2000 equator)
  const cosN = cos(N), sinN = sin(N), cosi = cos(inc), sini = sin(inc);
  const cosu = cos(u), sinu = sin(u);
  const xr = r * (cosN * cosu - sinN * sinu * cosi);
  const yr = r * (sinN * cosu + cosN * sinu * cosi);
  const zr = r * sinu * sini;

  // Rotate from reference plane to J2000 equatorial using pole (RA, Dec).
  // Reference plane x-axis = ascending node of J2000 equator on ref plane
  //   = z_J2000 × pole = (-sin(RA), cos(RA), 0)
  // y-axis = pole × x-axis = (-sin(Dec)cos(RA), -sin(Dec)sin(RA), cos(Dec))
  // z-axis = pole = (cos(Dec)cos(RA), cos(Dec)sin(RA), sin(Dec))
  const ra = md.RA * DEG, dec = md.Dec * DEG;
  const cosRA = cos(ra), sinRA = sin(ra), cosDec = cos(dec), sinDec = sin(dec);
  const KM_PER_AU = 149597870.7;
  return {
    x: (-sinRA * xr - sinDec * cosRA * yr + cosDec * cosRA * zr) / KM_PER_AU,
    y: ( cosRA * xr - sinDec * sinRA * yr + cosDec * sinRA * zr) / KM_PER_AU,
    z: (                cosDec * yr +        sinDec * zr)         / KM_PER_AU,
  };
}

function planetMoonMagnitude(name, helioDist, geoDist) {
  const d = MOON_DATA[name];
  if (!d || d.H === undefined) return 99;
  return d.H + 5 * Math.log10(helioDist * geoDist);
}
