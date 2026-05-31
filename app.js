// ============================================================
//  app.js — Renderer Utama, Kamera & Transformasi Affine
//  Mata Kuliah : INF11114 Grafika Komputer — UMRAH
//  Semester    : Genap 2025/2026
//  Dosen       : Tekad Matulatan & Nolan Efranda
// ============================================================
//  Kontributor : Ardiansyah Rizki Khairi Ali (2401020044)
//                Ikhbal Maulana (2401020039)
//  Peran       : Transformasi & Kamera (Ardiansyah)
//                Rendering & UI (Ikhbal)
//  Modul       : /camera  /transform  /renderer  /ui
// ============================================================
//
//  DESKRIPSI:
//  File inti yang menangani seluruh proses rendering peta
//  ke HTML5 Canvas, sistem kamera interaktif berbasis
//  transformasi affine, input pengguna, dan render loop.
//
//  ALGORITMA & TEKNIK GRAFIKA:
//
//  1. TRANSFORMASI AFFINE — ZOOM & SCROLL (Ardiansyah)
//     World Space (koordinat peta) ↔ Screen Space (piksel).
//     Zoom berpusat pada posisi kursor menggunakan urutan:
//       translate-to-cursor → scale → translate-back
//     Implementasi: ctx.scale(zoom) + ctx.translate(x,y)
//     Scroll/pan via ctx.translate dengan smooth lerp.
//
//  2. MULTI-LAYER RENDERING / PAINTER'S ALGORITHM (Ikhbal)
//     Rendering berlapis back-to-front:
//     background → blok → pohon → jalan → persimpangan
//     → furniture → gedung 3D → kendaraan
//     Urutan ini memastikan elemen depan menutupi belakang.
//
//  3. KURVA BÉZIER — RENDERING JALAN (Ikhbal)
//     Setiap frame jalan di-render ulang dari data vektor:
//       ctx.quadraticCurveTo(cp.x, cp.y, end.x, end.y)
//     Tidak pernah pixelated pada zoom berapapun —
//     keunggulan utama representasi vektor vs raster.
//
//  4. EKSTRUSI ISOMETRIK PSEUDO-3D (Ikhbal)
//     Gedung diekstrusi dengan vektor (-0.38, -0.80).
//     Face shading via dot product arah cahaya (0.707,-0.707)
//     Painter's algorithm (sort by Y) untuk urutan render.
//
//  5. VIEWPORT CULLING (Ardiansyah)
//     inView() dan edgeInView() memeriksa objek dalam
//     area pandang sebelum digambar — menjaga 60 FPS.
//
//  6. SEEDED RANDOM — DETERMINISTIC RENDERING (Ikhbal)
//     seededRand() berbasis sin untuk detail yang konsisten
//     setiap frame tanpa menyimpan data ekstra.
//
//  REFERENSI:
//  - Foley et al. (1990) Computer Graphics: Principles
//  - Shirley & Marschner (2009) Fundamentals of CG
// ============================================================
// app.js v3 — Smart City Vector Map

const canvas        = document.getElementById('mapCanvas');
const ctx           = canvas.getContext('2d', { alpha: false });
const minimapCanvas = document.getElementById('minimapCanvas');
const mctx          = minimapCanvas.getContext('2d');

// ── STATE ────────────────────────────────────────────────────
const state = {
    camera: { x:0, y:0, zoom:0.5 },
    targetCamera: { x:0, y:0, zoom:0.5 },
    velocity: { x:0, y:0 },
    mouse: { x:0, y:0 },
    interaction: { isDragging:false, lastX:0, lastY:0 },
    config: { minZoom:0.04, maxZoom:14, zoomSens:0.0012 },
    world: { size:10000, numNodes:60 },
    transition: { active:false, alpha:0, phase:'out' },
    speedMult: 1.6,
    fps: 60,
    fpsFrames: 0,
    fpsTimer: 0,
    time: 0,
};

// ── PALETTE ──────────────────────────────────────────────────
const THEME = {
    bg:           '#1a2e1a',
    groundGrass:  '#233c1a',
    grassLight:   '#2e4e22',
    sidewalk:     '#5a5c62',
    roadOuter:    '#2a2e36',
    roadMain:     '#383d48',
    roadCenter:   '#424850',
    roadLine:     'rgba(255,255,220,0.48)',
    roadLineSub:  'rgba(255,255,220,0.28)',

    buildingColors: [
        '#c0392b','#e74c3c','#a93226',
        '#2980b9','#3498db','#1a5276',
        '#8e44ad','#9b59b6','#6c3483',
        '#d35400','#e67e22','#a04000',
        '#16a085','#1abc9c','#0e6655',
        '#f39c12','#f1c40f','#b7770d',
        '#7f8c8d','#95a5a6','#616a6b',
        '#27ae60','#2ecc71','#1e8449',
    ],
    roofColors: [
        '#922b21','#cb4335','#7b241c',
        '#1f618d','#2874a6','#154360',
        '#6c3483','#7d3c98','#512e5f',
        '#a04000','#ba4a00','#784212',
        '#117864','#148f77','#0e6655',
        '#b7770d','#d4ac0d','#9a7d0a',
        '#616a6b','#717d7e','#4d5656',
        '#1e8449','#239b56','#196f3d',
    ],
    parkFill:    '#2d6e2d', parkBorder: '#3a8c3a', parkPath: '#8a7050',
    lakeFill:    '#1b6fa8', lakeBorder: '#2980b9', lakeShimmer: 'rgba(80,180,255,0.22)',
    treeA: '#2d7d2d', treeB: '#3a8c3a', treeC: '#225522', treeD: '#4a9a2a',
    treeTrunk: '#5c3d1e', roundabout: '#2a6b2a',
};

// ── HELPERS ──────────────────────────────────────────────────
function rr(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x+r,y); c.lineTo(x+w-r,y); c.arcTo(x+w,y,x+w,y+r,r);
    c.lineTo(x+w,y+h-r); c.arcTo(x+w,y+h,x+w-r,y+h,r);
    c.lineTo(x+r,y+h); c.arcTo(x,y+h,x,y+h-r,r);
    c.lineTo(x,y+r); c.arcTo(x,y,x+r,y,r);
    c.closePath();
}
function inView(x, y, r, view) {
    return x+r>view.left && x-r<view.right && y+r>view.top && y-r<view.bottom;
}
function edgeInView(e, view) {
    const minX=Math.min(e.n1.x,e.n2.x,e.cp.x)-250, maxX=Math.max(e.n1.x,e.n2.x,e.cp.x)+250;
    const minY=Math.min(e.n1.y,e.n2.y,e.cp.y)-250, maxY=Math.max(e.n1.y,e.n2.y,e.cp.y)+250;
    return maxX>view.left && minX<view.right && maxY>view.top && minY<view.bottom;
}
function seededRand(seed) {
    let s = Math.abs(Math.sin(seed) * 43758.5453);
    return s - Math.floor(s);
}
function blockClip(c, block) {
    c.beginPath();
    c.moveTo(block.vertices[0].v.x, block.vertices[0].v.y);
    for (let i=0; i<block.vertices.length; i++) {
        const ni=(i+1)%block.vertices.length;
        c.quadraticCurveTo(block.vertices[i].cp.x, block.vertices[i].cp.y,
                           block.vertices[ni].v.x, block.vertices[ni].v.y);
    }
    c.closePath();
}

// ── EXTRA ROADS (fill sparse areas) ─────────────────────────
// Add secondary/connector roads in areas with few nearby edges
function addExtraRoads(city) {
    const ws = city.worldSize;
    // Grid of sample points — find cells with low road density
    const cellSize = 1400;
    const cells = [];
    for (let gx = -ws/2; gx < ws/2; gx += cellSize) {
        for (let gy = -ws/2; gy < ws/2; gy += cellSize) {
            const cx = gx + cellSize/2, cy = gy + cellSize/2;
            // Count edges whose midpoint is near this cell
            let nearby = 0;
            for (const e of city.edges) {
                const mx = (e.n1.x+e.n2.x)/2, my = (e.n1.y+e.n2.y)/2;
                if (Math.abs(mx-cx) < cellSize && Math.abs(my-cy) < cellSize) nearby++;
            }
            if (nearby < 2) cells.push({ cx, cy });
        }
    }

    // For each sparse cell, try to add a loop/connector using 2 nearby nodes
    for (const cell of cells) {
        // Gather nodes sorted by distance to cell center
        const sorted = city.nodes
            .map(n => ({ n, d: Math.hypot(n.x-cell.cx, n.y-cell.cy) }))
            .sort((a,b) => a.d-b.d);

        if (sorted.length < 3) continue;

        // Pick closest 3..6 candidates and try to form extra edges
        const cands = sorted.slice(0, Math.min(6, sorted.length)).map(o=>o.n);

        // Try pairs
        for (let a = 0; a < cands.length; a++) {
            for (let b = a+1; b < cands.length; b++) {
                const nA = cands[a], nB = cands[b];
                // Don't duplicate existing edge
                const exists = nA.edges.some(e =>
                    (e.n1.id===nA.id&&e.n2.id===nB.id)||(e.n1.id===nB.id&&e.n2.id===nA.id));
                if (exists) continue;
                const dist = Math.hypot(nA.x-nB.x, nA.y-nB.y);
                if (dist > 2200 || dist < 350) continue;

                // Check for edge crossing a third node (keep graph clean)
                let blocked = false;
                const mx=(nA.x+nB.x)/2, my=(nA.y+nB.y)/2;
                for (const n of city.nodes) {
                    if (n.id===nA.id||n.id===nB.id) continue;
                    if (Math.hypot(n.x-mx,n.y-my) < dist*0.22) { blocked=true; break; }
                }
                if (blocked) continue;

                // Add curved secondary edge
                const dx=nB.x-nA.x, dy=nB.y-nA.y, len=Math.sqrt(dx*dx+dy*dy);
                const nx=-dy/len, ny=dx/len;
                const offset = (Math.random()-0.5) * len * 0.55;
                const cp = { x: mx + nx*offset, y: my + ny*offset };
                const e = { id: city.edges.length, n1: nA, n2: nB, cp, isSecondary: true };
                city.edges.push(e);
                nA.edges.push(e); nB.edges.push(e);
                break; // one extra edge per cell is enough
            }
            if (cell._added) break;
        }
    }
}

// ── INIT ─────────────────────────────────────────────────────
let city, trafficManager, trackerManager;

function initCity() {
    city = new CityGenerator(state.world.size, state.world.numNodes);
    addExtraRoads(city); // ← tambah jalan di area kosong
    trafficManager = new TrafficManager(city, 90);
    trackerManager = new TrackerManager(city);
    updateStats();
}
function updateStats() {
    document.getElementById('stat-nodes').textContent = city ? city.nodes.length : '—';
    document.getElementById('stat-length').textContent = '—';
    document.getElementById('stat-time').textContent   = '—';
}

// ── RESIZE ───────────────────────────────────────────────────
function resizeCanvas() {
    const dpr = window.devicePixelRatio||1;
    canvas.width  = window.innerWidth  * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width  = window.innerWidth  + 'px';
    canvas.style.height = window.innerHeight + 'px';
    minimapCanvas.width  = 180*dpr; minimapCanvas.height = 140*dpr;
    mctx.setTransform(1,0,0,1,0,0); mctx.scale(dpr,dpr);
}
window.addEventListener('resize', resizeCanvas);

// ── INPUT ─────────────────────────────────────────────────────
let dragMoved = false;
canvas.addEventListener('mousedown', e => {
    state.interaction.isDragging=true; dragMoved=false;
    state.interaction.lastX=e.clientX; state.interaction.lastY=e.clientY;
    state.velocity.x=state.velocity.y=0;
});
window.addEventListener('mouseup', e => {
    state.interaction.isDragging=false;
    if (!dragMoved && trackerManager) {
        const wx=(e.clientX/state.camera.zoom)-state.camera.x;
        const wy=(e.clientY/state.camera.zoom)-state.camera.y;
        trackerManager.handlePick(wx,wy);
    }
});
window.addEventListener('mousemove', e => {
    state.mouse.x=e.clientX; state.mouse.y=e.clientY;
    if (!state.interaction.isDragging) return;
    dragMoved=true;
    const dx=(e.clientX-state.interaction.lastX)/state.camera.zoom;
    const dy=(e.clientY-state.interaction.lastY)/state.camera.zoom;
    state.targetCamera.x+=dx; state.targetCamera.y+=dy;
    state.velocity.x=dx; state.velocity.y=dy;
    state.interaction.lastX=e.clientX; state.interaction.lastY=e.clientY;
});
canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const f=Math.exp(-e.deltaY*state.config.zoomSens);
    state.targetCamera.zoom=Math.max(state.config.minZoom,Math.min(state.targetCamera.zoom*f,state.config.maxZoom));
},{passive:false});

let touchStart=null;
canvas.addEventListener('touchstart',e=>{
    if(e.touches.length===1){const t=e.touches[0];touchStart={x:t.clientX,y:t.clientY,cx:state.targetCamera.x,cy:state.targetCamera.y};}
},{passive:true});
canvas.addEventListener('touchmove',e=>{
    if(e.touches.length===1&&touchStart){e.preventDefault();const t=e.touches[0];
    state.targetCamera.x=touchStart.cx+(t.clientX-touchStart.x)/state.camera.zoom;
    state.targetCamera.y=touchStart.cy+(t.clientY-touchStart.y)/state.camera.zoom;}
},{passive:false});

document.addEventListener('keydown',e=>{
    const p=80/state.camera.zoom;
    if(e.key==='ArrowLeft'||e.key==='a')  state.targetCamera.x+=p;
    if(e.key==='ArrowRight'||e.key==='d') state.targetCamera.x-=p;
    if(e.key==='ArrowUp'||e.key==='w')    state.targetCamera.y+=p;
    if(e.key==='ArrowDown'||e.key==='s')  state.targetCamera.y-=p;
    if(e.key==='+'||e.key==='=') zoomTo(state.targetCamera.zoom*1.2);
    if(e.key==='-')               zoomTo(state.targetCamera.zoom*0.83);
    if(e.key===' '){e.preventDefault();trackerManager&&trackerManager.togglePause();}
});
function zoomTo(nz){
    state.mouse.x=window.innerWidth/2; state.mouse.y=window.innerHeight/2;
    state.targetCamera.zoom=Math.max(state.config.minZoom,Math.min(nz,state.config.maxZoom));
}

// ── BUTTONS ───────────────────────────────────────────────────
document.getElementById('btn-random-map').addEventListener('click',()=>{
    if(state.transition.active) return;
    trackerManager&&trackerManager.onTrackingFinished();
    state.transition.active=true; state.transition.alpha=0; state.transition.phase='out';
});
document.getElementById('btn-random-pos').addEventListener('click',()=>trackerManager&&trackerManager.randomizePositions());
document.getElementById('btn-start-track').addEventListener('click',()=>trackerManager&&trackerManager.startTracking());
document.getElementById('btn-pause').addEventListener('click',()=>trackerManager&&trackerManager.togglePause());
document.getElementById('btn-reset-cam').addEventListener('click',()=>{
    state.targetCamera.x=0;state.targetCamera.y=0;state.targetCamera.zoom=0.5;
    state.velocity.x=state.velocity.y=0;
});
document.getElementById('btn-zoom-in').addEventListener('click',()=>zoomTo(state.targetCamera.zoom*1.4));
document.getElementById('btn-zoom-out').addEventListener('click',()=>zoomTo(state.targetCamera.zoom*0.7));

// Speed slider
const spSlider=document.getElementById('speedSlider');
spSlider.addEventListener('input',()=>{
    state.speedMult=parseFloat(spSlider.value);
    document.getElementById('speedVal').textContent=state.speedMult.toFixed(1)+'x';
    if(trackerManager&&trackerManager.tracker) {
        const def = VEHICLE_DEFS[trackerManager.vehicleType]||VEHICLE_DEFS.car;
        trackerManager.tracker.baseSpeed = def.baseSpeed * state.speedMult;
    }
    if(trafficManager) trafficManager.vehicles.forEach(v=>v.speedMult=state.speedMult);
    trackerManager && trackerManager.updateRouteStats();
});

// Scale slider
const scaleSlider = document.getElementById('scaleSlider');
scaleSlider.addEventListener('input', () => {
    const s = parseFloat(scaleSlider.value);
    document.getElementById('scaleVal').textContent = s.toFixed(1)+'x';
    trackerManager && trackerManager.setVehicleScale(s);
    // Also update active tracker if running
    if (trackerManager && trackerManager.tracker) trackerManager.tracker.vehicleScale = s;
});

// Vehicle selector buttons
document.querySelectorAll('.veh-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.veh-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const type = btn.dataset.type;
        trackerManager && trackerManager.setVehicleType(type);
    });
});

// Trail toggle
document.getElementById('trailToggle').addEventListener('change', e => {
    trackerManager && trackerManager.setTrail(e.target.checked);
});

// ── PHYSICS ───────────────────────────────────────────────────
function updatePhysics(){
    const zd=state.targetCamera.zoom-state.camera.zoom;
    if(Math.abs(zd)>0.0005){
        const wx=state.mouse.x/state.camera.zoom-state.camera.x;
        const wy=state.mouse.y/state.camera.zoom-state.camera.y;
        state.camera.zoom+=zd*0.15;
        state.camera.x=state.mouse.x/state.camera.zoom-wx;
        state.camera.y=state.mouse.y/state.camera.zoom-wy;
        state.targetCamera.x=state.camera.x; state.targetCamera.y=state.camera.y;
    }
    if(!state.interaction.isDragging){
        state.targetCamera.x+=state.velocity.x; state.targetCamera.y+=state.velocity.y;
        state.velocity.x*=0.86; state.velocity.y*=0.86;
    }
    state.camera.x+=(state.targetCamera.x-state.camera.x)*0.18;
    state.camera.y+=(state.targetCamera.y-state.camera.y)*0.18;
}
function getView(){
    const z=state.camera.zoom, w=window.innerWidth, h=window.innerHeight;
    return { left:-state.camera.x, top:-state.camera.y, right:w/z-state.camera.x, bottom:h/z-state.camera.y };
}

// ── BACKGROUND ───────────────────────────────────────────────
function drawBackground(c, view){
    c.fillStyle=THEME.bg;
    const pad=2000;
    c.fillRect(view.left-pad,view.top-pad,(view.right-view.left)+pad*2,(view.bottom-view.top)+pad*2);
    if(state.camera.zoom>0.1){
        c.fillStyle=THEME.grassLight;
        const step=200;
        const sx=Math.floor((view.left-pad)/step)*step;
        const sy=Math.floor((view.top -pad)/step)*step;
        for(let x=sx;x<view.right+pad;x+=step){
            for(let y=sy;y<view.bottom+pad;y+=step){
                c.beginPath();
                c.arc(x+Math.sin(x*0.027+y*0.019)*45, y+Math.cos(x*0.021+y*0.033)*45, 20,0,Math.PI*2);
                c.fill();
            }
        }
    }
}

// ── ROADS ─────────────────────────────────────────────────────
function drawRoads(c, view, detail){
    if(!city.edges) return;
    c.lineCap='round'; c.lineJoin='round';

    // Separate primary and secondary edges
    const vis = city.edges.filter(e=>edgeInView(e,view));
    const primary   = vis.filter(e=>!e.isSecondary);
    const secondary = vis.filter(e=> e.isSecondary);

    // ── Secondary roads (narrower, different style) ──
    if (secondary.length > 0) {
        c.beginPath();
        for(const e of secondary){ c.moveTo(e.n1.x,e.n1.y); c.quadraticCurveTo(e.cp.x,e.cp.y,e.n2.x,e.n2.y); }
        c.strokeStyle='#444850'; c.lineWidth=115; c.stroke();

        c.beginPath();
        for(const e of secondary){ c.moveTo(e.n1.x,e.n1.y); c.quadraticCurveTo(e.cp.x,e.cp.y,e.n2.x,e.n2.y); }
        c.strokeStyle='#30343e'; c.lineWidth=95; c.stroke();

        c.beginPath();
        for(const e of secondary){ c.moveTo(e.n1.x,e.n1.y); c.quadraticCurveTo(e.cp.x,e.cp.y,e.n2.x,e.n2.y); }
        c.strokeStyle='#383c46'; c.lineWidth=78; c.stroke();

        if (detail) {
            c.beginPath();
            for(const e of secondary){ c.moveTo(e.n1.x,e.n1.y); c.quadraticCurveTo(e.cp.x,e.cp.y,e.n2.x,e.n2.y); }
            c.strokeStyle = THEME.roadLineSub; c.lineWidth=3;
            c.setLineDash([40,60]); c.stroke(); c.setLineDash([]);
        }
    }

    // ── Primary roads ──
    c.beginPath();
    for(const e of primary){ c.moveTo(e.n1.x,e.n1.y); c.quadraticCurveTo(e.cp.x,e.cp.y,e.n2.x,e.n2.y); }
    c.strokeStyle=THEME.sidewalk; c.lineWidth=170; c.stroke();

    c.beginPath();
    for(const e of primary){ c.moveTo(e.n1.x,e.n1.y); c.quadraticCurveTo(e.cp.x,e.cp.y,e.n2.x,e.n2.y); }
    c.strokeStyle=THEME.roadOuter; c.lineWidth=148; c.stroke();

    c.beginPath();
    for(const e of primary){ c.moveTo(e.n1.x,e.n1.y); c.quadraticCurveTo(e.cp.x,e.cp.y,e.n2.x,e.n2.y); }
    c.strokeStyle=THEME.roadMain; c.lineWidth=130; c.stroke();

    c.beginPath();
    for(const e of primary){ c.moveTo(e.n1.x,e.n1.y); c.quadraticCurveTo(e.cp.x,e.cp.y,e.n2.x,e.n2.y); }
    c.strokeStyle=THEME.roadCenter; c.lineWidth=85; c.stroke();

    if(detail){
        if(state.camera.zoom>0.22) drawCrosswalks(c,view);
        c.beginPath();
        for(const e of primary){ c.moveTo(e.n1.x,e.n1.y); c.quadraticCurveTo(e.cp.x,e.cp.y,e.n2.x,e.n2.y); }
        c.strokeStyle=THEME.roadLine; c.lineWidth=5;
        c.setLineDash([55,55]); c.stroke(); c.setLineDash([]);
    }
}

function drawCrosswalks(c, view){
    for(const n of city.nodes){
        if(!inView(n.x,n.y,220,view)) continue;
        c.fillStyle='rgba(255,255,255,0.3)';
        for(let a=0;a<Math.PI*2;a+=Math.PI/3){
            const bx=n.x+Math.cos(a)*95, by=n.y+Math.sin(a)*95;
            c.save(); c.translate(bx,by); c.rotate(a);
            for(let i=-2;i<=2;i++){ rr(c,-20,i*14-5,40,10,2); c.fill(); }
            c.restore();
        }
    }
}

// ── INTERSECTIONS ─────────────────────────────────────────────
function drawIntersections(c, view){
    for(const n of city.nodes){
        if(!inView(n.x,n.y,120,view)) continue;
        c.beginPath(); c.arc(n.x,n.y,82,0,Math.PI*2);
        c.fillStyle=THEME.roadCenter; c.fill();
        c.beginPath(); c.arc(n.x,n.y,80,0,Math.PI*2);
        c.strokeStyle='rgba(255,255,255,0.12)'; c.lineWidth=8; c.stroke();
        const grd=c.createRadialGradient(n.x,n.y-10,0,n.x,n.y,50);
        grd.addColorStop(0,'#3a7d3a'); grd.addColorStop(1,'#1f4d1f');
        c.beginPath(); c.arc(n.x,n.y,48,0,Math.PI*2);
        c.fillStyle=grd; c.fill();
        c.strokeStyle='rgba(60,150,60,0.6)'; c.lineWidth=5; c.stroke();
        c.beginPath(); c.arc(n.x,n.y,16,0,Math.PI*2);
        c.fillStyle='#4a9e4a'; c.fill();
        c.beginPath(); c.arc(n.x-5,n.y-5,8,0,Math.PI*2);
        c.fillStyle='rgba(255,255,255,0.12)'; c.fill();
    }
}

// ── BLOCKS ────────────────────────────────────────────────────
function drawBlocks(c, view, detail){
    if(!city.blocks) return;
    const t=state.time;
    // Pass 1: draw flat base/ground of all blocks
    for(const block of city.blocks){
        if(!inView(block.centroid.x,block.centroid.y,1500,view)) continue;
        if(!block.vertices||block.vertices.length<3) continue;
        blockClip(c, block);
        switch(block.type){
            case 'park':        drawPark(c,block,detail,t);        break;
            case 'plaza':       drawPlaza(c,block,detail,t);       break;
            case 'lake':        drawLake(c,block,detail,t);        break;
            case 'skyscraper':  drawSkyscraper(c,block,detail);    break;
            case 'commercial':  drawCommercial(c,block,detail);    break;
            case 'residential': drawResidential(c,block,detail);   break;
            case 'industrial':  drawIndustrial(c,block,detail);    break;
            case 'hospital':    drawHospital(c,block,detail);      break;
            case 'hotel':       drawHotel(c,block,detail);         break;
            case 'parking':     drawParkingLot(c,block,detail);    break;
            default:            drawGenericBuilding(c,block,detail);
        }
    }
    // Pass 2: draw 3D extruded buildings on top (sorted back-to-front)
    if(state.camera.zoom>0.09){
        const bldTypes=['skyscraper','commercial','hotel','hospital','residential','building'];
        const bldBlocks=city.blocks.filter(b=>bldTypes.includes(b.type)&&inView(b.centroid.x,b.centroid.y,1500,view));
        // Sort back-to-front by centroid Y (painter's algorithm)
        bldBlocks.sort((a,b)=>a.centroid.y-b.centroid.y);
        for(const block of bldBlocks){
            draw3DBuilding(c,block,detail,t);
        }
    }
}


// ── 3D ISOMETRIC BUILDINGS ────────────────────────────────────
// Renders extruded pseudo-3D towers above each block footprint.
// Uses a fixed light direction (top-left) with face shading.
const _3D_PALETTES = {
    skyscraper:  { face:'#1c4a70', side:'#0d2a45', roof:'#1e6fa8', accent:'rgba(100,210,255,0.7)', glow:'rgba(0,180,255,0.18)' },
    commercial:  { face:'#1b3a5c', side:'#0e2236', roof:'#22608c', accent:'rgba(80,200,255,0.6)',  glow:'rgba(0,150,230,0.15)' },
    hotel:       { face:'#3a1f5a', side:'#1e0e30', roof:'#5a2e8a', accent:'rgba(200,130,255,0.7)', glow:'rgba(160,80,255,0.18)' },
    hospital:    { face:'#d0e8d0', side:'#8ab89a', roof:'#ffffff', accent:'rgba(200,255,200,0.8)', glow:'rgba(100,255,100,0.12)' },
    residential: { face:'#7a3020', side:'#3e1808', roof:'#a04030', accent:'rgba(255,160,100,0.6)', glow:'rgba(255,100,50,0.12)'  },
    building:    { face:'#4a5060', side:'#282e38', roof:'#606878', accent:'rgba(180,200,240,0.5)', glow:'rgba(100,130,180,0.12)' },
};

function draw3DBuilding(c, block, detail, t){
    const cx=block.centroid.x, cy=block.centroid.y;
    const verts=block.vertices;
    if(!verts||verts.length<3) return;

    const pal=_3D_PALETTES[block.type]||_3D_PALETTES.building;

    // Height based on block type + seeded random variation
    const seed=seededRand(cx*0.0017+cy*0.0013);
    const baseHeights={skyscraper:340,commercial:210,hotel:260,hospital:160,residential:120,building:140};
    const bh=(baseHeights[block.type]||130);
    const H=bh*(0.72+seed*0.56);   // world units of extrusion

    // Light direction: top-left → (1, -1) normalized
    const LIGHT_NX=0.707, LIGHT_NY=-0.707;

    // Compute footprint polygon (straight edges from shrunk vertices)
    const fp=verts.map(v=>({ x:v.v.x, y:v.v.y }));
    const n=fp.length;

    // Extrude: top polygon = footprint shifted "up" by H (isometric: shift by (-H*0.4, -H*0.82))
    const ISO_X=-0.38, ISO_Y=-0.80;
    const top=fp.map(p=>({ x:p.x+H*ISO_X, y:p.y+H*ISO_Y }));

    // Draw side walls (back to front — left sides first, right sides second)
    // For each edge of footprint, draw a quad: [fp[i], fp[i+1], top[i+1], top[i]]
    for(let i=0;i<n;i++){
        const j=(i+1)%n;
        const fx1=fp[i].x,  fy1=fp[i].y;
        const fx2=fp[j].x,  fy2=fp[j].y;
        const tx1=top[i].x, ty1=top[i].y;
        const tx2=top[j].x, ty2=top[j].y;

        // Edge normal (outward)
        const ex=fx2-fx1, ey=fy2-fy1;
        const enx=ey, eny=-ex; // perpendicular, unnormalized
        const dot=enx*LIGHT_NX+eny*LIGHT_NY;
        // Shade: lit face brighter, shadow face darker
        const shade=dot>0 ? 1.0 : 0.45+0.3*(1+dot);

        // Parse pal.side as base, apply shade
        c.beginPath();
        c.moveTo(fx1,fy1); c.lineTo(fx2,fy2);
        c.lineTo(tx2,ty2); c.lineTo(tx1,ty1);
        c.closePath();

        if(dot>0){
            // Lit face
            c.fillStyle=pal.face;
        } else {
            // Shadow face
            c.fillStyle=pal.side;
        }
        c.globalAlpha=0.92*shade+0.08;
        c.fill();
        c.globalAlpha=1;
        c.strokeStyle='rgba(0,0,0,0.25)'; c.lineWidth=2; c.stroke();
    }

    // Draw top face (roof)
    c.beginPath();
    c.moveTo(top[0].x,top[0].y);
    for(let i=1;i<n;i++) c.lineTo(top[i].x,top[i].y);
    c.closePath();
    c.fillStyle=pal.roof;
    c.globalAlpha=0.95;
    c.fill();
    c.globalAlpha=1;
    c.strokeStyle='rgba(0,0,0,0.2)'; c.lineWidth=2; c.stroke();

    if(!detail) return;

    // ── Roof decorations per type ──────────────────────────────
    const rcx=(top.reduce((s,p)=>s+p.x,0)/n);
    const rcy=(top.reduce((s,p)=>s+p.y,0)/n);

    if(block.type==='skyscraper'){
        // Antenna spire
        const aH=H*0.35;
        c.strokeStyle=pal.accent; c.lineWidth=4;
        c.beginPath(); c.moveTo(rcx,rcy); c.lineTo(rcx+aH*ISO_X,rcy+aH*ISO_Y); c.stroke();
        // Blinking light
        const blink=Math.sin(t*3.2+seed*6.28)>0.4;
        if(blink){
            c.beginPath(); c.arc(rcx+aH*ISO_X,rcy+aH*ISO_Y,10,0,Math.PI*2);
            c.fillStyle='rgba(255,80,80,0.95)'; c.fill();
            c.shadowColor='rgba(255,0,0,0.8)'; c.shadowBlur=18;
            c.fill(); c.shadowBlur=0;
        }
        // Window grid on roof
        if(state.camera.zoom>0.25){
            c.fillStyle=pal.accent;
            c.globalAlpha=0.18;
            for(let ri=-3;ri<=3;ri++) for(let ci=-2;ci<=2;ci++){
                const wx=rcx+ci*45+ri*12, wy=rcy+ri*22-ci*8;
                c.fillRect(wx-12,wy-8,20,12);
            }
            c.globalAlpha=1;
        }
        // Rooftop glow halo
        const glowGrd=c.createRadialGradient(rcx,rcy,0,rcx,rcy,H*0.55);
        glowGrd.addColorStop(0,pal.glow); glowGrd.addColorStop(1,'rgba(0,0,0,0)');
        c.fillStyle=glowGrd; c.globalAlpha=0.7;
        c.beginPath(); c.ellipse(rcx,rcy,H*0.55,H*0.28,0,0,Math.PI*2); c.fill();
        c.globalAlpha=1;

    } else if(block.type==='hotel'){
        // Helipad
        c.strokeStyle='rgba(255,255,255,0.5)'; c.lineWidth=5;
        c.beginPath(); c.arc(rcx,rcy,38,0,Math.PI*2); c.stroke();
        c.strokeStyle='rgba(255,255,255,0.35)'; c.lineWidth=3;
        c.beginPath(); c.moveTo(rcx-38,rcy); c.lineTo(rcx+38,rcy); c.stroke();
        c.beginPath(); c.moveTo(rcx,rcy-38); c.lineTo(rcx,rcy+38); c.stroke();
        c.fillStyle='rgba(200,140,255,0.6)';
        c.font='bold 44px Inter'; c.textAlign='center'; c.textBaseline='middle';
        c.fillText('H',rcx,rcy);
        // Glow
        const g2=c.createRadialGradient(rcx,rcy,0,rcx,rcy,H*0.45);
        g2.addColorStop(0,pal.glow); g2.addColorStop(1,'rgba(0,0,0,0)');
        c.fillStyle=g2; c.globalAlpha=0.6;
        c.beginPath(); c.ellipse(rcx,rcy,H*0.45,H*0.22,0,0,Math.PI*2); c.fill();
        c.globalAlpha=1;

    } else if(block.type==='hospital'){
        // Red cross on roof
        c.fillStyle='#e74c3c';
        c.fillRect(rcx-10,rcy-38,20,76);
        c.fillRect(rcx-38,rcy-10,76,20);
        c.strokeStyle='rgba(255,255,255,0.5)'; c.lineWidth=2;
        c.strokeRect(rcx-10,rcy-38,20,76);
        c.strokeRect(rcx-38,rcy-10,76,20);
        // Subtle glow
        const g3=c.createRadialGradient(rcx,rcy,0,rcx,rcy,80);
        g3.addColorStop(0,'rgba(150,255,150,0.15)'); g3.addColorStop(1,'rgba(0,0,0,0)');
        c.fillStyle=g3; c.beginPath(); c.arc(rcx,rcy,80,0,Math.PI*2); c.fill();

    } else if(block.type==='commercial'){
        // Neon sign
        if(state.camera.zoom>0.2){
            const pulse=0.7+0.3*Math.sin(t*2.1+seed*5);
            c.fillStyle=`rgba(0,220,255,${0.6*pulse})`;
            c.font='bold 52px Inter'; c.textAlign='center'; c.textBaseline='middle';
            c.fillText('MALL',rcx,rcy);
            c.shadowColor='rgba(0,200,255,0.9)'; c.shadowBlur=22*pulse;
            c.fillText('MALL',rcx,rcy); c.shadowBlur=0;
        }
        // Roof HVAC boxes
        c.fillStyle='rgba(150,170,200,0.55)';
        c.fillRect(rcx-55,rcy-18,40,26); c.fillRect(rcx+15,rcy-18,40,26);
        c.fillRect(rcx-20,rcy-36,38,18);

    } else if(block.type==='residential'){
        // Chimney
        c.fillStyle='rgba(80,50,30,0.8)';
        c.fillRect(rcx-8,rcy-28,16,28);
        // Roof line accent
        c.strokeStyle=pal.accent; c.lineWidth=4; c.globalAlpha=0.5;
        c.beginPath(); c.moveTo(top[0].x,top[0].y);
        for(let i=1;i<n;i++) c.lineTo(top[i].x,top[i].y);
        c.closePath(); c.stroke(); c.globalAlpha=1;

    } else {
        // Generic: roof edge highlight
        c.strokeStyle=pal.accent; c.lineWidth=3; c.globalAlpha=0.35;
        c.beginPath(); c.moveTo(top[0].x,top[0].y);
        for(let i=1;i<n;i++) c.lineTo(top[i].x,top[i].y);
        c.closePath(); c.stroke(); c.globalAlpha=1;
    }
}


function drawPark(c, block, detail, t){
    const cx=block.centroid.x, cy=block.centroid.y;
    c.fillStyle=THEME.parkFill; c.fill();
    c.strokeStyle=THEME.parkBorder; c.lineWidth=10; c.stroke();
    if(!detail) return;
    c.save(); blockClip(c,block); c.clip();
    c.beginPath(); c.arc(cx,cy,Math.sqrt(block.area)*0.28,0,Math.PI*2);
    c.strokeStyle=THEME.parkPath; c.lineWidth=22; c.stroke();
    c.beginPath(); c.arc(cx,cy,Math.sqrt(block.area)*0.28,0,Math.PI*2);
    c.strokeStyle='#a0875a'; c.lineWidth=14; c.stroke();
    const r=seededRand(cx*0.001+cy*0.002);
    if(r<0.6){
        c.beginPath(); c.arc(cx,cy,55,0,Math.PI*2); c.fillStyle='#1a5e8a'; c.fill();
        c.beginPath(); c.arc(cx,cy,38,0,Math.PI*2); c.fillStyle='#2980b9'; c.fill();
        for(let i=0;i<8;i++){
            const a=i/8*Math.PI*2;
            const spLen=20+Math.sin(t*3+i)*8;
            c.strokeStyle='rgba(100,200,255,0.55)'; c.lineWidth=3;
            c.beginPath();
            c.moveTo(cx+Math.cos(a)*12, cy+Math.sin(a)*12);
            c.lineTo(cx+Math.cos(a)*(12+spLen), cy+Math.sin(a)*(12+spLen));
            c.stroke();
        }
        c.beginPath(); c.arc(cx,cy,14,0,Math.PI*2); c.fillStyle='#5dade2'; c.fill();
    }
    if(r>0.45&&r<0.85){
        const offX=seededRand(cx*0.003)*200-100, offY=seededRand(cy*0.003)*200-100;
        const cw=200, ch=120;
        c.fillStyle='#b55a10'; c.fillRect(cx+offX-cw/2, cy+offY-ch/2, cw, ch);
        c.strokeStyle='rgba(255,255,255,0.7)'; c.lineWidth=4;
        c.strokeRect(cx+offX-cw/2, cy+offY-ch/2, cw, ch);
        c.beginPath(); c.moveTo(cx+offX, cy+offY-ch/2); c.lineTo(cx+offX, cy+offY+ch/2); c.stroke();
        c.beginPath(); c.arc(cx+offX, cy+offY, 28, 0, Math.PI*2); c.stroke();
    }
    const tCount = Math.min(10, Math.floor(block.area/60000)+3);
    for(let i=0;i<tCount;i++){
        const ang=seededRand(cx*0.011+cy*0.007+i)*Math.PI*2;
        const d=50+seededRand(cx*0.013+cy*0.009+i+0.5)*Math.sqrt(block.area)*0.28;
        drawTree(c, cx+Math.cos(ang)*d, cy+Math.sin(ang)*d, 42+seededRand(i*3.7)*18, detail);
    }
    if(state.camera.zoom>0.3){
        const pr=Math.sqrt(block.area)*0.28;
        for(let i=0;i<4;i++){
            const a=i/4*Math.PI*2;
            const bx=cx+Math.cos(a)*pr, by=cy+Math.sin(a)*pr;
            c.save(); c.translate(bx,by); c.rotate(a+Math.PI/2);
            c.fillStyle='#8B6914'; c.fillRect(-18,-5,36,10);
            c.fillStyle='#6B4E10'; c.fillRect(-16,-8,6,3); c.fillRect(10,-8,6,3);
            c.restore();
        }
    }
    c.restore();
}

function drawPlaza(c, block, detail, t){
    const cx=block.centroid.x, cy=block.centroid.y;
    c.fillStyle='#6b6055'; c.fill();
    c.strokeStyle='#7a6f62'; c.lineWidth=8; c.stroke();
    if(!detail) return;
    c.save(); blockClip(c,block); c.clip();
    c.strokeStyle='rgba(255,255,255,0.06)'; c.lineWidth=3;
    for(let dx=-400;dx<400;dx+=80){ c.beginPath(); c.moveTo(cx+dx,cy-500); c.lineTo(cx+dx,cy+500); c.stroke(); }
    for(let dy=-400;dy<400;dy+=80){ c.beginPath(); c.moveTo(cx-500,cy+dy); c.lineTo(cx+500,cy+dy); c.stroke(); }
    c.beginPath(); c.arc(cx,cy,35,0,Math.PI*2); c.fillStyle='#5a4a3a'; c.fill();
    c.beginPath(); c.arc(cx,cy,22,0,Math.PI*2); c.fillStyle='#8a7a6a'; c.fill();
    c.beginPath(); c.arc(cx,cy,10,0,Math.PI*2); c.fillStyle='#c0a88a'; c.fill();
    if(state.camera.zoom>0.3){
        const pts=[[-120,-120],[120,-120],[120,120],[-120,120]];
        for(const [ox,oy] of pts){
            c.fillStyle='#4a4a5a'; c.fillRect(cx+ox-4,cy+oy-40,8,40);
            c.beginPath(); c.arc(cx+ox,cy+oy-40,10,0,Math.PI*2);
            c.fillStyle='rgba(255,240,160,0.9)'; c.fill();
            if(state.camera.zoom>0.4){ c.beginPath(); c.arc(cx+ox,cy+oy-40,22,0,Math.PI*2); c.fillStyle='rgba(255,240,160,0.12)'; c.fill(); }
        }
    }
    c.restore();
}

function drawLake(c, block, detail, t){
    const cx=block.centroid.x, cy=block.centroid.y;
    const grd=c.createRadialGradient(cx,cy,0,cx,cy,Math.sqrt(block.area)*0.5);
    grd.addColorStop(0,'#3baed0'); grd.addColorStop(0.6,'#1f7ab5'); grd.addColorStop(1,'#155a8a');
    c.fillStyle=grd; c.fill();
    c.strokeStyle=THEME.lakeBorder; c.lineWidth=8; c.stroke();
    if(!detail) return;
    c.save(); blockClip(c,block); c.clip();
    c.strokeStyle=THEME.lakeShimmer; c.lineWidth=10;
    const sh=(t*28)%160;
    for(let i=-6;i<10;i++){
        c.beginPath(); c.moveTo(cx-600+i*90+sh, cy-500); c.lineTo(cx-400+i*90+sh, cy+500); c.stroke();
    }
    const lp=seededRand(cx*0.0017+cy*0.0013);
    if(lp>0.4){
        c.beginPath(); c.arc(cx+80,cy-50,28,0,Math.PI*2); c.fillStyle='#2d7a2d'; c.fill();
        c.beginPath(); c.arc(cx+80,cy-50,10,0,Math.PI*2); c.fillStyle='#ff6b8a'; c.fill();
        c.beginPath(); c.arc(cx-60,cy+60,22,0,Math.PI*2); c.fillStyle='#256825'; c.fill();
    }
    if(state.camera.zoom>0.35&&lp>0.55){
        c.fillStyle='rgba(255,255,255,0.5)';
        c.beginPath(); c.ellipse(cx-120,cy+30,18,10,0.3,0,Math.PI*2); c.fill();
        c.beginPath(); c.arc(cx-106,cy+22,8,0,Math.PI*2); c.fill();
    }
    c.restore();
}

function drawSkyscraper(c, block, detail){
    const cx=block.centroid.x, cy=block.centroid.y;
    c.save(); blockClip(c,block);
    c.shadowColor='rgba(0,0,0,0.45)'; c.shadowOffsetX=12; c.shadowOffsetY=12;
    c.fillStyle='rgba(0,0,0,0.35)'; c.fill();
    c.shadowOffsetX=0; c.shadowOffsetY=0; c.restore();
    blockClip(c,block);
    const grd=c.createLinearGradient(cx-200,cy-200,cx+200,cy+200);
    grd.addColorStop(0,'#1c3d5a'); grd.addColorStop(0.4,'#215f88'); grd.addColorStop(1,'#122c42');
    c.fillStyle=grd; c.fill();
    c.strokeStyle='#2e7ab5'; c.lineWidth=6; c.stroke();
    if(!detail) return;
    c.save(); blockClip(c,block); c.clip();
    c.strokeStyle='rgba(100,190,255,0.22)'; c.lineWidth=5;
    for(let i=-8;i<=8;i++){
        c.beginPath(); c.moveTo(cx+i*55-30,cy-600); c.lineTo(cx+i*55+30,cy+600); c.stroke();
        c.beginPath(); c.moveTo(cx-600,cy+i*55-30); c.lineTo(cx+600,cy+i*55+30); c.stroke();
    }
    for(let r=-5;r<5;r++) for(let col=-4;col<4;col++){
        if(seededRand(cx+r*71+col*37)>0.35){
            c.fillStyle=`rgba(255,240,160,${0.12+seededRand(cx+r*13+col*7)*0.12})`;
            c.fillRect(cx+col*55-20,cy+r*55-18,35,30);
        }
    }
    const refl=c.createLinearGradient(cx-200,cy-200,cx+200,cy+200);
    refl.addColorStop(0,'rgba(140,210,255,0.18)'); refl.addColorStop(1,'rgba(140,210,255,0)');
    c.fillStyle=refl; c.fillRect(cx-600,cy-600,1200,1200);
    if(block.area>250000){
        c.strokeStyle='rgba(255,255,255,0.45)'; c.lineWidth=7;
        c.beginPath(); c.arc(cx,cy,75,0,Math.PI*2); c.stroke();
        c.fillStyle='rgba(255,255,255,0.5)';
        c.font='bold 90px Inter'; c.textAlign='center'; c.textBaseline='middle';
        c.fillText('H',cx,cy);
    }
    c.restore();
}

function drawCommercial(c, block, detail){
    const cx=block.centroid.x, cy=block.centroid.y;
    blockClip(c,block);
    const grd=c.createLinearGradient(cx,cy-200,cx,cy+200);
    grd.addColorStop(0,'#1e4060'); grd.addColorStop(1,'#132a40');
    c.fillStyle=grd; c.fill();
    c.strokeStyle='#2a6090'; c.lineWidth=7; c.stroke();
    if(!detail) return;
    c.save(); blockClip(c,block); c.clip();
    c.strokeStyle='rgba(80,180,255,0.2)'; c.lineWidth=4;
    for(let i=-10;i<=10;i++){
        c.beginPath(); c.moveTo(cx+i*50,cy-500); c.lineTo(cx+i*50,cy+500); c.stroke();
        c.beginPath(); c.moveTo(cx-500,cy+i*50); c.lineTo(cx+500,cy+i*50); c.stroke();
    }
    c.fillStyle='rgba(30,100,160,0.6)'; c.fillRect(cx-80,cy-20,160,40);
    c.fillStyle='rgba(100,200,255,0.35)'; c.fillRect(cx-76,cy-16,152,32);
    if(state.camera.zoom>0.4){
        c.fillStyle='rgba(255,255,255,0.7)';
        c.font='bold 40px Inter'; c.textAlign='center'; c.textBaseline='middle';
        c.fillText('MALL', cx, cy-60);
    }
    c.restore();
}

function drawResidential(c, block, detail){
    const cx=block.centroid.x, cy=block.centroid.y;
    const h=seededRand(cx*0.0017+cy*0.0011);
    const ci=Math.floor(h*THEME.buildingColors.length);
    blockClip(c,block);
    c.fillStyle=THEME.buildingColors[ci]; c.fill();
    c.strokeStyle='rgba(0,0,0,0.3)'; c.lineWidth=5; c.stroke();
    if(!detail) return;
    c.save(); blockClip(c,block); c.clip();
    const sc=0.62;
    c.beginPath();
    c.moveTo(cx+(block.vertices[0].v.x-cx)*sc, cy+(block.vertices[0].v.y-cy)*sc);
    for(let i=0;i<block.vertices.length;i++){
        const ni=(i+1)%block.vertices.length;
        c.quadraticCurveTo(cx+(block.vertices[i].cp.x-cx)*sc, cy+(block.vertices[i].cp.y-cy)*sc,
                           cx+(block.vertices[ni].v.x-cx)*sc, cy+(block.vertices[ni].v.y-cy)*sc);
    }
    c.closePath(); c.fillStyle=THEME.roofColors[ci]; c.fill();
    c.strokeStyle='rgba(0,0,0,0.2)'; c.lineWidth=3; c.stroke();
    c.fillStyle='rgba(150,220,255,0.45)';
    for(const [ox,oy] of [[-60,-60],[60,-60],[-60,60],[60,60]]){ rr(c,cx+ox-14,cy+oy-18,28,36,4); c.fill(); }
    c.fillStyle='rgba(80,40,10,0.7)'; rr(c,cx-15,cy+40,30,50,3); c.fill();
    c.restore();
}

function drawIndustrial(c, block, detail){
    const cx=block.centroid.x, cy=block.centroid.y;
    blockClip(c,block); c.fillStyle='#4a4840'; c.fill();
    c.strokeStyle='#5a5650'; c.lineWidth=6; c.stroke();
    if(!detail) return;
    c.save(); blockClip(c,block); c.clip();
    c.strokeStyle='rgba(255,255,255,0.08)'; c.lineWidth=6;
    for(let i=-8;i<=8;i++){ c.beginPath(); c.moveTo(cx+i*60,cy-400); c.lineTo(cx+i*60,cy+400); c.stroke(); }
    c.fillStyle='#3a3530';
    c.fillRect(cx-15,cy-200,30,180); c.fillRect(cx+80,cy-160,22,140);
    if(state.camera.zoom>0.25){
        const sm=seededRand(cx*0.0019+cy*0.0023);
        if(sm>0.3){ c.fillStyle='rgba(150,150,140,0.25)';
            for(let s=0;s<4;s++){ const sy2=(state.time*12+s*18)%80;
                c.beginPath(); c.arc(cx,cy-200-sy2,8+sy2*0.3,0,Math.PI*2); c.fill();
                c.beginPath(); c.arc(cx+87,cy-160-sy2,6+sy2*0.25,0,Math.PI*2); c.fill(); }
        }
    }
    c.fillStyle='#2a2620'; c.fillRect(cx-40,cy+50,80,50);
    c.restore();
}

function drawHospital(c, block, detail){
    const cx=block.centroid.x, cy=block.centroid.y;
    blockClip(c,block); c.fillStyle='#d8e8d0'; c.fill();
    c.strokeStyle='#a0c8a0'; c.lineWidth=7; c.stroke();
    if(!detail) return;
    c.save(); blockClip(c,block); c.clip();
    c.fillStyle='rgba(135,206,250,0.4)';
    for(let r=-3;r<=3;r++) for(let col=-3;col<=3;col++){ rr(c,cx+col*55-18,cy+r*55-22,32,38,4); c.fill(); }
    c.fillStyle='#e74c3c'; c.fillRect(cx-14,cy-55,28,100); c.fillRect(cx-55,cy-14,100,28);
    c.strokeStyle='rgba(255,255,255,0.6)'; c.lineWidth=3;
    c.strokeRect(cx-14,cy-55,28,100); c.strokeRect(cx-55,cy-14,100,28);
    c.restore();
}

function drawHotel(c, block, detail){
    const cx=block.centroid.x, cy=block.centroid.y;
    const h=seededRand(cx*0.0015+cy*0.0021);
    const baseCol=h>0.5?'#2c3e7a':'#5a2c4a';
    blockClip(c,block);
    const grd=c.createLinearGradient(cx-100,cy-200,cx+100,cy+200);
    grd.addColorStop(0,baseCol); grd.addColorStop(1,'rgba(0,0,0,0.4)');
    c.fillStyle=grd; c.fill();
    c.strokeStyle='rgba(200,170,80,0.6)'; c.lineWidth=6; c.stroke();
    if(!detail) return;
    c.save(); blockClip(c,block); c.clip();
    for(let r=-4;r<=4;r++) for(let col=-3;col<=3;col++){
        c.fillStyle=seededRand(cx+r*53+col*37)>0.3?'rgba(255,240,160,0.22)':'rgba(135,206,250,0.18)';
        rr(c,cx+col*52-16,cy+r*48-18,28,32,3); c.fill();
    }
    c.fillStyle='rgba(200,170,80,0.55)'; c.fillRect(cx-90,cy+70,180,28);
    if(state.camera.zoom>0.45){
        c.fillStyle='rgba(255,230,100,0.9)';
        c.font='bold 28px Inter'; c.textAlign='center'; c.textBaseline='middle';
        c.fillText('HOTEL', cx, cy+84);
    }
    c.restore();
}

function drawParkingLot(c, block, detail){
    const cx=block.centroid.x, cy=block.centroid.y;
    blockClip(c,block); c.fillStyle='#383a3f'; c.fill();
    c.strokeStyle='#4a4c52'; c.lineWidth=5; c.stroke();
    if(!detail) return;
    c.save(); blockClip(c,block); c.clip();
    c.strokeStyle='rgba(255,255,255,0.18)'; c.lineWidth=4;
    for(let i=-5;i<=5;i++){
        c.beginPath(); c.moveTo(cx+i*80,cy-400); c.lineTo(cx+i*80,cy+400); c.stroke();
        c.beginPath(); c.moveTo(cx-400,cy+i*60); c.lineTo(cx+400,cy+i*60); c.stroke();
    }
    const carCols=['#e74c3c','#3498db','#f1c40f','#ecf0f1','#95a5a6','#e67e22','#1abc9c'];
    for(let r=-3;r<=3;r++) for(let col=-4;col<=4;col+=2){
        if(seededRand(cx+r*61+col*43+7)>0.35){
            const carC=carCols[Math.floor(seededRand(cx+r*41+col*29)*carCols.length)];
            c.fillStyle=carC; rr(c,cx+col*80-24,cy+r*60-14,44,26,5); c.fill();
            c.fillStyle='rgba(135,206,250,0.5)'; c.fillRect(cx+col*80-18,cy+r*60-12,18,8);
        }
    }
    c.fillStyle='rgba(255,255,100,0.5)';
    c.beginPath(); c.moveTo(cx,cy-150); c.lineTo(cx-18,cy-120); c.lineTo(cx+18,cy-120); c.closePath(); c.fill();
    c.restore();
}

function drawGenericBuilding(c, block, detail){
    const cx=block.centroid.x, cy=block.centroid.y;
    const h=seededRand(cx*0.0019+cy*0.0013);
    const ci=Math.floor(h*THEME.buildingColors.length);
    blockClip(c,block);
    c.fillStyle=THEME.buildingColors[ci]; c.fill();
    c.strokeStyle='rgba(0,0,0,0.25)'; c.lineWidth=4; c.stroke();
    if(!detail) return;
    c.save(); blockClip(c,block); c.clip();
    const sc=0.55;
    c.beginPath();
    c.moveTo(cx+(block.vertices[0].v.x-cx)*sc, cy+(block.vertices[0].v.y-cy)*sc);
    for(let i=0;i<block.vertices.length;i++){
        const ni=(i+1)%block.vertices.length;
        c.quadraticCurveTo(cx+(block.vertices[i].cp.x-cx)*sc, cy+(block.vertices[i].cp.y-cy)*sc,
                           cx+(block.vertices[ni].v.x-cx)*sc, cy+(block.vertices[ni].v.y-cy)*sc);
    }
