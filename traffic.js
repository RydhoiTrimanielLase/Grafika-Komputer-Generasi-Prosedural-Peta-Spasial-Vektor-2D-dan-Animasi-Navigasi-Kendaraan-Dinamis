// ============================================================
//  traffic.js — Simulasi Lalu Lintas NPC Otonom
//  Mata Kuliah : INF11114 Grafika Komputer — UMRAH
//  Semester    : Genap 2025/2026
//  Dosen       : Tekad Matulatan & Nolan Efranda
// ============================================================
//  Kontributor : Riki Andika Saputra (2401020134)
//  Peran       : Generasi Peta & Traffic Simulation
//  Modul       : /mapgen  /graph
// ============================================================
//
//  DESKRIPSI:
//  File ini mensimulasikan lalu lintas kendaraan otonom
//  (NPC) yang bergerak secara paralel di seluruh jaringan
//  jalan kota tanpa interaksi pengguna.
//
//  ALGORITMA & TEKNIK GRAFIKA:
//
//  1. RANDOM WALK ON GRAPH
//     Setiap kendaraan NPC memilih edge berikutnya secara
//     acak di tiap persimpangan, menghasilkan pergerakan
//     organik yang tidak berulang di seluruh peta.
//
//  2. KURVA BÉZIER — INTERPOLASI POSISI
//     Posisi kendaraan dihitung tiap frame:
//       B(t) = (1-t)²P₀ + 2(1-t)t·P₁ + t²P₂
//     Menghasilkan gerakan halus sepanjang jalan melengkung.
//
//  3. TANGENT-BASED ROTATION
//     Arah hadap NPC dihitung dari turunan B'(t) sehingga
//     kendaraan selalu menghadap arah jalannya dengan tepat.
//
//  4. AFFINE TRANSFORM — RENDER KENDARAAN
//     ctx.save() → ctx.translate() → ctx.rotate() →
//     ctx.scale() → render emoji → ctx.restore()
//     Setiap kendaraan dirender di posisi & sudut yang benar.
//
//  REFERENSI:
//  - Shirley & Marschner (2009) Fundamentals of CG
//  - Foley et al. (1990) Computer Graphics: Principles
// ============================================================
// traffic.js v3 — Kendaraan lalu lintas lengkap (reuse VEHICLE_DEFS dari tracker.js)

class TrafficManager {
    constructor(city, num) {
        this.city = city; this.vehicles = [];
        if (!city||!city.edges||!city.edges.length) return;
        for (let i = 0; i < num; i++) this.spawnVehicle();
    }
    spawnVehicle() {
        const e = this.city.edges[Math.floor(Math.random()*this.city.edges.length)];
        const dir = Math.random()>0.5 ? 1 : -1;
        const t = Math.random();
        const r = Math.random();
        // Distribution: cars dominate, sprinkle others
        let type;
        if      (r > 0.88) type = 'bus';
        else if (r > 0.75) type = 'truck';
        else if (r > 0.58) type = 'motor';
        else if (r > 0.44) type = 'bicycle';
        else if (r > 0.38) type = 'person';
        else               type = 'car';
        this.vehicles.push(new TrafficVehicle(e, dir, t, type));
    }
    update(dt) { for (const v of this.vehicles) v.update(dt); }
    draw(ctx, view, zoom) {
        if (zoom < 0.05) return;
        for (const v of this.vehicles) v.draw(ctx, view, zoom);
    }
}

const TRAFFIC_COLORS = [
    '#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6',
    '#1abc9c','#e67e22','#c0392b','#2980b9','#27ae60',
    '#f1c40f','#8e44ad','#16a085','#d35400','#2c3e50',
    '#ff6b6b','#4ecdc4','#45b7d1','#96ceb4','#ffeaa7'
];

class TrafficVehicle {
    constructor(edge, dir, t, type) {
        this.edge = edge; this.direction = dir; this.t = t; this.type = type;
        this.speedMult = 1;
        const def = VEHICLE_DEFS[type] || VEHICLE_DEFS.car;
        this.baseSpeed = def.baseSpeed * (0.75 + Math.random() * 0.5);
        this.x=0; this.y=0; this.angle=0; this.targetAngle=0;
        this.laneOffset = (type === 'bicycle' || type === 'person') ? 55 : 30;
        this.color = TRAFFIC_COLORS[Math.floor(Math.random()*TRAFFIC_COLORS.length)];
        // traffic vehicles use scale 0.7 so they feel smaller than tracker vehicle
        this.scale = 0.7;
        this.calcLen(); this.updatePos(); this.angle = this.targetAngle;
    }
    calcLen() {
        const A=this.edge.n1, B=this.edge.n2, C=this.edge.cp;
        this.length = (Math.hypot(C.x-A.x,C.y-A.y)+Math.hypot(B.x-C.x,B.y-C.y)+Math.hypot(B.x-A.x,B.y-A.y))/2;
    }
    updatePos() {
        const A=this.edge.n1, B=this.edge.n2, C=this.edge.cp, t=this.t, mt=1-t;
        this.x = mt*mt*A.x + 2*mt*t*C.x + t*t*B.x;
        this.y = mt*mt*A.y + 2*mt*t*C.y + t*t*B.y;
        const dx = 2*mt*(C.x-A.x) + 2*t*(B.x-C.x);
        const dy = 2*mt*(C.y-A.y) + 2*t*(B.y-C.y);
        this.targetAngle = Math.atan2(dy,dx) + (this.direction===-1 ? Math.PI : 0);
    }
    update(dt) {
        this.t += (this.baseSpeed * this.speedMult / this.length) * dt * this.direction;
        let end = false;
        if (this.t>=1) { this.t=1; end=true; }
        else if (this.t<=0) { this.t=0; end=true; }
        this.updatePos();
        let diff = this.targetAngle - this.angle;
        while (diff>Math.PI) diff -= Math.PI*2;
        while (diff<-Math.PI) diff += Math.PI*2;
        this.angle += diff * Math.min(1, dt*10);
        if (end) this.nextEdge();
    }
    nextEdge() {
        const cur = this.direction===1 ? this.edge.n2 : this.edge.n1;
        const opts = cur.edges.filter(e => e.id !== this.edge.id);
        if (opts.length > 0) {
            this.edge = opts[Math.floor(Math.random()*opts.length)];
            if (this.edge.n1.id===cur.id) { this.direction=1; this.t=0; }
            else { this.direction=-1; this.t=1; }
        } else {
            this.direction *= -1;
            this.t = Math.max(0, Math.min(1, this.t));
        }
        this.calcLen();
    }
    draw(ctx, view, zoom) {
        if (this.x<view.left-100||this.x>view.right+100||this.y<view.top-100||this.y>view.bottom+100) return;
        const detail = zoom > 0.3;
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle);
        ctx.translate(0, -this.laneOffset);

        const def = VEHICLE_DEFS[this.type] || VEHICLE_DEFS.car;
        def.draw(ctx, this.scale, this.color, detail);

        ctx.restore();
    }
}
