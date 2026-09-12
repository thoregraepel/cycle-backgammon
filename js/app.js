/* ------------------------------------------------------------------
   app.js — turn flow and clicking.

   The turn's legal plays are generated once, at the roll, and every
   click is matched against that list by prefix. That is what makes
   the board honest: a step that would strand a die is never offered,
   so the "play as many dice as you can" rule needs no special case.
   ------------------------------------------------------------------ */
(function (global) {
  'use strict';

  const R = global.Rules, AI = global.AI, B = global.Board;
  const $ = id => document.getElementById(id);

  const AI_ROLL_PAUSE = 620;
  const AI_MOVE_PAUSE = 480;

  let state = null;
  let plays = [];          // every legal way to play this roll
  let prefix = [];         // the moves played so far this turn
  let turnStart = null;    // the position as it stood at the roll
  let sel = null;          // { at, crowned } or null
  let variants = [];       // source variants at the selected point
  let vIndex = 0;
  let busy = false;
  let players = { W: 'human', B: 'normal' };

  const isHuman = c => players[c] === 'human';
  const name = c => (c === 'W' ? 'White' : 'Black');
  const roleText = c => players[c] === 'human' ? 'You' : 'AI · ' + players[c];

  /* ---- turn machinery ------------------------------------------------ */

  function newGame() {
    state = R.newState();
    plays = []; prefix = []; sel = null; turnStart = null; busy = false;
    $('banner').hidden = true;
    draw();
    maybeAutoRoll();
  }

  function rollDice() {
    return [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)];
  }

  function beginTurn() {
    R.startTurn(state, rollDice());
    turnStart = R.clone(state);
    plays = R.legalPlays(state, false);   // every order, so every click works
    prefix = []; sel = null;
    draw();
    if (!plays.length) {
      setHint(name(state.turn) + ' cannot play that roll.');
      setTimeout(finishTurn, AI_ROLL_PAUSE + 400);
      return;
    }
    if (!isHuman(state.turn)) setTimeout(aiPlay, AI_ROLL_PAUSE);
  }

  function aiPlay() {
    const play = AI.choosePlay(turnStart, players[state.turn]);
    if (!play) { finishTurn(); return; }
    let k = 0;
    (function step() {
      if (k >= play.moves.length) { draw(); setTimeout(finishTurn, AI_MOVE_PAUSE); return; }
      applyStep(play.moves[k++]);
      draw();
      setTimeout(step, AI_MOVE_PAUSE);
    })();
  }

  function applyStep(m) {
    R.applyMove(state, m);
    /* the die is spent: drop one matching value from the remainder */
    const i = state.dice.indexOf(m.die);
    if (i >= 0) state.dice.splice(i, 1);
    prefix = prefix.concat(m);
    sel = null;
  }

  function finishTurn() {
    if (state.winner) { declare(); return; }
    R.endTurn(state);
    draw();
    maybeAutoRoll();
  }

  function maybeAutoRoll() {
    if (state.winner) return;
    if (!isHuman(state.turn)) { busy = true; setTimeout(beginTurn, 340); }
    else busy = false;
    draw();
  }

  function declare() {
    busy = true;
    draw();
    const b = $('banner');
    b.innerHTML = '<span>' + name(state.winner) + ' crowns all fifteen</span>';
    b.hidden = false;
  }

  /* ---- clicking ------------------------------------------------------- */

  /* Distinct next steps, and the source variants they come from. */
  const steps = () => R.nextSteps(plays, prefix);

  function sourcesNow() {
    const out = [], seen = new Set();
    steps().forEach(m => {
      const k = m.from + '/' + m.crowned;
      if (seen.has(k)) return;
      seen.add(k);
      out.push({ at: m.from, crowned: m.crowned });
    });
    return out;
  }

  function targetsFor(s) {
    if (!s) return [];
    return steps().filter(m => m.from === s.at && m.crowned === s.crowned);
  }

  function pick(id) {
    if (busy || state.winner || !plays.length) return;
    if (!isHuman(state.turn)) return;

    const where = (typeof id === 'string' && id.indexOf('bar:') === 0)
      ? (id.slice(4) === state.turn ? 'bar' : null) : id;
    if (where === null) return;

    /* a click on a legal destination plays it */
    if (sel) {
      const t = targetsFor(sel).find(m => m.to === where);
      if (t) {
        applyStep(t);
        variants = [];
        if (state.winner) { draw(); setTimeout(declare, 260); return; }
        if (R.turnComplete(plays, prefix)) {
          draw();
          setTimeout(finishTurn, 260);
        } else {
          autoSelect();
          draw();
        }
        return;
      }
    }

    const here = sourcesNow().filter(s => s.at === where);
    if (!here.length) { sel = null; variants = []; draw(); return; }

    /* A point can hold both a runner and a supporter. Clicking again
       swaps which one you are moving — they go to the same place, but
       only the runner can come back crowned. */
    if (sel && sel.at === where && here.length > 1) {
      vIndex = (vIndex + 1) % here.length;
    } else {
      vIndex = 0;
      variants = here;
    }
    variants = here;
    sel = here[vIndex] || here[0];
    draw();
  }

  /* If only one checker can move at all, select it for the player. */
  function autoSelect() {
    const s = sourcesNow();
    sel = s.length === 1 ? s[0] : null;
    vIndex = 0;
  }

  function undo() {
    if (busy || !turnStart || !isHuman(state.turn)) return;
    Object.assign(state, R.clone(turnStart));
    prefix = []; sel = null; variants = [];
    plays = R.legalPlays(state, false);
    draw();
  }

  /* ---- drawing -------------------------------------------------------- */

  function setHint(s) { $('hint').textContent = s; }

  function draw() {
    const t = targetsFor(sel);
    const live = [];
    if (isHuman(state.turn) && !busy && !state.winner) {
      sourcesNow().forEach(s => live.push(s.at === 'bar' ? 'bar:' + state.turn : s.at));
      t.forEach(m => live.push(m.to));
    }

    const used = {};
    prefix.forEach(m => { used[m.die] = (used[m.die] || 0) + 1; });
    const dice = (state.roll ? R.diceFor(state.roll) : []).map(v => {
      if (used[v]) { used[v]--; return { v, used: true }; }
      return { v, used: false };
    });

    B.render(state, {
      sel: sel ? sel.at : null,
      targets: t,
      dice: dice,
      live: live,
      /* on a win the banner says it; two captions on top of each other
         is one too many */
      hubText: state.winner ? null
             : (state.roll ? name(state.turn) + ' to play' : name(state.turn) + ' to roll'),
      hubSub: state.winner ? null
            : (state.roll ? null : (isHuman(state.turn) ? 'press R' : 'thinking…'))
    });

    $('w-crowns').textContent = state.crowned.W;
    $('b-crowns').textContent = state.crowned.B;
    $('w-pips').textContent = R.pipCount(state, 'W');
    $('b-pips').textContent = R.pipCount(state, 'B');
    $('w-role').textContent = roleText('W');
    $('b-role').textContent = roleText('B');
    document.querySelector('.side-w').classList.toggle('on', state.turn === 'W' && !state.winner);
    document.querySelector('.side-b').classList.toggle('on', state.turn === 'B' && !state.winner);

    $('turn-line').innerHTML = state.winner
      ? '<b>' + name(state.winner) + '</b> wins'
      : '<b>' + name(state.turn) + '</b> ' + (state.roll ? 'to play' : 'to roll');

    const canRoll = !state.winner && !state.roll && isHuman(state.turn) && !busy;
    $('roll').disabled = !canRoll;
    $('undo').disabled = !(isHuman(state.turn) && prefix.length && !busy);

    if (state.winner) setHint('');
    else if (!state.roll) setHint(isHuman(state.turn) ? 'Roll to start your turn.' : '');
    else if (!plays.length) setHint('No legal play — the roll is lost.');
    else if (!isHuman(state.turn)) setHint('');
    else if (sel && variants.length > 1) {
      setHint('This point holds a runner and a supporter. Click it again to move the other one.');
    } else if (sel) {
      setHint('Click a marked point to move there.' + (t.some(m => m.crowns) ? '  ♛ takes a crown.' : ''));
    } else if (state.bar[state.turn === 'W' ? 'w' : 'b'] > 0) {
      setHint('You are on the bar — that checker comes in first.');
    } else {
      setHint('Click a checker, then click where it should go.');
    }
  }

  /* ---- wiring ---------------------------------------------------------- */

  function readPlayers() {
    players.W = $('white-player').value;
    players.B = $('black-player').value;
  }

  window.addEventListener('DOMContentLoaded', () => {
    B.init($('board'), pick);
    readPlayers();

    $('new-game').addEventListener('click', newGame);
    $('roll').addEventListener('click', () => {
      if (!state.winner && !state.roll && isHuman(state.turn)) beginTurn();
    });
    $('undo').addEventListener('click', undo);
    ['white-player', 'black-player'].forEach(id => {
      $(id).addEventListener('change', () => {
        readPlayers();
        draw();
        if (!state.roll && !state.winner) maybeAutoRoll();
      });
    });

    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'SELECT') return;
      const k = e.key.toLowerCase();
      if (k === 'n') { newGame(); }
      else if (k === 'r') { if (!$('roll').disabled) beginTurn(); }
      else if (k === 'u') { undo(); }
    });

    newGame();
  });

})(typeof window !== 'undefined' ? window : globalThis);
