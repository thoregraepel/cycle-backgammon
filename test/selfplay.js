/* ------------------------------------------------------------------
   AI-vs-AI selfplay.  node test/selfplay.js [games] [level]

   A new game needs evidence that it ends, that it ends in a sensible
   number of rolls, and that neither seat is a free win. Every ply is
   also audited for the invariants a legal position must satisfy.
   ------------------------------------------------------------------ */
'use strict';

const R = require('../js/rules.js');
const AI = require('../js/ai.js');

const GAMES = parseInt(process.argv[2] || '60', 10);
const LEVEL = process.argv[3] || 'normal';
if (process.env.CBG_CROWNED_SAFE === '0') R.setVariant({ crownedSafe: false });
const MAX_PLIES = 600;

let failures = 0;
function check(name, ok, detail) {
  if (!ok) { failures++; console.log('  FAIL  ' + name + (detail ? '  — ' + detail : '')); }
  return ok;
}

/* Deterministic dice so a failure can be reproduced from its seed. */
function rng(seed) {
  let x = seed >>> 0 || 1;
  return function () {
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5; x >>>= 0;
    return x / 4294967296;
  };
}

function audit(s, where) {
  let w = s.bar.w, b = s.bar.b, cw = s.bar.wc, cb = s.bar.bc;
  for (let i = 0; i < R.SIZE; i++) {
    const p = s.pts[i];
    w += p.w; b += p.b; cw += p.wc; cb += p.bc;
    if (p.w && p.b) return where + ': both colours on point ' + i;
    if (p.wc > p.w || p.bc > p.b) return where + ': crowned exceeds total on point ' + i;
    if (p.w < 0 || p.b < 0) return where + ': negative count on point ' + i;
  }
  if (w !== R.CHECKERS || b !== R.CHECKERS) return where + ': checker count ' + w + '/' + b;
  if (cw !== s.crowned.W || cb !== s.crowned.B) return where + ': crown tally off';
  if (R.pipCount(s, 'W') < 0 || R.pipCount(s, 'B') < 0) return where + ': negative pips';
  return null;
}

function playGame(seed) {
  const rand = rng(seed);
  const die = () => 1 + Math.floor(rand() * 6);
  const s = R.newState();
  let plies = 0, hits = 0, crowns = 0, passes = 0, bad = null;

  while (!s.winner && plies < MAX_PLIES) {
    R.startTurn(s, [die(), die()]);
    const beforePips = R.pipCount(s, s.turn);
    const play = AI.choosePlay(s, LEVEL);
    if (!play) { passes++; }
    else {
      play.moves.forEach(m => { if (m.hit) hits++; if (m.crowns) crowns++; });
      Object.assign(s, play.state);
    }
    bad = bad || audit(s, 'ply ' + plies);
    /* Within a turn the mover can only ever shorten their own race:
       you cannot hit your own checker. */
    if (play && R.pipCount(s, s.turn) > beforePips) {
      bad = bad || ('ply ' + plies + ': mover pips rose from ' + beforePips +
                    ' to ' + R.pipCount(s, s.turn));
    }
    if (s.winner) break;
    R.endTurn(s);
    plies++;
  }
  return { winner: s.winner, plies, hits, crowns, passes, bad, state: s };
}

console.log('cycle backgammon selfplay — ' + GAMES + ' games at level "' + LEVEL + '"\n');

let wins = { W: 0, B: 0 }, totalPlies = 0, totalHits = 0, totalPasses = 0, unfinished = 0, firstBad = null;
let minPlies = Infinity, maxPlies = 0;
const t0 = Date.now();

for (let g = 0; g < GAMES; g++) {
  const r = playGame(g * 2654435761 + 12345);
  if (!r.winner) { unfinished++; if (!firstBad) firstBad = 'seed ' + g + ' did not finish'; continue; }
  if (r.bad && !firstBad) firstBad = 'seed ' + g + ' — ' + r.bad;
  wins[r.winner]++;
  totalPlies += r.plies; totalHits += r.hits; totalPasses += r.passes;
  minPlies = Math.min(minPlies, r.plies); maxPlies = Math.max(maxPlies, r.plies);
  if (r.state.crowned[r.winner] !== R.CHECKERS && !firstBad) {
    firstBad = 'seed ' + g + ' — winner has ' + r.state.crowned[r.winner] + ' crowns, not 15';
  }
}

const done = GAMES - unfinished;
console.log('  games finished   ' + done + '/' + GAMES);
console.log('  white / black    ' + wins.W + ' / ' + wins.B);
console.log('  plies per game   ' + (totalPlies / Math.max(done, 1)).toFixed(1) +
            '  (min ' + minPlies + ', max ' + maxPlies + ')');
console.log('  hits per game    ' + (totalHits / Math.max(done, 1)).toFixed(1));
console.log('  passed turns     ' + (totalPasses / Math.max(done, 1)).toFixed(1));
console.log('  elapsed          ' + ((Date.now() - t0) / 1000).toFixed(1) + 's\n');

check('every game reaches a winner', unfinished === 0, unfinished + ' unfinished');
check('no illegal position occurred', !firstBad, firstBad);
check('games are not degenerate', totalPlies / Math.max(done, 1) > 20 && totalPlies / Math.max(done, 1) < 200);
check('hitting actually happens', totalHits > 0);
/* Moving first is worth something, but it should not be worth everything. */
check('neither seat is a free win', wins.W >= done * 0.25 && wins.B >= done * 0.25,
      wins.W + '/' + wins.B);

/* ---- the strength ladder ------------------------------------------
   An evaluation that means anything must beat a weaker version of
   itself, from either seat. This is the check that fails loudly if a
   change to the weights quietly breaks the AI. */

function match(levelW, levelB, n) {
  let w = 0, b = 0;
  for (let g = 0; g < n; g++) {
    const rand = rng(g * 2654435761 + 7);
    const die = () => 1 + Math.floor(rand() * 6);
    const s = R.newState();
    let plies = 0;
    while (!s.winner && plies < MAX_PLIES) {
      R.startTurn(s, [die(), die()]);
      const p = AI.choosePlay(s, s.turn === 'W' ? levelW : levelB);
      if (p) Object.assign(s, p.state);
      if (s.winner) break;
      R.endTurn(s);
      plies++;
    }
    if (s.winner === 'W') w++; else if (s.winner === 'B') b++;
  }
  return { w, b };
}

const asWhite = match('normal', 'easy', 12);
const asBlack = match('easy', 'normal', 12);
console.log('\n  normal as white  ' + asWhite.w + ' - ' + asWhite.b);
console.log('  normal as black  ' + asBlack.w + ' - ' + asBlack.b);
check('normal beats easy as white', asWhite.w >= 9, asWhite.w + '/12');
check('normal beats easy as black', asBlack.b >= 9, asBlack.b + '/12');

console.log(failures ? '\n' + failures + ' failing check(s)' : '\nselfplay clean');
process.exit(failures ? 1 : 0);
