import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_KEY, SUPABASE_URL } from "./config.js";

const COLS = 5;
const ROWS = 5;
const CENTER = 12;
const PAIR_COUNT = 12;
const FLIP_MS = 620;
const MISMATCH_MS = 780;
const DEAL_STEP_MS = 18;
const SYMBOLS = ["🍎", "🍋", "🍇", "🍒", "🍉", "🥝", "🍑", "🍓", "🫐", "🍊", "🍐", "🍍"];

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const boardEl = document.querySelector("#board");
const movesEl = document.querySelector("#moves");
const timerEl = document.querySelector("#timer");
const pairsEl = document.querySelector("#pairs");
const statusEl = document.querySelector("#status");
const leaderboardEl = document.querySelector("#leaderboard");
const boardErrorEl = document.querySelector("#board-error");
const modalEl = document.querySelector("#modal");
const saveForm = document.querySelector("#save-form");
const playerNameInput = document.querySelector("#player-name");
const modalStatsEl = document.querySelector("#modal-stats");
const saveErrorEl = document.querySelector("#save-error");
const saveButton = document.querySelector("#save-score");
const skipButton = document.querySelector("#skip-save");
const newGameButton = document.querySelector("#new-game");
const pageRegions = [document.querySelector("header"), document.querySelector("main")];

const state = {
  cells: [],
  phase: "playing",
  firstIndex: null,
  moves: 0,
  matchedPairs: 0,
  startedAt: null,
  elapsedMs: 0,
  timerId: 0,
  resolveTimer: 0,
  savedId: null,
  saving: false,
  dealTimer: 0,
};

let audioCtx = null;

function audioContext() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) audioCtx = new Ctx();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function playTone(freq, dur, { type = "sine", gain = 0.06, delay = 0, slide } = {}) {
  const ctx = audioContext();
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, slide), t + dur);
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(amp);
  amp.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function playFlip() {
  const ctx = audioContext();
  if (!ctx) return;
  const t = ctx.currentTime;
  const length = Math.max(1, Math.floor(ctx.sampleRate * 0.045));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) {
    const fade = (1 - i / length) ** 2;
    data[i] = (Math.random() * 2 - 1) * fade;
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 1800;
  filter.Q.value = 0.7;
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.18, t);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  noise.connect(filter);
  filter.connect(amp);
  amp.connect(ctx.destination);
  noise.start(t);
  noise.stop(t + 0.05);
  playTone(680, 0.06, { type: "triangle", gain: 0.035, slide: 260 });
}

function playMatch() {
  playTone(523, 0.11, { type: "sine", gain: 0.06 });
  playTone(784, 0.15, { type: "sine", gain: 0.05, delay: 0.08 });
}

function playMiss() {
  playTone(196, 0.16, { type: "triangle", gain: 0.05, slide: 98 });
}

function playWin() {
  [523, 659, 784, 1046].forEach((freq, index) => {
    playTone(freq, 0.18, { type: "triangle", gain: 0.06, delay: index * 0.09 });
  });
}

function playDeal() {
  [0, 0.045, 0.09, 0.14].forEach((delay, index) => {
    playTone(340 + index * 70, 0.04, { type: "triangle", gain: 0.03, delay });
  });
}

function shuffle(list) {
  const next = list.slice();
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function formatMs(ms) {
  if (ms == null) return "—";
  const total = Math.max(0, Math.floor(Number(ms) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function setStatus(text) {
  statusEl.textContent = text;
}

function renderStats() {
  movesEl.textContent = String(state.moves);
  timerEl.textContent = formatMs(state.elapsedMs);
  pairsEl.textContent = `${state.matchedPairs}/${PAIR_COUNT}`;
}

function stopTimer() {
  window.clearInterval(state.timerId);
  state.timerId = 0;
}

function tick() {
  if (!state.startedAt || state.phase === "won") return;
  state.elapsedMs = Date.now() - state.startedAt;
  timerEl.textContent = formatMs(state.elapsedMs);
}

function startTimer() {
  if (state.startedAt) return;
  state.startedAt = Date.now();
  state.timerId = window.setInterval(tick, 200);
}

function buildCells() {
  const deck = shuffle(
    SYMBOLS.flatMap((symbol, pairId) => [
      { symbol, pairId },
      { symbol, pairId },
    ]),
  );
  const cells = [];
  let deckIndex = 0;
  for (let index = 0; index < COLS * ROWS; index += 1) {
    if (index === CENTER) {
      cells.push({ index, kind: "fixed" });
      continue;
    }
    const card = deck[deckIndex];
    deckIndex += 1;
    cells.push({
      index,
      kind: "card",
      symbol: card.symbol,
      pairId: card.pairId,
      faceUp: false,
      matched: false,
    });
  }
  return cells;
}

function labelFor(cell) {
  if (cell.matched) return `맞춘 카드 ${cell.symbol}`;
  if (cell.faceUp) return `열린 카드 ${cell.symbol}`;
  return "뒷면 카드";
}

function createCell(cell) {
  if (cell.kind === "fixed") {
    const fixed = document.createElement("div");
    fixed.className = "fixed-card";
    fixed.style.animationDelay = `${cell.index * DEAL_STEP_MS}ms`;
    fixed.setAttribute("role", "img");
    fixed.setAttribute("aria-label", "고정 칸");
    const token = document.createElement("span");
    token.textContent = "★";
    token.setAttribute("aria-hidden", "true");
    fixed.append(token);
    return fixed;
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "card";
  button.style.animationDelay = `${cell.index * DEAL_STEP_MS}ms`;
  if (cell.faceUp || cell.matched) button.classList.add("is-up");
  if (cell.matched) button.classList.add("is-matched");
  button.dataset.index = String(cell.index);
  button.dataset.symbol = cell.symbol;
  button.disabled = cell.matched || state.phase !== "playing";
  button.setAttribute("aria-label", labelFor(cell));

  const lift = document.createElement("span");
  lift.className = "card-lift";
  const inner = document.createElement("span");
  inner.className = "card-inner";
  const back = document.createElement("span");
  back.className = "card-face card-back";
  back.setAttribute("aria-hidden", "true");
  const front = document.createElement("span");
  front.className = "card-face card-front";
  front.textContent = cell.symbol;
  front.setAttribute("aria-hidden", "true");
  inner.append(back, front);
  lift.append(inner);
  button.append(lift);
  return button;
}

function markTurning(button) {
  button.classList.remove("is-turning");
  void button.offsetWidth;
  button.classList.add("is-turning");
  window.setTimeout(() => button.classList.remove("is-turning"), FLIP_MS);
}

function renderBoard() {
  boardEl.replaceChildren(...state.cells.map(createCell));
  window.clearTimeout(state.dealTimer);
  boardEl.style.pointerEvents = "none";
  state.dealTimer = window.setTimeout(() => {
    boardEl.style.pointerEvents = "";
  }, 24 * DEAL_STEP_MS + 460);
}

function syncCard(index) {
  const cell = state.cells[index];
  const button = boardEl.querySelector(`[data-index="${index}"]`);
  if (!button || cell.kind !== "card") return;
  const wasUp = button.classList.contains("is-up");
  const nowUp = cell.faceUp || cell.matched;
  button.classList.toggle("is-up", nowUp);
  button.classList.toggle("is-matched", cell.matched);
  if (wasUp !== nowUp) markTurning(button);
  button.disabled = cell.matched || state.phase !== "playing";
  button.setAttribute("aria-label", labelFor(cell));
}

function setPageInert(inert) {
  pageRegions.forEach((region) => {
    region.inert = inert;
  });
}

function openModal() {
  modalStatsEl.textContent = `${state.moves}이동 · ${formatMs(state.elapsedMs)}`;
  saveErrorEl.hidden = true;
  saveErrorEl.textContent = "";
  saveButton.disabled = false;
  modalEl.hidden = false;
  setPageInert(true);
  playerNameInput.focus();
}

function closeModal() {
  modalEl.hidden = true;
  setPageInert(false);
}

function finishGame() {
  state.phase = "won";
  if (state.startedAt) state.elapsedMs = Date.now() - state.startedAt;
  stopTimer();
  state.cells.forEach((cell) => {
    if (cell.kind === "card") syncCard(cell.index);
  });
  renderStats();
  setStatus("모두 맞췄습니다. 이름을 남기면 리더보드에 올라갑니다.");
  playWin();
  openModal();
}

function resolveMismatch(firstIndex, secondIndex) {
  state.phase = "locked";
  syncCard(firstIndex);
  syncCard(secondIndex);
  setStatus("다른 그림입니다.");
  playMiss();
  state.resolveTimer = window.setTimeout(() => {
    if (state.phase !== "locked") return;
    state.cells[firstIndex].faceUp = false;
    state.cells[secondIndex].faceUp = false;
    playFlip();
    syncCard(firstIndex);
    syncCard(secondIndex);
    state.resolveTimer = window.setTimeout(() => {
      if (state.phase !== "locked") return;
      state.phase = "playing";
      state.firstIndex = null;
      syncCard(firstIndex);
      syncCard(secondIndex);
      setStatus("같은 그림 두 장을 찾으세요.");
    }, FLIP_MS);
  }, MISMATCH_MS);
}

function onCardClick(event) {
  const button = event.target.closest(".card");
  if (!button || state.phase !== "playing") return;

  const index = Number(button.dataset.index);
  const cell = state.cells[index];
  if (!cell || cell.kind !== "card" || cell.matched || cell.faceUp) return;

  startTimer();
  cell.faceUp = true;
  syncCard(index);
  playFlip();

  if (state.firstIndex == null) {
    state.firstIndex = index;
    setStatus("같은 그림을 찾으세요.");
    return;
  }

  const firstIndex = state.firstIndex;
  const first = state.cells[firstIndex];
  state.firstIndex = null;
  state.moves += 1;
  renderStats();

  if (first.pairId === cell.pairId) {
    first.matched = true;
    cell.matched = true;
    state.matchedPairs += 1;
    renderStats();
    syncCard(firstIndex);
    syncCard(index);
    if (state.matchedPairs === PAIR_COUNT) {
      finishGame();
      return;
    }
    playMatch();
    setStatus("같은 그림입니다.");
    return;
  }

  resolveMismatch(firstIndex, index);
}

function resetGame() {
  window.clearTimeout(state.resolveTimer);
  stopTimer();
  closeModal();
  state.cells = buildCells();
  state.phase = "playing";
  state.firstIndex = null;
  state.moves = 0;
  state.matchedPairs = 0;
  state.startedAt = null;
  state.elapsedMs = 0;
  state.savedId = null;
  state.saving = false;
  renderStats();
  renderBoard();
  setStatus("같은 그림 두 장을 찾으세요.");
}

function renderLeaderboard(rows) {
  if (!rows.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "아직 기록이 없습니다.";
    leaderboardEl.replaceChildren(empty);
    return;
  }

  leaderboardEl.replaceChildren(
    ...rows.map((row, index) => {
      const item = document.createElement("li");
      if (row.id === state.savedId) item.classList.add("is-mine");

      const rank = document.createElement("span");
      rank.className = "rank";
      rank.textContent = String(index + 1);

      const name = document.createElement("span");
      name.className = "name";
      name.textContent = row.player_name;

      const meta = document.createElement("span");
      meta.className = "meta";
      meta.textContent = `${row.moves}이동 · ${formatMs(row.elapsed_ms)}`;

      item.append(rank, name, meta);
      return item;
    }),
  );
}

async function loadLeaderboard() {
  boardErrorEl.hidden = true;
  const { data, error } = await supabase
    .from("card_flip_scores")
    .select("id, player_name, moves, elapsed_ms, created_at")
    .eq("board_cols", COLS)
    .eq("board_rows", ROWS)
    .eq("completed", true)
    .order("moves", { ascending: true })
    .order("elapsed_ms", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    boardErrorEl.hidden = false;
    boardErrorEl.textContent = "리더보드를 불러오지 못했습니다.";
    leaderboardEl.replaceChildren();
    return null;
  }

  renderLeaderboard(data ?? []);
  return data ?? [];
}

async function saveScore(name) {
  state.saving = true;
  saveButton.disabled = true;
  saveErrorEl.hidden = true;

  const { data, error } = await supabase
    .from("card_flip_scores")
    .insert({
      player_name: name,
      board_cols: COLS,
      board_rows: ROWS,
      moves: state.moves,
      elapsed_ms: state.elapsedMs,
      completed: true,
    })
    .select("id, player_name, moves, elapsed_ms, created_at")
    .single();

  state.saving = false;
  saveButton.disabled = false;

  if (error || !data) {
    saveErrorEl.hidden = false;
    saveErrorEl.textContent = "저장에 실패했습니다. 다시 시도해 주세요.";
    return;
  }

  state.savedId = data.id;
  closeModal();
  const rows = await loadLeaderboard();
  if (!rows) {
    setStatus("기록을 저장했습니다. 리더보드는 다시 열면 확인할 수 있습니다.");
    return;
  }
  const ranked = rows.some((row) => row.id === data.id);
  setStatus(ranked ? "기록을 저장했습니다." : "기록을 저장했습니다. 상위 20에는 들지 않았습니다.");
}

boardEl.addEventListener("click", onCardClick);

saveForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (state.saving || state.phase !== "won") return;
  const name = playerNameInput.value.trim();
  if (!name || name.length > 40) {
    saveErrorEl.hidden = false;
    saveErrorEl.textContent = "이름은 1자에서 40자까지 입력해 주세요.";
    playerNameInput.focus();
    return;
  }
  saveScore(name);
});

skipButton.addEventListener("click", () => {
  closeModal();
  setStatus("모두 맞췄습니다.");
  newGameButton.focus();
});

newGameButton.addEventListener("click", () => {
  playDeal();
  resetGame();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !modalEl.hidden) {
    closeModal();
    setStatus("모두 맞췄습니다.");
    newGameButton.focus();
  }
});

resetGame();
loadLeaderboard();
