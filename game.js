/* ================================================
   CFC — ColorFill Clash  |  game.js  v1.2
   ================================================ */

// ── DIFFICULTY → MAP SIZE ─────────────────────────
const DIFFICULTY_CONFIG = {
  easy:   { rows: 10, cols: 12, powerupCount: 3, powerupBand: { minRow: 3,  maxRow: 6  } },
  medium: { rows: 16, cols: 18, powerupCount: 5, powerupBand: { minRow: 5,  maxRow: 10 } },
  hard:   { rows: 22, cols: 24, powerupCount: 7, powerupBand: { minRow: 7,  maxRow: 14 } },
};

// ── CONSTANTS ─────────────────────────────────────
const COLORS      = ['#e05a5a','#4fc3f7','#e0c95a','#7be05a','#c45ae0','#e08e5a'];
const COLOR_NAMES = ['Red','Blue','Yellow','Green','Purple','Orange'];
const AI_DELAY    = 600;
const MAX_ROWS    = 25;
const MAX_COLS    = 40;

// Runtime dimensions
let ROWS = 16;
let COLS = 18;

// ── POWERUP DEFINITIONS ───────────────────────────
// "placeable" = true means the player picks the cell on the board
const POWERUPS = {
  shuffle: {
    emoji: '🔀',
    name: 'Shuffle Zone',
    desc: 'Randomly re-colors a 3×3 block of unclaimed cells in the center.',
    placeable: false,
    apply: (state) => applyShufflePowerup(state),
  },
  block: {
    emoji: '🔒',
    name: 'Barrier',
    desc: 'Place a neutral barrier cell anywhere on an unclaimed tile to slow the AI\'s expansion. Click a cell on the board to place it.',
    placeable: true,
    apply: (state, r, c) => applyBlockPowerup(state, r, c),
  },
  steal: {
    emoji: '🎯',
    name: 'Steal',
    desc: 'Click any AI-owned border cell to convert it and its immediate AI neighbors (up to 3) to your color.',
    placeable: true,
    apply: (state, r, c) => applyStealPowerup(state, r, c),
  },
  doubleMove: {
    emoji: '⏩',
    name: 'Double Turn',
    desc: 'You get to pick two colors this turn — expand twice in a row!',
    placeable: false,
    apply: (state) => applyDoublePowerup(state),
  },
};
const POWERUP_KEYS = Object.keys(POWERUPS);

// ── STATE ─────────────────────────────────────────
let state = {};

// Placement mode state
let placementMode = null; // { slot, puKey } or null

function getOppositeCorner(corner) {
  const map = { tl: 'br', tr: 'bl', bl: 'tr', br: 'tl' };
  return map[corner];
}

function cornerToCell(corner, rows, cols) {
  switch (corner) {
    case 'tl': return [0, 0];
    case 'tr': return [0, cols - 1];
    case 'bl': return [rows - 1, 0];
    case 'br': return [rows - 1, cols - 1];
  }
}

function initState(config) {
  const { difficulty, rows, cols, powerupCount, playerCorner, timerSeconds } = config;
  ROWS = Math.min(rows, MAX_ROWS);
  COLS = Math.min(cols, MAX_COLS);

  const grid = [];
  for (let r = 0; r < ROWS; r++) {
    grid.push([]);
    for (let c = 0; c < COLS; c++) {
      grid[r].push({
        color:   COLORS[Math.floor(Math.random() * COLORS.length)],
        owner:   null,
        powerup: null,
      });
    }
  }

  // Assign corners
  const aiCorner = getOppositeCorner(playerCorner);
  const [pr, pc] = cornerToCell(playerCorner, ROWS, COLS);
  const [ar, ac] = cornerToCell(aiCorner, ROWS, COLS);

  grid[pr][pc].color = COLORS[0];
  grid[ar][ac].color = COLORS[3];
  if (grid[pr][pc].color === grid[ar][ac].color) grid[ar][ac].color = COLORS[2];

  grid[pr][pc].owner = 'player';
  grid[ar][ac].owner = 'ai';

  // Scatter powerups in the middle band
  const minRow = Math.floor(ROWS * 0.3);
  const maxRow = Math.floor(ROWS * 0.7);
  let placed = 0;
  for (let i = 0; i < 800 && placed < powerupCount; i++) {
    const r = minRow + Math.floor(Math.random() * (maxRow - minRow + 1));
    const c = 1 + Math.floor(Math.random() * (COLS - 2));
    if (!grid[r][c].powerup && !grid[r][c].owner) {
      grid[r][c].powerup = POWERUP_KEYS[placed % POWERUP_KEYS.length];
      placed++;
    }
  }

  return {
    grid,
    config,
    difficulty,
    rows: ROWS,
    cols: COLS,
    playerCorner,
    aiCorner,
    playerPos: [pr, pc],
    aiPos: [ar, ac],
    playerColor:     grid[pr][pc].color,
    aiColor:         grid[ar][ac].color,
    aiLastColor:     grid[ar][ac].color,
    playerLastColor: null,
    turn:            'player',
    inventory:       [null, null],
    pendingDouble:   false,
    gameOver:        false,
    timerSeconds:    timerSeconds || 0,
    timerRemaining:  timerSeconds || 0,
    timerInterval:   null,
    timedOut:        false,
  };
}

// ── FLOOD FILL ────────────────────────────────────
function floodFill(grid, owner, newColor) {
  const rows = grid.length;
  const cols = grid[0].length;
  const directions = [[-1,0],[1,0],[0,-1],[0,1]];
  const owned = new Set();
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      if (grid[r][c].owner === owner) owned.add(`${r},${c}`);

  const collected = [];
  const powerupsFound = [];
  const queue = [];

  for (const key of owned) {
    const [r,c] = key.split(',').map(Number);
    for (const [dr,dc] of directions) {
      const nr = r+dr, nc = c+dc;
      if (nr<0||nr>=rows||nc<0||nc>=cols) continue;
      const cell = grid[nr][nc];
      if (cell.owner !== null) continue;
      if (cell.color !== newColor) continue;
      queue.push([nr,nc]);
    }
  }

  const visited = new Set([...owned]);
  while (queue.length) {
    const [r,c] = queue.shift();
    const key = `${r},${c}`;
    if (visited.has(key)) continue;
    visited.add(key);
    const cell = grid[r][c];
    if (cell.owner !== null) continue;
    if (cell.color !== newColor) continue;

    if (cell.powerup && owner === 'player') powerupsFound.push(cell.powerup);

    cell.owner = owner;
    collected.push([r,c]);

    for (const [dr,dc] of directions) {
      const nr=r+dr, nc=c+dc;
      if (nr<0||nr>=rows||nc<0||nc>=cols) continue;
      if (!visited.has(`${nr},${nc}`)) queue.push([nr,nc]);
    }
  }

  for (let r=0; r<rows; r++)
    for (let c=0; c<cols; c++)
      if (grid[r][c].owner === owner) {
        grid[r][c].color  = newColor;
        grid[r][c].powerup = null;
      }

  return { collected, powerupsFound };
}

function countOwned(grid, owner) {
  let n = 0;
  for (let r=0; r<grid.length; r++)
    for (let c=0; c<grid[0].length; c++)
      if (grid[r][c].owner === owner) n++;
  return n;
}

function totalCells() { return ROWS * COLS; }

function unclaimedCount(grid) {
  let n = 0;
  for (let r=0; r<grid.length; r++)
    for (let c=0; c<grid[0].length; c++)
      if (!grid[r][c].owner) n++;
  return n;
}

function isGameOver(grid) { return unclaimedCount(grid) === 0; }

// ── AI LOGIC ──────────────────────────────────────
function aiChooseColor(state) {
  const { grid, difficulty } = state;
  const rows = grid.length, cols = grid[0].length;
  const blocked  = state.playerLastColor;
  const aiCurrent = state.aiColor;
  const eligible  = COLORS.filter(c => c !== blocked && c !== aiCurrent);

  if (eligible.length === 0) return COLORS.find(c => c !== blocked) || COLORS[0];
  if (difficulty === 'easy') return eligible[Math.floor(Math.random() * eligible.length)];

  const directions = [[-1,0],[1,0],[0,-1],[0,1]];

  function simGain(g, owner, color) {
    const r2 = g.length, c2 = g[0].length;
    const aiOwned = new Set();
    for (let r=0;r<r2;r++) for (let c=0;c<c2;c++) if (g[r][c].owner===owner) aiOwned.add(`${r},${c}`);
    const visited = new Set([...aiOwned]);
    const queue = [];
    for (const key of aiOwned) {
      const [r,c] = key.split(',').map(Number);
      for (const [dr,dc] of directions) {
        const nr=r+dr, nc=c+dc;
        if (nr<0||nr>=r2||nc<0||nc>=c2) continue;
        const cell = g[nr][nc];
        if (!visited.has(`${nr},${nc}`) && cell.owner===null && cell.color===color) queue.push([nr,nc]);
      }
    }
    let gain = 0;
    while(queue.length) {
      const [r,c] = queue.shift();
      const key = `${r},${c}`;
      if(visited.has(key)) continue;
      visited.add(key);
      if(g[r][c].owner!==null||g[r][c].color!==color) continue;
      gain++;
      for(const[dr,dc]of directions){
        const nr=r+dr,nc=c+dc;
        if(nr<0||nr>=r2||nc<0||nc>=c2) continue;
        if(!visited.has(`${nr},${nc}`)) queue.push([nr,nc]);
      }
    }
    return gain;
  }

  const scores = eligible.map(color => ({ color, gain: simGain(grid, 'ai', color) }));
  scores.sort((a,b) => b.gain - a.gain);

  if (difficulty === 'medium') return scores[0].color;

  const hardScores = scores.slice(0, 3).map(({ color, gain }) => {
    const simGrid = deepCopyGrid(grid);
    floodFill(simGrid, 'ai', color);
    const playerOptions = COLORS.filter(c => c !== color && c !== state.playerColor);
    const bestPlayerGain = Math.max(0, ...playerOptions.map(pc => simGain(simGrid, 'player', pc)));
    return { color, score: gain - bestPlayerGain * 0.5 };
  });
  hardScores.sort((a,b) => b.score - a.score);
  return hardScores[0].color;
}

function deepCopyGrid(grid) {
  return grid.map(row => row.map(cell => ({ ...cell })));
}

// ── POWERUP EFFECTS ───────────────────────────────
function applyShufflePowerup(state) {
  const { grid } = state;
  const rows = grid.length, cols = grid[0].length;
  const midR = Math.floor(rows / 2);
  const midC = Math.floor(cols / 2);
  let changed = 0;
  for (let r = midR-1; r <= midR+1; r++)
    for (let c = midC-1; c <= midC+1; c++)
      if (r>=0&&r<rows&&c>=0&&c<cols&&!grid[r][c].owner) {
        grid[r][c].color = COLORS[Math.floor(Math.random()*COLORS.length)];
        changed++;
      }
  return `Shuffled ${changed} cells in the center!`;
}

// Placeable: user clicks a cell
function applyBlockPowerup(state, r, c) {
  const { grid } = state;
  if (r < 0 || r >= grid.length || c < 0 || c >= grid[0].length) return null;
  if (grid[r][c].owner) return '⚠ That cell is already claimed!';
  grid[r][c].owner = 'barrier';
  grid[r][c].color = '#2a2a35';
  grid[r][c].powerup = null;
  return 'Barrier placed!';
}

// Placeable: user clicks an AI cell
function applyStealPowerup(state, r, c) {
  const { grid } = state;
  const rows = grid.length, cols = grid[0].length;
  const directions = [[-1,0],[1,0],[0,-1],[0,1]];

  if (!grid[r] || !grid[r][c] || grid[r][c].owner !== 'ai') {
    return '⚠ Pick an AI-owned cell to steal!';
  }

  const playerColor = state.playerColor;
  // Convert clicked cell + up to 2 adjacent AI cells
  const toSteal = [[r, c]];
  for (const [dr,dc] of directions) {
    const nr=r+dr, nc=c+dc;
    if (nr>=0&&nr<rows&&nc>=0&&nc<cols&&grid[nr][nc].owner==='ai') {
      toSteal.push([nr,nc]);
      if (toSteal.length >= 3) break;
    }
  }
  for (const [sr,sc] of toSteal) {
    grid[sr][sc].owner = 'player';
    grid[sr][sc].color = playerColor;
    grid[sr][sc].powerup = null;
  }
  return `Stole ${toSteal.length} cell${toSteal.length>1?'s':''} from the AI!`;
}

function applyDoublePowerup(state) {
  state.pendingDouble = true;
  return 'Double Turn — pick your next color!';
}

// ── PLACEMENT MODE ────────────────────────────────
function enterPlacementMode(slot, puKey) {
  placementMode = { slot, puKey };
  const pu = POWERUPS[puKey];
  const banner = document.getElementById('placement-banner');
  const bannerText = document.getElementById('placement-banner-text');

  let hint = '';
  if (puKey === 'block')  hint = '🔒 Click any unclaimed cell to place a Barrier';
  if (puKey === 'steal')  hint = '🎯 Click any AI-owned cell to steal it';

  bannerText.textContent = hint;
  banner.classList.remove('hidden');
  document.getElementById('powerup-panel').classList.add('hidden');

  // Highlight canvas to signal placement mode
  canvas.classList.add('placement-active');
  drawGrid([], true);
}

function exitPlacementMode(cancelled) {
  placementMode = null;
  document.getElementById('placement-banner').classList.add('hidden');
  canvas.classList.remove('placement-active');
  if (cancelled) {
    // Return powerup to inventory (already not consumed yet)
    updateInventory();
  }
  drawGrid();
}

// ── CANVAS RENDERING ──────────────────────────────
let canvas, ctx, cellW, cellH;

function setupCanvas() {
  canvas = document.getElementById('game-canvas');
  ctx = canvas.getContext('2d');

  const availW = Math.min(window.innerWidth - 16, 720);
  const availH = window.innerHeight - 260;
  const cellByW = Math.floor(availW / COLS);
  const cellByH = Math.floor(availH / ROWS);
  const cellSize = Math.min(cellByW, cellByH, 36);

  cellW = Math.max(cellSize, 4);
  cellH = Math.max(cellSize, 4);

  canvas.width  = cellW * COLS;
  canvas.height = cellH * ROWS;
  canvas.style.borderRadius = '12px';
}

function drawGrid(highlights = [], placementOverlay = false) {
  const { grid } = state;
  if (!grid) return;
  const rows = grid.length, cols = grid[0].length;
  const hl = new Set((highlights || []).map(([r,c]) => `${r},${c}`));

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (let r=0; r<rows; r++) {
    for (let c=0; c<cols; c++) {
      const cell = grid[r][c];
      const x = c * cellW, y = r * cellH;
      const key = `${r},${c}`;

      // In placement mode: dim non-targetable cells
      let dimmed = false;
      if (placementMode) {
        if (placementMode.puKey === 'block' && cell.owner !== null) dimmed = true;
        if (placementMode.puKey === 'steal' && cell.owner !== 'ai') dimmed = true;
      }

      let fillColor = cell.owner === 'barrier' ? '#1e1e28' : cell.color;
      ctx.globalAlpha = dimmed ? 0.25 : 1;
      ctx.fillStyle = fillColor;
      ctx.beginPath();
      roundRect(ctx, x+1, y+1, cellW-2, cellH-2, Math.min(3, cellW/4));
      ctx.fill();

      ctx.globalAlpha = 1;

      if (!dimmed) {
        if (cell.owner === 'player') {
          ctx.strokeStyle = 'rgba(79,195,247,0.75)';
          ctx.lineWidth = 2;
          ctx.stroke();
        } else if (cell.owner === 'ai') {
          ctx.strokeStyle = 'rgba(239,83,80,0.75)';
          ctx.lineWidth = 2;
          ctx.stroke();
        } else if (cell.owner === 'barrier') {
          ctx.strokeStyle = 'rgba(255,255,255,0.06)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      if (hl.has(key)) {
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = 'rgba(255,255,255,1)';
        ctx.beginPath();
        roundRect(ctx, x+1, y+1, cellW-2, cellH-2, Math.min(3, cellW/4));
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      if (cell.powerup && !cell.owner) {
        const fontSize = Math.max(8, Math.round(cellH * 0.55));
        ctx.font = `${fontSize}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.globalAlpha = dimmed ? 0.25 : 1;
        ctx.fillText(POWERUPS[cell.powerup].emoji, x + cellW/2, y + cellH/2);
        ctx.globalAlpha = 1;
      }

      // Placement mode: hover hint for valid cells
      if (placementOverlay && !dimmed && cell.owner !== 'player' && cell.owner !== 'barrier') {
        ctx.strokeStyle = 'rgba(255,229,102,0.5)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3,3]);
        ctx.beginPath();
        roundRect(ctx, x+1, y+1, cellW-2, cellH-2, Math.min(3, cellW/4));
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.lineTo(x+w-r, y);
  ctx.quadraticCurveTo(x+w, y, x+w, y+r);
  ctx.lineTo(x+w, y+h-r);
  ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
  ctx.lineTo(x+r, y+h);
  ctx.quadraticCurveTo(x, y+h, x, y+h-r);
  ctx.lineTo(x, y+r);
  ctx.quadraticCurveTo(x, y, x+r, y);
  ctx.closePath();
}

// ── CANVAS CLICK → PLACEMENT ──────────────────────
function handleCanvasClick(e) {
  if (!placementMode) return;
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width  / rect.width;
  const scaleY = canvas.height / rect.height;
  const px = (e.clientX - rect.left) * scaleX;
  const py = (e.clientY - rect.top)  * scaleY;
  const c  = Math.floor(px / cellW);
  const r  = Math.floor(py / cellH);

  if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return;

  const { slot, puKey } = placementMode;
  const msg = POWERUPS[puKey].apply(state, r, c);

  if (msg && msg.startsWith('⚠')) {
    showToast(msg);
    return; // don't consume
  }

  // Consume
  state.inventory[slot] = null;
  exitPlacementMode(false);
  updateInventory();
  drawGrid();
  updateHUD();
  showToast(msg || '⚡ Activated!');
  updateColorPicker();
}

// ── HUD UPDATES ───────────────────────────────────
function updateHUD() {
  const pCount    = countOwned(state.grid, 'player');
  const aCount    = countOwned(state.grid, 'ai');
  const total     = totalCells();
  const unclaimed = unclaimedCount(state.grid);

  document.getElementById('score-player').textContent = pCount;
  document.getElementById('score-ai').textContent     = aCount;
  document.getElementById('cells-left').textContent   = `cells left: ${unclaimed}`;

  document.getElementById('tug-player').style.width = (pCount / total * 100).toFixed(1) + '%';
  document.getElementById('tug-ai').style.width     = (aCount / total * 100).toFixed(1) + '%';
}

function updateColorPicker() {
  const picker = document.getElementById('color-picker');
  picker.innerHTML = '';
  COLORS.forEach((color, i) => {
    const btn = document.createElement('button');
    btn.className = 'color-btn';
    btn.style.background = color;
    btn.title = COLOR_NAMES[i];

    const isPlayerColor = color === state.playerColor;
    const isAiBlocked   = color === state.aiLastColor;
    const isDisabled    = isPlayerColor || isAiBlocked || state.turn !== 'player';

    if (isDisabled) {
      btn.classList.add('disabled');
      if (isAiBlocked && !isPlayerColor) btn.classList.add('ai-blocked');
    } else {
      btn.addEventListener('click', () => playerPickColor(color));
    }
    picker.appendChild(btn);
  });
}

function updateAISwatch(color) {
  document.getElementById('ai-last-swatch').style.background = color || 'transparent';
}

function updateInventory() {
  for (let i=0; i<2; i++) {
    const slot = document.getElementById(`slot-${i}`);
    const pu   = state.inventory[i];
    if (pu) {
      slot.classList.add('has-item');
      slot.innerHTML = `<span title="${POWERUPS[pu].name}">${POWERUPS[pu].emoji}</span>`;
    } else {
      slot.classList.remove('has-item');
      slot.innerHTML = `<span class="slot-empty">—</span>`;
    }
  }
}

function showToast(msg) {
  const toast = document.getElementById('powerup-toast');
  toast.textContent = msg;
  toast.classList.remove('hidden');
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.classList.add('hidden'), 300);
  }, 2200);
}

// ── TIMER ─────────────────────────────────────────
function startTimer() {
  if (!state.timerSeconds) return;
  const display = document.getElementById('timer-display');
  display.classList.remove('hidden');
  updateTimerDisplay();

  state.timerInterval = setInterval(() => {
    state.timerRemaining--;
    updateTimerDisplay();

    // Flash red in last 30s
    if (state.timerRemaining <= 30) {
      document.getElementById('timer-text').classList.add('timer-urgent');
    }

    if (state.timerRemaining <= 0) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
      state.timedOut = true;
      endGame();
    }
  }, 1000);
}

function stopTimer() {
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
}

function updateTimerDisplay() {
  const rem = Math.max(0, state.timerRemaining);
  const m = Math.floor(rem / 60);
  const s = rem % 60;
  document.getElementById('timer-text').textContent =
    `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

// ── PLAYER TURN ───────────────────────────────────
function playerPickColor(color) {
  if (state.turn !== 'player' || state.gameOver) return;
  if (placementMode) return;

  const { collected, powerupsFound } = floodFill(state.grid, 'player', color);
  state.playerColor     = color;
  state.playerLastColor = color;

  for (const pu of powerupsFound) {
    const emptySlot = state.inventory.indexOf(null);
    if (emptySlot !== -1) {
      state.inventory[emptySlot] = pu;
      showToast(`⚡ Got ${POWERUPS[pu].name}!`);
    } else {
      showToast('⚡ Inventory full — powerup missed!');
    }
  }

  drawGrid(collected);
  updateHUD();
  updateInventory();

  if (isGameOver(state.grid)) { endGame(); return; }

  if (state.pendingDouble) {
    state.pendingDouble = false;
    showToast('⏩ Pick again!');
    updateColorPicker();
    return;
  }

  state.turn = 'ai';
  updateColorPicker();
  setTimeout(doAITurn, AI_DELAY);
}

// ── AI TURN ───────────────────────────────────────
function doAITurn() {
  if (state.gameOver) return;

  const aiColor = aiChooseColor(state);
  const { collected } = floodFill(state.grid, 'ai', aiColor);
  state.aiColor     = aiColor;
  state.aiLastColor = aiColor;

  updateAISwatch(aiColor);
  drawGrid(collected);
  updateHUD();

  if (isGameOver(state.grid)) { endGame(); return; }

  state.turn = 'player';
  updateColorPicker();
}

// ── POWERUP ACTIVATION ────────────────────────────
let pendingPowerupSlot = null;

function openPowerupPanel(slotIndex) {
  if (state.turn !== 'player' || state.gameOver) return;
  if (placementMode) return;
  const pu = state.inventory[slotIndex];
  if (!pu) return;

  pendingPowerupSlot = slotIndex;
  const def = POWERUPS[pu];
  document.getElementById('pp-title').textContent = `${def.emoji} ${def.name}`;
  document.getElementById('pp-desc').textContent  = def.desc;
  document.getElementById('powerup-panel').classList.remove('hidden');
}

document.getElementById('pp-cancel').addEventListener('click', () => {
  document.getElementById('powerup-panel').classList.add('hidden');
  pendingPowerupSlot = null;
});

document.getElementById('pp-confirm').addEventListener('click', () => {
  if (pendingPowerupSlot === null) return;
  const pu = state.inventory[pendingPowerupSlot];
  if (!pu) return;

  if (POWERUPS[pu].placeable) {
    // Enter placement mode — don't consume yet
    enterPlacementMode(pendingPowerupSlot, pu);
    pendingPowerupSlot = null;
    return;
  }

  // Non-placeable: apply immediately
  const msg = POWERUPS[pu].apply(state);
  state.inventory[pendingPowerupSlot] = null;
  pendingPowerupSlot = null;

  document.getElementById('powerup-panel').classList.add('hidden');
  updateInventory();
  drawGrid();
  updateHUD();
  showToast(msg || '⚡ Activated!');
  updateColorPicker();
});

document.getElementById('placement-cancel').addEventListener('click', () => {
  exitPlacementMode(true);
});

document.getElementById('slot-0').addEventListener('click', () => openPowerupPanel(0));
document.getElementById('slot-1').addEventListener('click', () => openPowerupPanel(1));

// ── IN-GAME BUTTONS ───────────────────────────────
document.getElementById('btn-ingame-restart').addEventListener('click', () => {
  stopTimer();
  startGame(state.config);
});

document.getElementById('btn-ingame-quit').addEventListener('click', () => {
  stopTimer();
  state.gameOver = true;
  placementMode = null;
  showScreen('screen-start');
});

// ── GAME FLOW ─────────────────────────────────────
function startGame(config) {
  placementMode = null;
  document.getElementById('placement-banner').classList.add('hidden');
  document.getElementById('powerup-panel').classList.add('hidden');
  document.getElementById('timer-text').classList.remove('timer-urgent');
  document.getElementById('timer-display').classList.add('hidden');

  state = initState(config);
  ROWS = state.rows;
  COLS = state.cols;
  setupCanvas();
  canvas.addEventListener('click', handleCanvasClick);
  drawGrid();
  updateHUD();
  updateColorPicker();
  updateAISwatch(state.aiColor);
  updateInventory();
  showScreen('screen-game');
  startTimer();
}

function endGame() {
  state.gameOver = true;
  stopTimer();

  const pScore = countOwned(state.grid, 'player');
  const aScore = countOwned(state.grid, 'ai');
  const win = pScore > aScore;
  const tie = pScore === aScore;

  let emoji, title, sub;

  if (state.timedOut) {
    if (tie) {
      emoji = '⏰🤝';
      title = "Time's Up — Draw!";
      sub   = "The clock ran out with equal territory. A true standoff.";
    } else if (win) {
      emoji = '⏰🏆';
      title = "Time's Up — You Win!";
      sub   = `Clock ran out! You held ${pScore} cells vs ${aScore} — victory by time!`;
    } else {
      emoji = '⏰';
      title = "Time's Up!";
      sub   = `The clock ran out. AI held ${aScore} cells, you had ${pScore}.`;
    }
  } else {
    emoji = tie ? '🤝' : win ? '🏆' : '😤';
    title = tie ? "It's a Tie!" : win ? 'You Won!' : 'AI Wins!';
    sub   = tie
      ? 'An exact draw — well played by both sides.'
      : win
      ? `You dominated with ${pScore} cells vs ${aScore}.`
      : `The AI took ${aScore} cells. You had ${pScore}.`;
  }

  document.getElementById('result-emoji').textContent = emoji;
  document.getElementById('result-title').textContent = title;
  document.getElementById('result-sub').textContent   = sub;
  document.getElementById('fs-player').textContent    = pScore;
  document.getElementById('fs-ai').textContent        = aScore;
  document.getElementById('fs-player').style.color    = win ? 'var(--player)' : 'var(--muted)';
  document.getElementById('fs-ai').style.color        = (!win && !tie) ? 'var(--ai)' : 'var(--muted)';

  setTimeout(() => showScreen('screen-end'), 400);
}

// ── SCREEN MANAGEMENT ─────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ── START SCREEN WIRING ───────────────────────────
let selectedDifficulty = 'easy';
let selectedCorner     = 'bl';
let selectedTimer      = 0;
let useCustomGrid      = false;

// Tabs
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    useCustomGrid = btn.dataset.tab === 'custom';
  });
});

// Difficulty buttons
document.querySelectorAll('.diff-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedDifficulty = btn.dataset.diff;
    document.querySelectorAll('.diff-detail').forEach(d => d.hidden = true);
    const detail = document.querySelector(`.diff-detail[data-for="${selectedDifficulty}"]`);
    if (detail) detail.hidden = false;
  });
});

// Corner buttons
document.querySelectorAll('.corner-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.corner-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedCorner = btn.dataset.corner;
  });
});

// Timer buttons
document.querySelectorAll('.timer-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.timer-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const customRow = document.getElementById('custom-timer-row');
    if (btn.dataset.time === 'custom') {
      customRow.classList.remove('hidden');
      selectedTimer = 'custom';
    } else {
      customRow.classList.add('hidden');
      selectedTimer = parseInt(btn.dataset.time);
    }
  });
});

document.getElementById('btn-start').addEventListener('click', () => {
  let rows, cols, powerupCount;

  if (useCustomGrid) {
    rows = Math.min(Math.max(parseInt(document.getElementById('custom-rows').value) || 16, 5), MAX_ROWS);
    cols = Math.min(Math.max(parseInt(document.getElementById('custom-cols').value) || 20, 5), MAX_COLS);
    powerupCount = Math.min(Math.max(parseInt(document.getElementById('custom-pups').value) || 5, 0), 20);
  } else {
    const cfg = DIFFICULTY_CONFIG[selectedDifficulty];
    rows = cfg.rows; cols = cfg.cols; powerupCount = cfg.powerupCount;
  }

  let timerSeconds = 0;
  if (selectedTimer === 'custom') {
    timerSeconds = Math.max(1, parseInt(document.getElementById('custom-time-input').value) || 10) * 60;
  } else {
    timerSeconds = selectedTimer;
  }

  const config = {
    difficulty: useCustomGrid ? 'medium' : selectedDifficulty,
    rows, cols, powerupCount,
    playerCorner: selectedCorner,
    timerSeconds,
  };

  startGame(config);
});

document.getElementById('btn-restart').addEventListener('click', () => {
  if (state.config) startGame(state.config);
});
document.getElementById('btn-menu').addEventListener('click', () => showScreen('screen-start'));

// ── RESIZE ────────────────────────────────────────
window.addEventListener('resize', () => {
  if (document.getElementById('screen-game').classList.contains('active')) {
    setupCanvas();
    drawGrid();
  }
});