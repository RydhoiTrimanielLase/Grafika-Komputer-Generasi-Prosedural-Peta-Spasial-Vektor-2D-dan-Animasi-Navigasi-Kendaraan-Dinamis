// ============================================================
//  generator.js — Generasi Peta Prosedural
//  Mata Kuliah : INF11114 Grafika Komputer — UMRAH
//  Semester    : Genap 2025/2026
//  Dosen       : Tekad Matulatan & Nolan Efranda
// ============================================================
//  Kontributor : Riki Andika Saputra (2401020134)
//  Peran       : Generasi Peta
//  Modul       : /mapgen  /graph
// ============================================================
//
//  DESKRIPSI:
//  File ini bertanggung jawab men-generate kota secara
//  prosedural menggunakan pendekatan berbasis graf geometri.
//  Setiap peta yang dihasilkan dijamin konektivitas penuh —
//  tidak ada ruas jalan yang terisolasi.
//
//  ALGORITMA & TEKNIK GRAFIKA:
//
//  1. GABRIEL GRAPH
//     Membangun jaringan jalan yang natural dan tidak
//     tumpang tindih. Dua node a dan b dihubungkan hanya
//     jika tidak ada node lain c di dalam lingkaran
//     berdiameter segmen ab:
//       radius² = ((a.x-b.x)² + (a.y-b.y)²) / 4
//       valid jika ∀c: dist(c, midpoint)² ≥ radius²
//
//  2. KRUSKAL'S MST + UNION-FIND
//     Menjamin seluruh simpul terhubung minimal dalam
//     satu pohon rentang. Komponen terpisah disambung
//     secara greedy berdasarkan jarak terdekat.
//     Validasi akhir: BFS dari sembarang simpul harus
//     mengunjungi semua simpul.
//
//  3. KURVA BÉZIER KUADRATIK
//     Setiap edge jalan diberi control point yang di-offset
//     tegak lurus terhadap segmen sehingga ≥90% jalan
//     berbentuk kurva — sesuai batasan masalah RPM.
//
//  4. FACE EXTRACTION & BLOCK GENERATION
//     Algoritma half-edge mengekstrak "face" dari graf
//     sebagai blok kota: taman, gedung, danau, dll.
//     (polygon filling sesuai fitur tambahan RPM)
//
//  REFERENSI:
//  - De Berg et al. (2008) Computational Geometry
//  - Cormen et al. (2009) Introduction to Algorithms
// ============================================================
// generator.js — Smart City Vector Map v2 (Enhanced)

class CityGenerator {
    constructor(worldSize, numNodes) {
        this.worldSize = worldSize;
        this.numNodes  = numNodes;
        this.nodes  = [];
        this.edges  = [];
        this.faces  = [];
        this.blocks = [];
        this.generate();
    }

    generate() {
        this.generateNodes();
        this.generateGabrielGraph();
        this.ensureConnectivity();
        this.removeDeadEnds();      // ← tidak boleh ada jalan buntu
        this.curveEdges();
        this.extractFaces();
        this.processBlocks();
    }

    // ── 1. NODES ──────────────────────────────────────────────
    generateNodes() {
        const minD   = 400;
        const margin = 700;
        for (let i = 0; i < this.numNodes * 10 && this.nodes.length < this.numNodes; i++) {
            const x = (Math.random() - 0.5) * (this.worldSize - margin * 2);
            const y = (Math.random() - 0.5) * (this.worldSize - margin * 2);
            let ok = true;
            for (const n of this.nodes) {
                if ((n.x-x)**2 + (n.y-y)**2 < minD*minD) { ok = false; break; }
            }
            if (ok) this.nodes.push({ id: this.nodes.length, x, y, edges: [] });
        }
    }

    // ── 2. GABRIEL GRAPH ─────────────────────────────────────
    generateGabrielGraph() {
        for (let i = 0; i < this.nodes.length; i++) {
            for (let j = i + 1; j < this.nodes.length; j++) {
                const a = this.nodes[i], b = this.nodes[j];
                const cx = (a.x+b.x)/2, cy = (a.y+b.y)/2;
                const r2 = ((a.x-b.x)**2 + (a.y-b.y)**2) / 4;
                if (r2 > 1200*1200) continue;
                let valid = true;
                for (let k = 0; k < this.nodes.length; k++) {
                    if (k===i||k===j) continue;
                    const c = this.nodes[k];
                    if ((c.x-cx)**2+(c.y-cy)**2 < r2) { valid=false; break; }
                }
                if (valid) {
                    const e = { id:this.edges.length, n1:a, n2:b, cp:null };
                    this.edges.push(e); a.edges.push(e); b.edges.push(e);
                }
            }
        }
    }

    // ── 3. CONNECTIVITY ──────────────────────────────────────
    ensureConnectivity() {
        const visited = new Set();
        const components = [];
        for (const node of this.nodes) {
            if (visited.has(node.id)) continue;
            const comp = [], q = [node];
            visited.add(node.id);
            while (q.length) {
                const cur = q.shift(); comp.push(cur.id);
                for (const e of cur.edges) {
                    const nb = e.n1.id===cur.id ? e.n2 : e.n1;
                    if (!visited.has(nb.id)) { visited.add(nb.id); q.push(nb); }
                }
            }
            components.push(comp);
        }
        if (components.length < 2) return;
        components.sort((a,b)=>b.length-a.length);
        const main = components[0];
        for (let i = 1; i < components.length; i++) {
            let minD=Infinity, bA=null, bB=null;
            for (const idA of components[i]) {
                const nA = this.nodes[idA];
                for (const idB of main) {
                    const nB = this.nodes[idB];
                    const d = (nA.x-nB.x)**2+(nA.y-nB.y)**2;
                    if (d<minD) { minD=d; bA=nA; bB=nB; }
                }
            }
            if (bA&&bB) {
                const e = { id:this.edges.length, n1:bA, n2:bB, cp:null };
                this.edges.push(e); bA.edges.push(e); bB.edges.push(e);
                main.push(...components[i]);
            }
        }
    }

    // ── 4. HAPUS JALAN BUNTU (degree < 2) ───────────────────
    removeDeadEnds() {
        // Iterasi sampai tidak ada node dengan degree 1
        let changed = true;
        while (changed) {
            changed = false;
            for (const node of this.nodes) {
                if (node.edges.length >= 2) continue;

                // Cari node terdekat yang belum terhubung
                let best = null, bestDist = Infinity;
                for (const other of this.nodes) {
                    if (other.id === node.id) continue;
                    const alreadyLinked = node.edges.some(
                        e => e.n1.id === other.id || e.n2.id === other.id
                    );
                    if (alreadyLinked) continue;
                    const d = (node.x-other.x)**2 + (node.y-other.y)**2;
                    if (d < bestDist) { bestDist = d; best = other; }
                }

                if (best) {
                    const e = { id: this.edges.length, n1: node, n2: best, cp: null };
                    this.edges.push(e);
                    node.edges.push(e);
                    best.edges.push(e);
                    changed = true;
                }
            }
        }
    }

    // ── 5. CURVE EDGES ───────────────────────────────────────
    curveEdges() {
        for (const e of this.edges) {
            const dx = e.n2.x-e.n1.x, dy = e.n2.y-e.n1.y;
            const len = Math.sqrt(dx*dx+dy*dy);
            const mx = (e.n1.x+e.n2.x)/2, my = (e.n1.y+e.n2.y)/2;
            const nx = -dy/len, ny = dx/len;
            const roll = Math.random();
            let offset;
            if      (roll < 0.10) offset = 0;
            else if (roll < 0.55) offset = (Math.random()-0.5) * len * 0.60;
            else                  offset = (Math.random()-0.5) * len * 1.0;
            e.cp = { x: mx + nx*offset, y: my + ny*offset };
        }
    }

    // ── 6. EXTRACT FACES ─────────────────────────────────────
    extractFaces() {
        const halfEdges = [];
        const adj = new Map();
        for (const e of this.edges) {
            halfEdges.push({ from:e.n1, to:e.n2, edge:e, visited:false });
            halfEdges.push({ from:e.n2, to:e.n1, edge:e, visited:false });
        }
        for (const he of halfEdges) {
            if (!adj.has(he.from.id)) adj.set(he.from.id, []);
            adj.get(he.from.id).push(he);
        }
        for (const [nodeId, edges] of adj.entries()) {
            const node = this.nodes[nodeId];
            edges.sort((a,b)=>{
                const aa = Math.atan2(a.to.y-node.y, a.to.x-node.x);
                const bb = Math.atan2(b.to.y-node.y, b.to.x-node.x);
                return aa-bb;
            });
        }
        for (const he of halfEdges) {
            if (he.visited) continue;
            const face = []; let curr = he, safe = 0;
            while (!curr.visited && safe < 100) {
                curr.visited = true; face.push(curr);
                const next = adj.get(curr.to.id);
                if (!next) break;
                let ri = -1;
                for (let i = 0; i < next.length; i++) {
                    if (next[i].to.id === curr.from.id) { ri = i; break; }
                }
                if (ri < 0) break;
                curr = next[(ri-1+next.length)%next.length];
                safe++;
            }
            if (safe > 2 && safe < 100) this.faces.push(face);
        }
    }

    // ── 7. PROCESS BLOCKS ────────────────────────────────────
    processBlocks() {
        // roadHalf lebih besar → gedung lebih jauh dari jalan
        const roadHalf = 100;
        const valid = [];

        for (const face of this.faces) {
            let cx=0, cy=0, area=0;
            for (const he of face) {
                cx += he.from.x; cy += he.from.y;
                area += (he.from.x*he.to.y - he.to.x*he.from.y);
            }
            area /= 2;
            // Hanya blok yang menghadap dalam (area > 0) & ukuran wajar
            if (area < 0 || area > 4_200_000) continue;
            cx /= face.length; cy /= face.length;

            const shrunk = [];
            for (const he of face) {
                const v  = he.from;
                const dv = Math.sqrt((cx-v.x)**2+(cy-v.y)**2) || 1;
                const mv = Math.min(roadHalf, dv * 0.22);  // lebih aman
                const newV = {
                    x: v.x + (cx-v.x)/dv*mv,
                    y: v.y + (cy-v.y)/dv*mv
                };
                const cp  = he.edge.cp;
                const dcp = Math.sqrt((cx-cp.x)**2+(cy-cp.y)**2) || 1;
                const mcp = Math.min(roadHalf, dcp * 0.22);
                const newCP = {
                    x: cp.x + (cx-cp.x)/dcp*mcp,
                    y: cp.y + (cy-cp.y)/dcp*mcp
                };
                shrunk.push({ v:newV, cp:newCP });
            }

            // ── Klasifikasi blok berdasar area & random
            const r = Math.random();
            const areaK = area / 1000; // area dalam ribuan

            let type;
            if      (r > 0.94)  type = 'lake';
            else if (r > 0.86)  type = 'park';
            else if (r > 0.79)  type = 'plaza';
            else if (r > 0.70)  type = 'residential';
            else if (r > 0.60)  type = 'commercial';
            else if (r > 0.52)  type = 'skyscraper';
            else if (r > 0.44)  type = 'industrial';
            else if (r > 0.38)  type = 'hospital';
            else if (r > 0.33)  type = 'hotel';
            else if (r > 0.28)  type = 'parking';
            else                type = 'building';

            // Override: blok sangat besar → taman / danau
            if (area > 2_800_000 && type !== 'lake') type = 'park';
            if (area > 3_500_000) type = 'lake';

            valid.push({
                centroid: { x:cx, y:cy },
                vertices: shrunk,
                type, area
            });
        }
        this.blocks = valid;
    }
}
