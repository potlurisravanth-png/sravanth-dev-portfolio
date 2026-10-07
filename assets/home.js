/* ============================================================================
   home.js: the exploded stack, and the page that routes its reader.

   One fixed 3D stage holds six drawing sheets. The only things in document
   flow are the eight waypoint sections, which are invisible scroll markers
   (data-sc-act="flow") carrying the real, semantic copy. Scroll position maps
   to a camera parameter s (0 = overview, 1..6 = landed on a sheet, 7 =
   contact) through a monotone curve that arrives quickly, settles while the
   copy is read, and leaves.

   The signature: while you read, the page measures how long each sheet's copy
   was on screen. At the Routes sheet a classifier weighs that time, draws the
   route to the matching project, and prints a receipt saying why. Nothing is
   sent or stored, and every route stays open.

   The engine (scrollcraft.js) is mounted for act bookkeeping and sc-ready. It
   is not edited; everything bespoke lives here.
   ========================================================================== */
(function () {
  'use strict';

  var doc = document.documentElement;
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fineMQ = matchMedia('(hover: hover) and (pointer: fine)');

  var clamp = function (x, a, b) { return x < a ? a : x > b ? b : x; };
  var clamp01 = function (x) { return clamp(x, 0, 1); };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var ease = function (t) { t = clamp01(t); return t * t * (3 - 2 * t); };
  var band = function (a, b, x) { return ease((x - a) / (b - a)); };
  var easeOut = function (t) { t = clamp01(t); return 1 - Math.pow(1 - t, 3); };

  // ---- elements -----------------------------------------------------------
  var stage = document.querySelector('.stage');
  var scene = stage.querySelector('.scene');
  var sheets = [].slice.call(scene.querySelectorAll('.sheet'));
  var hazes = sheets.map(function (s) { return s.querySelector('.sheet__haze'); });
  var inks = sheets.map(function (s) { return s.querySelector('.sheet-svg'); });
  var axisLine = document.querySelector('.overlay .axis-line');
  var paper = document.querySelector('.paper');
  var wps = [].slice.call(document.querySelectorAll('.waypoint'));
  var N = wps.length;          // 8 waypoints
  var NS = sheets.length;      // 6 sheets
  var NAMES = wps.map(function (w) {
    var a = document.querySelector('.strip__list a[data-goto="' + w.id + '"]');
    return a ? a.textContent.trim() : w.id;
  });

  // The sheets' labels are part of the drawing, not text to find or select, and
  // a sheet that is not showing stays in the page (clear, not removed).
  stage.inert = true;

  var G = 900;                 // spacing between sheets along the stack, px
  var PIERCE = [140 - 480, 140 - 320];
  var PORT_X = 700 - 480;

  // Pace. A sheet's span is how much scroll it owns, in screens, and its hold is
  // the part of that span where the camera rests on it. The camera needs about
  // 0.6 of a screen to travel from one sheet to the next; whatever is left over
  // is scroll that moves nothing but the redline. Keep that part short (it was
  // about a screen per sheet, and it read as a page that would not move):
  // trim a span or a hold, not the travel.
  wps.forEach(function (w) {
    w._span = parseFloat(w.getAttribute('data-span')) || 1;
    w._hold = (w.getAttribute('data-hold') || '0.22 0.6').split(/\s+/).map(parseFloat);
  });

  var copies = [];
  wps.forEach(function (w, k) {
    [].slice.call(w.querySelectorAll('[data-sc-copy]')).forEach(function (el) {
      copies.push({
        el: el, k: k,
        // in by the time the sheet lands, out as it starts to lift (see the hold above)
        win: (el.getAttribute('data-win') || '0.08 0.22 0.62 0.76').split(/\s+/).map(parseFloat),
        fixedPos: el.classList.contains('copy--routes'),
        quiet: el.classList.contains('copy--quiet'),
        op: -1, tf: ''
      });
    });
  });
  var mainCopy = wps.map(function (w) { return w.querySelector('.copy'); });

  // ---- state --------------------------------------------------------------
  var vw = 0, vh = 0, mobile = false, D = 1800;
  var poses = [], knots = [], maxY = 0;
  var s = -1, lastS = -2, lastT = 0;
  var draws = sheets.map(function () { return 0; });
  var drawSet = sheets.map(function () { return -1; });
  var ptr = { x: 0, y: 0, tx: 0, ty: 0 };
  var current = -1;
  var dwell = [0, 0, 0, 0, 0, 0, 0, 0];
  // Reading time lives in this tab's session only, so a trip into a project and
  // back keeps the same receipt. It never leaves the browser.
  try {
    var kept = JSON.parse(sessionStorage.getItem('sp-dwell') || 'null');
    if (kept && kept.length === dwell.length) dwell = kept.map(function (v) { return +v || 0; });
  } catch (e) {}
  var keptAt = 0;
  function keepDwell(now) {
    if (now - keptAt < 1000) return;
    keptAt = now;
    try { sessionStorage.setItem('sp-dwell', JSON.stringify(dwell.map(function (v) { return +v.toFixed(2); }))); } catch (e) {}
  }

  // ---- layout -------------------------------------------------------------
  function rectOf(el) {
    var t = el.style.transform;
    el.style.transform = 'none';
    var r = el.getBoundingClientRect();
    el.style.transform = t;
    return r;
  }

  function measure() {
    vw = innerWidth; vh = innerHeight;
    mobile = vw <= 860;
    D = mobile ? 1300 : 1800;
    stage.style.perspective = D + 'px';

    var top = 0;
    wps.forEach(function (w, k) {
      w.style.height = (w._span * vh + (k === N - 1 ? vh : 0)) + 'px';
      w._c = top / vh;
      top += w._span * vh;
    });
    maxY = top;

    // On a phone every landed sheet sits in a band across the top and the copy
    // reads underneath it. Publish where that band ends so the CSS agrees.
    var fb = frameBox();
    doc.style.setProperty('--plate-b', Math.round(fb.T + (fb.R - fb.L) * 640 / 960 + 16) + 'px');

    buildKnots();
    computePoses();
    setWeights();
    layoutReceipt();
    cleared = false;   // the hidden receipt's offset depends on its new height
  }

  // Scroll (in viewport heights) to camera parameter s. Each waypoint arrives
  // over the first part of its span, holds while its copy is read (drifting a
  // few hundredths so the camera never sits dead), then leaves.
  function buildKnots() {
    knots = [];
    wps.forEach(function (w, k) {
      var c = w._c, sp = w._span, h0 = w._hold[0], h1 = w._hold[1];
      if (k === 0) { knots.push([0, 0], [c + h1 * sp, 0.04], [c + sp, 0.5]); }
      else if (k === N - 1) { knots.push([c + h0 * sp, k - 0.02], [c + sp, k]); }
      else { knots.push([c + h0 * sp, k - 0.04], [c + h1 * sp, k + 0.04], [c + sp, k + 0.5]); }
    });
    // Fritsch-Carlson monotone cubic, so the camera never runs backwards.
    var n = knots.length, m = [], t = [];
    for (var i = 0; i < n - 1; i++) m[i] = (knots[i + 1][1] - knots[i][1]) / (knots[i + 1][0] - knots[i][0]);
    t[0] = m[0]; t[n - 1] = m[n - 2];
    for (i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
    for (i = 0; i < n - 1; i++) {
      if (!m[i]) { t[i] = t[i + 1] = 0; continue; }
      var a = t[i] / m[i], b = t[i + 1] / m[i], h = a * a + b * b;
      if (h > 9) { var q = 3 / Math.sqrt(h); t[i] = q * a * m[i]; t[i + 1] = q * b * m[i]; }
    }
    knots.tan = t;
  }

  function sAt(yv) {
    var K = knots, n = K.length;
    if (yv <= K[0][0]) return K[0][1];
    if (yv >= K[n - 1][0]) return K[n - 1][1];
    var i = 0;
    while (i < n - 2 && yv > K[i + 1][0]) i++;
    var h = K[i + 1][0] - K[i][0], u = (yv - K[i][0]) / h, u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * K[i][1] + (u3 - 2 * u2 + u) * h * K.tan[i] +
           (-2 * u3 + 3 * u2) * K[i + 1][1] + (u3 - u2) * h * K.tan[i + 1];
  }

  // ---- line weight ----------------------------------------------------------
  // A far-off sheet needs heavier lines than a landed one to read at all. The
  // weight used to follow the camera in steps, and every step made the browser
  // redraw the sheet; on the way from the stack to the first sheet that was six
  // sheets redrawn several times inside a quarter of a second, which is the
  // stutter. Now each drawing is set once, at the weight it needs when landed,
  // and a second copy of it at the stack's weight lies over it and fades with
  // the camera. Fading a layer redraws nothing.
  //
  // (The small per-sheet offset is left over from the stepped version. It stays
  // so every sheet keeps exactly the weight it had.)
  var bolds = [], boldOn = [], boldOp = [], boldK = [], boldDraw = [];
  var kLand = [], kStack = [[], []];
  function weightFor(sc, i) {
    return clamp(Math.round((clamp(0.95 / sc, 1, 2.8) + (i - 2.5) * 0.04) * 4) / 4, 1, 2.75);
  }
  function setWeights() {
    // A phone shows the landed sheet about as small as the stacked one, so one
    // weight serves both and there is no second copy to hold in memory.
    if (!mobile && !bolds.length) {
      bolds = sheets.map(function (sh, i) {
        var b = inks[i].cloneNode(true);
        b.classList.add('sheet-svg--bold');
        // the marks the routing drives live on the drawing itself, once
        [].slice.call(b.querySelectorAll('.dwell-bar, .port-ring, .r--route')).forEach(function (n) {
          n.parentNode.removeChild(n);
        });
        sh.insertBefore(b, hazes[i]);
        return b;
      });
    }
    for (var i = 0; i < NS; i++) {
      var kl = weightFor(poses[i + 1].sc, i);
      if (kl !== kLand[i]) { inks[i].style.setProperty('--k', kl); kLand[i] = kl; }
      kStack[0][i] = weightFor(poses[0].sc * 0.8, i);        // the overview stack
      kStack[1][i] = weightFor(poses[N - 1].sc * 0.8, i);    // the contact stack
    }
  }

  // ---- camera ---------------------------------------------------------------
  function matrixFor(p) {
    return new DOMMatrix()
      .translate(p.ox, p.oy, 0)
      .scale(p.sc, p.sc, p.sc)
      .rotateAxisAngle(1, 0, 0, p.rx)
      .rotateAxisAngle(0, 0, 1, p.rz)
      .translate(0, 0, p.fi * G * p.ex);
  }
  function camPoint(M, x, y, z) {
    return [M.m11 * x + M.m21 * y + M.m31 * z + M.m41,
            M.m12 * x + M.m22 * y + M.m32 * z + M.m42,
            M.m13 * x + M.m23 * y + M.m33 * z + M.m43];
  }
  function toScreen(c) {
    var f = D / Math.max(D - c[2], 1);
    return [vw / 2 + c[0] * f, vh / 2 + c[1] * f];
  }
  function project(M, x, y, z) { return toScreen(camPoint(M, x, y, z)); }

  // The assembly centre line runs through every sheet and passes close to the
  // camera, so projected as it stands its ends can land hundreds of thousands
  // of pixels off screen, and the browser then rasters a layer that size on
  // every frame. Clip it to a near plane, then to the screen. The dash pattern
  // (26 6 3 6 = 41px) stays pinned to the top sheet's pierce point.
  var AXIS_DASH = 41;
  function axisPath(M, ex) {
    var a = camPoint(M, PIERCE[0], PIERCE[1], G * ex * 0.9);
    var b = camPoint(M, PIERCE[0], PIERCE[1], -(NS - 1) * G * ex - G * ex * 0.9);
    var zmax = D * 0.8;
    var cut = function (p, q) {
      var t = (zmax - p[2]) / (q[2] - p[2]);
      return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, zmax];
    };
    if (a[2] > zmax && b[2] > zmax) return null;
    if (a[2] > zmax) a = cut(a, b); else if (b[2] > zmax) b = cut(b, a);
    var p = toScreen(a), q = toScreen(b);
    var dx = q[0] - p[0], dy = q[1] - p[1], t0 = 0, t1 = 1, m = 40;
    var P = [-dx, dx, -dy, dy], Q = [p[0] + m, vw + m - p[0], p[1] + m, vh + m - p[1]];
    for (var i = 0; i < 4; i++) {
      if (P[i] === 0) { if (Q[i] < 0) return null; continue; }
      var r = Q[i] / P[i];
      if (P[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
      else { if (r < t0) return null; if (r < t1) t1 = r; }
    }
    var sx = p[0] + dx * t0, sy = p[1] + dy * t0, len = Math.sqrt(dx * dx + dy * dy) || 1;
    var off = 0, o = camPoint(M, PIERCE[0], PIERCE[1], 0);
    if (o[2] < zmax) {
      o = toScreen(o);
      var along = ((o[0] - sx) * dx + (o[1] - sy) * dy) / len;
      off = ((-along % AXIS_DASH) + AXIS_DASH) % AXIS_DASH;
    }
    return {
      d: 'M' + sx.toFixed(1) + ' ' + sy.toFixed(1) + 'L' + (p[0] + dx * t1).toFixed(1) + ' ' + (p[1] + dy * t1).toFixed(1),
      off: off.toFixed(1)
    };
  }
  function bbox(p) {
    var M = matrixFor(p), x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (var i = 0; i < NS; i++) {
      var z = -i * G * p.ex;
      [[-480, -320], [480, -320], [480, 320], [-480, 320]].forEach(function (c) {
        var q = project(M, c[0], c[1], z);
        x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]);
      });
    }
    return { x0: x0, y0: y0, x1: x1, y1: y1 };
  }

  // The usable drawing area inside the sheet border and above the title strip.
  function frameBox() {
    var inset = mobile ? 6 : 10;
    var L = inset + (mobile ? 6 : 24);
    return { L: L, R: vw - L, T: inset + (mobile ? 6 : 22), B: vh - inset - (mobile ? 54 : 52) - (mobile ? 10 : 22) };
  }

  // A pose for each waypoint, fitted to the room its copy leaves free.
  function computePoses() {
    var fb = frameBox(), L = fb.L, R = fb.R, T = fb.T, B = fb.B;
    var gap = 40;
    if (!mobile) mainCopy.forEach(function (el) { el.style.top = ''; });
    poses = [];
    for (var k = 0; k < N; k++) {
      var copy = mainCopy[k];
      var r = rectOf(copy);
      var side = copy.getAttribute('data-plate');
      var rg;
      if (mobile) {
        if (k === 0 || k === N - 1) rg = [L, r.bottom + 10, R, B];
        else {
          // sheet and copy read as one group, sitting a little above centre
          var bandH = (R - L) * 640 / 960, sh = 0;
          if (k !== 6) {
            var free = B - T - bandH - 16 - copy.offsetHeight;
            sh = Math.max(0, Math.round(free * 0.32));
            wps[k].querySelectorAll('.copy').forEach(function (el) {
              if (!el.classList.contains('copy--quiet')) el.style.top = (T + sh + bandH + 16) + 'px';
            });
          }
          rg = [L, T + sh, R, T + sh + bandH];
        }
      } else if (side === 'right') rg = [r.right + gap, T, R, B];
      else if (side === 'left') rg = [L, T, r.left - gap, B];
      else rg = [L, T, R, r.top - 28];

      if (k === 0 || k === N - 1) poses.push(stackPose(rg, k));
      else {
        var w = rg[2] - rg[0], h = rg[3] - rg[1];
        var sc = Math.max(0.2, Math.min(w / 960, h / 640) * (mobile ? 1 : 0.95));
        poses.push({ fi: k - 1, ex: 1, rx: 0, rz: 0, m: 1, g: 1, sc: sc,
          ox: (rg[0] + rg[2]) / 2 - vw / 2, oy: (rg[1] + rg[3]) / 2 - vh / 2 });
      }
    }
    // the stack hides on a phone's contact screen if the form leaves no room
    poses[N - 1].hide = mobile && (poses[N - 1].fitH < 120);
  }

  function stackPose(rg, k) {
    var p = k === 0
      ? { fi: 2.5, ex: 0.3, rx: 57, rz: -34, m: 0, g: 0 }
      : { fi: 2.5, ex: 0.14, rx: 54, rz: 28, m: 0, g: 0 };
    if (mobile && k === 0) { p.rx = 58; p.rz = -30; p.ex = 0.26; }
    p.sc = 1; p.ox = 0; p.oy = 0;
    var w = Math.max(rg[2] - rg[0], 40), h = Math.max(rg[3] - rg[1], 40);
    for (var pass = 0; pass < 3; pass++) {
      var b = bbox(p);
      var f = Math.min(w / (b.x1 - b.x0), h / (b.y1 - b.y0)) * 0.92;
      p.sc *= f;
      b = bbox(p);
      p.ox += (rg[0] + rg[2]) / 2 - (b.x0 + b.x1) / 2;
      p.oy += (rg[1] + rg[3]) / 2 - (b.y0 + b.y1) / 2;
    }
    p.fitH = h;
    return p;
  }

  function poseAt(sv) {
    var k = Math.floor(sv), t = sv - k;
    var p;
    if (k >= N - 1) { p = Object.assign({}, poses[N - 1]); t = 0; k = N - 1; }
    else if (k < 0) { p = Object.assign({}, poses[0]); }
    else {
      var A = poses[k], B = poses[k + 1];
      var landed = A.m === 1 && B.m === 1;
      var e = ease(t);
      p = {
        fi: landed ? lerp(A.fi, B.fi, t) : lerp(A.fi, B.fi, e),
        ex: lerp(A.ex, B.ex, e), rx: lerp(A.rx, B.rx, e), rz: lerp(A.rz, B.rz, e),
        sc: lerp(A.sc, B.sc, e), ox: lerp(A.ox, B.ox, e), oy: lerp(A.oy, B.oy, e),
        m: lerp(A.m, B.m, e),
        // g: how much the camera is descending past sheets. Leaving the
        // overview passes nothing, so the sheets above the pivot stay solid.
        g: k === 0 ? 0 : landed ? 1 : lerp(A.g, B.g, e)
      };
      // into the reassembled stack: close the gaps first, and only then let the
      // sheets you already passed come back, so nothing sweeps past the camera
      if (k === N - 2) {
        p.ex = lerp(A.ex, B.ex, ease(t / 0.45));
        p.m = lerp(A.m, B.m, band(0.55, 0.8, t));
        p.g = p.m;
      }
      // between two sheets the top one lifts like a page before it goes
      if (landed) { var bump = Math.sin(Math.PI * ease(t)); p.rx += 19 * bump; p.rz -= 4 * bump; p.sc *= 1 - 0.1 * bump; }
    }
    // the overview turns and opens a little as you begin to scroll
    var open = clamp01(sv / 0.04);
    if (sv < 1) { var wv = 1 - ease(clamp01(sv)); p.rz -= 7 * open * wv; p.ex += 0.05 * open * wv; }
    // contact closes the last few degrees as it settles
    var shut = clamp01((sv - (N - 1 - 0.02)) / 0.02);
    if (shut > 0) { p.rz += 3 * shut; p.ex -= 0.02 * shut; }
    return p;
  }

  // ---- receipt geometry -----------------------------------------------------
  var receipt = document.querySelector('.receipt');
  var paperEl = receipt && receipt.querySelector('.receipt__paper');
  var rows = paperEl ? [].slice.call(paperEl.querySelectorAll('.rc')) : [];
  var rowBottoms = [], paperH = 0;
  function layoutReceipt() {
    if (!paperEl) return;
    var vis = rows.filter(function (r) { return r.offsetParent !== null; });
    rows._vis = vis;
    paperH = paperEl.offsetHeight;
    rowBottoms = vis.map(function (r) { return r.offsetTop + r.offsetHeight; });
  }

  // ---- routing ------------------------------------------------------------
  // [Agentic Router, Medicare Part D, Deepfake Defender, Secure File-Sharing]
  var WEIGHTS = {
    1: [0.2, 0.0, 0.6, 0.2],   // Signal
    2: [0.0, 0.5, 0.0, 0.5],   // Enterprise
    3: [0.2, 0.4, 0.0, 0.4],   // Architecture
    4: [0.3, 0.0, 0.7, 0.0],   // Models
    5: [0.9, 0.0, 0.1, 0.0]    // Decisions
  };
  var ROUTES = ['router', 'medicare', 'deepfake', 'secure'];
  var PROJECT = ['Agentic Router', 'Medicare Part D', 'Deepfake Defender', 'Secure File-Sharing'];
  var routeSheet = sheets[NS - 1];
  var routePaths = ROUTES.map(function (r) { return routeSheet.querySelector('.r--route[data-route="' + r + '"]'); });
  var portRings = ROUTES.map(function (r) { return routeSheet.querySelector('.port-ring[data-route="' + r + '"]'); });
  var bars = [].slice.call(routeSheet.querySelectorAll('.dwell-bar'));
  var portsList = document.querySelector('.ports');
  var portLinks = ROUTES.map(function (r) { return portsList.querySelector('a[data-route="' + r + '"]'); });
  var portItems = portLinks.map(function (a) { return a.parentNode; });
  var statusEl = document.querySelector('[data-out="status"]');
  var decided = false, pick = 0, printed = 0, routeDraw = 0, barFill = 0, barNorm = [0, 0, 0, 0, 0];
  var PORT_Y = [150, 270, 390, 510].map(function (y) { return y - 320; });

  function decide() {
    var total = 0, sc = [0, 0, 0, 0];
    for (var k = 1; k <= 5; k++) {
      total += dwell[k];
      for (var j = 0; j < 4; j++) sc[j] += dwell[k] * WEIGHTS[k][j];
    }
    var reason;
    pick = 0;
    if (total < 0.5) {
      reason = 'You came straight here, so it chose the flagship.';
    } else if (total < 4) {
      reason = 'You moved quickly, so it chose the flagship.';
    } else {
      for (j = 1; j < 4; j++) if (sc[j] > sc[pick] + 1e-9) pick = j;
      var best = 1, bv = -1;
      for (k = 1; k <= 5; k++) { var v = dwell[k] * WEIGHTS[k][pick]; if (v > bv) { bv = v; best = k; } }
      reason = 'Most of the weight came from your time on ' + NAMES[best] + '.';
    }
    var mx = 0;
    for (k = 1; k <= 5; k++) mx = Math.max(mx, dwell[k]);
    barNorm = [1, 2, 3, 4, 5].map(function (k) { return mx ? dwell[k] / mx : 0; });

    // fill the receipt
    for (k = 1; k <= 5; k++) {
      var d = document.querySelector('[data-dwell="' + k + '"]');
      if (d) d.textContent = dwell[k].toFixed(1) + ' s';
    }
    for (j = 0; j < 4; j++) {
      var cell = document.querySelector('[data-score="' + j + '"]');
      if (cell) {
        cell.textContent = (total ? sc[j] / total : 0).toFixed(2);
        cell.parentNode.classList.toggle('is-max', j === pick && total >= 4);
      }
    }
    document.querySelector('[data-out="route"]').textContent = PROJECT[pick];
    document.querySelector('[data-out="reason"]').textContent = reason;

    routePaths.forEach(function (p, j) { p.style.setProperty('--draw', 0); });
    portRings.forEach(function (r) { r.classList.remove('is-on'); });
    portLinks.forEach(function (a, j) {
      a.classList.toggle('is-routed', j === pick);
      if (j === pick) a.setAttribute('aria-describedby', 'receipt-cap'); else a.removeAttribute('aria-describedby');
    });
    if (statusEl) statusEl.textContent = 'Routed to ' + PROJECT[pick] + '. ' + reason;
    printed = 0; routeDraw = 0; barFill = 0;
    layoutReceipt();
  }

  // ---- render ---------------------------------------------------------------
  var lastVerify = '', lastCopyState = '', sheetOp = [0, 0, 0, 0, 0, 0], lastBo = 0, axisD = null, axisO = null, cleared = false;
  // only write an SVG attribute when its value changes: every write, even of
  // the same value, makes the browser lay the drawing out and redraw it
  function setX2(b, v) { if (b._x2 !== v) { b.setAttribute('x2', v); b._x2 = v; } }
  function render(now) {
    requestAnimationFrame(render);
    var dt = lastT ? Math.min(100, now - lastT) : 16;
    lastT = now;

    var y = clamp(scrollY, 0, maxY);
    var yv = y / vh;
    var target = sAt(yv);
    // the camera eases after the scroll, by elapsed time rather than by frame,
    // so a slow or dropped frame never leaves it trailing further behind. A
    // jump of more than CUT of a sheet (a link, a restored position) is cut to,
    // not flown; one notch of a mouse wheel is always less than that, so it
    // glides even in a browser that does not smooth its own scrolling.
    var CUT = 0.6;
    var jumped = s < 0 || reduce || Math.abs(target - s) > CUT || !render._done;
    if (s < 0 || reduce || Math.abs(target - s) > CUT) s = target;
    else s += (target - s) * (1 - Math.pow(0.76, dt / 16.7));
    if (Math.abs(target - s) < 0.0004) s = target;

    var fine = fineMQ.matches && !reduce;
    ptr.x += (ptr.tx - ptr.x) * 0.07;
    ptr.y += (ptr.ty - ptr.y) * 0.07;
    var ptrMoving = fine && (Math.abs(ptr.tx - ptr.x) > 0.001 || Math.abs(ptr.ty - ptr.y) > 0.001);

    // local progress through each waypoint's own span
    var u = wps.map(function (w) { return (yv - w._c) / w._span; });
    var near = clamp(Math.round(s), 0, N - 1);

    // ---- dwell: only time the reader could actually see a sheet's copy
    if (near >= 1 && near <= 5 && document.visibilityState === 'visible') {
      var cop = mainCopy[near].__op || 0;
      if (cop > 0.6) { dwell[near] += dt / 1000; keepDwell(now); }
    }

    // ---- routing lifecycle
    if (!decided && s > 5.55) { decide(); decided = true; }
    if (decided && s < 5.25) { decided = false; }
    var u6 = u[6];
    if (decided) {
      if (reduce) { barFill = u6 > 0.05 ? 1 : barFill; routeDraw = u6 > 0.1 ? 1 : routeDraw; printed = u6 > 0.2 ? 1 : printed; }
      else {
        barFill = Math.max(barFill, clamp01((u6 - 0.04) / 0.1));
        routeDraw = Math.max(routeDraw, clamp01((u6 - 0.12) / 0.2));
        printed = Math.max(printed, clamp01((u6 - 0.3) / 0.38));
      }
    }

    var moved = Math.abs(s - lastS) > 0.00005 || ptrMoving || s !== lastS;
    lastS = s;

    var pose;
    var stageOp = 1;
    if (reduce) {
      // fewer and gentler: no camera travel, a crossfade through paper between sheets
      pose = Object.assign({}, poses[near]);
      stageOp = 1 - band(0.18, 0.44, Math.abs(s - near));
    } else {
      pose = poseAt(s);
    }
    if (poses[N - 1].hide) stageOp *= 1 - band(6.3, 6.8, s);

    if (fine) { pose.rx += -ptr.y * 2.6; pose.rz += ptr.x * 2.2; }
    var M = matrixFor(pose);
    if (moved || !render._done) {
      scene.style.transform = M.toString();
      stage.style.opacity = stageOp.toFixed(3);

      // the authored silence: the Decisions sheet empties to bare paper before the
      // peak, and its one line then holds for about a quarter of a screen
      var quiet = band(0.5, 0.58, u[5]) * (1 - band(5.7, 6.2, s));
      // sheets returning to the stack arrive as bare paper, then their drawings
      var blank = (!reduce && s > N - 2 && s < N - 1) ? 1 - band(0.75, 0.97, s - (N - 2)) : 0;
      for (var i = 0; i < NS; i++) {
        var z = -i * G * pose.ex;
        var dz = pose.fi - i;
        // passed sheets lift away; deeper sheets stay hidden until their turn,
        // or the perspective lets the next one peek out under the current one
        // (the deeper ones stay opaque until the camera is nearly flat, so no
        // sheet is ever see-through over another one's drawing)
        var gone = band(0.06, 0.5, dz) * (pose.g || 0);
        var under = dz < 0 ? (1 - band(-1, -0.62, dz)) * band(0.72, 0.96, pose.m) : 0;
        var op = 1 - Math.max(gone, under);
        var haze = (1 - pose.m) * i * 0.036;
        if (i === 4) haze = Math.max(haze, quiet * 0.94);
        if (i < NS - 1) haze = Math.max(haze, blank);
        var el = sheets[i];
        el.style.transform = 'translate3d(0,0,' + z.toFixed(1) + 'px)';
        el.style.opacity = op.toFixed(3);
        sheetOp[i] = op;
        // the haze is its own layer, so fading it redraws nothing
        var hz = hazes[i], hs = haze > 0.002 ? haze.toFixed(3) : '0';
        if (hz._o !== hs) { hz.style.opacity = hs; hz._o = hs; }
      }

      // the assembly centre line, through every sheet's pierce point
      var ax = band(10, 26, pose.rx) * stageOp;
      var seg = ax > 0.002 ? axisPath(M, pose.ex) : null;
      var axd = seg ? seg.d : 'M0 0', axo = seg ? seg.off : '0';
      if (axd !== axisD) { axisLine.setAttribute('d', axd); axisD = axd; }
      if (axo !== axisO) { axisLine.style.strokeDashoffset = axo; axisO = axo; }
      axisLine.style.opacity = seg ? ax.toFixed(3) : '0';

      // paper drifts a little slower than the drawing: the desk under the
      // sheets. Whole device pixels, so its hairlines stay crisp.
      var gx = -pose.ox * 0.04 + (fine ? ptr.x * 6 : 0);
      var gy = (-pose.oy * 0.04 + (fine ? ptr.y * 6 : 0) - yv * 6) % 120;
      var dpr = devicePixelRatio || 1;
      paper.style.transform = 'translate3d(' + (Math.round(gx * dpr) / dpr).toFixed(2) + 'px,' +
        (Math.round(gy * dpr) / dpr).toFixed(2) + 'px,0)';
      render._done = true;
    }

    // ---- red layers draw once per visit and stay drawn
    for (i = 0; i < NS; i++) {
      var uk = u[i + 1];
      // starts as the sheet comes in and is finished a little before it lifts
      var want = reduce ? (uk > 0.04 && uk < 1.2 ? 1 : 0) : clamp01((uk - 0.11) / 0.42);
      if (want > draws[i]) draws[i] = want;
      var dv = Math.round(draws[i] * 1000) / 1000;
      if (dv !== drawSet[i]) { sheets[i].style.setProperty('--draw', dv); drawSet[i] = dv; }
    }

    // ---- line weight: the stack's heavier ink, faded over each drawing. A copy
    // is brought up to date (the stack's weight, the redline drawn so far) when
    // it starts to show or the camera turns back toward a stack, one sheet per
    // frame, so the redraws never land together. On the way down to a sheet it
    // is left alone: it is fading out, and the sheet under it is busy drawing
    // its own redline.
    if (bolds.length) {
      var bo = mobile ? 0 : 1 - pose.m;
      if (bo < 0.02) bo = 0;
      var bos = bo.toFixed(3), ks = kStack[s < 3.5 ? 0 : 1], rising = bo > lastBo, caught = false;
      lastBo = bo;
      for (i = 0; i < NS; i++) {
        var bd = bolds[i];
        if (boldOp[i] !== bos) { bd.style.opacity = bos; boldOp[i] = bos; }
        if (!bo || sheetOp[i] < 0.003) { boldOn[i] = false; continue; }
        var stale = boldK[i] !== ks[i] || (boldDraw[i] !== drawSet[i] && (rising || !boldOn[i]));
        if (stale && caught && !jumped) { boldOn[i] = false; continue; }   // its turn is the next frame
        boldOn[i] = true;
        if (stale) {
          caught = true;
          if (boldK[i] !== ks[i]) { bd.style.setProperty('--k', ks[i]); boldK[i] = ks[i]; }
          if (boldDraw[i] !== drawSet[i]) { bd.style.setProperty('--draw', drawSet[i]); boldDraw[i] = drawSet[i]; }
        }
      }
    }

    // ---- routes sheet: classifier bars, the chosen route, the receipt
    if (decided) {
      cleared = false;
      bars.forEach(function (b, j) {
        var x1 = b._x1 != null ? b._x1 : (b._x1 = parseFloat(b.getAttribute('x1')));
        var len = Math.max(4, 120 * barNorm[j] * easeOut(barFill));
        setX2(b, (x1 + len).toFixed(1));
      });
      routePaths[pick].style.setProperty('--draw', routeDraw.toFixed(3));
      portRings[pick].classList.toggle('is-on', routeDraw > 0.98);
      var vis = rows._vis || rows;
      var nOn = Math.floor(printed * vis.length + 0.0001);
      for (var r = 0; r < vis.length; r++) vis[r].classList.toggle('is-on', r < nOn);
      var shown = nOn ? rowBottoms[nOn - 1] + (nOn === vis.length ? 16 : 6) : 0;
      paperEl.style.setProperty('--feed', Math.max(0, paperH - shown).toFixed(0) + 'px');
    } else if (paperEl && !cleared) {
      cleared = true;
      (rows._vis || rows).forEach(function (r) { r.classList.remove('is-on'); });
      paperEl.style.setProperty('--feed', (paperH + 20) + 'px');
      routePaths.forEach(function (p) { p.style.setProperty('--draw', 0); });
      portRings.forEach(function (r) { r.classList.remove('is-on'); });
      bars.forEach(function (b) { setX2(b, b.getAttribute('x1')); });
    }

    // ---- copy
    var copyState = '';
    copies.forEach(function (c) {
      var uk = u[c.k], a = c.win;
      var op = a[0] < 0 ? 1 - band(a[2], a[3], uk) : band(a[0], a[1], uk) * (1 - band(a[2], a[3], uk));
      if (reduce) op = Math.round(op * 20) / 20;
      var rise = reduce || c.fixedPos ? 0 : (1 - op) * 16 * (uk < (a[1] + a[2]) / 2 ? 1 : -1);
      var px = (fine && c.k === 0) ? -ptr.x * 5 : 0, py = (fine && c.k === 0) ? -ptr.y * 4 : 0;
      if (c.quiet && op > 0.001 && !mobile) {
        var qc = project(M, 0, 0, -4 * G * pose.ex);
        px += qc[0] - vw / 2; py += qc[1] - vh * 0.47;
      }
      var tf = (rise || px || py) ? 'translate3d(' + px.toFixed(1) + 'px,' + (rise + py).toFixed(1) + 'px,0)' : '';
      if (Math.abs(op - c.op) > 0.001 || tf !== c.tf) {
        c.el.style.opacity = op.toFixed(3);
        c.el.style.transform = tf;
        c.el.style.pointerEvents = op > 0.5 ? 'auto' : 'none';
        c.op = op; c.tf = tf;
      }
      c.el.__op = op;
      copyState += op.toFixed(2) + ',';
    });

    // project links pinned to the drawing's ports (desktop)
    if (!mobile && portsList.classList.contains('ports--pinned')) {
      var rop = mainCopy[6].__op || 0;
      if (rop > 0.001) {
        for (var j = 0; j < 4; j++) {
          var q = project(M, PORT_X + 24, PORT_Y[j], -(NS - 1) * G * pose.ex);
          portItems[j].style.transform = 'translate3d(' + q[0].toFixed(1) + 'px,' + q[1].toFixed(1) + 'px,0)';
        }
      }
    }

    // ---- counters (real figures only). Each counts up once, over about a
    // second, when its sheet's copy appears. They used to follow the scroll,
    // which left a reader who stopped mid-sheet looking at a half-counted
    // figure (33+ workflows instead of 40+).
    counters.forEach(function (c) {
      var uk = u[c.k];
      if (!c.go && uk > 0.12 && uk < 1.2) c.go = true;
      if (c.go && c.p < 1) c.p = reduce ? 1 : Math.min(1, c.p + dt / 1100);
      var txt = c.fmt(c.target * easeOut(c.p));
      if (txt !== c.txt) { c.el.textContent = txt; c.txt = txt; }
    });

    // ---- the title strip
    var cur = clamp(Math.round(s), 0, N - 1);
    if (cur !== current) {
      current = cur;
      sheetLabel.textContent = NAMES[cur];
      stripLinks.forEach(function (a) {
        if (a.getAttribute('data-goto') === wps[cur].id) a.setAttribute('aria-current', 'true');
        else a.removeAttribute('aria-current');
      });
    }

    // ---- what the harness reads: the values that actually paint
    var verify = s.toFixed(3) + '|' + draws.map(function (d) { return d.toFixed(2); }).join(',') + '|' +
      printed.toFixed(2) + '|' + routeDraw.toFixed(2) + '|' + stageOp.toFixed(2) + '|' + copyState;
    if (verify !== lastVerify) {
      stage.setAttribute('data-sc-verify-state', verify);
      lastVerify = verify;
      var hold = (s >= N - 1 - 0.0005) || (reduce && stageOp > 0.999 && Math.abs(s - near) < 0.1);
      if (hold) stage.setAttribute('data-sc-verify-hold', 'true');
      else stage.removeAttribute('data-sc-verify-hold');
    }
  }

  // ---- counters -------------------------------------------------------------
  var counters = [].slice.call(document.querySelectorAll('[data-count]')).map(function (el) {
    var w = el.closest('.waypoint');
    var dec = parseInt(el.getAttribute('data-decimals') || '0', 10);
    var suf = el.getAttribute('data-suffix') || '';
    return {
      el: el, k: wps.indexOf(w), target: parseFloat(el.getAttribute('data-count')), p: 0, txt: el.textContent,
      fmt: function (v) {
        var n = dec ? v.toFixed(dec) : Math.round(v).toLocaleString('en-US');
        return n + suf;
      }
    };
  });

  // ---- navigation ---------------------------------------------------------
  var sheetLabel = document.querySelector('[data-out="sheet"]');
  var stripLinks = [].slice.call(document.querySelectorAll('.strip__list a[data-goto]'));
  var menuBtn = document.querySelector('.strip__current');
  var menu = document.getElementById('sheet-list');
  var GOTO_U = { routes: 0.8, decisions: 0.32, contact: 1 };

  function holdY(id) {
    var k = wps.findIndex(function (w) { return w.id === id; });
    if (k < 0) return null;
    if (k === 0) return 0;
    if (k === N - 1) return maxY;
    var w = wps[k];
    var uu = GOTO_U[id] != null ? GOTO_U[id] : (w._hold[0] + w._hold[1]) / 2;
    return Math.round((w._c + uu * w._span) * vh);
  }
  function goTo(id, instant) {
    var yy = holdY(id);
    if (yy == null) return;
    scrollTo({ top: yy, behavior: instant || reduce ? 'instant' : 'smooth' });
  }
  function closeMenu() {
    if (!menu.classList.contains('is-open')) return;
    menu.classList.remove('is-open');
    menuBtn.setAttribute('aria-expanded', 'false');
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest('[data-goto]');
    if (a) {
      e.preventDefault();
      var id = a.getAttribute('data-goto');
      if (location.hash !== '#' + id) history.pushState(null, '', '#' + id);
      closeMenu();
      goTo(id, false);
      return;
    }
    if (menuBtn.contains(e.target)) {
      var open = !menu.classList.contains('is-open');
      menu.classList.toggle('is-open', open);
      menuBtn.setAttribute('aria-expanded', String(open));
      return;
    }
    if (!menu.contains(e.target)) closeMenu();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && menu.classList.contains('is-open')) { closeMenu(); menuBtn.focus(); }
  });
  addEventListener('popstate', function () {
    var id = location.hash.slice(1);
    if (id) goTo(id, false); else goTo('overview', false);
  });

  // Keyboard: a focused link or field in a sheet the reader cannot see yet
  // brings that sheet into view first.
  document.addEventListener('focusin', function (e) {
    var w = e.target.closest && e.target.closest('.waypoint');
    if (!w) return;
    var c = copies.filter(function (c) { return c.el.contains(e.target); })[0];
    if (c && c.op < 0.85) goTo(w.id, true);
  });

  // spec sheet
  var spec = document.getElementById('spec');
  document.querySelectorAll('[data-open="spec"]').forEach(function (b) {
    b.addEventListener('click', function () { closeMenu(); if (spec.showModal) spec.showModal(); else spec.setAttribute('open', ''); });
  });
  spec.addEventListener('click', function (e) {
    if (e.target.closest('[data-close]') || e.target === spec) spec.close();
  });

  // pointer (fine pointers only; never touch)
  addEventListener('pointermove', function (e) {
    if (e.pointerType !== 'mouse') return;
    ptr.tx = clamp((e.clientX / vw - 0.5) * 2, -1, 1);
    ptr.ty = clamp((e.clientY / vh - 0.5) * 2, -1, 1);
  }, { passive: true });

  // resize: keep the reader at the same place in the drawing
  var lastW = 0;
  function onResize() {
    // A phone's URL bar changes the height all the time, and laying the page out
    // again for that makes it jump under the reader's thumb. A desktop window
    // dragged narrow is not a phone: follow its height too.
    if (innerWidth === lastW && mobile && !fineMQ.matches) { return; }
    var keep = scrollY / (vh || 1);
    lastW = innerWidth;
    portsList.classList.toggle('ports--pinned', innerWidth > 860);
    measure();
    render._done = false;
    scrollTo({ top: Math.round(keep * vh), behavior: 'instant' });
  }

  // ---- start ----------------------------------------------------------------
  lastW = innerWidth;
  portsList.classList.toggle('ports--pinned', innerWidth > 860);
  measure();
  // arrive on the sheet a link named (again after load, because the browser's
  // own jump to the fragment lands on the section's top edge, mid-flight)
  var start = location.hash.slice(1);
  function arrive() { if (start && holdY(start) != null) scrollTo({ top: holdY(start), behavior: 'instant' }); }
  arrive();
  if (start) addEventListener('load', function () { requestAnimationFrame(arrive); });
  addEventListener('resize', onResize, { passive: true });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { measure(); render._done = false; });

  requestAnimationFrame(render);
  if (window.ScrollCraft) window.ScrollCraft.mount(document.body);
  else doc.classList.add('sc-ready');
})();
