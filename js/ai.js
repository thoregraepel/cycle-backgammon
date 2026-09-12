/* ------------------------------------------------------------------
   ai.js — an opponent good enough to test the rules against.

   One-ply search over every legal way to play the roll, scored by a
   hand-built evaluation: the race, blots weighted by the chance of
   being hit and by how much a hit would cost, points made, checkers
   on the bar, and crowns banked. The "strong" level re-scores the
   best handful by expectimax over the opponent's 21 distinct rolls.
   ------------------------------------------------------------------ */
(function (global) {
  'use strict';

  const R = global.Rules;
  const SIZE = R.SIZE;

  /* Shots out of 36 that cover a given distance, blocking ignored.
     The 7..12 entries are the combination shots; the long tail are
     the doubles that reach 15, 16, 18, 20 and 24. */
  const SHOTS = {
    1: 11, 2: 12, 3: 14, 4: 15, 5: 15, 6: 17,
    7: 6, 8: 6, 9: 5, 10: 3, 11: 2, 12: 3,
    15: 1, 16: 1, 18: 1, 20: 1, 24: 1
  };

  /* Distance from `at` to `to` travelling in colour c's direction. */
  function ahead(c, at, to) {
    const d = c === 'W' ? to - at : at - to;
    return ((d % SIZE) + SIZE) % SIZE;
  }

  /* Rough chance (0..1) that colour `by` hits a blot standing on `at`. */
  function hitChance(s, by, at) {
    const f = by === 'W' ? { own: 'w' } : { own: 'b' };
    let shots = 0;
    if (s.bar[f.own] > 0) {
      /* On the bar it can only hit from its entry points. */
      const entry = by === 'W' ? [0, 1, 2, 3, 4, 5] : [23, 22, 21, 20, 19, 18];
      if (entry.indexOf(at) >= 0) shots += 11;
      return Math.min(shots, 36) / 36;
    }
    for (let i = 0; i < SIZE; i++) {
      if (s.pts[i][f.own] === 0) continue;
      shots += SHOTS[ahead(by, i, at)] || 0;
    }
    return Math.min(shots, 36) / 36;
  }

  const W = {
    race: 1.0,          // per pip of race advantage
    crown: 8.0,         // per crown banked
    blot: 1.1,          // per expected pip lost to a hit
    point: 4.0,         // per point held with two or more
    homeBlock: 3.0,     // extra for points in front of the opponent's entry
    prime: 5.0,         // extra per adjacent pair of held points
    bar: 14.0,          // per own checker sitting on the bar
    stack: 1.2          // per checker piled beyond the fourth
  };

  function evaluate(s, me) {
    if (s.winner) return s.winner === me ? 1e6 : -1e6;
    const you = R.other(me);
    let score = 0;

    score += W.race * (R.pipCount(s, you) - R.pipCount(s, me));
    score += W.crown * (s.crowned[me] - s.crowned[you]);

    const mine = me === 'W' ? { own: 'w', ownC: 'wc' } : { own: 'b', ownC: 'bc' };
    const theirs = you === 'W' ? { own: 'w', ownC: 'wc' } : { own: 'b', ownC: 'bc' };

    score -= W.bar * (s.bar[mine.own] - s.bar[mine.ownC]) * 1.0;
    score -= W.bar * 0.5 * s.bar[mine.ownC];
    score += W.bar * 0.8 * s.bar[theirs.own];

    /* The six points an opponent on the bar must enter on. */
    const theirEntry = you === 'W' ? [0, 1, 2, 3, 4, 5] : [23, 22, 21, 20, 19, 18];

    let held = [];
    for (let i = 0; i < SIZE; i++) {
      const p = s.pts[i];
      const n = p[mine.own];
      if (n === 1) {
        /* A hit costs the checker its whole lap, or just its position
           if it has already been crowned. */
        const crownedBlot = p[mine.ownC] === 1;
        const cost = crownedBlot ? R.pipsFrom(me, i) * 0.35 : R.pipsFrom(me, i);
        score -= W.blot * hitChance(s, you, i) * cost;
      } else if (n >= 2) {
        held.push(i);
        score += W.point;
        if (theirEntry.indexOf(i) >= 0) score += W.homeBlock;
        if (n > 4) score -= W.stack * (n - 4);
      }
      const theirN = p[theirs.own];
      if (theirN === 1) {
        const cost = p[theirs.ownC] === 1 ? R.pipsFrom(you, i) * 0.35 : R.pipsFrom(you, i);
        score += W.blot * 0.8 * hitChance(s, me, i) * cost;
      }
    }

    /* Adjacent held points are worth more than scattered ones. */
    for (let k = 1; k < held.length; k++) {
      if (held[k] === held[k - 1] + 1) score += W.prime;
    }

    return score;
  }

  const ROLLS = (function () {
    const out = [];
    for (let a = 1; a <= 6; a++) for (let b = a; b <= 6; b++) {
      out.push({ roll: [a, b], p: a === b ? 1 / 36 : 2 / 36 });
    }
    return out;
  })();

  /* The opponent is on roll and `s` already has their dice. They pick
     the line that suits them best; we score whatever that leaves us. */
  function opponentReply(s, me) {
    const plays = R.legalPlays(s);
    if (!plays.length) return evaluate(s, me);
    const opp = s.turn;
    let pick = null, bv = -Infinity;
    for (const p of plays) {
      const v = evaluate(p.state, opp);
      if (v > bv) { bv = v; pick = p; }
    }
    return evaluate(pick.state, me);
  }

  /* Expectimax over the opponent's 21 distinct rolls. */
  function rollOutValue(s, me) {
    let total = 0;
    for (const r of ROLLS) {
      total += r.p * opponentReply(R.startTurn(R.clone(s), r.roll), me);
    }
    return total;
  }

  const LEVELS = { easy: 0, normal: 1, strong: 2 };

  function choosePlay(s, level) {
    const plays = R.legalPlays(s);
    if (!plays.length) return null;
    const me = s.turn;
    const depth = LEVELS[level] === undefined ? 1 : LEVELS[level];

    if (depth === 0) {
      /* Still avoids the worst blunders: sample a few, take the best. */
      const sample = [];
      for (let i = 0; i < Math.min(4, plays.length); i++) {
        sample.push(plays[Math.floor(Math.random() * plays.length)]);
      }
      return sample.reduce((a, b) => evaluate(a.state, me) >= evaluate(b.state, me) ? a : b);
    }

    const scored = plays.map(p => ({ play: p, v: evaluate(p.state, me) }));
    scored.sort((a, b) => b.v - a.v);
    if (depth === 1 || scored.length === 1) return scored[0].play;

    const top = scored.slice(0, 6);
    for (const c of top) {
      if (c.play.state.winner) { c.v = 1e6; continue; }
      const next = R.endTurn(R.clone(c.play.state));
      c.v = rollOutValue(next, me);
    }
    top.sort((a, b) => b.v - a.v);
    return top[0].play;
  }

  global.AI = { evaluate, choosePlay, hitChance, ahead, SHOTS, LEVELS, W };

})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined') {
  module.exports = (typeof window !== 'undefined' ? window : globalThis).AI;
}
