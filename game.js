(() => {
  const canvas = document.getElementById('rink');
  const ctx = canvas.getContext('2d');

  const W = canvas.width;
  const H = canvas.height;

  // ---- Rink geometry ----
  const SIDE_L = 60;
  const SIDE_R = W - 60;
  const HOUSE_X = W / 2;
  const HOUSE_Y = 140;
  const RINGS = [
    { r: 130, color: '#3a6ea8' },
    { r: 90, color: '#f2f5f8' },
    { r: 45, color: '#c23b3b' },
    { r: 14, color: '#f2f5f8' },
  ];
  const TEE_LINE_Y = HOUSE_Y;
  const BACK_LINE_Y = 15;
  const FAR_HOG_Y = HOUSE_Y + 180;
  const HACK_Y = H - 60;
  const STONE_R = 13;

  // ---- Physics tuning ----
  const MAX_DRAG = 150;
  const MAX_POWER_SPEED = 480; // px/s
  const BASE_FRICTION = 50; // px/s^2, ice speed on end 1
  const ICE_SPEEDUP_PER_END = 0.04; // ice gets ~4% faster (less friction) each end
  const MIN_ICE_FRICTION_MULT = 0.75; // floor so ice can't get faster than this
  const SWEEP_FRICTION_MULT = 0.55;
  const CURL_ACCEL = 24; // px/s^2, perpendicular
  const SWEEP_CURL_MULT = 0.45;
  const STOP_SPEED = 4; // px/s below which a stone is considered stopped
  const MAX_PICKS_PER_GAME = 2;
  const PICK_CHANCE_PER_SEC = 0.04; // chance per second an unswept sliding stone picks
  const PICK_ANGLE_MIN = 15 * (Math.PI / 180);
  const PICK_ANGLE_MAX = 35 * (Math.PI / 180);
  const MAX_BURNS_PER_GAME = 1;
  const BURN_CHANCE_PER_SEC = 0.015; // chance per second a sliding stone gets burned

  // ---- Intro (bagpiper) ----
  const INTRO_MARCH_DURATION = 2.2;
  const INTRO_SHOT_DURATION = 1.1;
  const INTRO_SHOUT_DURATION = 1.4;
  const INTRO_FADE_DURATION = 0.5;

  const GAME_MODES = {
    standard: { stonesPerTeam: 8, players: 4, label: 'Standard' },
    doubles: { stonesPerTeam: 5, players: 2, label: 'Doubles' },
  };
  const TEAMS = ['red', 'yellow'];
  const TEAM_COLORS = { red: '#c23b3b', yellow: '#e0b020' };
  const COMPUTER_TEAM = 'yellow'; // the team the computer controls in single-team mode
  const AI_THINK_DELAY_MIN = 700; // ms
  const AI_THINK_DELAY_MAX = 1200; // ms
  const AI_TAKEOUT_POWER_MIN = 0.6;
  const AI_TAKEOUT_POWER_RANGE = 0.08;
  const AI_DRAW_POWER_MIN = 0.48;
  const AI_DRAW_POWER_RANGE = 0.09;
  const AI_AIM_WOBBLE = 22; // px of random aim error at the target

  // ---- DOM ----
  const scoreRedEl = document.getElementById('score-red');
  const scoreYellowEl = document.getElementById('score-yellow');
  const teamRedEl = document.getElementById('team-red');
  const teamYellowEl = document.getElementById('team-yellow');
  const teamNameRedEl = document.getElementById('team-name-red');
  const teamNameYellowEl = document.getElementById('team-name-yellow');
  const startOverlay = document.getElementById('start-overlay');
  const inputTeamRed = document.getElementById('input-team-red');
  const inputTeamYellow = document.getElementById('input-team-yellow');
  const opponentSingleBtn = document.getElementById('opponent-single');
  const opponentTwoBtn = document.getElementById('opponent-two');
  const labelTeamYellow = document.getElementById('label-team-yellow');
  const modeStandardBtn = document.getElementById('mode-standard');
  const modeDoublesBtn = document.getElementById('mode-doubles');
  const selectEnds = document.getElementById('select-ends');
  const startGameBtn = document.getElementById('start-game-btn');
  const endLabelEl = document.getElementById('end-label');
  const turnLabelEl = document.getElementById('turn-label');
  const stonesLeftEl = document.getElementById('stones-left');
  const curlLeftBtn = document.getElementById('curl-left');
  const curlRightBtn = document.getElementById('curl-right');
  const sweepBtn = document.getElementById('sweep-btn');
  const endOverlay = document.getElementById('end-overlay');
  const endOverlayTitle = document.getElementById('end-overlay-title');
  const endOverlayText = document.getElementById('end-overlay-text');
  const nextEndBtn = document.getElementById('next-end-btn');
  const toastEl = document.getElementById('toast');
  let toastTimer = null;

  // ---- Game state ----
  let state = {
    started: false, // true once team names are set and the game has begun
    teamNames: { red: 'Red', yellow: 'Yellow' },
    opponentMode: 'single', // 'single' (vs computer) or 'two-team' (pass and play)
    aiPending: false, // true while the computer's next shot is "thinking"
    mode: 'standard',
    totalShots: GAME_MODES.standard.stonesPerTeam * 2,
    endNumber: 1,
    totalEnds: 8,
    gameOver: false,
    startingTeamIndex: 0, // which team throws first this end
    shotIndex: 0, // 0..totalShots-1, whose turn it is this end
    stones: [], // {x, y, vx, vy, team, resting, outOfPlay}
    curlDir: -1, // -1 left, +1 right
    sweeping: false,
    sliding: false, // true while a thrown stone is in motion
    scores: { red: 0, yellow: 0 },
    dragging: false,
    dragStart: null,
    dragCurrent: null,
    endOver: false,
    picksUsed: 0, // how many times a stone has picked this game, capped at MAX_PICKS_PER_GAME
    burnsUsed: 0, // how many stones have been burned this game, capped at MAX_BURNS_PER_GAME
    intro: null, // { phase: 'march'|'shot'|'shout'|'fade', elapsed } while the bagpiper intro plays
  };

  function teamName(team) {
    return state.teamNames[team];
  }

  function currentIceFriction() {
    const mult = Math.max(MIN_ICE_FRICTION_MULT, 1 - (state.endNumber - 1) * ICE_SPEEDUP_PER_END);
    return BASE_FRICTION * mult;
  }

  function currentTeam() {
    const order = state.startingTeamIndex === 0 ? TEAMS : [TEAMS[1], TEAMS[0]];
    return order[state.shotIndex % 2];
  }

  function shotsRemaining() {
    return state.totalShots - state.shotIndex;
  }

  function resetEndStones() {
    state.stones = [];
    state.shotIndex = 0;
    state.endOver = false;
    endOverlay.classList.remove('visible');
    updateUI();
    maybeComputerTurn();
  }

  function startNewGame() {
    state.scores = { red: 0, yellow: 0 };
    state.endNumber = 1;
    state.gameOver = false;
    state.startingTeamIndex = 0;
    state.picksUsed = 0;
    state.burnsUsed = 0;
    resetEndStones();
  }

  function setOpponentMode(opponentMode) {
    state.opponentMode = opponentMode;
    opponentSingleBtn.classList.toggle('selected', opponentMode === 'single');
    opponentTwoBtn.classList.toggle('selected', opponentMode === 'two-team');
    labelTeamYellow.textContent = opponentMode === 'single' ? 'Computer team' : 'Yellow team';
    inputTeamYellow.placeholder = opponentMode === 'single' ? 'Joshua' : 'Yellow';
  }
  opponentSingleBtn.addEventListener('click', () => setOpponentMode('single'));
  opponentTwoBtn.addEventListener('click', () => setOpponentMode('two-team'));
  setOpponentMode('single');

  function setMode(mode) {
    state.mode = mode;
    state.totalShots = GAME_MODES[mode].stonesPerTeam * 2;
    modeStandardBtn.classList.toggle('selected', mode === 'standard');
    modeDoublesBtn.classList.toggle('selected', mode === 'doubles');
  }
  modeStandardBtn.addEventListener('click', () => setMode('standard'));
  modeDoublesBtn.addEventListener('click', () => setMode('doubles'));
  setMode('standard');

  function startGame() {
    state.teamNames.red = inputTeamRed.value.trim() || 'Red';
    const yellowDefault = state.opponentMode === 'single' ? 'Joshua' : 'Yellow';
    state.teamNames.yellow = inputTeamYellow.value.trim() || yellowDefault;
    teamNameRedEl.textContent = state.teamNames.red;
    teamNameYellowEl.textContent = state.teamNames.yellow;
    state.totalEnds = parseInt(selectEnds.value, 10);
    startOverlay.classList.remove('visible');
    state.intro = { phase: 'march', elapsed: 0 };
  }

  function updateIntro(dt) {
    const intro = state.intro;
    if (!intro) return;
    intro.elapsed += dt;
    if (intro.phase === 'march' && intro.elapsed >= INTRO_MARCH_DURATION) {
      intro.phase = 'shot';
      intro.elapsed = 0;
    } else if (intro.phase === 'shot' && intro.elapsed >= INTRO_SHOT_DURATION) {
      intro.phase = 'shout';
      intro.elapsed = 0;
    } else if (intro.phase === 'shout' && intro.elapsed >= INTRO_SHOUT_DURATION) {
      intro.phase = 'fade';
      intro.elapsed = 0;
    } else if (intro.phase === 'fade' && intro.elapsed >= INTRO_FADE_DURATION) {
      finishIntro();
    }
  }

  function finishIntro() {
    state.intro = null;
    state.started = true;
    startNewGame();
  }

  startGameBtn.addEventListener('click', startGame);
  [inputTeamRed, inputTeamYellow].forEach((input) => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') startGame();
    });
  });

  // ---- Input: aiming via drag (slingshot) ----
  function hackPos() {
    return { x: HOUSE_X, y: HACK_Y };
  }

  function canAim() {
    if (state.opponentMode === 'single' && currentTeam() === COMPUTER_TEAM) return false;
    return state.started && !state.sliding && !state.endOver && shotsRemaining() > 0;
  }

  function getPointer(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  function onPointerDown(e) {
    if (state.intro) {
      finishIntro();
      e.preventDefault();
      return;
    }
    if (!canAim()) return;
    const p = getPointer(e);
    const hack = hackPos();
    const dist = Math.hypot(p.x - hack.x, p.y - hack.y);
    if (dist < 50) {
      state.dragging = true;
      state.dragStart = hack;
      state.dragCurrent = p;
      e.preventDefault();
    }
  }

  function onPointerMove(e) {
    if (!state.dragging) return;
    state.dragCurrent = getPointer(e);
    e.preventDefault();
  }

  function onPointerUp(e) {
    if (!state.dragging) return;
    state.dragging = false;
    const hack = state.dragStart;
    const cur = state.dragCurrent;
    let dx = hack.x - cur.x;
    let dy = hack.y - cur.y;
    let dist = Math.hypot(dx, dy);
    if (dist < 12) return; // too small, treat as cancelled
    dist = Math.min(dist, MAX_DRAG);
    const power = dist / MAX_DRAG;
    const angle = Math.atan2(dy, dx);
    throwStone(angle, power, state.curlDir);
  }

  function throwStone(angle, power, curlDir) {
    const hack = hackPos();
    const speed = power * MAX_POWER_SPEED;
    const stone = {
      x: hack.x,
      y: hack.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      team: currentTeam(),
      resting: false,
      outOfPlay: false,
      curlDir,
      picked: false,
      burned: false,
      peelWeight: power >= 1,
      hasRestedBefore: false,
    };
    state.stones.push(stone);
    state.sliding = true;
    updateUI();
    if (stone.peelWeight) showToast('Peel Weight!');
  }

  // ---- Computer opponent (single-team mode) ----
  function chooseAiShot() {
    const myTeam = currentTeam();
    const inPlay = state.stones.filter((s) => !s.outOfPlay);
    const distToButton = (s) => Math.hypot(s.x - HOUSE_X, s.y - HOUSE_Y);
    const opponentInHouse = inPlay
      .filter((s) => s.team !== myTeam && distToButton(s) <= RINGS[0].r)
      .sort((a, b) => distToButton(a) - distToButton(b));

    let targetX;
    let targetY;
    let power;
    if (opponentInHouse.length > 0 && Math.random() < 0.7) {
      const target = opponentInHouse[0];
      targetX = target.x;
      targetY = target.y;
      power = AI_TAKEOUT_POWER_MIN + Math.random() * AI_TAKEOUT_POWER_RANGE;
    } else {
      targetX = HOUSE_X;
      targetY = HOUSE_Y;
      power = AI_DRAW_POWER_MIN + Math.random() * AI_DRAW_POWER_RANGE;
    }

    // Human-like imprecision.
    targetX += (Math.random() - 0.5) * AI_AIM_WOBBLE;
    targetY += (Math.random() - 0.5) * AI_AIM_WOBBLE;
    power = Math.min(1, Math.max(0.3, power + (Math.random() - 0.5) * 0.03));

    const hack = hackPos();
    const angle = Math.atan2(targetY - hack.y, targetX - hack.x);
    const curlDir = Math.random() < 0.5 ? -1 : 1;
    return { angle, power, curlDir };
  }

  function computerThrow() {
    const shot = chooseAiShot();
    throwStone(shot.angle, shot.power, shot.curlDir);
  }

  function maybeComputerTurn() {
    if (state.opponentMode !== 'single') return;
    if (!state.started || state.intro || state.sliding || state.endOver || state.dragging) return;
    if (state.aiPending || shotsRemaining() <= 0) return;
    if (currentTeam() !== COMPUTER_TEAM) return;

    state.aiPending = true;
    const delay = AI_THINK_DELAY_MIN + Math.random() * (AI_THINK_DELAY_MAX - AI_THINK_DELAY_MIN);
    setTimeout(() => {
      state.aiPending = false;
      const stillComputersTurn = state.opponentMode === 'single' && state.started && !state.intro
        && !state.sliding && !state.endOver && !state.dragging
        && currentTeam() === COMPUTER_TEAM && shotsRemaining() > 0;
      if (stillComputersTurn) computerThrow();
    }, delay);
  }

  canvas.addEventListener('mousedown', onPointerDown);
  window.addEventListener('mousemove', onPointerMove);
  window.addEventListener('mouseup', onPointerUp);
  canvas.addEventListener('touchstart', onPointerDown, { passive: false });
  window.addEventListener('touchmove', onPointerMove, { passive: false });
  window.addEventListener('touchend', onPointerUp);

  // ---- Curl + sweep controls ----
  function setCurl(dir) {
    state.curlDir = dir;
    curlLeftBtn.classList.toggle('selected', dir === -1);
    curlRightBtn.classList.toggle('selected', dir === 1);
  }
  curlLeftBtn.addEventListener('click', () => setCurl(-1));
  curlRightBtn.addEventListener('click', () => setCurl(1));
  setCurl(-1);

  function setSweeping(on) {
    state.sweeping = on;
    sweepBtn.classList.toggle('sweeping', on);
  }
  sweepBtn.addEventListener('mousedown', () => setSweeping(true));
  sweepBtn.addEventListener('mouseup', () => setSweeping(false));
  sweepBtn.addEventListener('mouseleave', () => setSweeping(false));
  sweepBtn.addEventListener('touchstart', (e) => { e.preventDefault(); setSweeping(true); });
  sweepBtn.addEventListener('touchend', (e) => { e.preventDefault(); setSweeping(false); });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') { setSweeping(true); e.preventDefault(); }
    if (e.key === 'ArrowLeft' || e.key === 'a') setCurl(-1);
    if (e.key === 'ArrowRight' || e.key === 'd') setCurl(1);
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') { setSweeping(false); e.preventDefault(); }
  });

  nextEndBtn.addEventListener('click', () => {
    if (state.gameOver) {
      endOverlay.classList.remove('visible');
      startOverlay.classList.add('visible');
      return;
    }
    state.endNumber += 1;
    state.startingTeamIndex = 1 - state.startingTeamIndex;
    resetEndStones();
  });

  // ---- Physics update ----
  function updatePhysics(dt) {
    const moving = state.stones.filter((s) => !s.resting && !s.outOfPlay);
    if (moving.length === 0) {
      if (state.sliding) {
        state.sliding = false;
        maybeAdvanceTurn();
      }
      return;
    }

    const friction = currentIceFriction() * (state.sweeping ? SWEEP_FRICTION_MULT : 1);
    const curlAccel = CURL_ACCEL * (state.sweeping ? SWEEP_CURL_MULT : 1);

    for (const stone of moving) {
      const speed = Math.hypot(stone.vx, stone.vy);
      if (speed > STOP_SPEED) {
        // Friction opposes velocity direction.
        const fx = -(stone.vx / speed) * friction;
        const fy = -(stone.vy / speed) * friction;

        // Curl: lateral accel perpendicular to velocity direction.
        const perpX = -(stone.vy / speed);
        const perpY = (stone.vx / speed);
        const cx = perpX * curlAccel * stone.curlDir;
        const cy = perpY * curlAccel * stone.curlDir;

        stone.vx += (fx + cx) * dt;
        stone.vy += (fy + cy) * dt;
        stone.x += stone.vx * dt;
        stone.y += stone.vy * dt;

        maybeTriggerPick(stone, dt);
        maybeTriggerBurn(stone, dt);
      } else {
        stone.vx = 0;
        stone.vy = 0;
        stone.resting = true;
        finalizeStoneRest(stone);
      }
    }

    // Resolve collisions across every in-play pair, not just the stone(s)
    // that were moving at the start of this frame, since a hit stone can
    // become newly moving mid-frame.
    const active = state.stones.filter((s) => !s.outOfPlay);
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i];
        const b = active[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.hypot(dx, dy);
        const minDist = STONE_R * 2;
        if (dist > 0 && dist < minDist) {
          resolveCollision(a, b, dx, dy, dist, minDist);
        }
      }
    }

    for (const stone of moving) {
      checkBounds(stone);
    }
  }

  function resolveCollision(a, b, dx, dy, dist, minDist) {
    const nx = dx / dist;
    const ny = dy / dist;
    const overlap = minDist - dist;
    // Separate so they don't stick.
    a.x += nx * overlap * 0.5;
    a.y += ny * overlap * 0.5;
    b.x -= nx * overlap * 0.5;
    b.y -= ny * overlap * 0.5;

    // Equal-mass elastic collision: swap the velocity components along the
    // collision normal, keep the tangential components.
    const avn = a.vx * nx + a.vy * ny;
    const bvn = b.vx * nx + b.vy * ny;
    const avt_x = a.vx - avn * nx;
    const avt_y = a.vy - avn * ny;
    const bvt_x = b.vx - bvn * nx;
    const bvt_y = b.vy - bvn * ny;

    a.vx = avt_x + bvn * nx;
    a.vy = avt_y + bvn * ny;
    b.vx = bvt_x + avn * nx;
    b.vy = bvt_y + avn * ny;

    if (a.resting && (Math.abs(a.vx) > 0.01 || Math.abs(a.vy) > 0.01)) {
      a.resting = false;
    }
    if (b.resting && (Math.abs(b.vx) > 0.01 || Math.abs(b.vy) > 0.01)) {
      b.resting = false;
    }
  }

  function maybeTriggerPick(stone, dt) {
    if (stone.picked || state.sweeping || state.picksUsed >= MAX_PICKS_PER_GAME) return;
    if (Math.random() >= PICK_CHANCE_PER_SEC * dt) return;

    stone.picked = true;
    state.picksUsed += 1;

    const magnitude = PICK_ANGLE_MIN + Math.random() * (PICK_ANGLE_MAX - PICK_ANGLE_MIN);
    const angle = Math.random() < 0.5 ? -magnitude : magnitude;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const vx = stone.vx;
    const vy = stone.vy;
    stone.vx = vx * cos - vy * sin;
    stone.vy = vx * sin + vy * cos;

    showToast('Stone Picked! Clean the ice!');
  }

  function maybeTriggerBurn(stone, dt) {
    if (!state.sweeping || stone.burned || state.burnsUsed >= MAX_BURNS_PER_GAME) return;
    if (Math.random() >= BURN_CHANCE_PER_SEC * dt) return;

    stone.burned = true;
    stone.outOfPlay = true;
    stone.resting = true;
    state.burnsUsed += 1;

    showToast('Burned Stone! 🔥');
  }

  function showToast(text) {
    toastEl.textContent = text;
    toastEl.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('visible'), 3000);
  }

  function checkBounds(stone) {
    if (stone.outOfPlay) return;
    const outLeft = stone.x - STONE_R < SIDE_L;
    const outRight = stone.x + STONE_R > SIDE_R;
    const outBack = stone.y < BACK_LINE_Y;
    if (outLeft || outRight || outBack) {
      stone.outOfPlay = true;
      stone.resting = true;
      finalizeStoneRest(stone);
    }
  }

  function finalizeStoneRest(stone) {
    // A stone that stops touching or short of the hog line (hasn't fully crossed it) is "hogged" and
    // removed — but only on its own original delivery. A stone that already cleared the hog line on
    // an earlier shot and later gets knocked back behind it by a hit is not re-hogged.
    if (!stone.hasRestedBefore && !stone.outOfPlay && stone.y + STONE_R >= FAR_HOG_Y) {
      stone.outOfPlay = true;
      showToast('Hogged! 🐷');
    }
    stone.hasRestedBefore = true;
  }

  function maybeAdvanceTurn() {
    state.shotIndex += 1;
    if (state.shotIndex >= state.totalShots) {
      finishEnd();
    } else {
      updateUI();
      maybeComputerTurn();
    }
  }

  function finishEnd() {
    const inPlay = state.stones.filter((s) => !s.outOfPlay);
    const dist = (s) => Math.hypot(s.x - HOUSE_X, s.y - HOUSE_Y);
    const eligible = inPlay.filter((s) => dist(s) <= RINGS[0].r);

    let text;
    if (eligible.length === 0) {
      text = 'No stones in the house. Blank end — no points scored.';
    } else {
      const byTeam = { red: [], yellow: [] };
      eligible.forEach((s) => byTeam[s.team].push(dist(s)));
      byTeam.red.sort((a, b) => a - b);
      byTeam.yellow.sort((a, b) => a - b);
      const redBest = byTeam.red[0] ?? Infinity;
      const yellowBest = byTeam.yellow[0] ?? Infinity;
      const leader = redBest < yellowBest ? 'red' : 'yellow';
      const leaderDists = byTeam[leader];
      const opponentBest = leader === 'red' ? yellowBest : redBest;
      const count = leaderDists.filter((d) => d < opponentBest).length;
      state.scores[leader] += count;
      text = `${teamName(leader)} scores ${count} point${count === 1 ? '' : 's'} this end.`;
    }

    state.endOver = true;
    state.gameOver = state.endNumber >= state.totalEnds;

    if (state.gameOver) {
      const redScore = state.scores.red;
      const yellowScore = state.scores.yellow;
      let winnerText;
      if (redScore === yellowScore) {
        winnerText = "It's a tie game!";
      } else {
        const winner = redScore > yellowScore ? 'red' : 'yellow';
        winnerText = `${teamName(winner)} wins the game!`;
      }
      endOverlayTitle.textContent = 'Game complete';
      endOverlayText.textContent = `${text} Final score: ${teamName('red')} ${redScore} – ${teamName('yellow')} ${yellowScore}. ${winnerText}`;
      nextEndBtn.textContent = 'New game';
    } else {
      endOverlayTitle.textContent = `End ${state.endNumber} complete`;
      endOverlayText.textContent = text;
      nextEndBtn.textContent = 'Play next end';
    }
    endOverlay.classList.add('visible');
    updateUI();
  }

  function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // ---- Rendering ----
  function drawRink() {
    ctx.fillStyle = '#dce9f0';
    ctx.fillRect(0, 0, W, H);

    // Sidelines
    ctx.strokeStyle = '#9fc3d6';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(SIDE_L, 0); ctx.lineTo(SIDE_L, H);
    ctx.moveTo(SIDE_R, 0); ctx.lineTo(SIDE_R, H);
    ctx.stroke();

    // Back line, tee line, far hog line, hack
    drawLine(BACK_LINE_Y, '#9fc3d6');
    drawLine(TEE_LINE_Y, '#9fc3d6');
    drawLine(FAR_HOG_Y, '#d9a441');

    drawHouse();

    // Hack marker
    ctx.fillStyle = '#334568';
    ctx.fillRect(HOUSE_X - 10, HACK_Y + 10, 20, 6);
  }

  function drawLine(y, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(SIDE_L, y);
    ctx.lineTo(SIDE_R, y);
    ctx.stroke();
  }

  function drawHouse() {
    for (const ring of RINGS) {
      ctx.beginPath();
      ctx.arc(HOUSE_X, HOUSE_Y, ring.r, 0, Math.PI * 2);
      ctx.fillStyle = ring.color;
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(HOUSE_X - RINGS[0].r, HOUSE_Y);
    ctx.lineTo(HOUSE_X + RINGS[0].r, HOUSE_Y);
    ctx.moveTo(HOUSE_X, HOUSE_Y - RINGS[0].r);
    ctx.lineTo(HOUSE_X, HOUSE_Y + RINGS[0].r);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function drawStones() {
    for (const s of state.stones) {
      if (s.outOfPlay) continue;
      drawStone(s.x, s.y, s.team);
    }
  }

  function drawStone(x, y, team) {
    ctx.beginPath();
    ctx.arc(x, y, STONE_R, 0, Math.PI * 2);
    ctx.fillStyle = TEAM_COLORS[team];
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, STONE_R * 0.4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fill();
  }

  function drawNextStonePreview() {
    if (!state.started || state.sliding || state.endOver || shotsRemaining() <= 0) return;
    const hack = hackPos();
    drawStone(hack.x, hack.y, currentTeam());
  }

  function drawAimIndicator() {
    if (!state.dragging) return;
    const hack = state.dragStart;
    const cur = state.dragCurrent;
    let dx = hack.x - cur.x;
    let dy = hack.y - cur.y;
    let dist = Math.min(Math.hypot(dx, dy), MAX_DRAG);
    const angle = Math.atan2(dy, dx);
    const endX = hack.x + Math.cos(angle) * dist;
    const endY = hack.y + Math.sin(angle) * dist;

    ctx.beginPath();
    ctx.moveTo(hack.x, hack.y);
    ctx.lineTo(endX, endY);
    ctx.strokeStyle = `rgba(194, 59, 59, ${0.4 + 0.5 * (dist / MAX_DRAG)})`;
    ctx.lineWidth = 4;
    ctx.stroke();

    // Power meter
    const pct = Math.round((dist / MAX_DRAG) * 100);
    ctx.fillStyle = '#152238';
    ctx.font = pct >= 100 ? 'bold 24px sans-serif' : 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    const label = pct >= 100 ? `${pct}% — Peel Weight!` : `${pct}% power`;
    ctx.fillText(label, hack.x, hack.y - 36);
  }

  // ---- Intro: bagpiper ----
  function roundRectPath(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawSpeechBubble(x, y, text) {
    ctx.font = 'bold 16px sans-serif';
    const paddingX = 14;
    const h = 30;
    const w = ctx.measureText(text).width + paddingX * 2;
    const left = x - w / 2;
    const top = y - h;

    roundRectPath(left, top, w, h, 10);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.strokeStyle = '#152238';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x - 7, top + h - 1);
    ctx.lineTo(x + 7, top + h - 1);
    ctx.lineTo(x, top + h + 10);
    ctx.closePath();
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.strokeStyle = '#152238';
    ctx.stroke();

    ctx.fillStyle = '#152238';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, top + h / 2 + 1);
    ctx.textBaseline = 'alphabetic';
  }

  function drawBagpiper(x, y, elapsed, phase) {
    const walking = phase === 'march';
    const stride = walking ? Math.sin(elapsed * 9) : 0;
    const drinking = phase === 'shot';

    ctx.save();
    ctx.translate(x, y);

    // Legs
    ctx.strokeStyle = '#1b2a44';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-4, 14); ctx.lineTo(-4 + stride * 7, 32);
    ctx.moveTo(4, 14); ctx.lineTo(4 - stride * 7, 32);
    ctx.stroke();

    // Kilt
    ctx.fillStyle = '#8c2f2f';
    ctx.beginPath();
    ctx.moveTo(-10, -1); ctx.lineTo(10, -1); ctx.lineTo(7, 15); ctx.lineTo(-7, 15);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#2a1414';
    ctx.lineWidth = 1;
    for (let i = -8; i <= 8; i += 4) {
      ctx.beginPath();
      ctx.moveTo(i, -1);
      ctx.lineTo(i * 0.7, 15);
      ctx.stroke();
    }

    // Torso (jacket)
    ctx.fillStyle = '#1b3a2e';
    ctx.fillRect(-9, -23, 18, 23);

    // Arms + bagpipe or dram
    ctx.strokeStyle = '#1b3a2e';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-9, -17); ctx.lineTo(-17, -6);
    ctx.moveTo(9, -17);
    if (drinking) {
      ctx.lineTo(13, -32);
    } else {
      ctx.lineTo(16, -6);
    }
    ctx.stroke();

    if (drinking) {
      ctx.fillStyle = '#c7902a';
      ctx.fillRect(9, -38, 7, 11);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('🥃', 24, -30);
    } else {
      // Bagpipe bag
      ctx.fillStyle = '#d7b98e';
      ctx.beginPath();
      ctx.ellipse(-17, -15, 7, 10, 0.3, 0, Math.PI * 2);
      ctx.fill();
      // Drones
      ctx.strokeStyle = '#6b4a2b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-19, -21); ctx.lineTo(-25, -41);
      ctx.moveTo(-15, -23); ctx.lineTo(-19, -43);
      ctx.moveTo(-11, -21); ctx.lineTo(-13, -39);
      ctx.stroke();
    }

    // Head
    ctx.fillStyle = '#e8c39e';
    ctx.beginPath();
    ctx.arc(0, -29, 7, 0, Math.PI * 2);
    ctx.fill();

    // Feather bonnet
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(0, -34, 7, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#c23b3b';
    ctx.beginPath();
    ctx.arc(5, -39, 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawIntroScene() {
    const intro = state.intro;
    if (!intro) return;

    let piperX;
    if (intro.phase === 'march') {
      const t = Math.min(intro.elapsed / INTRO_MARCH_DURATION, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      piperX = (SIDE_L - 40) + (HOUSE_X - (SIDE_L - 40)) * eased;
    } else {
      piperX = HOUSE_X;
    }
    const piperY = FAR_HOG_Y;

    drawBagpiper(piperX, piperY, intro.elapsed, intro.phase);

    if (intro.phase === 'shout') {
      drawSpeechBubble(piperX, piperY - 75, 'Good Curling!');
    }

    if (intro.phase !== 'fade') {
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Tap to skip', HOUSE_X, H - 20);
    }

    if (intro.phase === 'fade') {
      const alpha = Math.min(intro.elapsed / INTRO_FADE_DURATION, 1);
      ctx.fillStyle = `rgba(13,21,38,${alpha})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function render() {
    drawRink();
    if (state.intro) {
      drawIntroScene();
    } else {
      drawStones();
      drawNextStonePreview();
      drawAimIndicator();
    }
  }

  // ---- UI sync ----
  function updateUI() {
    scoreRedEl.textContent = state.scores.red;
    scoreYellowEl.textContent = state.scores.yellow;
    endLabelEl.textContent = `End ${state.endNumber}`;

    const team = currentTeam();
    teamRedEl.classList.toggle('active', team === 'red' && !state.endOver);
    teamYellowEl.classList.toggle('active', team === 'yellow' && !state.endOver);

    if (state.endOver) {
      turnLabelEl.textContent = 'End complete';
      stonesLeftEl.textContent = '';
    } else {
      turnLabelEl.textContent = `${teamName(team)}'s throw`;
      const left = shotsRemaining();
      stonesLeftEl.textContent = `${left} stone${left === 1 ? '' : 's'} left`;
    }
  }

  // ---- Main loop ----
  let lastTime = null;
  function loop(ts) {
    if (lastTime === null) lastTime = ts;
    const dt = Math.min((ts - lastTime) / 1000, 0.05);
    lastTime = ts;

    if (state.intro) {
      updateIntro(dt);
    } else {
      updatePhysics(dt);
    }
    render();

    requestAnimationFrame(loop);
  }

  startNewGame();
  requestAnimationFrame(loop);
})();
