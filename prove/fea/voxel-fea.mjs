// voxel-fea.mjs — elasticità lineare 3D su una griglia di voxel, senza dipendenze.
// Gira in Node e in un Web Worker: usa solo ECMAScript e, se c'è, performance.now().
//
// Unità coerenti consigliate: mm, N, MPa (= N/mm²). Spostamenti in mm, sforzi in MPa.
// Ogni voxel pieno è un esaedro a 8 nodi (trilineare); la matrice di rigidezza
// dell'elemento si calcola una volta per materiale (Gauss 2×2×2) e il prodotto
// K·u si fa elemento per elemento, senza assemblare K. Il sistema si risolve con
// il gradiente coniugato precondizionato con la diagonale (Jacobi).

const ora = () => (globalThis.performance ? globalThis.performance.now() : Date.now());

// Nodi locali dell'esaedro, (ξ, η, ζ) ∈ {−1, +1}³ in ordine standard.
const XI = [-1, 1, 1, -1, -1, 1, 1, -1];
const ETA = [-1, -1, 1, 1, -1, -1, 1, 1];
const ZETA = [-1, -1, -1, -1, 1, 1, 1, 1];

// Nodi locali di ogni faccia: −x, +x, −y, +y, −z, +z.
const FACCE = [[0, 3, 7, 4], [1, 2, 6, 5], [0, 1, 5, 4], [3, 2, 6, 7], [0, 1, 2, 3], [4, 5, 6, 7]];

/** Legame elastico isotropo 6×6, deformazioni [εxx εyy εzz γxy γyz γzx]. */
export function matriceD(E, nu) {
  const l = (E * nu) / ((1 + nu) * (1 - 2 * nu));
  const m = E / (2 * (1 + nu));
  const D = new Float64Array(36);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) D[i * 6 + j] = l + (i === j ? 2 * m : 0);
  for (let i = 3; i < 6; i++) D[i * 6 + i] = m;
  return D;
}

/** Matrice deformazione-spostamento B (6×24) nel punto (ξ, η, ζ) di un voxel hx×hy×hz. */
export function matriceB(xi, eta, zeta, hx, hy, hz) {
  const B = new Float64Array(6 * 24);
  for (let a = 0; a < 8; a++) {
    // dN/dx = dN/dξ · 2/hx, con dN/dξ = ξa (1 + η ηa)(1 + ζ ζa) / 8
    const dx = (XI[a] * (1 + eta * ETA[a]) * (1 + zeta * ZETA[a])) / (4 * hx);
    const dy = (ETA[a] * (1 + xi * XI[a]) * (1 + zeta * ZETA[a])) / (4 * hy);
    const dz = (ZETA[a] * (1 + xi * XI[a]) * (1 + eta * ETA[a])) / (4 * hz);
    const c = 3 * a;
    B[c] = dx;
    B[24 + c + 1] = dy;
    B[48 + c + 2] = dz;
    B[72 + c] = dy; B[72 + c + 1] = dx;
    B[96 + c + 1] = dz; B[96 + c + 2] = dy;
    B[120 + c] = dz; B[120 + c + 2] = dx;
  }
  return B;
}

function prodottoDB(D, B) {
  const DB = new Float64Array(6 * 24);
  for (let i = 0; i < 6; i++)
    for (let c = 0; c < 24; c++) {
      let s = 0;
      for (let k = 0; k < 6; k++) s += D[i * 6 + k] * B[k * 24 + c];
      DB[i * 24 + c] = s;
    }
  return DB;
}

/** Rigidezza dell'elemento 24×24: Σ Bᵀ D B · detJ sui 2×2×2 punti di Gauss (pesi 1). */
export function matriceKe(E, nu, hx, hy, hz) {
  const D = matriceD(E, nu);
  const g = 1 / Math.sqrt(3);
  const detJ = (hx * hy * hz) / 8;
  const K = new Float64Array(576);
  for (const xi of [-g, g])
    for (const eta of [-g, g])
      for (const zeta of [-g, g]) {
        const B = matriceB(xi, eta, zeta, hx, hy, hz);
        const DB = prodottoDB(D, B);
        for (let r = 0; r < 24; r++)
          for (let c = 0; c < 24; c++) {
            let s = 0;
            for (let k = 0; k < 6; k++) s += B[k * 24 + r] * DB[k * 24 + c];
            K[r * 24 + c] += s * detJ;
          }
      }
  return K;
}

/**
 * Crea il modello.
 * voxel: Uint8Array di nx·ny·nz, indice v = i + nx·(j + ny·k); 0 = vuoto, n = materiali[n − 1].
 * h: lato del voxel, numero o [hx, hy, hz]. origine: angolo (i, j, k) = (0, 0, 0).
 * materiali: [{ E, nu, snervamento? }].
 */
export function creaModello({ nx, ny, nz, h, voxel, materiali, origine = [0, 0, 0] }) {
  const [hx, hy, hz] = typeof h === 'number' ? [h, h, h] : h;
  const NX = nx + 1, NY = ny + 1, NZ = nz + 1;
  const nn = NX * NY * NZ, ndof = 3 * nn;
  let ne = 0;
  for (let v = 0; v < voxel.length; v++) if (voxel[v]) ne++;
  const base = new Int32Array(ne), mat = new Uint8Array(ne), vox = new Int32Array(ne);
  const usato = new Uint8Array(nn);
  const off = new Int32Array(8);
  for (let a = 0; a < 8; a++) off[a] = (XI[a] + 1) / 2 + NX * ((ETA[a] + 1) / 2 + NY * ((ZETA[a] + 1) / 2));
  let e = 0;
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const v = i + nx * (j + ny * k);
        if (!voxel[v]) continue;
        if (voxel[v] > materiali.length) throw new Error(`voxel ${v}: materiale ${voxel[v]} inesistente`);
        const b = i + NX * (j + NY * k);
        base[e] = b; mat[e] = voxel[v] - 1; vox[e] = v;
        for (let a = 0; a < 8; a++) usato[b + off[a]] = 1;
        e++;
      }
  const dofOff = new Int32Array(24);
  for (let a = 0; a < 8; a++) for (let d = 0; d < 3; d++) dofOff[3 * a + d] = 3 * off[a] + d;
  const B0 = matriceB(0, 0, 0, hx, hy, hz);
  return {
    nx, ny, nz, hx, hy, hz, origine, NX, NY, NZ, nn, ndof, ne,
    voxel, base, mat, vox, usato, off, dofOff, materiali,
    Ke: materiali.map((m) => matriceKe(m.E, m.nu, hx, hy, hz)),
    DB0: materiali.map((m) => prodottoDB(matriceD(m.E, m.nu), B0)),
    fisso: new Uint8Array(ndof),
    f: new Float64Array(ndof),
  };
}

/** Coordinate del nodo n. */
export function posNodo(m, n) {
  const i = n % m.NX, j = ((n / m.NX) | 0) % m.NY, k = (n / (m.NX * m.NY)) | 0;
  return [m.origine[0] + i * m.hx, m.origine[1] + j * m.hy, m.origine[2] + k * m.hz];
}

/** Incastra (spostamento zero) i nodi usati per cui filtro(x, y, z) è vero; dir sceglie ux, uy, uz. */
export function incastra(m, filtro, dir = [true, true, true]) {
  let n0 = 0;
  for (let n = 0; n < m.nn; n++) {
    if (!m.usato[n]) continue;
    const [x, y, z] = posNodo(m, n);
    if (!filtro(x, y, z)) continue;
    for (let d = 0; d < 3; d++) if (dir[d]) m.fisso[3 * n + d] = 1;
    n0++;
  }
  return n0;
}

/**
 * Distribuisce la forza totale F = [Fx, Fy, Fz] sulle facce esterne dei voxel scelte da
 * filtro(cx, cy, cz, faccia), con faccia 0..5 = −x, +x, −y, +y, −z, +z: trazione uniforme,
 * carichi nodali coerenti (un quarto dell'area della faccia a ogni suo nodo).
 */
export function forzaSuFacce(m, filtro, F) {
  const { nx, ny, nz, hx, hy, hz, voxel, base, vox, off, ne } = m;
  const scelte = [];
  let area = 0;
  const aree = [hy * hz, hy * hz, hx * hz, hx * hz, hx * hy, hx * hy];
  for (let e = 0; e < ne; e++) {
    const v = vox[e];
    const i = v % nx, j = ((v / nx) | 0) % ny, k = (v / (nx * ny)) | 0;
    const vicini = [
      i > 0 ? voxel[v - 1] : 0, i < nx - 1 ? voxel[v + 1] : 0,
      j > 0 ? voxel[v - nx] : 0, j < ny - 1 ? voxel[v + nx] : 0,
      k > 0 ? voxel[v - nx * ny] : 0, k < nz - 1 ? voxel[v + nx * ny] : 0,
    ];
    const cx = m.origine[0] + (i + 0.5) * hx, cy = m.origine[1] + (j + 0.5) * hy, cz = m.origine[2] + (k + 0.5) * hz;
    for (let f = 0; f < 6; f++) {
      if (vicini[f]) continue;
      const s = f & 1 ? 0.5 : -0.5;
      const p = [cx, cy, cz];
      p[f >> 1] += s * [hx, hy, hz][f >> 1];
      if (!filtro(p[0], p[1], p[2], f)) continue;
      scelte.push(e, f);
      area += aree[f];
    }
  }
  if (!area) throw new Error('forzaSuFacce: nessuna faccia scelta');
  for (let q = 0; q < scelte.length; q += 2) {
    const e = scelte[q], f = scelte[q + 1];
    const w = aree[f] / area / 4;
    for (const a of FACCE[f]) {
      const n = base[e] + off[a];
      for (let d = 0; d < 3; d++) m.f[3 * n + d] += F[d] * w;
    }
  }
  return { facce: scelte.length / 2, area };
}

/** y = K·x, elemento per elemento. */
export function prodotto(m, x, y) {
  const { ne, base, mat, dofOff, Ke } = m;
  const xe = new Float64Array(24);
  y.fill(0);
  for (let e = 0; e < ne; e++) {
    const b3 = 3 * base[e];
    const K = Ke[mat[e]];
    for (let a = 0; a < 24; a++) xe[a] = x[b3 + dofOff[a]];
    for (let a = 0, r = 0; a < 24; a++, r += 24) {
      let s = 0;
      for (let c = 0; c < 24; c++) s += K[r + c] * xe[c];
      y[b3 + dofOff[a]] += s;
    }
  }
}

/**
 * Gradiente coniugato con precondizionatore di Jacobi (quello chiesto) oppure, con
 * multigriglia: true, con un ciclo a V di multigriglia geometrica (vedi sotto).
 * Si ferma quando ‖r‖ ≤ tol·‖f‖ (sui gradi di libertà liberi) o a maxIter.
 * u0: soluzione di partenza (per esempio quella di prima, dopo una piccola modifica).
 */
export function risolvi(m, { tol = 1e-8, maxIter = 20000, u0 = null, multigriglia = false } = {}) {
  const t0 = ora();
  const { ndof, ne, base, mat, dofOff, Ke, usato, fisso, f } = m;
  const diag = new Float64Array(ndof);
  for (let e = 0; e < ne; e++) {
    const b3 = 3 * base[e], K = Ke[mat[e]];
    for (let a = 0; a < 24; a++) diag[b3 + dofOff[a]] += K[a * 25];
  }
  const inv = new Float64Array(ndof);
  const blocc = [];
  for (let d = 0; d < ndof; d++) {
    if (fisso[d] || !usato[(d / 3) | 0] || diag[d] === 0) blocc.push(d);
    else inv[d] = 1 / diag[d];
  }
  const B = Int32Array.from(blocc);
  if (B.length === ndof) throw new Error('nessun grado di libertà libero');
  const x = u0 ? Float64Array.from(u0) : new Float64Array(ndof);
  const r = new Float64Array(ndof), z = new Float64Array(ndof), p = new Float64Array(ndof), q = new Float64Array(ndof);
  for (let i = 0; i < B.length; i++) x[B[i]] = 0;
  prodotto(m, x, q);
  for (let d = 0; d < ndof; d++) r[d] = f[d] - q[d];
  for (let i = 0; i < B.length; i++) r[B[i]] = 0;
  let nf = 0;
  for (let d = 0; d < ndof; d++) if (inv[d]) nf += f[d] * f[d];
  nf = Math.sqrt(nf);
  if (nf === 0) return { u: x, iterazioni: 0, residuo: 0, convergito: true, ms: ora() - t0, msProdotto: 0 };
  const mg = multigriglia ? creaMultigriglia(m, inv, B) : null;
  const msPreparazione = ora() - t0;
  let rz = 0, rr = 0;
  if (mg) mg.applica(r, z);
  else for (let d = 0; d < ndof; d++) z[d] = inv[d] * r[d];
  for (let d = 0; d < ndof; d++) { p[d] = z[d]; rz += r[d] * z[d]; rr += r[d] * r[d]; }
  rr = Math.sqrt(rr);
  let it = 0, msProdotto = 0;
  while (it < maxIter && rr > tol * nf) {
    const tp = ora();
    prodotto(m, p, q);
    msProdotto += ora() - tp;
    for (let i = 0; i < B.length; i++) q[B[i]] = 0;
    let pq = 0;
    for (let d = 0; d < ndof; d++) pq += p[d] * q[d];
    const alfa = rz / pq;
    let rzn = 0, rn = 0;
    if (mg) {
      for (let d = 0; d < ndof; d++) {
        x[d] += alfa * p[d];
        const rd = r[d] - alfa * q[d];
        r[d] = rd;
        rn += rd * rd;
      }
      mg.applica(r, z);
      for (let d = 0; d < ndof; d++) rzn += r[d] * z[d];
    } else {
      for (let d = 0; d < ndof; d++) {
        x[d] += alfa * p[d];
        const rd = r[d] - alfa * q[d];
        r[d] = rd;
        const zd = inv[d] * rd;
        z[d] = zd;
        rzn += rd * zd;
        rn += rd * rd;
      }
    }
    const beta = rzn / rz;
    rz = rzn;
    for (let d = 0; d < ndof; d++) p[d] = z[d] + beta * p[d];
    rr = Math.sqrt(rn);
    it++;
  }
  return {
    u: x, iterazioni: it, residuo: rr / nf, convergito: rr <= tol * nf, ms: ora() - t0, msProdotto, msPreparazione,
    livelli: mg ? mg.livelli.map((L) => [L.nx, L.ny, L.nz]) : null,
  };
}

// ---------------------------------------------------------------- multigriglia geometrica
// Precondizionatore: un ciclo a V. Ogni livello grossolano raddoppia il voxel; una cella
// grossolana pesa la frazione di rigidezza dei suoi 8 figli (rigidezza ridiscretizzata, non
// di Galerkin). Lisciatore: Jacobi smorzato con ω = 4/(3·λmax), λmax stimato con 12 passi di
// potenza; interpolazione trilineare e restrizione trasposta; Cholesky denso sull'ultimo.
// Un grado di libertà grossolano è bloccato se tocca un grado di libertà fine bloccato.

const OFF8 = (NX, NY) => {
  const off = new Int32Array(8);
  for (let a = 0; a < 8; a++) off[a] = (XI[a] + 1) / 2 + NX * ((ETA[a] + 1) / 2 + NY * ((ZETA[a] + 1) / 2));
  return off;
};

function prodottoPesato(L, x, y) {
  const { ne, base, w, dofOff, Ke } = L;
  const xe = new Float64Array(24);
  y.fill(0);
  for (let e = 0; e < ne; e++) {
    const b3 = 3 * base[e], we = w[e];
    for (let a = 0; a < 24; a++) xe[a] = x[b3 + dofOff[a]];
    for (let a = 0, r = 0; a < 24; a++, r += 24) {
      let s = 0;
      for (let c = 0; c < 24; c++) s += Ke[r + c] * xe[c];
      y[b3 + dofOff[a]] += we * s;
    }
  }
}

// Interpolazione lungo un asse: il nodo fine I prende dai nodi grossolani i0, i1 con pesi w0, w1.
function asse(N) {
  const i0 = new Int32Array(N), i1 = new Int32Array(N), w0 = new Float64Array(N), w1 = new Float64Array(N);
  for (let I = 0; I < N; I++) {
    if (I & 1) { i0[I] = (I - 1) >> 1; i1[I] = (I + 1) >> 1; w0[I] = w1[I] = 0.5; }
    else { i0[I] = i1[I] = I >> 1; w0[I] = 1; w1[I] = 0; }
  }
  return { i0, i1, w0, w1 };
}

// Applica fn(nodoFine, nodoGrosso, peso) a ogni coppia con peso > 0.
function perCoppie(F, C, ax, ay, az, fn) {
  for (let K = 0; K < F.NZ; K++)
    for (let J = 0; J < F.NY; J++)
      for (let I = 0; I < F.NX; I++) {
        const n = I + F.NX * (J + F.NY * K);
        if (!F.usato[n]) continue;
        for (let c = 0; c < 8; c++) {
          const wx = c & 1 ? ax.w1[I] : ax.w0[I], wy = c & 2 ? ay.w1[J] : ay.w0[J], wz = c & 4 ? az.w1[K] : az.w0[K];
          const wt = wx * wy * wz;
          if (!wt) continue;
          const ic = c & 1 ? ax.i1[I] : ax.i0[I], jc = c & 2 ? ay.i1[J] : ay.i0[J], kc = c & 4 ? az.i1[K] : az.i0[K];
          fn(n, ic + C.NX * (jc + C.NY * kc), wt);
        }
      }
}

// Diagonale, inverso (0 sui bloccati) ed elenco dei bloccati di un livello.
function chiudiLivello(L) {
  const diag = new Float64Array(L.ndof);
  for (let e = 0; e < L.ne; e++) {
    const b3 = 3 * L.base[e];
    for (let a = 0; a < 24; a++) diag[b3 + L.dofOff[a]] += L.w[e] * L.Ke[a * 25];
  }
  L.inv = new Float64Array(L.ndof);
  const blocc = [];
  for (let d = 0; d < L.ndof; d++) {
    if (L.fisso[d] || !L.usato[(d / 3) | 0] || diag[d] === 0) blocc.push(d);
    else L.inv[d] = 1 / diag[d];
  }
  L.blocc = Int32Array.from(blocc);
}

function livelloGrosso(F, Eref, nu) {
  const nx = Math.ceil(F.nx / 2), ny = Math.ceil(F.ny / 2), nz = Math.ceil(F.nz / 2);
  const NX = nx + 1, NY = ny + 1, NZ = nz + 1, nn = NX * NY * NZ, ndof = 3 * nn;
  const celle = new Float64Array(nx * ny * nz);
  for (let k = 0; k < F.nz; k++)
    for (let j = 0; j < F.ny; j++)
      for (let i = 0; i < F.nx; i++) {
        const c = F.celle[i + F.nx * (j + F.ny * k)];
        if (c) celle[(i >> 1) + nx * ((j >> 1) + ny * (k >> 1))] += c / 8;
      }
  let ne = 0;
  for (let c = 0; c < celle.length; c++) if (celle[c]) ne++;
  const base = new Int32Array(ne), w = new Float64Array(ne), usato = new Uint8Array(nn);
  const off = OFF8(NX, NY);
  let e = 0;
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const c = celle[i + nx * (j + ny * k)];
        if (!c) continue;
        const b = i + NX * (j + NY * k);
        base[e] = b; w[e] = c; e++;
        for (let a = 0; a < 8; a++) usato[b + off[a]] = 1;
      }
  const dofOff = new Int32Array(24);
  for (let a = 0; a < 8; a++) for (let d = 0; d < 3; d++) dofOff[3 * a + d] = 3 * off[a] + d;
  const C = {
    nx, ny, nz, NX, NY, NZ, nn, ndof, ne, base, w, usato, dofOff, celle,
    hx: 2 * F.hx, hy: 2 * F.hy, hz: 2 * F.hz, fisso: new Uint8Array(ndof),
  };
  C.Ke = matriceKe(Eref, nu, C.hx, C.hy, C.hz);
  const ax = asse(F.NX), ay = asse(F.NY), az = asse(F.NZ);
  perCoppie(F, C, ax, ay, az, (n, c) => {
    for (let d = 0; d < 3; d++) if (F.fisso[3 * n + d]) C.fisso[3 * c + d] = 1;
  });
  chiudiLivello(C);
  C.prodotto = (x, y) => prodottoPesato(C, x, y);
  return { C, ax, ay, az };
}

function cholesky(L) {
  const liberi = [];
  for (let d = 0; d < L.ndof; d++) if (L.inv[d]) liberi.push(d);
  const n = liberi.length, idx = new Int32Array(L.ndof).fill(-1);
  liberi.forEach((d, i) => (idx[d] = i));
  const A = new Float64Array(n * n);
  for (let e = 0; e < L.ne; e++) {
    const b3 = 3 * L.base[e], we = L.w[e];
    for (let a = 0; a < 24; a++) {
      const ia = idx[b3 + L.dofOff[a]];
      if (ia < 0) continue;
      for (let c = 0; c < 24; c++) {
        const ic = idx[b3 + L.dofOff[c]];
        if (ic >= 0) A[ia * n + ic] += we * L.Ke[a * 24 + c];
      }
    }
  }
  for (let j = 0; j < n; j++) {
    let s = A[j * n + j];
    for (let k = 0; k < j; k++) s -= A[j * n + k] ** 2;
    if (!(s > 0)) throw new Error('multigriglia: livello grossolano singolare');
    const l = Math.sqrt(s);
    A[j * n + j] = l;
    for (let i = j + 1; i < n; i++) {
      let t = A[i * n + j];
      for (let k = 0; k < j; k++) t -= A[i * n + k] * A[j * n + k];
      A[i * n + j] = t / l;
    }
  }
  const y = new Float64Array(n);
  return (b, x) => {
    for (let i = 0; i < n; i++) {
      let s = b[liberi[i]];
      for (let k = 0; k < i; k++) s -= A[i * n + k] * y[k];
      y[i] = s / A[i * n + i];
    }
    for (let i = n - 1; i >= 0; i--) {
      let s = y[i];
      for (let k = i + 1; k < n; k++) s -= A[k * n + i] * y[k];
      y[i] = s / A[i * n + i];
    }
    x.fill(0);
    for (let i = 0; i < n; i++) x[liberi[i]] = y[i];
  };
}

function lambdaMax(L) {
  let v = new Float64Array(L.ndof), t = new Float64Array(L.ndof), lam = 1;
  for (let d = 0; d < L.ndof; d++) v[d] = L.inv[d] ? 1 + 0.37 * Math.sin(d) : 0;
  for (let it = 0; it < 12; it++) {
    L.prodotto(v, t);
    let num = 0, den = 0;
    for (let d = 0; d < L.ndof; d++) { t[d] *= L.inv[d]; num += t[d] * t[d]; den += v[d] * v[d]; }
    lam = Math.sqrt(num / den);
    [v, t] = [t, v];
  }
  return lam;
}

function creaMultigriglia(m, inv, blocc, { maxGrossi = 600, passi = 2 } = {}) {
  const Eref = m.materiali[0].E, nu = m.materiali[0].nu;
  const celle = new Float64Array(m.nx * m.ny * m.nz);
  for (let e = 0; e < m.ne; e++) celle[m.vox[e]] = m.materiali[m.mat[e]].E / Eref;
  const fine = {
    nx: m.nx, ny: m.ny, nz: m.nz, NX: m.NX, NY: m.NY, NZ: m.NZ, ndof: m.ndof, hx: m.hx, hy: m.hy, hz: m.hz,
    celle, fisso: m.fisso, usato: m.usato, inv, blocc, prodotto: (x, y) => prodotto(m, x, y),
  };
  const livelli = [fine], ponti = [];
  for (;;) {
    const L = livelli[livelli.length - 1];
    let liberi = 0;
    for (let d = 0; d < L.ndof; d++) if (L.inv[d]) liberi++;
    if (liberi <= maxGrossi || livelli.length >= 12) break;
    const { C, ax, ay, az } = livelloGrosso(L, Eref, nu);
    livelli.push(C);
    ponti.push({ ax, ay, az });
  }
  const ultimo = livelli.length - 1;
  const risolviUltimo = ultimo > 0 ? cholesky(livelli[ultimo]) : null;
  const omega = livelli.map((L, l) => (l < ultimo ? 4 / (3 * lambdaMax(L)) : 0));
  const xs = livelli.map((L) => new Float64Array(L.ndof));
  const bs = livelli.map((L) => new Float64Array(L.ndof));
  const ts = livelli.map((L) => new Float64Array(L.ndof));

  const liscia = (L, b, x, t, om) => {
    L.prodotto(x, t);
    for (let d = 0; d < L.ndof; d++) x[d] += om * L.inv[d] * (b[d] - t[d]);
  };
  const ciclo = (l, b, x) => {
    if (l === ultimo) { risolviUltimo(b, x); return; }
    const L = livelli[l], C = livelli[l + 1], t = ts[l], om = omega[l], P = ponti[l];
    for (let d = 0; d < L.ndof; d++) x[d] = om * L.inv[d] * b[d];
    for (let s = 1; s < passi; s++) liscia(L, b, x, t, om);
    L.prodotto(x, t);
    for (let d = 0; d < L.ndof; d++) t[d] = b[d] - t[d];
    for (let i = 0; i < L.blocc.length; i++) t[L.blocc[i]] = 0;
    const bc = bs[l + 1], xc = xs[l + 1];
    bc.fill(0);
    perCoppie(L, C, P.ax, P.ay, P.az, (n, c, wt) => {
      bc[3 * c] += wt * t[3 * n]; bc[3 * c + 1] += wt * t[3 * n + 1]; bc[3 * c + 2] += wt * t[3 * n + 2];
    });
    for (let i = 0; i < C.blocc.length; i++) bc[C.blocc[i]] = 0;
    ciclo(l + 1, bc, xc);
    t.fill(0);
    perCoppie(L, C, P.ax, P.ay, P.az, (n, c, wt) => {
      t[3 * n] += wt * xc[3 * c]; t[3 * n + 1] += wt * xc[3 * c + 1]; t[3 * n + 2] += wt * xc[3 * c + 2];
    });
    for (let i = 0; i < L.blocc.length; i++) t[L.blocc[i]] = 0;
    for (let d = 0; d < L.ndof; d++) x[d] += t[d];
    for (let s = 0; s < passi; s++) liscia(L, b, x, t, om);
  };
  return {
    livelli,
    applica(r, z) {
      if (ultimo === 0) { for (let d = 0; d < r.length; d++) z[d] = inv[d] * r[d]; return; }
      ciclo(0, r, z);
    },
  };
}

/**
 * Sforzi al centro di ogni elemento: s = [σxx σyy σzz τxy τyz τzx] (6 per elemento) e von Mises.
 * Per un voxel parziale (materiale con frazione) è lo sforzo del materiale: diviso per la frazione.
 */
export function sforzi(m, u) {
  const { ne, base, mat, dofOff, DB0 } = m;
  const vm = new Float64Array(ne), s = new Float64Array(6 * ne);
  const ue = new Float64Array(24);
  const scala = m.materiali.map((q) => 1 / (q.frazione || 1));
  for (let e = 0; e < ne; e++) {
    const b3 = 3 * base[e], DB = DB0[mat[e]], sc = scala[mat[e]];
    for (let a = 0; a < 24; a++) ue[a] = u[b3 + dofOff[a]];
    for (let i = 0; i < 6; i++) {
      let t = 0;
      for (let c = 0; c < 24; c++) t += DB[i * 24 + c] * ue[c];
      s[6 * e + i] = t * sc;
    }
    const sx = s[6 * e], sy = s[6 * e + 1], sz = s[6 * e + 2];
    const txy = s[6 * e + 3], tyz = s[6 * e + 4], tzx = s[6 * e + 5];
    vm[e] = Math.sqrt(0.5 * ((sx - sy) ** 2 + (sy - sz) ** 2 + (sz - sx) ** 2) + 3 * (txy * txy + tyz * tyz + tzx * tzx));
  }
  return { vm, s };
}

/** Fattore di sicurezza per elemento: snervamento del suo materiale / von Mises. */
export function fattoreSicurezza(m, vm) {
  const fs = new Float64Array(m.ne);
  for (let e = 0; e < m.ne; e++) fs[e] = m.materiali[m.mat[e]].snervamento / Math.max(vm[e], 1e-30);
  return fs;
}

/** Rischio 0 (blu) … 1 (rosso): 1 sotto fs = 1, 0 sopra fsSicuro, in scala logaritmica in mezzo. */
export function rischio(fs, fsSicuro = 3) {
  const t = Math.log(fsSicuro / fs) / Math.log(fsSicuro);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

// ---------------------------------------------------------------- voxelizzazione

/** Riempie la griglia valutando dentro(x, y, z) → 0 (vuoto) o indice di materiale, al centro di ogni voxel. */
export function voxelizza({ nx, ny, nz, h, origine = [0, 0, 0] }, dentro) {
  const [hx, hy, hz] = typeof h === 'number' ? [h, h, h] : h;
  const voxel = new Uint8Array(nx * ny * nz);
  for (let k = 0; k < nz; k++) {
    const z = origine[2] + (k + 0.5) * hz;
    for (let j = 0; j < ny; j++) {
      const y = origine[1] + (j + 0.5) * hy;
      for (let i = 0; i < nx; i++) voxel[i + nx * (j + ny * k)] = +dentro(origine[0] + (i + 0.5) * hx, y, z) | 0;
    }
  }
  return voxel;
}

/**
 * Come voxelizza, ma un voxel di bordo (angoli discordi, o centro dentro e angoli fuori) pesa
 * la sua frazione piena, contata su campioni³ punti e arrotondata a Q livelli. Restituisce
 * { voxel, materiali }: il livello q usa E·q/Q e porta frazione q/Q, così sforzi() riporta lo
 * sforzo del materiale (diviso per la frazione) e il risolutore resta lo stesso.
 */
export function voxelizzaFrazione({ nx, ny, nz, h, origine = [0, 0, 0] }, dentro, materiale, { Q = 16, campioni = 4 } = {}) {
  const [hx, hy, hz] = typeof h === 'number' ? [h, h, h] : h;
  const [x0, y0, z0] = origine, NX = nx + 1, NY = ny + 1;
  const angoli = new Uint8Array(NX * NY * (nz + 1));
  for (let K = 0; K <= nz; K++)
    for (let J = 0; J < NY; J++)
      for (let I = 0; I < NX; I++) angoli[I + NX * (J + NY * K)] = dentro(x0 + I * hx, y0 + J * hy, z0 + K * hz) ? 1 : 0;
  const voxel = new Uint8Array(nx * ny * nz);
  const off = OFF8(NX, NY), n3 = campioni ** 3;
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const b = i + NX * (j + NY * k);
        let c8 = 0;
        for (let a = 0; a < 8; a++) c8 += angoli[b + off[a]];
        const v = i + nx * (j + ny * k);
        if (c8 === 8) { voxel[v] = Q; continue; }
        if (c8 === 0 && !dentro(x0 + (i + 0.5) * hx, y0 + (j + 0.5) * hy, z0 + (k + 0.5) * hz)) continue;
        let n = 0;
        for (let c = 0; c < campioni; c++)
          for (let bb = 0; bb < campioni; bb++)
            for (let a = 0; a < campioni; a++)
              if (dentro(x0 + (i + (a + 0.5) / campioni) * hx, y0 + (j + (bb + 0.5) / campioni) * hy, z0 + (k + (c + 0.5) / campioni) * hz)) n++;
        voxel[v] = Math.round((Q * n) / n3);
      }
  const materiali = [];
  for (let q = 1; q <= Q; q++) materiali.push({ ...materiale, E: (materiale.E * q) / Q, frazione: q / Q });
  return { voxel, materiali };
}

/** Forme primitive: funzioni dentro(x, y, z) → bool. Unione, differenza e intersezione si fanno con && e ||. */
export const forme = {
  scatola: ([x0, y0, z0], [x1, y1, z1]) => (x, y, z) => x >= x0 && x <= x1 && y >= y0 && y <= y1 && z >= z0 && z <= z1,
  // Asse parallelo a z, centro (cx, cy), da z0 a z1.
  cilindro: ([cx, cy], r, z0, z1) => (x, y, z) => z >= z0 && z <= z1 && (x - cx) ** 2 + (y - cy) ** 2 <= r * r,
  tubo: ([cx, cy], ri, re, z0, z1) => (x, y, z) => {
    if (z < z0 || z > z1) return false;
    const d = (x - cx) ** 2 + (y - cy) ** 2;
    return d >= ri * ri && d <= re * re;
  },
  // Settore di guscio cilindrico: asse parallelo a y per (cx, cz), raggio medio R, spessore t,
  // apertura totale fi (radianti) centrata sulla direzione +z, larghezza da y0 a y1.
  piastraCurva: ([cx, cz], R, t, fi, y0, y1) => (x, y, z) => {
    if (y < y0 || y > y1) return false;
    const dx = x - cx, dz = z - cz, rho = Math.hypot(dx, dz);
    return Math.abs(rho - R) <= t / 2 && Math.abs(Math.atan2(dx, dz)) <= fi / 2;
  },
};

/**
 * Voxelizza una mesh chiusa (triangoli: 9 numeri ciascuno) con il test di parità:
 * per ogni colonna (j, k) un raggio lungo x dal centro dei voxel, si ordinano le
 * intersezioni e si riempie tra la prima e la seconda, la terza e la quarta, ecc.
 * Il raggio è spostato di una frazione irrazionale di voxel per non cadere su spigoli e vertici.
 */
export function voxelizzaMesh({ nx, ny, nz, h, origine = [0, 0, 0] }, tri, materiale = 1) {
  const [hx, hy, hz] = typeof h === 'number' ? [h, h, h] : h;
  const [x0, y0, z0] = origine;
  const ey = 1.2345678e-6 * hy, ez = 2.3456789e-6 * hz;
  const colonne = new Array(ny * nz);
  for (let t = 0; t < tri.length; t += 9) {
    const ax = tri[t], ay = tri[t + 1], az = tri[t + 2];
    const bx = tri[t + 3], by = tri[t + 4], bz = tri[t + 5];
    const cx = tri[t + 6], cy = tri[t + 7], cz = tri[t + 8];
    const d = (by - ay) * (cz - az) - (cy - ay) * (bz - az);
    if (d === 0) continue; // triangolo parallelo ai raggi
    const j0 = Math.max(0, Math.ceil((Math.min(ay, by, cy) - y0 - ey) / hy - 0.5));
    const j1 = Math.min(ny - 1, Math.floor((Math.max(ay, by, cy) - y0 - ey) / hy - 0.5));
    const k0 = Math.max(0, Math.ceil((Math.min(az, bz, cz) - z0 - ez) / hz - 0.5));
    const k1 = Math.min(nz - 1, Math.floor((Math.max(az, bz, cz) - z0 - ez) / hz - 0.5));
    for (let k = k0; k <= k1; k++) {
      const pz = z0 + (k + 0.5) * hz + ez;
      for (let j = j0; j <= j1; j++) {
        const py = y0 + (j + 0.5) * hy + ey;
        const w1 = ((py - ay) * (cz - az) - (cy - ay) * (pz - az)) / d;
        const w2 = ((by - ay) * (pz - az) - (py - ay) * (bz - az)) / d;
        if (w1 < 0 || w2 < 0 || w1 + w2 > 1) continue;
        const c = j + ny * k;
        (colonne[c] || (colonne[c] = [])).push(ax + w1 * (bx - ax) + w2 * (cx - ax));
      }
    }
  }
  const voxel = new Uint8Array(nx * ny * nz);
  let dispari = 0;
  for (let c = 0; c < colonne.length; c++) {
    const xs = colonne[c];
    if (!xs) continue;
    xs.sort((a, b) => a - b);
    if (xs.length & 1) dispari++;
    for (let q = 0; q + 1 < xs.length; q += 2) {
      const i0 = Math.max(0, Math.ceil((xs[q] - x0) / hx - 0.5));
      const i1 = Math.min(nx - 1, Math.floor((xs[q + 1] - x0) / hx - 0.5));
      for (let i = i0; i <= i1; i++) voxel[i + nx * c] = materiale;
    }
  }
  return { voxel, colonneDispari: dispari };
}
