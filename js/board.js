/* ------------------------------------------------------------------
   board.js — the ring, drawn in SVG.

   Twenty-four wedges around an annulus, four quadrants of six. The
   gate sits at twelve o'clock, on the seam between point 23 and point
   0, drawn as the join it is. White's quadrant of entry runs clockwise
   from it, Black's anticlockwise, so the two home boards meet at the
   gate exactly as the ends of a folded board would.

   Scenery is built once. Only checkers, dice and highlights are
   redrawn, so a move costs a couple of dozen nodes.
   ------------------------------------------------------------------ */
(function (global) {
  'use strict';

  const R = global.Rules;
  const NS = 'http://www.w3.org/2000/svg';

  const CX = 380, CY = 380;
  const R_RIM = 330;        // outer edge of the points
  const R_APEX = 168;       // inner tip of the points
  const R_FRAME = 368;      // outer edge of the wooden frame
  const CHK = 15.5;         // checker radius
  const SLOT0 = R_RIM - 20; // radius of the first checker on a point
  const SLOT_GAP = 30;
  const SPAN = 360 / R.SIZE;

  let svg = null, dyn = null, hits = null, onPick = null;

  const el = (name, attrs) => {
    const n = document.createElementNS(NS, name);
    for (const k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) n.setAttribute(k, attrs[k]);
    return n;
  };
  const polar = (r, deg) => {
    const a = (deg - 90) * Math.PI / 180;
    return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
  };
  /* Angles run clockwise from twelve o'clock, which is also the gate,
     so point i simply occupies [i * 15, (i + 1) * 15). */
  const a0 = i => i * SPAN;
  const mid = i => (i + 0.5) * SPAN;

  /* A point is a tapered triangle: the full wedge at the rim, a tip at
     the apex. Drawn with a hair of inset so the wedges read separately. */
  function pointPath(i) {
    const inset = 0.55;
    const [x0, y0] = polar(R_RIM, a0(i) + inset);
    const [x1, y1] = polar(R_RIM, a0(i) + SPAN - inset);
    const [tx, ty] = polar(R_APEX, mid(i));
    return `M${x0},${y0} A${R_RIM},${R_RIM} 0 0 1 ${x1},${y1} L${tx},${ty} Z`;
  }

  /* Where the k-th checker on a point sits. Beyond five they compress
     into the same band rather than spilling past the apex. */
  function slot(i, k, n) {
    const shown = Math.min(n, 9);
    const gap = shown <= 5 ? SLOT_GAP : (SLOT_GAP * 4) / (shown - 1);
    return polar(SLOT0 - Math.min(k, shown - 1) * gap, mid(i));
  }

  const BAR_W = polar(96, 26);     // wells sit either side of the gate,
  const BAR_B = polar(96, -26);    // each on the side its owner enters

  /* ---- scenery ------------------------------------------------------- */

  function defs() {
    const d = el('defs');
    d.innerHTML = `
      <radialGradient id="felt" cx="50%" cy="42%" r="62%">
        <stop offset="0%"  stop-color="#1d4a38"/>
        <stop offset="100%" stop-color="#0d2b20"/>
      </radialGradient>
      <linearGradient id="wood" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%"   stop-color="#5b3c22"/>
        <stop offset="28%"  stop-color="#3b2616"/>
        <stop offset="55%"  stop-color="#6a4728"/>
        <stop offset="78%"  stop-color="#3a2515"/>
        <stop offset="100%" stop-color="#54371f"/>
      </linearGradient>
      <linearGradient id="pt-light" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="#dccaa4"/>
        <stop offset="100%" stop-color="#a8905f"/>
      </linearGradient>
      <linearGradient id="pt-dark" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="#8e3630"/>
        <stop offset="100%" stop-color="#5a201d"/>
      </linearGradient>
      <radialGradient id="chk-w" cx="36%" cy="30%" r="78%">
        <stop offset="0%"   stop-color="#fdf6e5"/>
        <stop offset="62%"  stop-color="#e7dbc2"/>
        <stop offset="100%" stop-color="#b9a880"/>
      </radialGradient>
      <radialGradient id="chk-b" cx="36%" cy="30%" r="78%">
        <stop offset="0%"   stop-color="#54504b"/>
        <stop offset="60%"  stop-color="#221f1d"/>
        <stop offset="100%" stop-color="#0a0908"/>
      </radialGradient>
      <radialGradient id="gate-glow" cx="50%" cy="50%" r="50%">
        <stop offset="0%"   stop-color="#c9a227" stop-opacity=".38"/>
        <stop offset="100%" stop-color="#c9a227" stop-opacity="0"/>
      </radialGradient>
      <filter id="soft" x="-40%" y="-40%" width="180%" height="180%">
        <feDropShadow dx="0" dy="2" stdDeviation="2.4" flood-color="#000" flood-opacity=".55"/>
      </filter>`;
    return d;
  }

  function buildScenery() {
    const g = el('g', { id: 'scenery' });

    g.appendChild(el('circle', { cx: CX, cy: CY, r: R_FRAME, fill: 'url(#wood)' }));
    g.appendChild(el('circle', {
      cx: CX, cy: CY, r: R_FRAME - 1, fill: 'none',
      stroke: '#1a1008', 'stroke-width': 2
    }));
    g.appendChild(el('circle', {
      cx: CX, cy: CY, r: R_RIM + 2, fill: 'none',
      stroke: '#20150b', 'stroke-width': 4
    }));

    /* the points */
    for (let i = 0; i < R.SIZE; i++) {
      g.appendChild(el('path', {
        d: pointPath(i),
        fill: i % 2 === 0 ? 'url(#pt-light)' : 'url(#pt-dark)',
        stroke: '#1c130b', 'stroke-width': .7, 'stroke-opacity': .8
      }));
    }

    /* the felt hub */
    g.appendChild(el('circle', { cx: CX, cy: CY, r: R_APEX, fill: 'url(#felt)' }));
    g.appendChild(el('circle', {
      cx: CX, cy: CY, r: R_APEX, fill: 'none',
      stroke: '#0a1f17', 'stroke-width': 3
    }));

    /* quadrant seams: three plain ones, and the gate */
    [6, 12, 18].forEach(i => {
      const [x1, y1] = polar(R_APEX, a0(i));
      const [x2, y2] = polar(R_FRAME, a0(i));
      g.appendChild(el('line', {
        x1, y1, x2, y2, stroke: '#c9a227', 'stroke-width': 1, 'stroke-opacity': .28
      }));
    });

    g.appendChild(gate());
    g.appendChild(labels());
    return g;
  }

  /* The gate: the seam where the two ends of a linear board were
     joined. Drawn as a keystone straddling twelve o'clock. */
  function gate() {
    const g = el('g', { id: 'gate' });
    /* a glow contained inside the band, so it lights the seam without
       washing the frame or the points either side of it */
    const [gx, gy] = polar((R_APEX + R_RIM) / 2, 0);
    g.appendChild(el('circle', { cx: gx, cy: gy, r: 62, fill: 'url(#gate-glow)' }));

    const [x1, y1] = polar(R_APEX - 6, 0);
    const [x2, y2] = polar(R_FRAME, 0);
    g.appendChild(el('line', { x1, y1, x2, y2, stroke: '#0f0b06', 'stroke-width': 7 }));
    g.appendChild(el('line', { x1, y1, x2, y2, stroke: '#c9a227', 'stroke-width': 2.4 }));

    /* a keystone block sat on the seam, on the frame */
    const kw = 5.4;
    const [k0x, k0y] = polar(R_FRAME - 1, -kw);
    const [k1x, k1y] = polar(R_FRAME - 1, kw);
    const [k2x, k2y] = polar(R_RIM - 4, kw * 1.5);
    const [k3x, k3y] = polar(R_RIM - 4, -kw * 1.5);
    g.appendChild(el('path', {
      d: `M${k0x},${k0y} A${R_FRAME - 1},${R_FRAME - 1} 0 0 1 ${k1x},${k1y} L${k2x},${k2y} L${k3x},${k3y} Z`,
      fill: '#c9a227', 'fill-opacity': .9, stroke: '#6b5324', 'stroke-width': 1
    }));

    const [tx, ty] = polar(R_FRAME - 20, 0);
    g.appendChild(text('GATE', tx, ty + 4, {
      fill: '#1a1008', 'font-size': 11, 'letter-spacing': 2.4, 'font-weight': 700
    }));
    return g;
  }

  function text(s, x, y, attrs) {
    const t = el('text', Object.assign({
      x, y, 'text-anchor': 'middle',
      'font-family': 'Iowan Old Style, Palatino, Georgia, serif'
    }, attrs));
    t.textContent = s;
    return t;
  }

  function labels() {
    const g = el('g', { id: 'labels' });

    /* point numbers, set into the frame */
    for (let i = 0; i < R.SIZE; i++) {
      const [x, y] = polar(R_FRAME - 12, mid(i));
      const t = text(String(i), x, y + 3.6, {
        fill: '#c9a227', 'fill-opacity': .5, 'font-size': 10.5
      });
      const a = mid(i);
      t.setAttribute('transform', `rotate(${a > 90 && a < 270 ? a + 180 : a} ${x} ${y})`);
      g.appendChild(t);
    }

    /* which way each colour runs, as an arrow on the felt either side
       of the gate: ivory sweeps clockwise, ebony anticlockwise */
    g.appendChild(runArrow(14, 52, '#efe4cd', 'WHITE'));
    g.appendChild(runArrow(-14, -52, '#8e8a85', 'BLACK'));

    /* the bar wells */
    [[BAR_W, 'W'], [BAR_B, 'B']].forEach(([p, c]) => {
      g.appendChild(el('circle', {
        cx: p[0], cy: p[1], r: 25,
        fill: '#0b241b', stroke: '#c9a227', 'stroke-opacity': .35, 'stroke-width': 1.2
      }));
      g.appendChild(text('BAR', p[0], p[1] + 40, {
        fill: '#e7dbc2', 'fill-opacity': .4, 'font-size': 9.5, 'letter-spacing': 1.6
      }));
    });
    return g;
  }

  /* An arc with a head on it, drawn on the felt, showing which way a
     colour travels. `from` and `to` are angles; the head sits at `to`. */
  function runArrow(from, to, colour, label) {
    const g = el('g', { opacity: .62 });
    const r = 150;
    const [x0, y0] = polar(r, from);
    const [x1, y1] = polar(r, to);
    const sweep = to > from ? 1 : 0;
    g.appendChild(el('path', {
      d: `M${x0},${y0} A${r},${r} 0 0 ${sweep} ${x1},${y1}`,
      fill: 'none', stroke: colour, 'stroke-width': 2, 'stroke-linecap': 'round'
    }));
    const head = el('path', {
      d: 'M0,-6 L11,0 L0,6 Z', fill: colour
    });
    head.setAttribute('transform',
      `translate(${x1} ${y1}) rotate(${to + (sweep ? 90 : -90)})`);
    g.appendChild(head);
    const [lx, ly] = polar(r - 17, (from + to) / 2);
    const t = text(label, lx, ly, {
      fill: colour, 'font-size': 10.5, 'letter-spacing': 1.8
    });
    t.setAttribute('transform', `rotate(${(from + to) / 2} ${lx} ${ly})`);
    g.appendChild(t);
    return g;
  }

  /* ---- pieces --------------------------------------------------------- */

  function checker(x, y, colour, crowned, opts) {
    const g = el('g', { class: 'checker' });
    g.appendChild(el('circle', {
      cx: x, cy: y, r: CHK,
      fill: colour === 'W' ? 'url(#chk-w)' : 'url(#chk-b)',
      stroke: colour === 'W' ? '#8d7d5f' : '#000',
      'stroke-width': 1,
      filter: 'url(#soft)'
    }));
    g.appendChild(el('circle', {
      cx: x, cy: y, r: CHK - 4.5, fill: 'none',
      stroke: colour === 'W' ? '#b9a880' : '#3a3633',
      'stroke-width': .9, 'stroke-opacity': .8
    }));
    if (crowned) {
      g.appendChild(el('circle', {
        cx: x, cy: y, r: CHK - 2.4, fill: 'none',
        stroke: '#c9a227', 'stroke-width': 2
      }));
      g.appendChild(text('♛', x, y + 3.6, { 'font-size': 10, fill: '#e2c869' }));
    }
    if (opts && opts.glow) {
      g.appendChild(el('circle', {
        cx: x, cy: y, r: CHK + 3.5, fill: 'none',
        stroke: '#e2c869', 'stroke-width': 2.2, 'stroke-opacity': .95
      }));
    }
    return g;
  }

  function die(x, y, v, used) {
    const g = el('g', { opacity: used ? .3 : 1 });
    g.appendChild(el('rect', {
      x: x - 21, y: y - 21, width: 42, height: 42, rx: 8,
      fill: used ? '#2a2b28' : '#f2ead8',
      stroke: '#141310', 'stroke-width': 1.4, filter: 'url(#soft)'
    }));
    const p = [[-1, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [-1, 1], [1, 1]];
    const FACES = {
      1: [3], 2: [0, 6], 3: [0, 3, 6], 4: [0, 1, 5, 6],
      5: [0, 1, 3, 5, 6], 6: [0, 1, 2, 4, 5, 6]
    };
    (FACES[v] || []).forEach(k => {
      g.appendChild(el('circle', {
        cx: x + p[k][0] * 10.5, cy: y + p[k][1] * 10.5, r: 3.6,
        fill: used ? '#8c8579' : '#1a1713'
      }));
    });
    return g;
  }

  /* ---- render --------------------------------------------------------- */

  function init(svgEl, pickHandler) {
    svg = svgEl;
    onPick = pickHandler;
    svg.innerHTML = '';
    svg.appendChild(defs());
    svg.appendChild(buildScenery());
    dyn = el('g', { id: 'dyn' });
    svg.appendChild(dyn);
    hits = el('g', { id: 'hits' });
    svg.appendChild(hits);
    buildHitLayer();
  }

  function buildHitLayer() {
    for (let i = 0; i < R.SIZE; i++) {
      const p = el('path', { d: pointPath(i), fill: 'transparent', class: 'hit' });
      p.addEventListener('click', () => onPick && onPick(i));
      hits.appendChild(p);
    }
    [[BAR_W, 'W'], [BAR_B, 'B']].forEach(([p, c]) => {
      const h = el('circle', { cx: p[0], cy: p[1], r: 27, fill: 'transparent', class: 'hit' });
      h.addEventListener('click', () => onPick && onPick('bar:' + c));
      hits.appendChild(h);
    });
  }

  function render(state, view) {
    view = view || {};
    dyn.innerHTML = '';

    /* highlight tints under the checkers */
    (view.targets || []).forEach(t => {
      dyn.appendChild(el('path', {
        d: pointPath(t.to),
        fill: t.hit ? '#d0563f' : '#c9a227',
        'fill-opacity': t.hit ? .42 : .34
      }));
    });
    if (view.sel !== null && view.sel !== undefined && view.sel !== 'bar') {
      dyn.appendChild(el('path', {
        d: pointPath(view.sel), fill: '#e2c869', 'fill-opacity': .24
      }));
    }

    /* checkers */
    for (let i = 0; i < R.SIZE; i++) {
      const p = state.pts[i];
      const colour = p.w ? 'W' : (p.b ? 'B' : null);
      if (!colour) continue;
      const n = colour === 'W' ? p.w : p.b;
      const nc = colour === 'W' ? p.wc : p.bc;
      const shown = Math.min(n, 9);
      for (let k = 0; k < shown; k++) {
        const [x, y] = slot(i, k, n);
        /* crowned ones are drawn at the back of the stack */
        const isCrowned = k >= shown - Math.min(nc, shown);
        const top = k === shown - 1;
        dyn.appendChild(checker(x, y, colour, isCrowned, {
          glow: top && view.sel === i
        }));
      }
      if (n > 9) {
        /* a stack too deep to draw honestly, so it says how deep it is */
        const [x, y] = slot(i, 8, n);
        dyn.appendChild(el('circle', {
          cx: x, cy: y, r: 11,
          fill: '#17130f', stroke: '#c9a227', 'stroke-width': 1.4
        }));
        dyn.appendChild(text(String(n), x, y + 4.2, {
          'font-size': 12, 'font-weight': 700, fill: '#e2c869'
        }));
      }
    }

    /* the bar */
    [['W', BAR_W], ['B', BAR_B]].forEach(([c, p]) => {
      const n = c === 'W' ? state.bar.w : state.bar.b;
      const nc = c === 'W' ? state.bar.wc : state.bar.bc;
      for (let k = 0; k < Math.min(n, 4); k++) {
        dyn.appendChild(checker(p[0], p[1] - k * 9, c, k >= Math.min(n, 4) - nc, {
          glow: k === Math.min(n, 4) - 1 && view.sel === 'bar'
        }));
      }
      if (n > 4) {
        dyn.appendChild(text('×' + n, p[0] + 24, p[1] + 4, {
          'font-size': 12, fill: '#e2c869'
        }));
      }
    });

    /* target rings on top of everything */
    (view.targets || []).forEach(t => {
      const n = (state.pts[t.to].w || state.pts[t.to].b || 0);
      const [x, y] = slot(t.to, t.hit ? 0 : n, n + 1);
      dyn.appendChild(el('circle', {
        cx: x, cy: y, r: CHK, fill: 'none',
        stroke: t.hit ? '#e8795f' : '#e2c869',
        'stroke-width': 2.4, 'stroke-dasharray': '5 4'
      }));
      if (t.crowns) {
        dyn.appendChild(text('♛', x, y + 4.5, { 'font-size': 13, fill: '#e2c869' }));
      }
    });

    /* dice in the hub */
    const dice = view.dice || [];
    const y = CY + 52;
    const spread = dice.length > 2 ? 47 : 52;
    dice.forEach((d, k) => {
      dyn.appendChild(die(CX + (k - (dice.length - 1) / 2) * spread, y, d.v, d.used));
    });

    if (view.hubText) {
      dyn.appendChild(text(view.hubText, CX, CY - 8, {
        fill: '#e7dbc2', 'font-size': 17, 'letter-spacing': 1.4
      }));
    }
    if (view.hubSub) {
      dyn.appendChild(text(view.hubSub, CX, CY + 14, {
        fill: '#9fb3a7', 'font-size': 12.5, 'letter-spacing': 1
      }));
    }

    /* only live points take the pointer */
    const live = new Set((view.live || []).map(String));
    Array.from(hits.children).forEach((h, k) => {
      const id = k < R.SIZE ? String(k) : (k === R.SIZE ? 'bar:W' : 'bar:B');
      h.classList.toggle('live', live.has(id));
    });
  }

  global.Board = { init, render, CX, CY, polar, slot, R_APEX, R_RIM };

})(typeof window !== 'undefined' ? window : globalThis);
