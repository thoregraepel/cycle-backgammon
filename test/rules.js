/* ------------------------------------------------------------------
   Rule checks for Cycle Backgammon.  node test/rules.js

   The interesting properties are the ones the ring changes: the gate
   is a single seam both players cross in opposite directions, pips
   have to stay consistent under wraparound, and a hit checker must
   owe a full lap again.
   ------------------------------------------------------------------ */
'use strict';

const R = require('../js/rules.js');

let failures = 0;
function check(name, ok, detail) {
  if (!ok) { failures++; console.log('  FAIL  ' + name + (detail ? '  — ' + detail : '')); }
  return ok;
}

/* ---- 1. the opening position -------------------------------------- */

const s0 = R.newState();
check('white starts on 167 pips', R.pipCount(s0, 'W') === 167, R.pipCount(s0, 'W'));
check('black starts on 167 pips', R.pipCount(s0, 'B') === 167, R.pipCount(s0, 'B'));

let wc = 0, bc = 0;
for (let i = 0; i < R.SIZE; i++) { wc += s0.pts[i].w; bc += s0.pts[i].b; }
check('fifteen checkers a side', wc === 15 && bc === 15, wc + '/' + bc);
check('no point holds both colours', s0.pts.every(p => !(p.w && p.b)));
check('nobody starts crowned', s0.crowned.W === 0 && s0.crowned.B === 0);

/* ---- 2. the gate --------------------------------------------------- */

check('white crosses 23 -> 0', R.land('W', 23, 1).crosses && R.land('W', 23, 1).to === 0);
check('black crosses 0 -> 23', R.land('B', 0, 1).crosses && R.land('B', 0, 1).to === 23);
check('white short of the gate does not cross', !R.land('W', 20, 3).crosses);
check('black short of the gate does not cross', !R.land('B', 3, 3).crosses);
check('white enters from the bar past the gate', R.land('W', 'bar', 4).to === 3 && !R.land('W', 'bar', 4).crosses);
check('black enters from the bar past the gate', R.land('B', 'bar', 4).to === 20 && !R.land('B', 'bar', 4).crosses);

/* Entry point plus the pips it still owes must equal the bar's 25. */
for (let d = 1; d <= 6; d++) {
  const w = R.land('W', 'bar', d).to, b = R.land('B', 'bar', d).to;
  check('white bar pips consistent, die ' + d, d + R.pipsFrom('W', w) === R.BAR_PIPS);
  check('black bar pips consistent, die ' + d, d + R.pipsFrom('B', b) === R.BAR_PIPS);
}

/* Every move of d pips must reduce the mover's pip count by exactly d,
   unless it crowns — a crown retires the checker from the count. */
{
  let bad = null;
  const s = R.newState();
  for (let die = 1; die <= 6; die++) {
    for (const src of R.sources(s, 'W')) {
      const m = R.moveFor(s, 'W', src, die);
      if (!m) continue;
      const before = R.pipCount(s, 'W');
      const after = R.pipCount(R.applyMove(R.clone(s), m), 'W');
      const expected = m.crowns ? before - R.pipsFrom('W', m.from) : before - die;
      if (after !== expected) bad = die + ' from ' + m.from + ': ' + after + ' vs ' + expected;
    }
  }
  check('every move spends exactly its pips', !bad, bad);
}

/* ---- 3. crowning and hitting --------------------------------------- */

{
  const s = R.newState();
  R.startTurn(s, [6, 5]);
  const crowning = R.legalPlays(s).find(p => p.moves.some(m => m.crowns));
  check('white can cross the gate from the 18 point', !!crowning);
  if (crowning) {
    const m = crowning.moves.find(x => x.crowns);
    check('a crowned checker re-enters the ring', m.to < 6, 'landed on ' + m.to);
    check('crossing banks a crown', crowning.state.crowned.W >= 1);
    check('a crowned checker is marked where it lands', crowning.state.pts[m.to].wc >= 1);
  }
}

{
  /* A lone checker is a blot; hitting it must cost a full lap. */
  const s = R.newState();
  s.pts[4] = { w: 0, wc: 0, b: 1, bc: 0 };   // a lone black checker White can reach
  s.pts[5].b = 4;
  const before = R.pipCount(s, 'B');
  R.startTurn(s, [4, 1]);
  const hit = R.legalPlays(s).find(p => p.moves.some(m => m.hit && m.to === 4));
  check('a blot can be hit', !!hit);
  if (hit) {
    const after = hit.state;
    check('the victim goes to the bar', after.bar.b === 1);
    check('a hit costs the victim its lap', R.pipCount(after, 'B') > before, R.pipCount(after, 'B') + ' vs ' + before);
  }
}

{
  /* Checkers on the bar must come in before anything else moves. */
  const s = R.newState();
  s.bar.w = 1; s.pts[0].w = 1;
  R.startTurn(s, [2, 3]);
  const plays = R.legalPlays(s);
  check('the bar is played first', plays.every(p => p.moves[0].from === 'bar'), plays.length + ' plays');
}

{
  /* Six blocked entry points means no play at all. */
  const s = R.newState();
  for (let i = 0; i < R.SIZE; i++) s.pts[i] = { w: 0, wc: 0, b: 0, bc: 0 };
  for (let i = 0; i <= 5; i++) s.pts[i].b = 2;
  s.pts[12].b = 3; s.bar.w = 1; s.pts[15].w = 14;
  R.startTurn(s, [1, 6]);
  check('a shut-out board leaves no legal play', R.legalPlays(s).length === 0);
}

/* ---- 4. playing the roll out --------------------------------------- */

{
  const s = R.newState();
  R.startTurn(s, [3, 1]);
  const plays = R.legalPlays(s);
  check('both dice must be played', plays.every(p => p.moves.length === 2), plays.map(p => p.moves.length).join(','));
  check('doubles give four moves', (function () {
    const d = R.newState(); R.startTurn(d, [2, 2]);
    return R.legalPlays(d).every(p => p.moves.length === 4);
  })());
}

{
  /* Only one die playable: the rules must force the larger one. */
  const s = R.newState();
  for (let i = 0; i < R.SIZE; i++) s.pts[i] = { w: 0, wc: 0, b: 0, bc: 0 };
  s.pts[10].w = 1; s.pts[14].w = 14;          // white blocked everywhere but 10 -> 12
  for (const i of [11, 13, 15, 16, 17]) s.pts[i].b = 2;
  s.pts[12].b = 0; s.pts[20].b = 5;
  R.startTurn(s, [2, 1]);
  const plays = R.legalPlays(s);
  if (plays.length && plays.every(p => p.moves.length === 1)) {
    check('the larger die is forced', plays.every(p => p.moves[0].die === 2), plays.map(p => p.moves[0].die).join(','));
  }
}

{
  /* nextSteps must never offer a step that strands a die. */
  const s = R.newState();
  R.startTurn(s, [6, 4]);
  const plays = R.legalPlays(s);
  const steps = R.nextSteps(plays, []);
  check('every offered step belongs to a full play', steps.every(st =>
    plays.some(p => R.sameMove(p.moves[0], st))));
  if (steps.length) {
    const after = R.nextSteps(plays, [steps[0]]);
    check('a step leaves the rest of the roll playable', after.length > 0 || plays.some(p => p.moves.length === 1));
  }
}

{
  /* Every order of playing the roll must be offered, not just one of
     them. Collapsing orders that reach the same position is fine for
     the AI and wrong for the board: the player clicks an order, not a
     position. Checked directly — if a move can be followed by a legal
     play of the other die, the board has to offer it. */
  let missing = null;
  for (const roll of [[2, 4], [6, 1], [5, 3]]) {
    const s = R.newState();
    R.startTurn(s, roll);
    const offered = R.nextSteps(R.legalPlays(s, false), []);
    for (const src of R.sources(s, 'W')) {
      for (const die of roll) {
        const m = R.moveFor(s, 'W', src, die);
        if (!m) continue;
        const after = R.applyMove(R.clone(s), m);
        const otherDie = die === roll[0] ? roll[1] : roll[0];
        const playable = R.sources(after, 'W').some(s2 => R.moveFor(after, 'W', s2, otherDie));
        if (!playable) continue;               // stranding a die: rightly hidden
        if (!offered.some(o => R.sameMove(o, m))) {
          missing = roll.join('-') + ': ' + m.from + ' to ' + m.to + ' with ' + die;
        }
      }
    }
  }
  check('every playable order is offered', !missing, missing);
  check('the AI still gets the deduped list', (function () {
    const s = R.newState(); R.startTurn(s, [2, 4]);
    return R.legalPlays(s, true).length < R.legalPlays(s, false).length;
  })());
}

/* ---- 5. conservation ------------------------------------------------ */

{
  /* Nothing may create, destroy or uncrown a checker, ever. */
  let bad = null;
  const s = R.newState();
  R.startTurn(s, [5, 5]);
  for (const p of R.legalPlays(s)) {
    let w = p.state.bar.w, b = p.state.bar.b, cw = p.state.bar.wc;
    for (let i = 0; i < R.SIZE; i++) {
      w += p.state.pts[i].w; b += p.state.pts[i].b; cw += p.state.pts[i].wc;
      if (p.state.pts[i].wc > p.state.pts[i].w || p.state.pts[i].bc > p.state.pts[i].b) {
        bad = 'crowned exceeds total on point ' + i;
      }
    }
    if (w !== 15 || b !== 15) bad = 'checker count ' + w + '/' + b;
    if (cw !== p.state.crowned.W) bad = 'crown tally ' + cw + ' vs ' + p.state.crowned.W;
  }
  check('checkers and crowns are conserved', !bad, bad);
}

console.log(failures ? '\n' + failures + ' failing check(s)' : '\nall rule checks pass');
process.exit(failures ? 1 : 0);
