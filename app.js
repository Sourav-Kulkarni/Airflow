'use strict';
(function () {
  const $ = (s, r) => (r || document).querySelector(s);
  function el(tag, props) {
    const e = document.createElement(tag);
    if (props) for (const k in props) {
      if (k === 'class') e.className = props[k];
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), props[k]);
      else if (k === 'html') e.innerHTML = props[k];
      else e.setAttribute(k, props[k]);
    }
    for (let i = 2; i < arguments.length; i++) {
      const c = arguments[i];
      if (c == null) continue;
      e.append(c.nodeType ? c : document.createTextNode(c));
    }
    return e;
  }
  const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
  const DEG = Math.PI / 180;

  // ------------------------------------------------------------------ state
  const scene = { wallT: 0.15, walls: [], openings: [], devices: [], zones: [], env: { windDir: 270, windSpeed: 2, gust: 0.25, tOut: 28, tIn: 35, wallHeat: 0.5 } };
  let nid = 1; const newId = () => nid++;
  const sim = new Sim(0.125, { dt: 0.05, iters: 18 });
  const ui = { tool: 'select', sel: null, overlay: 'speed', particles: true, running: true, speedMul: 1, snap: true, grid: true };
  const view = { s: 40, ox: 0, oy: 0, fitted: false };
  let drag = null, hover = null, spaceDown = false;
  let opt = null, optResult = null, optTarget = null;
  let zoneStats = {};
  const undoStack = []; let lastCp = 0, saveTimer = 0;

  const cv = $('#cv'), ctx = cv.getContext('2d');
  let DPR = 1;

  // ------------------------------------------------------------------ scene helpers
  function allObjs(kind) { return kind === 'wall' ? scene.walls : kind === 'opening' ? scene.openings : kind === 'device' ? scene.devices : scene.zones; }
  function getSel() { return ui.sel ? allObjs(ui.sel.kind).find(o => o.id === ui.sel.id) || null : null; }
  function rebuild() { sim.devices = scene.devices; sim.env = scene.env; sim.build(scene); updateRoomNote(); }

  function setScene(o) {
    scene.wallT = o.wallT || 0.15;
    scene.walls = o.walls || []; scene.openings = o.openings || []; scene.devices = o.devices || []; scene.zones = o.zones || [];
    scene.env = Object.assign({ windDir: 270, windSpeed: 2, gust: 0.25, tOut: 28, tIn: 35, wallHeat: 0.5 }, o.env || {});
    let m = 0;
    for (const k of ['walls', 'openings', 'devices', 'zones']) for (const x of scene[k]) { if (!x.id) x.id = 0; m = Math.max(m, x.id); }
    nid = m + 1;
    for (const k of ['walls', 'openings', 'devices', 'zones']) for (const x of scene[k]) if (!x.id) x.id = newId();
    ui.sel = null; optResult = null; opt = null;
    rebuild(); sim.reset();
    buildEnvCtl(); drawDial(); renderSelection(); renderOpt();
  }

  function checkpoint(throttle) {
    const now = performance.now();
    optResult = null; renderOptSoft();
    if (throttle && now - lastCp < 700) { lastCp = now; scheduleSave(); return; }
    lastCp = now;
    undoStack.push(JSON.stringify(scene));
    if (undoStack.length > 60) undoStack.shift();
    scheduleSave();
  }
  function undo() {
    const s = undoStack.pop(); if (!s) return;
    setScene(JSON.parse(s)); scheduleSave();
  }
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { try { localStorage.setItem('airflow-scene-v1', JSON.stringify(scene)); } catch (e) { /* ignore */ } }, 400);
  }

  // Demo flat (exported from the editor: demo_apartment.airflow.json)
  const DEMO = {wallT:0.15,walls:[{id:1,x1:9,y1:5,x2:15.5,y2:5},{id:2,x1:15.5,y1:5,x2:15.5,y2:10},{id:3,x1:15.5,y1:10,x2:9,y2:10},{id:4,x1:9,y1:10,x2:9,y2:5},{id:6,x1:9,y1:7.75,x2:9,y2:10},{id:10,x1:9,y1:5,x2:9,y2:7.25},{id:14,x1:9,y1:5,x2:9,y2:7.25},{id:18,x1:9,y1:7.25,x2:9,y2:10},{id:21,x1:6.25,y1:5,x2:9,y2:5},{id:22,x1:9,y1:5,x2:9,y2:10},{id:23,x1:9,y1:10,x2:6.25,y2:10},{id:24,x1:6.25,y1:10,x2:6.25,y2:5},{id:25,x1:6.25,y1:7.5,x2:9,y2:7.5},{id:31,x1:6.25,y1:6.25,x2:8.25,y2:6.25},{id:34,x1:9,y1:2,x2:15.5,y2:2},{id:35,x1:15.5,y1:2,x2:15.5,y2:5},{id:36,x1:15.5,y1:5,x2:12.25,y2:5},{id:38,x1:9,y1:2,x2:9,y2:5}],openings:[{id:26,kind:'door',x1:8.922428828286757,y1:7.5,x2:8.022428828286756,y2:7.5,open:1},{id:27,kind:'window',x1:6.25,y1:6.83951309054322,x2:6.25,y2:7.239513090543221,open:1},{id:28,kind:'window',x1:6.25,y1:9.549342953925887,x2:6.25,y2:9.799342953925887,open:1},{id:29,kind:'window',x1:6.25,y1:7.764809745781352,x2:6.25,y2:8.014809745781353,open:1},{id:30,kind:'door',x1:9,y1:8.252309745781352,x2:9,y2:9.15,open:1},{id:33,kind:'door',x1:14.15,y1:5,x2:15.05,y2:5,open:1},{id:39,kind:'window',x1:15.5,y1:5.34793744813899,x2:15.5,y2:6.25,open:1}],devices:[{id:41,type:'ceil',x:12.429176671275332,y:8.588196111879222,on:true,angle:0,speed:1.2,dir:1,radius:0.65},{id:42,type:'fan',x:14.757516200503243,y:5.873607776241556,on:true,angle:-180,speed:1,osc:false,oscRange:60}],zones:[],env:{windDir:270,windSpeed:0.4,gust:0.25,tOut:28,tIn:35,wallHeat:0.5}};
  function loadDemo() { setScene(JSON.parse(JSON.stringify(DEMO))); }

  // ------------------------------------------------------------------ view transform
  function resize() {
    const r = cv.getBoundingClientRect();
    DPR = window.devicePixelRatio || 1;
    cv.width = Math.max(1, Math.round(r.width * DPR)); cv.height = Math.max(1, Math.round(r.height * DPR));
    if (!view.fitted && r.width > 50) { fit(); view.fitted = true; }
  }
  function fit() {
    const r = cv.getBoundingClientRect();
    view.s = Math.min(r.width / WORLD.w, r.height / WORLD.h) * 0.98;
    view.ox = (r.width - WORLD.w * view.s) / 2; view.oy = (r.height - WORLD.h * view.s) / 2;
  }
  const toWorld = p => ({ x: (p.x - view.ox) / view.s, y: (p.y - view.oy) / view.s });
  const toScr = p => ({ x: p.x * view.s + view.ox, y: p.y * view.s + view.oy });
  function evPt(e) { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

  // ------------------------------------------------------------------ geometry utils
  function closestOnSeg(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy;
    const t = L2 > 0 ? clamp(((px - x1) * dx + (py - y1) * dy) / L2, 0, 1) : 0;
    const x = x1 + t * dx, y = y1 + t * dy;
    return { x, y, t, d: Math.hypot(px - x, py - y) };
  }
  function snapPt(p, noGrid) {
    let best = null, bd = 0.25;
    const test = (x, y) => { const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = { x, y }; } };
    for (const w of scene.walls) { test(w.x1, w.y1); test(w.x2, w.y2); }
    if (best) return best;
    if (ui.snap && !noGrid) { const g = 0.25; return { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g }; }
    return { x: p.x, y: p.y };
  }
  function ortho(a, b, free) {
    if (free) return b;
    const dx = b.x - a.x, dy = b.y - a.y, ang = Math.atan2(Math.abs(dy), Math.abs(dx)) / DEG;
    if (ang < 6) return { x: b.x, y: a.y };
    if (ang > 84) return { x: a.x, y: b.y };
    return b;
  }
  function nearestWall(p, maxD) {
    let best = null;
    for (const w of scene.walls) {
      const c = closestOnSeg(p.x, p.y, w.x1, w.y1, w.x2, w.y2);
      if (c.d < maxD && (!best || c.d < best.c.d)) best = { w, c };
    }
    return best;
  }
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  function deviceRadius(d) { return d.type === 'ceil' ? (d.radius || 0.65) : d.type === 'ac' ? Math.max((d.width || 0.9) / 2, 0.3) : 0.35; }
  function aimHandle(d) {
    const a = d.angle * DEG, r = d.type === 'ac' ? 0.95 : 1.0;
    return { x: d.x + Math.cos(a) * r, y: d.y + Math.sin(a) * r };
  }

  function hitTest(p) {
    const tol = 6 / view.s;
    let best = null, bd = 1e9;
    for (const d of scene.devices) {
      const dd = Math.hypot(p.x - d.x, p.y - d.y);
      if (dd <= deviceRadius(d) + tol && dd < bd) { bd = dd; best = { kind: 'device', id: d.id }; }
    }
    if (best) return best;
    for (const o of scene.openings) {
      const c = closestOnSeg(p.x, p.y, o.x1, o.y1, o.x2, o.y2);
      if (c.d <= Math.max(scene.wallT / 2, tol) + tol && c.d < bd) { bd = c.d; best = { kind: 'opening', id: o.id }; }
    }
    if (best) return best;
    for (const w of scene.walls) {
      const c = closestOnSeg(p.x, p.y, w.x1, w.y1, w.x2, w.y2);
      if (c.d <= Math.max(scene.wallT / 2, tol) + tol && c.d < bd) { bd = c.d; best = { kind: 'wall', id: w.id }; }
    }
    if (best) return best;
    for (const z of scene.zones) if (p.x >= z.x && p.x <= z.x + z.w && p.y >= z.y && p.y <= z.y + z.h) return { kind: 'zone', id: z.id };
    return null;
  }

  function hitHandle(o, p) {
    const tol = 11 / view.s, k = ui.sel.kind;
    if (k === 'wall' || k === 'opening') {
      if (Math.hypot(p.x - o.x1, p.y - o.y1) < tol) return { mode: 'endpoint', which: 1 };
      if (Math.hypot(p.x - o.x2, p.y - o.y2) < tol) return { mode: 'endpoint', which: 2 };
    } else if (k === 'device' && o.type !== 'ceil') {
      const h = aimHandle(o);
      if (Math.hypot(p.x - h.x, p.y - h.y) < tol) return { mode: 'aim' };
    } else if (k === 'zone') {
      if (Math.hypot(p.x - (o.x + o.w), p.y - (o.y + o.h)) < tol) return { mode: 'zoneResize' };
    }
    return null;
  }

  // ------------------------------------------------------------------ editing actions
  function deleteSel() {
    const o = getSel(); if (!o) return;
    checkpoint();
    const arr = allObjs(ui.sel.kind), i = arr.indexOf(o);
    arr.splice(i, 1);
    const structural = ui.sel.kind === 'wall' || ui.sel.kind === 'opening';
    ui.sel = null; if (structural) rebuild();
    renderSelection();
  }
  function setTool(t) {
    ui.tool = t; drag = null;
    for (const b of document.querySelectorAll('.tool')) b.classList.toggle('on', b.dataset.tool === t);
    $('#hint').textContent = HINTS[t];
    cv.style.cursor = t === 'select' ? 'default' : 'crosshair';
  }
  const HINTS = {
    select: 'Click to select · drag to move · drag the handles to resize/aim · Del deletes · Q/E rotate · wheel zoom · right-drag pan',
    wall: 'Drag to draw a wall (Shift = any angle). Endpoints snap to each other.',
    room: 'Drag a rectangle to create a room with four walls.',
    window: 'Drag along a wall to place a window of any width (click = default width).',
    door: 'Drag along a wall to place a doorway of any width (click = default width).',
    fan: 'Click to place a standing fan, drag to aim it.',
    ac: 'Click near a wall to mount an AC (it faces into the room), or drag to aim.',
    ceil: 'Click to place a ceiling fan.',
    zone: 'Drag to mark a comfort zone (bed, sofa, desk). Metrics and the optimizer score these.',
  };

  function makeDevice(type, p) {
    const base = { id: newId(), type, x: p.x, y: p.y, on: true, angle: 0 };
    if (type === 'fan') return Object.assign(base, { speed: 3, osc: false, oscRange: 60 });
    if (type === 'ac') return Object.assign(base, { speed: 2.5, temp: 19, width: 0.9 });
    return Object.assign(base, { speed: 1.2, dir: 1, radius: 0.65 });
  }

  // ------------------------------------------------------------------ pointer handling
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    const p = evPt(e), w = toWorld(p), f = Math.pow(1.0015, -e.deltaY);
    view.s = clamp(view.s * f, 12, 160);
    view.ox = p.x - w.x * view.s; view.oy = p.y - w.y * view.s;
  }, { passive: false });

  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture(e.pointerId);
    const sp = evPt(e), wp = toWorld(sp);
    if (e.button === 1 || e.button === 2 || spaceDown) { drag = { mode: 'pan', sx: sp.x, sy: sp.y, ox: view.ox, oy: view.oy }; return; }
    if (e.button !== 0) return;
    const t = ui.tool;
    if (t === 'select') return selectDown(wp);
    if (t === 'wall' || t === 'room') { const s = snapPt(wp); drag = { mode: t, a: s, b: s }; }
    else if (t === 'zone') { const s = snapPt(wp); drag = { mode: 'zone', a: s, b: s }; }
    else if (t === 'window' || t === 'door') {
      const nw = nearestWall(wp, 0.6);
      const a = nw ? { x: nw.c.x, y: nw.c.y } : snapPt(wp);
      drag = { mode: 'opening', kind: t, wall: nw ? nw.w : null, a, b: a, moved: false };
    } else if (t === 'fan' || t === 'ac' || t === 'ceil') {
      checkpoint();
      const d = makeDevice(t, { x: Math.round(wp.x * 20) / 20, y: Math.round(wp.y * 20) / 20 });
      if (t === 'ac') {
        const nw = nearestWall(wp, 0.7);
        if (nw) {
          const w = nw.w, L = Math.hypot(w.x2 - w.x1, w.y2 - w.y1) || 1;
          let nx = -(w.y2 - w.y1) / L, ny = (w.x2 - w.x1) / L;
          if ((wp.x - nw.c.x) * nx + (wp.y - nw.c.y) * ny < 0) { nx = -nx; ny = -ny; }
          d.x = nw.c.x + nx * (scene.wallT / 2 + 0.13); d.y = nw.c.y + ny * (scene.wallT / 2 + 0.13);
          d.angle = Math.round(Math.atan2(ny, nx) / DEG);
        }
      }
      scene.devices.push(d);
      ui.sel = { kind: 'device', id: d.id };
      drag = { mode: 'aim', dev: d, fresh: true, sx: sp.x, sy: sp.y, moved: false, cp: true };
      renderSelection();
    }
  });

  function selectDown(wp) {
    const o = getSel();
    if (o) {
      const h = hitHandle(o, wp);
      if (h) { drag = Object.assign({ cp: false, obj: o }, h); return; }
    }
    const hit = hitTest(wp);
    ui.sel = hit;
    if (hit) {
      const obj = getSel();
      drag = { mode: 'move', cp: false, obj, start: wp, orig: JSON.parse(JSON.stringify(obj)), kind: hit.kind };
    }
    renderSelection();
  }

  function ensureCp() { if (drag && !drag.cp) { checkpoint(); drag.cp = true; } }

  cv.addEventListener('pointermove', e => {
    const sp = evPt(e), wp = toWorld(sp);
    hover = wp; updateReadout();
    if (!drag) return;
    switch (drag.mode) {
      case 'pan': view.ox = drag.ox + sp.x - drag.sx; view.oy = drag.oy + sp.y - drag.sy; break;
      case 'wall': drag.b = snapPt(ortho(drag.a, wp, e.shiftKey)); break;
      case 'room': drag.b = snapPt(wp); break;
      case 'zone': drag.b = snapPt(wp); break;
      case 'opening': {
        drag.moved = true;
        if (drag.wall) {
          const w = drag.wall, c = closestOnSeg(wp.x, wp.y, w.x1, w.y1, w.x2, w.y2);
          const L = Math.hypot(w.x2 - w.x1, w.y2 - w.y1), ux = (w.x2 - w.x1) / L, uy = (w.y2 - w.y1) / L;
          const tB = Math.round(c.t * L / 0.05) * 0.05;
          drag.b = { x: w.x1 + ux * tB, y: w.y1 + uy * tB };
        } else drag.b = snapPt(ortho(drag.a, wp, e.shiftKey));
        break;
      }
      case 'aim': {
        const d = drag.dev || drag.obj;
        if (drag.fresh) {
          if (Math.hypot(sp.x - drag.sx, sp.y - drag.sy) > 6 && d.type !== 'ceil') { d.angle = Math.round(Math.atan2(wp.y - d.y, wp.x - d.x) / DEG); drag.moved = true; }
        } else { ensureCp(); d.angle = ((Math.round(Math.atan2(wp.y - d.y, wp.x - d.x) / DEG) % 360) + 360) % 360; }
        break;
      }
      case 'endpoint': {
        ensureCp();
        const o = drag.obj, k = drag.which, ox = k === 1 ? o.x2 : o.x1, oy = k === 1 ? o.y2 : o.y1;
        let q;
        if (ui.sel.kind === 'opening') {
          const L = Math.hypot(o.x2 - o.x1, o.y2 - o.y1) || 1, ux = (o.x2 - o.x1) / L * (k === 2 ? 1 : -1), uy = (o.y2 - o.y1) / L * (k === 2 ? 1 : -1);
          const t = Math.max(0.2, Math.round(((wp.x - ox) * ux + (wp.y - oy) * uy) / 0.05) * 0.05);
          q = { x: ox + ux * t, y: oy + uy * t };
        } else q = snapPt(ortho({ x: ox, y: oy }, wp, e.shiftKey));
        if (k === 1) { o.x1 = q.x; o.y1 = q.y; } else { o.x2 = q.x; o.y2 = q.y; }
        rebuildSoon(); renderSelectionSoft();
        break;
      }
      case 'zoneResize': {
        ensureCp(); const z = drag.obj;
        z.w = Math.max(0.4, Math.round((wp.x - z.x) / 0.05) * 0.05); z.h = Math.max(0.4, Math.round((wp.y - z.y) / 0.05) * 0.05);
        renderSelectionSoft(); break;
      }
      case 'move': {
        const dx = wp.x - drag.start.x, dy = wp.y - drag.start.y;
        if (!drag.cp && Math.hypot(dx, dy) < 0.04) break;
        ensureCp();
        const o = drag.obj, g = drag.orig, q = v => Math.round(v / 0.05) * 0.05;
        if (drag.kind === 'wall' || drag.kind === 'opening') {
          const sdx = ui.snap ? q(dx) : dx, sdy = ui.snap ? q(dy) : dy;
          o.x1 = g.x1 + sdx; o.y1 = g.y1 + sdy; o.x2 = g.x2 + sdx; o.y2 = g.y2 + sdy;
          rebuildSoon();
        } else { o.x = g.x + dx; o.y = g.y + dy; }
        break;
      }
    }
  });

  let rebuildPending = false;
  function rebuildSoon() { rebuildPending = true; }

  cv.addEventListener('pointerup', e => {
    const d = drag; drag = null;
    if (!d) return;
    if (d.mode === 'wall') {
      if (dist(d.a, d.b) >= 0.2) { checkpoint(); scene.walls.push({ id: newId(), x1: d.a.x, y1: d.a.y, x2: d.b.x, y2: d.b.y }); rebuild(); }
    } else if (d.mode === 'room') {
      const x1 = Math.min(d.a.x, d.b.x), x2 = Math.max(d.a.x, d.b.x), y1 = Math.min(d.a.y, d.b.y), y2 = Math.max(d.a.y, d.b.y);
      if (x2 - x1 >= 0.5 && y2 - y1 >= 0.5) {
        checkpoint();
        for (const s of [[x1, y1, x2, y1], [x2, y1, x2, y2], [x2, y2, x1, y2], [x1, y2, x1, y1]]) scene.walls.push({ id: newId(), x1: s[0], y1: s[1], x2: s[2], y2: s[3] });
        rebuild();
      }
    } else if (d.mode === 'zone') {
      const x1 = Math.min(d.a.x, d.b.x), y1 = Math.min(d.a.y, d.b.y), w = Math.abs(d.a.x - d.b.x), h = Math.abs(d.a.y - d.b.y);
      if (w >= 0.3 && h >= 0.3) {
        checkpoint(); const z = { id: newId(), x: x1, y: y1, w, h, name: 'Zone ' + (scene.zones.length + 1) };
        scene.zones.push(z); ui.sel = { kind: 'zone', id: z.id }; setTool('select'); renderSelection();
      }
    } else if (d.mode === 'opening') {
      let a = d.a, b = d.b;
      if (dist(a, b) < 0.3) {
        const L = d.kind === 'door' ? 0.9 : 1.2;
        if (d.wall) {
          const w = d.wall, wl = Math.hypot(w.x2 - w.x1, w.y2 - w.y1), ux = (w.x2 - w.x1) / wl, uy = (w.y2 - w.y1) / wl;
          a = { x: d.a.x - ux * L / 2, y: d.a.y - uy * L / 2 }; b = { x: d.a.x + ux * L / 2, y: d.a.y + uy * L / 2 };
        } else b = { x: a.x + L, y: a.y };
      }
      checkpoint();
      const o = { id: newId(), kind: d.kind, x1: a.x, y1: a.y, x2: b.x, y2: b.y, open: 1 };
      scene.openings.push(o); ui.sel = { kind: 'opening', id: o.id }; rebuild(); renderSelection();
    } else if (d.mode === 'aim' && d.fresh) {
      setTool('select'); renderSelection();
    } else if (d.mode === 'endpoint' || d.mode === 'move') {
      if (d.cp) { rebuild(); renderSelection(); }
    } else if (d.mode === 'zoneResize') renderSelection();
  });

  window.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    const k = e.key.toLowerCase();
    if (e.ctrlKey && k === 'z') { e.preventDefault(); undo(); return; }
    if (e.key === ' ') { spaceDown = true; e.preventDefault(); return; }
    if (k === 'delete' || k === 'backspace') { deleteSel(); return; }
    if (k === 'escape') { drag = null; ui.sel = null; setTool('select'); renderSelection(); return; }
    const map = { v: 'select', w: 'wall', r: 'room', i: 'window', d: 'door', f: 'fan', a: 'ac', c: 'ceil', z: 'zone' };
    if (map[k] && !e.ctrlKey) { setTool(map[k]); return; }
    if (k === 'p') { togglePlay(); return; }
    if (k === 'q' || k === 'e') {
      const o = getSel();
      if (o && ui.sel.kind === 'device' && o.type !== 'ceil') { checkpoint(true); o.angle = (((o.angle + (k === 'e' ? 15 : -15)) % 360) + 360) % 360; renderSelection(); }
    }
  });
  window.addEventListener('keyup', e => { if (e.key === ' ') spaceDown = false; });

  // ------------------------------------------------------------------ particles
  const NP = 4500;
  const px = new Float32Array(NP), py = new Float32Array(NP), pvx = new Float32Array(NP), pvy = new Float32Array(NP), page = new Float32Array(NP), plife = new Float32Array(NP);
  const tmpV = [0, 0];
  function respawn(i, ageRandom) {
    const nx = sim.nx, h = sim.cell;
    for (let tries = 0; tries < 8; tries++) {
      let x, y;
      if (sim.indoorList.length && Math.random() < 0.8) {
        const c = sim.indoorList[(Math.random() * sim.indoorList.length) | 0];
        x = ((c % nx) + Math.random()) * h; y = (((c / nx) | 0) + Math.random()) * h;
      } else { x = Math.random() * WORLD.w; y = Math.random() * WORLD.h; }
      if (sim.isSolidAt(x, y)) continue;
      px[i] = x; py[i] = y; break;
    }
    plife[i] = 250 + Math.random() * 350;
    page[i] = ageRandom ? Math.random() * plife[i] : 0;
    pvx[i] = 0; pvy[i] = 0;
  }
  for (let i = 0; i < NP; i++) respawn(i, true);

  function advectParticles() {
    const dt = sim.dt, jit = 0.04;
    for (let i = 0; i < NP; i++) {
      sim.sample(px[i], py[i], tmpV);
      pvx[i] = tmpV[0]; pvy[i] = tmpV[1];
      px[i] += (tmpV[0] + (Math.random() - 0.5) * jit) * dt; py[i] += (tmpV[1] + (Math.random() - 0.5) * jit) * dt;
      page[i]++;
      if (page[i] > plife[i] || px[i] < 0 || py[i] < 0 || px[i] >= WORLD.w || py[i] >= WORLD.h || sim.isSolidAt(px[i], py[i])) respawn(i, false);
    }
  }

  // ------------------------------------------------------------------ rendering
  function ramp(stops) {
    const lut = new Uint8Array(256 * 3);
    for (let i = 0; i < 256; i++) {
      const t = i / 255 * (stops.length - 1), k = Math.min(stops.length - 2, Math.floor(t)), f = t - k;
      for (let c = 0; c < 3; c++) lut[i * 3 + c] = stops[k][c] * (1 - f) + stops[k + 1][c] * f;
    }
    return lut;
  }
  const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const SPEED_STOPS = ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'];
  const TEMP_STOPS = ['#2563eb', '#7dd3fc', '#e5e7eb', '#fbbf24', '#ef4444'];
  const speedLUT = ramp(SPEED_STOPS.map(hex)), tempLUT = ramp(TEMP_STOPS.map(hex));
  const SPEED_MAX = 3;
  // Temperature scale follows the scene: coldest of outdoors / AC supply to hottest of outdoors / room.
  function tempRange() {
    const e = scene.env; let lo = Math.min(e.tOut, e.tIn);
    for (const d of scene.devices) if (d.type === 'ac' && d.on) lo = Math.min(lo, d.temp);
    return [Math.floor(lo) - 2, Math.ceil(Math.max(e.tOut, e.tIn)) + 1];
  }
  const fieldCv = document.createElement('canvas'); fieldCv.width = sim.nx; fieldCv.height = sim.ny;
  const fctx = fieldCv.getContext('2d'), fimg = fctx.createImageData(sim.nx, sim.ny);

  function drawField() {
    const d = fimg.data, n = sim.n, ov = ui.overlay, [tlo, thi] = tempRange();
    for (let c = 0; c < n; c++) {
      const o = c * 4;
      if (sim.solid[c]) { d[o + 3] = 0; continue; }
      let r, g, b;
      if (sim.indoor[c]) { r = 30; g = 44; b = 60; } else { r = 14; g = 21; b = 30; }
      if (ov === 'speed') {
        const s = Math.hypot(sim.u[c], sim.v[c]), li = ((clamp(s / SPEED_MAX, 0, 1) * 255) | 0) * 3;
        const a = clamp(s / 0.25, 0, 1) * (sim.indoor[c] ? 0.8 : 0.45);
        r += (speedLUT[li] - r) * a; g += (speedLUT[li + 1] - g) * a; b += (speedLUT[li + 2] - b) * a;
      } else if (ov === 'temp') {
        const li = ((clamp((sim.T[c] - tlo) / (thi - tlo), 0, 1) * 255) | 0) * 3;
        const a = 0.9;
        r += (tempLUT[li] - r) * a; g += (tempLUT[li + 1] - g) * a; b += (tempLUT[li + 2] - b) * a;
      }
      d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
    }
    fctx.putImageData(fimg, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(fieldCv, 0, 0, sim.nx * sim.cell, sim.ny * sim.cell);
  }

  function drawGrid() {
    if (!ui.grid) return;
    ctx.lineWidth = 1 / view.s;
    for (let x = 0; x <= WORLD.w; x++) { ctx.strokeStyle = x % 5 === 0 ? 'rgba(148,163,184,.16)' : 'rgba(148,163,184,.06)'; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WORLD.h); ctx.stroke(); }
    for (let y = 0; y <= WORLD.h; y++) { ctx.strokeStyle = y % 5 === 0 ? 'rgba(148,163,184,.16)' : 'rgba(148,163,184,.06)'; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WORLD.w, y); ctx.stroke(); }
  }

  function arrow(x, y, ang, len, w, color) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-len / 2, 0); ctx.lineTo(len / 2 - w * 3, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(len / 2, 0); ctx.lineTo(len / 2 - w * 4.5, -w * 2.4); ctx.lineTo(len / 2 - w * 4.5, w * 2.4); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function drawWind() {
    const e = scene.env; if (e.windSpeed < 0.05) return;
    const th = e.windDir * DEG, ux = -Math.sin(th), uy = Math.cos(th), ang = Math.atan2(uy, ux);
    const len = 0.8 + e.windSpeed * 0.25, col = 'rgba(56,189,248,.75)', w = 2.5 / view.s;
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 500);
    ctx.globalAlpha = 0.45 + 0.4 * pulse;
    if (ux > 0.2) for (let y = 1.5; y < WORLD.h; y += 2.5) arrow(0.9, y, ang, len, w, col);
    if (ux < -0.2) for (let y = 1.5; y < WORLD.h; y += 2.5) arrow(WORLD.w - 0.9, y, ang, len, w, col);
    if (uy > 0.2) for (let x = 1.5; x < WORLD.w; x += 2.5) arrow(x, 0.9, ang, len, w, col);
    if (uy < -0.2) for (let x = 1.5; x < WORLD.w; x += 2.5) arrow(x, WORLD.h - 0.9, ang, len, w, col);
    ctx.globalAlpha = 1;
  }

  function drawZones() {
    for (const z of scene.zones) {
      ctx.fillStyle = 'rgba(74,222,128,.10)'; ctx.fillRect(z.x, z.y, z.w, z.h);
      ctx.setLineDash([6 / view.s, 4 / view.s]); ctx.strokeStyle = 'rgba(74,222,128,.8)'; ctx.lineWidth = 1.5 / view.s;
      ctx.strokeRect(z.x, z.y, z.w, z.h); ctx.setLineDash([]);
    }
  }

  function segPath(o) { ctx.beginPath(); ctx.moveTo(o.x1, o.y1); ctx.lineTo(o.x2, o.y2); }
  const wallCv = document.createElement('canvas'), wctx = wallCv.getContext('2d');
  function drawWalls() {
    if (wallCv.width !== cv.width || wallCv.height !== cv.height) { wallCv.width = cv.width; wallCv.height = cv.height; }
    wctx.setTransform(1, 0, 0, 1, 0, 0); wctx.clearRect(0, 0, wallCv.width, wallCv.height);
    wctx.setTransform(DPR * view.s, 0, 0, DPR * view.s, DPR * view.ox, DPR * view.oy);
    wctx.lineCap = 'square'; wctx.lineWidth = scene.wallT; wctx.strokeStyle = '#cbd5e1';
    for (const w of scene.walls) { wctx.beginPath(); wctx.moveTo(w.x1, w.y1); wctx.lineTo(w.x2, w.y2); wctx.stroke(); }
    wctx.globalCompositeOperation = 'destination-out'; wctx.lineCap = 'butt'; wctx.lineWidth = scene.wallT * 1.1;
    for (const o of scene.openings) {
      const f = clamp(o.open, 0, 1); if (f <= 0) continue;
      const mx = (o.x1 + o.x2) / 2, my = (o.y1 + o.y2) / 2, dx = (o.x2 - o.x1) * f / 2, dy = (o.y2 - o.y1) * f / 2;
      wctx.beginPath(); wctx.moveTo(mx - dx, my - dy); wctx.lineTo(mx + dx, my + dy); wctx.stroke();
    }
    wctx.globalCompositeOperation = 'source-over';
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(wallCv, 0, 0); ctx.restore();
  }
  function drawOpenings() {
    for (const o of scene.openings) {
      const col = o.kind === 'door' ? '251,191,36' : '34,211,238';
      const dx = o.x2 - o.x1, dy = o.y2 - o.y1, f = clamp(o.open, 0, 1), L = Math.hypot(dx, dy) || 1;
      const mx = (o.x1 + o.x2) / 2, my = (o.y1 + o.y2) / 2, ox1 = mx - dx * f / 2, oy1 = my - dy * f / 2, ox2 = mx + dx * f / 2, oy2 = my + dy * f / 2;
      ctx.lineCap = 'butt'; ctx.lineWidth = scene.wallT * 0.7; ctx.strokeStyle = 'rgba(' + col + ',.8)';
      for (const s of [[o.x1, o.y1, ox1, oy1], [ox2, oy2, o.x2, o.y2]]) { if (Math.hypot(s[2] - s[0], s[3] - s[1]) < 0.01) continue; ctx.beginPath(); ctx.moveTo(s[0], s[1]); ctx.lineTo(s[2], s[3]); ctx.stroke(); }
      if (f > 0) {
        ctx.strokeStyle = 'rgba(' + col + ',1)'; ctx.lineWidth = 2.5 / view.s;
        ctx.setLineDash([7 / view.s, 5 / view.s]); ctx.beginPath(); ctx.moveTo(ox1, oy1); ctx.lineTo(ox2, oy2); ctx.stroke(); ctx.setLineDash([]);
        ctx.lineWidth = 3 / view.s; ctx.beginPath();
        const nx = -dy / L * scene.wallT * 0.6, ny = dx / L * scene.wallT * 0.6;
        for (const q of [[ox1, oy1], [ox2, oy2]]) { ctx.moveTo(q[0] - nx, q[1] - ny); ctx.lineTo(q[0] + nx, q[1] + ny); }
        ctx.stroke();
      }
    }
  }

  function drawParticles() {
    if (!ui.particles) return;
    const buckets = [[], [], [], []], alphas = [0.28, 0.45, 0.7, 0.95], dt = 0.35;
    for (let i = 0; i < NP; i++) {
      const s = Math.hypot(pvx[i], pvy[i]);
      buckets[s < 0.12 ? 0 : s < 0.5 ? 1 : s < 1.3 ? 2 : 3].push(i);
    }
    ctx.lineCap = 'round'; ctx.lineWidth = 1.4 / view.s;
    const minLen = 1.2 / view.s;
    for (let b = 0; b < 4; b++) {
      ctx.strokeStyle = `rgba(235,247,255,${alphas[b]})`;
      ctx.beginPath();
      for (const i of buckets[b]) {
        let vx = pvx[i] * dt, vy = pvy[i] * dt; const l = Math.hypot(vx, vy);
        if (l < minLen) { if (l < 1e-6) { vx = minLen; vy = 0; } else { vx *= minLen / l; vy *= minLen / l; } }
        ctx.moveTo(px[i] - vx, py[i] - vy); ctx.lineTo(px[i], py[i]);
      }
      ctx.stroke();
    }
  }

  function drawDevices() {
    const t = sim.time;
    for (const d of scene.devices) {
      ctx.save(); ctx.translate(d.x, d.y);
      const sel = ui.sel && ui.sel.kind === 'device' && ui.sel.id === d.id, a = d.angle * DEG;
      const dim = d.on ? 1 : 0.4; ctx.globalAlpha = dim;
      if (d.type === 'fan') {
        if (d.osc) {
          const half = (d.oscRange || 60) / 2 * DEG;
          ctx.fillStyle = 'rgba(56,189,248,.08)'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 1.6, a - half, a + half); ctx.closePath(); ctx.fill();
        }
        ctx.rotate(a);
        ctx.fillStyle = 'rgba(56,189,248,.10)'; ctx.beginPath(); ctx.moveTo(0.2, -0.12); ctx.lineTo(1.4, -0.5); ctx.lineTo(1.4, 0.5); ctx.lineTo(0.2, 0.12); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#0f172a'; ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 2 / view.s;
        ctx.beginPath(); ctx.arc(0, 0, 0.24, 0, 7); ctx.fill(); ctx.stroke();
        ctx.save(); ctx.rotate(d.on && ui.running ? t * d.speed * 5 : 0); ctx.fillStyle = '#38bdf8';
        for (let k = 0; k < 3; k++) { ctx.rotate(2.0944); ctx.beginPath(); ctx.ellipse(0.11, 0, 0.11, 0.045, 0, 0, 7); ctx.fill(); }
        ctx.restore();
        ctx.fillStyle = '#38bdf8'; ctx.beginPath(); ctx.moveTo(0.34, 0); ctx.lineTo(0.25, -0.07); ctx.lineTo(0.25, 0.07); ctx.closePath(); ctx.fill();
      } else if (d.type === 'ac') {
        ctx.rotate(a); const w = d.width || 0.9;
        ctx.fillStyle = '#082f49'; ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2 / view.s;
        ctx.beginPath(); ctx.rect(-0.14, -w / 2, 0.14, w); ctx.fill(); ctx.stroke();
        ctx.fillStyle = 'rgba(34,211,238,.12)'; ctx.beginPath(); ctx.moveTo(0, -w / 2); ctx.lineTo(1.1, -w / 2 - 0.3); ctx.lineTo(1.1, w / 2 + 0.3); ctx.lineTo(0, w / 2); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 1 / view.s;
        for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.moveTo(-0.1, k * w / 6); ctx.lineTo(-0.02, k * w / 6); ctx.stroke(); }
      } else {
        const R = d.radius || 0.65, dir = d.dir >= 0 ? 1 : -1;
        ctx.setLineDash([5 / view.s, 4 / view.s]); ctx.strokeStyle = 'rgba(250,204,21,.7)'; ctx.lineWidth = 1.5 / view.s;
        ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.stroke(); ctx.setLineDash([]);
        ctx.save(); ctx.rotate(d.on && ui.running ? t * d.speed * 2.5 * dir : 0); ctx.fillStyle = 'rgba(250,204,21,.85)';
        for (let k = 0; k < 4; k++) { ctx.rotate(Math.PI / 2); ctx.beginPath(); ctx.ellipse(R * 0.55, 0, R * 0.42, 0.07, 0, 0, 7); ctx.fill(); }
        ctx.restore();
        ctx.fillStyle = '#0f172a'; ctx.strokeStyle = '#facc15'; ctx.lineWidth = 1.5 / view.s; ctx.beginPath(); ctx.arc(0, 0, 0.09, 0, 7); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = 'rgba(250,204,21,.9)'; ctx.lineWidth = 2 / view.s; ctx.beginPath(); ctx.arc(0, 0, R * 1.12, dir > 0 ? 0.3 : 1.3, dir > 0 ? 1.3 : 0.3, dir < 0); ctx.stroke();
      }
      ctx.restore();
      if (sel) {
        ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 1.5 / view.s; ctx.setLineDash([4 / view.s, 3 / view.s]);
        ctx.beginPath(); ctx.arc(d.x, d.y, deviceRadius(d) + 0.12, 0, 7); ctx.stroke(); ctx.setLineDash([]);
        if (d.type !== 'ceil') {
          const h = aimHandle(d); ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(h.x, h.y); ctx.stroke();
          ctx.fillStyle = '#fbbf24'; ctx.beginPath(); ctx.arc(h.x, h.y, 6 / view.s, 0, 7); ctx.fill();
        }
      }
    }
  }

  function drawSelection() {
    const o = getSel(); if (!o) return;
    const k = ui.sel.kind;
    ctx.strokeStyle = '#fbbf24'; ctx.fillStyle = '#fbbf24'; ctx.lineWidth = 1.5 / view.s;
    if (k === 'wall' || k === 'opening') {
      ctx.lineCap = 'butt'; ctx.globalAlpha = 0.35; ctx.lineWidth = scene.wallT + 6 / view.s; segPath(o); ctx.stroke(); ctx.globalAlpha = 1;
      for (const p of [[o.x1, o.y1], [o.x2, o.y2]]) { ctx.beginPath(); ctx.arc(p[0], p[1], 6 / view.s, 0, 7); ctx.fill(); }
    } else if (k === 'zone') {
      ctx.setLineDash([4 / view.s, 3 / view.s]); ctx.strokeRect(o.x - 0.05, o.y - 0.05, o.w + 0.1, o.h + 0.1); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(o.x + o.w, o.y + o.h, 6 / view.s, 0, 7); ctx.fill();
    }
  }

  function drawOptOverlay() {
    if (!optResult) return;
    const r = optResult, sc = r.map.map(m => m.score), lo = Math.min(...sc), hi = Math.max(...sc), span = Math.max(1e-6, hi - lo);
    for (const m of r.map) {
      const t = (m.score - lo) / span, li = ((t * 255) | 0) * 3;
      ctx.fillStyle = `rgba(${speedLUT[li]},${speedLUT[li + 1]},${speedLUT[li + 2]},.55)`;
      ctx.fillRect(m.x - 0.45, m.y - 0.45, 0.9, 0.9);
    }
    r.best.forEach((b, i) => {
      ctx.fillStyle = i === 0 ? '#4ade80' : '#fbbf24'; ctx.strokeStyle = '#0b1118'; ctx.lineWidth = 2 / view.s;
      ctx.beginPath(); ctx.arc(b.x, b.y, 0.26, 0, 7); ctx.fill(); ctx.stroke();
      arrow(b.x + Math.cos(b.angle * DEG) * 0.55, b.y + Math.sin(b.angle * DEG) * 0.55, b.angle * DEG, 0.8, 2.5 / view.s, ctx.fillStyle);
    });
  }

  function drawPreview() {
    if (!drag) return;
    ctx.lineWidth = scene.wallT; ctx.lineCap = 'square';
    if (drag.mode === 'wall') { ctx.strokeStyle = 'rgba(203,213,225,.6)'; ctx.beginPath(); ctx.moveTo(drag.a.x, drag.a.y); ctx.lineTo(drag.b.x, drag.b.y); ctx.stroke(); }
    else if (drag.mode === 'room') {
      ctx.strokeStyle = 'rgba(203,213,225,.6)'; ctx.strokeRect(Math.min(drag.a.x, drag.b.x), Math.min(drag.a.y, drag.b.y), Math.abs(drag.a.x - drag.b.x), Math.abs(drag.a.y - drag.b.y));
    } else if (drag.mode === 'zone') {
      ctx.fillStyle = 'rgba(74,222,128,.18)'; ctx.fillRect(Math.min(drag.a.x, drag.b.x), Math.min(drag.a.y, drag.b.y), Math.abs(drag.a.x - drag.b.x), Math.abs(drag.a.y - drag.b.y));
    } else if (drag.mode === 'opening') {
      ctx.lineCap = 'butt'; ctx.strokeStyle = drag.kind === 'door' ? 'rgba(251,191,36,.8)' : 'rgba(34,211,238,.8)';
      ctx.beginPath(); ctx.moveTo(drag.a.x, drag.a.y); ctx.lineTo(drag.b.x, drag.b.y); ctx.stroke();
    }
    if (drag.mode === 'wall' || drag.mode === 'opening' || drag.mode === 'room' || drag.mode === 'zone') {
      const a = toScr(drag.a), b = toScr(drag.b);
      ctx.save(); ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.fillStyle = '#e2e8f0'; ctx.font = '12px Segoe UI, sans-serif';
      const txt = drag.mode === 'room' || drag.mode === 'zone' ? `${Math.abs(drag.a.x - drag.b.x).toFixed(2)} × ${Math.abs(drag.a.y - drag.b.y).toFixed(2)} m` : `${dist(drag.a, drag.b).toFixed(2)} m`;
      ctx.fillText(txt, (a.x + b.x) / 2 + 8, (a.y + b.y) / 2 - 8); ctx.restore();
    }
  }

  function drawLabels() {
    ctx.save(); ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.font = '12px Segoe UI, sans-serif'; ctx.textBaseline = 'middle';
    for (const z of scene.zones) {
      const s = toScr({ x: z.x, y: z.y }), st = zoneStats[z.id];
      ctx.fillStyle = 'rgba(134,239,172,.95)';
      ctx.fillText(z.name + (st ? `  ${st.speed.toFixed(2)} m/s · ${st.temp.toFixed(1)}°` : ''), s.x + 4, s.y - 8);
    }
    for (const o of scene.openings) {
      const L = Math.hypot(o.x2 - o.x1, o.y2 - o.y1), m = toScr({ x: (o.x1 + o.x2) / 2, y: (o.y1 + o.y2) / 2 });
      if (view.s > 24) { ctx.fillStyle = o.kind === 'door' ? 'rgba(251,191,36,.9)' : 'rgba(34,211,238,.9)'; ctx.fillText(`${(L * clamp(o.open, 0, 1)).toFixed(1)} m`, m.x + 6, m.y - 12); }
    }
    optResult && optResult.best.forEach((b, i) => { const s = toScr(b); ctx.fillStyle = '#04120a'; ctx.font = 'bold 12px Segoe UI'; ctx.textAlign = 'center'; ctx.fillText(String(i + 1), s.x, s.y); ctx.textAlign = 'left'; });
    // scale bar
    const x0 = 14, y0 = cv.height / DPR - 44, len = 2 * view.s;
    ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + len, y0); ctx.moveTo(x0, y0 - 4); ctx.lineTo(x0, y0 + 4); ctx.moveTo(x0 + len, y0 - 4); ctx.lineTo(x0 + len, y0 + 4); ctx.stroke();
    ctx.fillStyle = '#94a3b8'; ctx.fillText('2 m', x0 + len / 2 - 10, y0 - 10);
    ctx.restore();
  }

  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#080d13'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.setTransform(DPR * view.s, 0, 0, DPR * view.s, DPR * view.ox, DPR * view.oy);
    drawField(); drawGrid(); drawZones(); drawOptOverlay(); drawWind();
    drawWalls(); drawOpenings(); drawParticles(); drawDevices(); drawSelection(); drawPreview();
    drawLabels();
  }

  // ------------------------------------------------------------------ main loop
  let acc = 0, lastT = performance.now(), lastMetrics = 0;
  function frame(now) {
    const dtFrame = Math.min(100, now - lastT); lastT = now;
    if (opt) {
      const p = opt.step(30);
      $('#optFill').style.width = (p * 100).toFixed(0) + '%';
      if (opt.done) { optResult = opt.result; opt = null; renderOpt(); }
    } else if (ui.running) {
      acc += ui.speedMul * 2;
      const t0 = performance.now();
      let steps = 0;
      while (acc >= 1 && steps < 8) {
        sim.step(); advectParticles(); acc -= 1; steps++;
        if (performance.now() - t0 > 22) { acc = 0; break; }
      }
      if (acc > 8) acc = 0;
    }
    if (rebuildPending) { rebuildPending = false; sim.build(scene); updateRoomNote(); }
    if (now - lastMetrics > 250) { lastMetrics = now; updateMetrics(); updateReadout(); }
    render();
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------------ side panels
  function updateRoomNote() {
    $('#roomNote').textContent = sim.indoorList.length ? '' : '· no enclosed room yet';
  }
  function updateReadout() {
    if (!hover) { $('#readout').textContent = ''; return; }
    let txt = `x ${hover.x.toFixed(1)} m  y ${hover.y.toFixed(1)} m`;
    if (hover.x >= 0 && hover.y >= 0 && hover.x < WORLD.w && hover.y < WORLD.h) {
      const c = sim.cellAt(hover.x, hover.y);
      if (!sim.solid[c]) txt += `  ·  ${Math.hypot(sim.u[c], sim.v[c]).toFixed(2)} m/s  ·  ${sim.T[c].toFixed(1)} °C`;
    }
    $('#readout').textContent = txt;
  }

  function updateMetrics() {
    const m = sim.metrics(scene.zones), box = $('#metrics');
    zoneStats = {};
    if (!m) { box.innerHTML = '<div class="k" style="grid-column:1/-1">Draw closed walls to form a room. Window and door openings count as gaps, so a room is "enclosed" once its walls close.</div>'; return; }
    for (const z of m.zones) zoneStats[z.id] = z;
    let h = `<div class="k">Indoor area</div><div>${m.area.toFixed(1)} m²</div>
      <div class="k">Mean air speed</div><div>${m.speed.toFixed(2)} m/s</div>
      <div class="k">Comfortable (0.2–2 m/s)</div><div>${(m.comfort * 100).toFixed(0)} %</div>
      <div class="k">Stagnant (&lt; 0.05 m/s)</div><div>${(m.stagnant * 100).toFixed(0)} %</div>
      <div class="k">Mean temperature</div><div>${m.temp.toFixed(1)} °C</div>`;
    if (m.zones.length) {
      h += '<div class="z">Comfort zones</div>';
      for (const z of m.zones) { const zz = scene.zones.find(q => q.id === z.id); h += `<div class="k">${zz ? zz.name : ''}</div><div>${z.speed.toFixed(2)} m/s · ${z.temp.toFixed(1)}°</div>`; }
    }
    box.innerHTML = h;
  }

  function slider(label, min, max, step, get, set, fmt, structural) {
    const out = el('output'), inp = el('input', { type: 'range', min, max, step, value: get() });
    const upd = () => { out.textContent = fmt ? fmt(+inp.value) : inp.value; };
    inp.addEventListener('input', () => { checkpoint(true); set(+inp.value); upd(); if (structural) rebuildSoon(); });
    upd();
    return el('div', { class: 'ctl' }, el('label', null, label), inp, out);
  }
  function check(label, get, set) {
    const inp = el('input', { type: 'checkbox' }); inp.checked = !!get();
    inp.addEventListener('change', () => { checkpoint(); set(inp.checked); });
    return el('div', { class: 'ctl chk' }, el('label', null, label), inp);
  }

  function buildEnvCtl() {
    const box = $('#envCtl'); box.innerHTML = '';
    const e = scene.env;
    box.append(
      slider('Wind speed', 0, 6, 0.1, () => e.windSpeed, v => { e.windSpeed = v; }, v => v.toFixed(1) + ' m/s'),
      slider('Gustiness', 0, 1, 0.05, () => e.gust, v => { e.gust = v; }, v => (v * 100).toFixed(0) + '%'),
      slider('Outdoor temp', 15, 42, 1, () => e.tOut, v => { e.tOut = v; }, v => v + ' °C'),
      slider('Room / wall temp', 20, 45, 1, () => e.tIn, v => { e.tIn = v; }, v => v + ' °C'),
      slider('Wall heat release', 0, 1, 0.05, () => e.wallHeat, v => { e.wallHeat = v; }, v => (v * 100).toFixed(0) + '%'),
      el('div', { class: 'row' }, el('button', { class: 'btn small', title: 'Set all indoor air to the room temperature now', onclick: () => { sim.resetTemp(); } }, 'Set room air to this now')),
      el('p', { class: 'muted small' }, 'Heat-soaked concrete: walls keep warming the room air toward the room / wall temperature, while outdoor air is cooler. Release = how fast walls give back heat.'));
  }
  function buildViewCtl() {
    const seg = $('#overlaySeg'); seg.innerHTML = '';
    for (const [k, l] of [['speed', 'Air speed'], ['temp', 'Temperature'], ['none', 'None']]) {
      seg.append(el('button', { class: ui.overlay === k ? 'on' : '', onclick: () => { ui.overlay = k; buildViewCtl(); updateLegend(); } }, l));
    }
    const box = $('#viewCtl'); box.innerHTML = '';
    box.append(
      check('Particles', () => ui.particles, v => { ui.particles = v; }),
      slider('Sim speed', 0.25, 3, 0.25, () => ui.speedMul, v => { ui.speedMul = v; }, v => v + '×'),
      check('Snap to grid', () => ui.snap, v => { ui.snap = v; }),
      check('Grid lines', () => ui.grid, v => { ui.grid = v; }),
      el('div', { class: 'row' }, el('button', { class: 'btn small', onclick: fit }, 'Fit view')));
  }
  function updateLegend() {
    const L = $('#legend');
    if (ui.overlay === 'none') { L.style.display = 'none'; return; }
    L.style.display = '';
    const stops = ui.overlay === 'speed' ? SPEED_STOPS : TEMP_STOPS, [tlo, thi] = tempRange();
    L.innerHTML = `<div>${ui.overlay === 'speed' ? 'Air speed' : 'Temperature'}</div><div class="ramp" style="background:linear-gradient(90deg,${stops.join(',')})"></div>
      <div class="lab"><span>${ui.overlay === 'speed' ? '0' : tlo + '°'}</span><span>${ui.overlay === 'speed' ? SPEED_MAX + ' m/s' : thi + '°'}</span></div>`;
  }
  setInterval(() => { if (ui.overlay === 'temp') updateLegend(); }, 1000);

  const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const dial = $('#dial'), dctx = dial.getContext('2d');
  function drawDial() {
    const S = dial.width, c = S / 2, r = c - 8, b = scene.env.windDir * DEG;
    dctx.clearRect(0, 0, S, S);
    dctx.strokeStyle = '#334a63'; dctx.lineWidth = 2; dctx.beginPath(); dctx.arc(c, c, r, 0, 7); dctx.stroke();
    dctx.fillStyle = '#8497ad'; dctx.font = '11px Segoe UI'; dctx.textAlign = 'center'; dctx.textBaseline = 'middle';
    dctx.fillText('N', c, 8); dctx.fillText('S', c, S - 8); dctx.fillText('E', S - 7, c); dctx.fillText('W', 7, c);
    const sx = Math.sin(b), sy = -Math.cos(b), tail = { x: c + sx * r * 0.82, y: c + sy * r * 0.82 }, head = { x: c - sx * r * 0.55, y: c - sy * r * 0.55 };
    dctx.strokeStyle = '#38bdf8'; dctx.fillStyle = '#38bdf8'; dctx.lineWidth = 4; dctx.lineCap = 'round';
    dctx.beginPath(); dctx.moveTo(tail.x, tail.y); dctx.lineTo(head.x, head.y); dctx.stroke();
    const ang = Math.atan2(head.y - tail.y, head.x - tail.x);
    dctx.beginPath(); dctx.moveTo(head.x + Math.cos(ang) * 8, head.y + Math.sin(ang) * 8);
    dctx.lineTo(head.x + Math.cos(ang + 2.5) * 9, head.y + Math.sin(ang + 2.5) * 9); dctx.lineTo(head.x + Math.cos(ang - 2.5) * 9, head.y + Math.sin(ang - 2.5) * 9); dctx.closePath(); dctx.fill();
    dctx.beginPath(); dctx.arc(tail.x, tail.y, 5, 0, 7); dctx.fill();
    const deg = Math.round(scene.env.windDir);
    $('#dialLabel').textContent = `from ${COMPASS[Math.round(deg / 45) % 8]} (${deg}°)`;
  }
  function dialPointer(e) {
    const r = dial.getBoundingClientRect(), dx = e.clientX - r.left - r.width / 2, dy = e.clientY - r.top - r.height / 2;
    let b = Math.atan2(dx, -dy) / DEG; b = (b + 360) % 360;
    if (!e.shiftKey) b = Math.round(b / 5) * 5 % 360;
    scene.env.windDir = b; checkpoint(true); drawDial();
  }
  dial.addEventListener('pointerdown', e => { dial.setPointerCapture(e.pointerId); dial._d = true; dialPointer(e); });
  dial.addEventListener('pointermove', e => { if (dial._d) dialPointer(e); });
  dial.addEventListener('pointerup', () => { dial._d = false; });

  function selectedFan() { const o = getSel(); return o && ui.sel.kind === 'device' && o.type === 'fan' ? o : null; }

  let selSoftPending = false;
  function renderSelectionSoft() { selSoftPending = true; }
  setInterval(() => { if (selSoftPending && drag) { selSoftPending = false; renderSelection(); } }, 150);

  function renderSelection() {
    const box = $('#selection'); box.innerHTML = '';
    const o = getSel(), t = $('#selTitle');
    if (!o) { t.textContent = 'Selection'; box.append(el('p', { class: 'muted small' }, 'Nothing selected. Pick a tool on the left and draw, or click an object to edit it. Click the room outline, a fan, an AC, an opening…')); return; }
    const k = ui.sel.kind;
    const del = el('button', { class: 'btn small danger', onclick: deleteSel }, 'Delete');
    if (k === 'wall') {
      t.textContent = 'Wall';
      box.append(el('div', { class: 'ctl chk' }, el('label', null, `Length ${Math.hypot(o.x2 - o.x1, o.y2 - o.y1).toFixed(2)} m`), del));
    } else if (k === 'opening') {
      t.textContent = o.kind === 'door' ? 'Doorway' : 'Window';
      const sel = el('select', { onchange: () => { checkpoint(); o.kind = sel.value; renderSelection(); } },
        el('option', { value: 'window' }, 'Window'), el('option', { value: 'door' }, 'Doorway'));
      sel.value = o.kind;
      box.append(
        el('div', { class: 'ctl', style: 'grid-template-columns:78px 1fr' }, el('label', null, 'Type'), sel),
        slider('Opened', 0, 1, 0.05, () => o.open, v => { o.open = v; renderLenSoon(); }, v => (v * 100).toFixed(0) + '%', true),
        el('div', { class: 'ctl chk' }, el('label', { id: 'openLen' }, openLenText(o)), del));
    } else if (k === 'zone') {
      t.textContent = 'Comfort zone';
      const nm = el('input', { type: 'text', value: o.name || '' });
      nm.addEventListener('input', () => { o.name = nm.value; scheduleSave(); });
      box.append(el('div', { class: 'ctl', style: 'grid-template-columns:78px 1fr' }, el('label', null, 'Name'), nm),
        slider('Width', 0.4, 6, 0.05, () => o.w, v => { o.w = v; }, v => v.toFixed(2) + ' m'),
        slider('Depth', 0.4, 6, 0.05, () => o.h, v => { o.h = v; }, v => v.toFixed(2) + ' m'),
        el('div', { class: 'row' }, del));
    } else {
      const names = { fan: 'Standing fan', ac: 'Air conditioner', ceil: 'Ceiling fan' };
      t.textContent = names[o.type];
      box.append(check('Powered on', () => o.on, v => { o.on = v; }));
      if (o.type !== 'ceil') box.append(slider('Direction', 0, 359, 1, () => o.angle, v => { o.angle = v; }, v => v + '°'));
      if (o.type === 'fan') {
        box.append(slider('Air speed', 0.5, 6, 0.1, () => o.speed, v => { o.speed = v; }, v => v.toFixed(1) + ' m/s'),
          check('Oscillate', () => o.osc, v => { o.osc = v; }),
          slider('Sweep', 20, 140, 5, () => o.oscRange || 60, v => { o.oscRange = v; }, v => v + '°'));
      } else if (o.type === 'ac') {
        box.append(slider('Air speed', 0.5, 5, 0.1, () => o.speed, v => { o.speed = v; }, v => v.toFixed(1) + ' m/s'),
          slider('Supply temp', 14, 26, 1, () => o.temp, v => { o.temp = v; }, v => v + ' °C'),
          slider('Vent width', 0.4, 1.6, 0.05, () => o.width, v => { o.width = v; }, v => v.toFixed(2) + ' m'));
      } else {
        const dsel = el('select', { onchange: () => { checkpoint(); o.dir = +dsel.value; } }, el('option', { value: 1 }, 'Clockwise'), el('option', { value: -1 }, 'Counter-clockwise'));
        dsel.value = o.dir >= 0 ? 1 : -1;
        box.append(slider('Power', 0.3, 3, 0.1, () => o.speed, v => { o.speed = v; }, v => v.toFixed(1) + ' m/s'),
          slider('Blade radius', 0.4, 0.9, 0.05, () => o.radius, v => { o.radius = v; }, v => v.toFixed(2) + ' m'),
          el('div', { class: 'ctl', style: 'grid-template-columns:78px 1fr' }, el('label', null, 'Spin'), dsel));
      }
      const row = el('div', { class: 'row' }, del);
      if (o.type === 'fan') row.prepend(el('button', { class: 'btn small primary', onclick: startOpt }, 'Find best spot for this fan'));
      box.append(row);
    }
  }
  const openLenText = o => `Gap ${(Math.hypot(o.x2 - o.x1, o.y2 - o.y1) * clamp(o.open, 0, 1)).toFixed(2)} m of ${Math.hypot(o.x2 - o.x1, o.y2 - o.y1).toFixed(2)} m`;
  function renderLenSoon() { const l = $('#openLen'), o = getSel(); if (l && o) l.textContent = openLenText(o); }

  // ------------------------------------------------------------------ optimizer UI
  function startOpt() {
    if (!sim.indoorList.length) { $('#optRes').innerHTML = '<div class="note">Close off at least one room with walls first.</div>'; return; }
    optTarget = selectedFan() || scene.devices.find(d => d.type === 'fan') || null;
    optResult = null;
    opt = new FanOptimizer(scene, optTarget, { speed: optTarget ? optTarget.speed : 3 });
    renderOpt();
  }
  function renderOptSoft() { /* map cleared by checkpoint; refresh buttons lazily */ if (!opt) renderOpt(); }
  function pct(x) { return (x * 100).toFixed(0); }
  function applyBest(b) {
    const keep = optResult; checkpoint();
    let d = optTarget && scene.devices.includes(optTarget) ? optTarget : null;
    if (!d) { d = makeDevice('fan', b); scene.devices.push(d); optTarget = d; }
    d.x = b.x; d.y = b.y; d.angle = b.angle; d.on = true;
    ui.sel = { kind: 'device', id: d.id }; optResult = keep;
    renderSelection(); renderOpt();
  }
  function renderOpt() {
    const box = $('#optRes'); box.innerHTML = '';
    $('#optBar').hidden = !opt; $('#bOpt').disabled = !!opt; $('#bOptClear').hidden = !optResult;
    if (opt) { box.append(el('div', { class: 'muted small' }, 'Simulating candidates… (the live view is paused meanwhile)')); return; }
    if (!optResult) return;
    const r = optResult;
    box.append(el('div', { class: 'muted small' }, r.zones ? 'Scored on your comfort zones' + (r.ac ? ' (air speed + cooling).' : ' (air speed).') : 'No comfort zones drawn — scored over the whole indoor area. Draw zones (Z) to target a bed or sofa.'));
    const ref = r.cur != null ? r.cur : r.base;
    box.append(el('div', { class: 'muted small' }, `Comfort index — without this fan: ${pct(r.base)}${r.cur != null ? ` · current placement: ${pct(r.cur)}` : ''}`));
    if (!r.best.length) { box.append(el('div', { class: 'note' }, 'No free indoor spot found for a fan.')); return; }
    r.best.forEach((b, i) => {
      const gain = b.score - ref;
      box.append(el('div', { class: 'res' + (i === 0 ? ' best' : '') },
        el('div', { class: 't' }, el('b', null, `#${i + 1}  at (${b.x.toFixed(1)}, ${b.y.toFixed(1)}) m, aim ${Math.round(b.angle)}°`),
          el('span', { class: 'pill ' + (gain > 0.005 ? 'good' : gain < -0.005 ? 'bad' : '') }, `${pct(b.score)}  (${gain >= 0 ? '+' : ''}${(gain * 100).toFixed(0)})`)),
        el('div', { class: 'row', style: 'margin:0' }, el('button', { class: 'btn small', onclick: () => applyBest(b) }, optTarget && scene.devices.includes(optTarget) ? 'Move fan here' : 'Place fan here'))));
    });
    box.append(el('div', { class: 'muted small' }, 'The coloured tiles on the plan show the best score reachable at each position (bright = better). Short transient simulation at 0.3 m resolution — check the result in the live view.'));
  }
  $('#bOpt').addEventListener('click', startOpt);
  $('#bOptClear').addEventListener('click', () => { optResult = null; renderOpt(); });

  // ------------------------------------------------------------------ toolbar & header
  const TOOLS = [
    ['grp', 'Build'], ['select', 'Select', 'V', '#94a3b8'], ['wall', 'Wall', 'W', '#cbd5e1'], ['room', 'Room', 'R', '#cbd5e1'],
    ['window', 'Window', 'I', '#22d3ee'], ['door', 'Doorway', 'D', '#fbbf24'],
    ['grp', 'Air devices'], ['fan', 'Fan', 'F', '#38bdf8'], ['ac', 'AC', 'A', '#22d3ee'], ['ceil', 'Ceiling fan', 'C', '#facc15'],
    ['grp', 'Analyse'], ['zone', 'Comfort zone', 'Z', '#4ade80'],
  ];
  const tools = $('#tools');
  for (const t of TOOLS) {
    if (t[0] === 'grp') { tools.append(el('div', { class: 'grp' }, t[1])); continue; }
    tools.append(el('button', { class: 'tool', 'data-tool': t[0], onclick: () => setTool(t[0]), title: t[1] + ' (' + t[2] + ')' },
      el('span', { class: 'dot', style: 'background:' + t[3] }), t[1], el('kbd', null, t[2])));
  }

  function togglePlay() { ui.running = !ui.running; $('#bPlay').textContent = ui.running ? '⏸ Pause' : '▶ Play'; }
  $('#bPlay').addEventListener('click', togglePlay);
  $('#bReset').addEventListener('click', () => sim.reset());
  $('#bUndo').addEventListener('click', undo);
  $('#bDemo').addEventListener('click', () => { if (!scene.walls.length || confirm('Replace the current plan with the demo flat?')) { checkpoint(); loadDemo(); } });
  $('#bClear').addEventListener('click', () => {
    if (scene.walls.length && !confirm('Clear the whole plan?')) return;
    checkpoint(); setScene({ env: scene.env }); scheduleSave();
  });
  $('#bSave').addEventListener('click', () => {
    const a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(scene, null, 1)], { type: 'application/json' })), download: 'apartment.airflow.json' });
    document.body.append(a); a.click(); a.remove();
  });
  $('#bLoad').addEventListener('click', () => $('#fileIn').click());
  $('#fileIn').addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    f.text().then(s => { checkpoint(); setScene(JSON.parse(s)); }).catch(() => alert('Could not read that file.'));
    e.target.value = '';
  });

  window.addEventListener('resize', resize);
  new ResizeObserver(resize).observe($('#stage'));

  // ------------------------------------------------------------------ boot
  buildViewCtl(); updateLegend(); setTool('select'); resize();
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('airflow-scene-v1') || 'null'); } catch (e) { /* ignore */ }
  if (saved && saved.walls && saved.walls.length) setScene(saved); else loadDemo();
  for (let i = 0; i < 60; i++) sim.step();   // pre-roll so the first frame already shows flow
  requestAnimationFrame(frame);
  $('#status').textContent = 'Top-down 2D simplified solver · 0.125 m grid';
})();
