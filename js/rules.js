/* ------------------------------------------------------------------
   rules.js — the Cycle Backgammon engine. No DOM, no globals beyond
   the export, so the whole rule set is testable from node.

   THE BOARD IS A RING. Points 0..23 run clockwise. White travels in
   the +1 direction, Black in the -1 direction, and both keep going
   round for as long as the game lasts — nothing is ever borne off.

   THE GATE is the single line between point 23 and point 0. It is the
   seam where a linear backgammon board's two ends were joined, which
   is why both players cross the same line: White going 23 -> 0, Black
   going 0 -> 23. A checker that crosses it has completed its lap and
   is CROWNED. Crowned checkers stay on the ring and keep blocking,
   hitting and being hit exactly as before; they simply cannot be
   crowned twice. Crown all fifteen and you win.

   Because the opening position is the standard backgammon position
   with the ends joined, each side starts on exactly 167 pips — the
   same race length as the real game.
   ------------------------------------------------------------------ */
(function (global) {
  'use strict';

  const SIZE = 24;          // points on the ring
  const CHECKERS = 15;      // per player
  const BAR_PIPS = SIZE + 1;

  /* Per-colour field names on a point: total and crowned-of-that-total. */
  /* Rule options. `crownedSafe` is the ruling that makes a crowned
     checker a supporter rather than a target: it can no longer be hit,
     and it holds its point on its own. Selfplay says the game is a
     coin-flipping bloodbath without it — see README. */
  const VARIANT = { crownedSafe: true };
  function setVariant(o) { Object.assign(VARIANT, o); }

  const F = {
    W: { own: 'w', ownC: 'wc', opp: 'b', oppC: 'bc', dir: +1 },
    B: { own: 'b', ownC: 'bc', opp: 'w', oppC: 'wc', dir: -1 }
  };
  const other = c => (c === 'W' ? 'B' : 'W');

  /* ---- state -------------------------------------------------------- */

  function emptyPoint() { return { w: 0, wc: 0, b: 0, bc: 0 }; }

  /* Standard backgammon's opening position, wrapped onto the ring.
     White's 24/13/8/6 points become 0/11/16/18; Black's are the
     mirror image p -> 23 - p. */
  const SETUP = [
    { c: 'W', at: 0, n: 2 }, { c: 'W', at: 11, n: 5 },
    { c: 'W', at: 16, n: 3 }, { c: 'W', at: 18, n: 5 },
    { c: 'B', at: 23, n: 2 }, { c: 'B', at: 12, n: 5 },
    { c: 'B', at: 7, n: 3 }, { c: 'B', at: 5, n: 5 }
  ];

  function newState() {
    const pts = [];
    for (let i = 0; i < SIZE; i++) pts.push(emptyPoint());
    SETUP.forEach(s => { pts[s.at][F[s.c].own] = s.n; });
    return {
      pts: pts,
      bar: emptyPoint(),
      crowned: { W: 0, B: 0 },
      turn: 'W',
      roll: null,          // the two (or four) die values as rolled
      dice: [],            // die values still to be played this turn
      winner: null
    };
  }

  function clone(s) {
    return {
      pts: s.pts.map(p => ({ w: p.w, wc: p.wc, b: p.b, bc: p.bc })),
      bar: { w: s.bar.w, wc: s.bar.wc, b: s.bar.b, bc: s.bar.bc },
      crowned: { W: s.crowned.W, B: s.crowned.B },
      turn: s.turn,
      roll: s.roll ? s.roll.slice() : null,
      dice: s.dice.slice(),
      winner: s.winner
    };
  }

  /* ---- geometry ----------------------------------------------------- */

  /* Pips a checker of colour c still owes before it crosses the gate.
     White at 23 is one pip short of the gate, Black at 0 likewise. */
  function pipsFrom(c, at) {
    if (at === 'bar') return BAR_PIPS;
    return c === 'W' ? SIZE - at : at + 1;
  }

  function pipCount(s, c) {
    const f = F[c];
    let pips = (s.bar[f.own] - s.bar[f.ownC]) * BAR_PIPS;
    for (let i = 0; i < SIZE; i++) {
      const uncrowned = s.pts[i][f.own] - s.pts[i][f.ownC];
      if (uncrowned) pips += uncrowned * pipsFrom(c, i);
    }
    return pips;
  }

  /* Where a die takes a checker, and whether it crosses the gate.
     Entering from the bar lands just past the gate, so a hit checker
     owes a full lap again — White on 0..5, Black on 23..18. */
  function land(c, src, die) {
    if (src === 'bar') {
      return { to: c === 'W' ? die - 1 : SIZE - die, crosses: false };
    }
    const raw = src + F[c].dir * die;
    if (c === 'W') return raw >= SIZE ? { to: raw - SIZE, crosses: true } : { to: raw, crosses: false };
    return raw < 0 ? { to: raw + SIZE, crosses: true } : { to: raw, crosses: false };
  }

  /* ---- atomic moves ------------------------------------------------- */

  /* A source is a (place, crowned?) pair: moving an already-crowned
     checker off a point is a different move from moving a raw one,
     because only the raw one can earn a crown on the way. */
  function sources(s, c) {
    const f = F[c], out = [];
    if (s.bar[f.own] > 0) {
      if (s.bar[f.own] - s.bar[f.ownC] > 0) out.push({ at: 'bar', crowned: false });
      if (s.bar[f.ownC] > 0) out.push({ at: 'bar', crowned: true });
      return out;                       // bar checkers must enter first
    }
    for (let i = 0; i < SIZE; i++) {
      const p = s.pts[i];
      if (p[f.own] - p[f.ownC] > 0) out.push({ at: i, crowned: false });
      if (p[f.ownC] > 0) out.push({ at: i, crowned: true });
    }
    return out;
  }

  function moveFor(s, c, src, die) {
    const f = F[c];
    const { to, crosses } = land(c, src.at, die);
    const dst = s.pts[to];
    const them = dst[f.opp], theirCrowns = dst[f.oppC];
    if (them >= 2) return null;                                     // a made point
    if (VARIANT.crownedSafe && theirCrowns >= 1) return null;        // a supporter holds it alone
    const hit = them === 1;
    return {
      from: src.at, crowned: src.crowned, die: die, to: to,
      crowns: crosses && !src.crowned,
      hit: hit,
      hitCrowned: hit && theirCrowns === 1
    };
  }

  function applyMove(s, m) {
    const c = s.turn, f = F[c], o = F[other(c)];
    const from = m.from === 'bar' ? s.bar : s.pts[m.from];
    from[f.own]--;
    if (m.crowned) from[f.ownC]--;

    if (m.hit) {
      const dst = s.pts[m.to];
      dst[f.opp]--;
      if (m.hitCrowned) dst[f.oppC]--;
      s.bar[o.own]++;
      if (m.hitCrowned) s.bar[o.ownC]++;
    }

    const dst = s.pts[m.to];
    dst[f.own]++;
    if (m.crowned || m.crowns) dst[f.ownC]++;
    if (m.crowns) {
      s.crowned[c]++;
      if (s.crowned[c] >= CHECKERS) s.winner = c;
    }
    return s;
  }

  /* ---- full turns --------------------------------------------------- */

  function diceFor(roll) {
    return roll[0] === roll[1] ? [roll[0], roll[0], roll[0], roll[0]] : roll.slice();
  }

  function hash(s) {
    let h = s.bar.w + ':' + s.bar.wc + ':' + s.bar.b + ':' + s.bar.bc + '|';
    for (let i = 0; i < SIZE; i++) {
      const p = s.pts[i];
      if (p.w || p.b) h += i + '.' + p.w + '.' + p.wc + '.' + p.b + '.' + p.bc + ',';
    }
    return h;
  }

  /* Every legal way to play the roll out, as a list of
     { moves: [...], state: <resulting state> }.

     Backgammon's "play as many dice as you can, and if you can only
     play one, play the larger" rule is enforced the usual way: expand
     the whole tree, then keep the longest lines. A line that wins is
     terminal however short it is. */
  function legalPlays(s) {
    const seen = new Map();
    const lines = [];

    (function expand(st, dice, moves) {
      if (st.winner) { lines.push({ moves: moves, state: st }); return; }
      let extended = false;
      const uniqueDice = dice.filter((d, i) => dice.indexOf(d) === i);
      for (const die of uniqueDice) {
        const rest = dice.slice();
        rest.splice(rest.indexOf(die), 1);
        for (const src of sources(st, st.turn)) {
          const m = moveFor(st, st.turn, src, die);
          if (!m) continue;
          extended = true;
          expand(applyMove(clone(st), m), rest, moves.concat(m));
        }
      }
      if (!extended) lines.push({ moves: moves, state: st });
    })(s, s.dice, []);

    /* A line that wins is always allowed, however few dice it used. */
    const winners = lines.filter(l => l.state.winner);
    let keep;
    if (winners.length) {
      keep = winners;
    } else {
      const len = Math.max.apply(null, lines.map(l => l.moves.length));
      keep = lines.filter(l => l.moves.length === len);
      if (len === 1 && s.dice.length === 2 && s.dice[0] !== s.dice[1]) {
        const big = Math.max(s.dice[0], s.dice[1]);
        if (keep.some(l => l.moves[0].die === big)) {
          keep = keep.filter(l => l.moves[0].die === big);
        }
      }
    }

    const out = [];
    for (const l of keep) {
      if (!l.moves.length) continue;          // nothing playable: the turn is lost
      const k = hash(l.state) + '#' + l.moves.length;
      if (seen.has(k)) continue;
      seen.set(k, true);
      out.push(l);
    }
    return out;
  }

  const sameMove = (a, b) =>
    a.from === b.from && a.crowned === b.crowned && a.die === b.die && a.to === b.to;

  const hasPrefix = (moves, prefix) =>
    prefix.length <= moves.length && prefix.every((m, i) => sameMove(m, moves[i]));

  /* The distinct moves that may be played *next*, given the moves
     already made this turn. Filtering the turn's full legal plays by
     the prefix is what keeps the click-to-move UI honest: a step that
     would strand a die simply never appears. */
  function nextSteps(plays, prefix) {
    const out = [], seen = new Set();
    for (const p of plays) {
      if (!hasPrefix(p.moves, prefix)) continue;
      const m = p.moves[prefix.length];
      if (!m) continue;
      const k = m.from + '/' + m.crowned + '/' + m.die + '/' + m.to;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(m);
    }
    return out;
  }

  /* Is the turn over — no play extends this prefix any further? */
  function turnComplete(plays, prefix) {
    return nextSteps(plays, prefix).length === 0;
  }

  function startTurn(s, roll) {
    s.roll = roll.slice();
    s.dice = diceFor(roll);
    return s;
  }

  function endTurn(s) {
    s.turn = other(s.turn);
    s.roll = null;
    s.dice = [];
    return s;
  }

  global.Rules = {
    SIZE, CHECKERS, BAR_PIPS, SETUP,
    newState, clone, other, hash, VARIANT, setVariant,
    pipsFrom, pipCount, land,
    sources, moveFor, applyMove, sameMove,
    diceFor, legalPlays, nextSteps, turnComplete, startTurn, endTurn
  };

})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined') {
  module.exports = (typeof window !== 'undefined' ? window : globalThis).Rules;
}
