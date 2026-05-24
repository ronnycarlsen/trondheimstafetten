const DEFAULT_RUNNERS = [
  { stage: 1, name: "Test", distance_km: 1.609, speed_kmh: 9.863, start_place: "Skansenparken", finish_place: "Rockheim Park" },
  { stage: 2, name: "Jan Are", distance_km: 2.59, speed_kmh: 9.9, start_place: "Rockheim", finish_place: "Dakotaparken" },
  { stage: 3, name: "Jan Are", distance_km: 1.0, speed_kmh: 10.0, start_place: "Dakotaparken", finish_place: "Dronning Mauds Minne Høgskole" },
  { stage: 4, name: "Sørensen", distance_km: 2.82, speed_kmh: 10.0, start_place: "Dronning Mauds Minne Høgskole", finish_place: "Festningsparken" },
  { stage: 5, name: "Ronny", distance_km: 1.75, speed_kmh: 10.141, start_place: "Festningsparken", finish_place: "Høgskoleparken" },
  { stage: 6, name: "Ronny", distance_km: 1.609, speed_kmh: 9.5, start_place: "Høgskoleparken", finish_place: "Regnbueparken" },
  { stage: 7, name: "Kenth Rune", distance_km: 2.8, speed_kmh: 10.0, start_place: "Regnbueparken", finish_place: "Sverresborg Museum" },
  { stage: 8, name: "Anne Lene", distance_km: 3.55, speed_kmh: 8.5, start_place: "Sverresborg Museum", finish_place: "Museumsparken" },
  { stage: 9, name: "Andreas", distance_km: 0.8, speed_kmh: 9.863, start_place: "Museumsparken", finish_place: "Marinen" },
  { stage: 10, name: "Lien", distance_km: 2.58, speed_kmh: 9.9, start_place: "Marinen", finish_place: "Trondheim Stadion" }
];

const DEFAULT_START_TIME = "14:30";
const STORE_KEY = "trondheimstafetten-state-v2";
let runners = [];
let actuals = {};
let supabaseClient = null;
let finishTimeManualOverride = false;
let finishStageManualOverride = false;
let actualMeta = {};
const cfg = window.STAFETT_CONFIG || {};
const ADMIN_CODE = cfg.ADMIN_CODE || "ronny";
const params = new URLSearchParams(window.location.search);
const isAdmin = params.get("admin") === ADMIN_CODE || params.get("admin") === "1";

const $ = (id) => document.getElementById(id);

function configured() {
  return Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);
}


function timeFromDate(date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function currentTime() {
  return timeFromDate(new Date());
}

function oneMinuteAgo() {
  return timeFromDate(new Date(Date.now() - 60 * 1000));
}

function refreshFinishTime(force = false) {
  const input = $("finishTime");
  if (!input) return;
  if (force || (!finishTimeManualOverride && document.activeElement !== input)) {
    input.value = currentTime();
  }
}

function toMinutes(time) {
  if (!time) return null;
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function toTime(minutes) {
  if (minutes === null || Number.isNaN(minutes)) return "--:--";
  const mins = Math.round(minutes) % (24 * 60);
  const h = Math.floor(mins / 60).toString().padStart(2, "0");
  const m = (mins % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

function legMinutes(runner) {
  const d = Number(runner.distance_km);
  const s = Number(runner.speed_kmh);
  if (!d || !s) return 0;
  return (d / s) * 60;
}

function minutesBetween(startTime, endTime) {
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  if (start === null || end === null) return null;
  let diff = end - start;
  if (diff < 0) diff += 24 * 60;
  return diff;
}

function latestRegisteredStage() {
  // Bruk siste registrering i tid, ikke første manglende etappe.
  // Dette gjør at appen tåler at noen glemmer en tidligere veksling.
  const entries = Object.entries(actualMeta)
    .map(([stage, meta]) => ({ stage: Number(stage), updatedAt: meta?.updated_at || "" }))
    .filter(x => Number.isFinite(x.stage) && x.updatedAt);

  if (entries.length) {
    entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return entries[0].stage;
  }

  const stages = Object.keys(actuals)
    .map(Number)
    .filter(Number.isFinite);
  return stages.length ? Math.max(...stages) : 0;
}

function nextStageToRegister(sorted = [...runners].sort((a, b) => a.stage - b.stage)) {
  const latest = latestRegisteredStage();
  return sorted.find(r => r.stage === latest + 1) || sorted.find(r => r.stage > latest) || sorted[0] || null;
}

function segmentDistance(rows) {
  return rows.reduce((sum, r) => sum + Number(r.distance_km || 0), 0);
}

function calculate() {
  const sorted = [...runners].sort((a, b) => a.stage - b.stage);
  const liveStage = nextStageToRegister(sorted)?.stage;
  const rows = sorted.map(r => ({
    ...r,
    startTime: null,
    finishEstimate: null,
    directActualFinish: actuals[r.stage] ? toMinutes(actuals[r.stage]) : null,
    actualFinish: actuals[r.stage] ? toMinutes(actuals[r.stage]) : null,
    interpolated: false,
    measured: null,
    status: "waiting"
  }));

  let previousStage = 0;
  let previousTime = toMinutes(DEFAULT_START_TIME);
  const actualStages = Object.keys(actuals)
    .map(Number)
    .filter(stage => Number.isFinite(stage) && actuals[stage])
    .sort((a, b) => a - b);

  for (const anchorStage of actualStages) {
    const anchorTime = toMinutes(actuals[anchorStage]);
    if (anchorTime === null) continue;
    let elapsed = anchorTime - previousTime;
    if (elapsed < 0) elapsed += 24 * 60;

    const segmentRows = rows.filter(r => r.stage > previousStage && r.stage <= anchorStage);
    const distance = segmentDistance(segmentRows);
    const actualSpeed = distance && elapsed > 0 ? (distance / elapsed) * 60 : null;
    let cursor = previousTime;

    for (const row of segmentRows) {
      const dist = Number(row.distance_km || 0);
      const legUsed = actualSpeed ? (dist / actualSpeed) * 60 : legMinutes(row);
      row.startTime = cursor;
      cursor += legUsed;
      row.finishEstimate = row.stage === anchorStage ? anchorTime : cursor;
      row.interpolated = row.stage !== anchorStage;
      row.status = row.stage === anchorStage ? "done" : "calculated";
      row.measured = actualSpeed ? {
        elapsed: row.stage === anchorStage ? minutesBetween(toTime(row.startTime), actuals[anchorStage]) : legUsed,
        speed: actualSpeed,
        fromStage: previousStage + 1,
        toStage: anchorStage,
        previousActualStage: previousStage || null,
        anchorStage
      } : null;
    }

    previousStage = anchorStage;
    previousTime = anchorTime;
  }

  let cursor = previousTime;
  for (const row of rows.filter(r => r.stage > previousStage)) {
    row.startTime = cursor;
    row.finishEstimate = cursor + legMinutes(row);
    row.status = row.stage === liveStage ? "live" : "waiting";
    cursor = row.finishEstimate;
  }

  return rows;
}

function saveLocal() {
  localStorage.setItem(STORE_KEY, JSON.stringify({ runners, actuals, actualMeta }));
}

function loadLocal() {
  const raw = localStorage.getItem(STORE_KEY);
  if (!raw) {
    runners = DEFAULT_RUNNERS;
    actuals = {};
    saveLocal();
    return;
  }
  try {
    const state = JSON.parse(raw);
    runners = state.runners?.length ? state.runners : DEFAULT_RUNNERS;
    actuals = state.actuals || {};
    actualMeta = state.actualMeta || {};
  } catch {
    runners = DEFAULT_RUNNERS;
    actuals = {};
  }
}

async function initSupabase() {
  if (!configured()) {
    $("setupWarning").classList.remove("hidden");
    return false;
  }
  supabaseClient = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  return true;
}

async function loadRemote() {
  if (!supabaseClient) return;
  const { data, error } = await supabaseClient
    .from("stafett_runners")
    .select("*")
    .eq("event_id", cfg.EVENT_ID)
    .order("stage");
  if (error) throw error;
  if (!data || data.length === 0) {
    await supabaseClient.from("stafett_runners").insert(DEFAULT_RUNNERS.map(r => ({ ...r, event_id: cfg.EVENT_ID })));
    runners = DEFAULT_RUNNERS;
  } else {
    runners = data;
  }
  const res = await supabaseClient
    .from("stafett_actuals")
    .select("stage, finish_time, updated_at")
    .eq("event_id", cfg.EVENT_ID);
  if (res.error) throw res.error;
  actuals = Object.fromEntries((res.data || []).map(x => [x.stage, x.finish_time.slice(0, 5)]));
  actualMeta = Object.fromEntries((res.data || []).map(x => [x.stage, { updated_at: x.updated_at || "" }]));
}

async function saveRunnerRemote(runner) {
  if (!supabaseClient) return;
  await supabaseClient.from("stafett_runners").upsert({ ...runner, event_id: cfg.EVENT_ID }, { onConflict: "event_id,stage" });
}

async function saveActualRemote(stage, finishTime) {
  if (!supabaseClient) return;
  await supabaseClient.from("stafett_actuals").upsert({ event_id: cfg.EVENT_ID, stage, finish_time: finishTime, updated_at: new Date().toISOString() }, { onConflict: "event_id,stage" });
}

async function resetRemote() {
  if (!supabaseClient) return;
  await supabaseClient.from("stafett_actuals").delete().eq("event_id", cfg.EVENT_ID);
}

async function replaceRunnersRemote(newRunners) {
  if (!supabaseClient) return;
  await supabaseClient.from("stafett_actuals").delete().eq("event_id", cfg.EVENT_ID);
  await supabaseClient.from("stafett_runners").delete().eq("event_id", cfg.EVENT_ID);
  await supabaseClient.from("stafett_runners").insert(newRunners.map(r => ({ ...r, event_id: cfg.EVENT_ID })));
}

function runnerLabel(runner) {
  const name = runner?.name?.trim() || "Uten navn";
  return `${runner.stage} - ${name}`;
}

function fillSelects() {
  const sorted = [...runners].sort((a, b) => a.stage - b.stage);
  const options = sorted.map(r => `<option value="${r.stage}">${escapeHtml(runnerLabel(r))}</option>`).join("");
  for (const id of ["stage", "finishStage"]) {
    const current = $(id).value;
    $(id).innerHTML = options;
    if (current) $(id).value = current;
  }
}


function selectCurrentRunnerForRegistration(force = false) {
  if (!force && finishStageManualOverride) return;
  const rows = calculate();
  const next = nextStageToRegister(rows);
  if (next && $("finishStage")) $("finishStage").value = String(next.stage);
}

function selectStageAfterRegistered(stage) {
  const sorted = [...runners].sort((a, b) => a.stage - b.stage);
  const next = sorted.find(r => r.stage > Number(stage));
  if (next && $("finishStage")) {
    $("finishStage").value = String(next.stage);
  }
  finishStageManualOverride = false;
}

function fillForm(stage) {
  const r = runners.find(x => x.stage === Number(stage));
  if (!r) return;
  $("stage").value = r.stage;
  $("name").value = r.name || "";
  $("distance").value = r.distance_km || "";
  $("speed").value = r.speed_kmh || "";
  $("startPlace").value = r.start_place || "";
  $("finishPlace").value = r.finish_place || "";
  if ($("registeredFinish")) {
    $("registeredFinish").value = actuals[r.stage] || "";
  }
}

function render() {
  fillSelects();
  if (!$('name').value) fillForm($("stage").value || 1);
  const rows = calculate();
  const next = nextStageToRegister(rows);
  if ($("nextRunner")) $("nextRunner").textContent = next ? runnerLabel(next) : "Alle registrert";
  if ($("nextEstimate")) $("nextEstimate").textContent = next ? toTime(next.finishEstimate) : "Ferdig";
  $("list").innerHTML = rows.map(r => {
    const statusText = r.status === "done"
      ? "Registrert"
      : r.status === "calculated"
        ? `Beregnet fra veksling ${r.measured?.toStage || ""}`
        : r.status === "live"
          ? "Løper nå"
          : "Ikke startet";
    const shownFinish = r.finishEstimate;
    const finishText = r.directActualFinish ? "Faktisk inn" : (r.interpolated ? "Beregnet inn" : "Estimert inn");
    const measuredText = r.measured
      ? `Tid brukt ${Math.round(r.measured.elapsed)} min · faktisk ${r.measured.speed.toFixed(1)} km/t${r.measured.fromStage !== r.measured.toStage ? ` · etappe ${r.measured.fromStage}-${r.measured.toStage}` : ""}`
      : "";
    return `<article class="row ${r.status}">
      <div class="badge">${r.stage}</div>
      <div>
        <div class="name">${escapeHtml(runnerLabel(r))}</div>
        <div class="meta">${escapeHtml(r.start_place || "")} → ${escapeHtml(r.finish_place || "")}</div>
        <div class="meta">${Number(r.distance_km).toFixed(3)} km · estimert ${Number(r.speed_kmh).toFixed(1)} km/t · ${Math.round(legMinutes(r))} min</div>
        <div class="meta row-status">${statusText}</div>
        ${measuredText ? `<div class="actual-metrics">${escapeHtml(measuredText)}</div>` : ""}
      </div>
      <div class="time-stack">
        <div class="time-line start-line"><span>Start</span><strong>${toTime(r.startTime)}</strong></div>
        <div class="time-line finish-line ${r.directActualFinish ? "actual-finish" : ""}"><span>${finishText}</span><strong>${toTime(shownFinish)}</strong></div>
      </div>
    </article>`;
  }).join("");
}


function parseNumber(value) {
  if (value === undefined || value === null) return 0;
  return Number(String(value).trim().replace(",", "."));
}

function normalizeHeader(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[æ]/g, "ae")
    .replace(/[ø]/g, "o")
    .replace(/[å]/g, "a")
    .replace(/[^a-z0-9]/g, "");
}

function parseRunnerPaste(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return [];

  const splitLine = (line) => {
    if (line.includes("\t")) return line.split("\t");
    if (line.includes(";")) return line.split(";");
    return line.split(",");
  };

  const first = splitLine(lines[0]).map(x => x.trim());
  const normalized = first.map(normalizeHeader);
  const hasHeader = normalized.some(h => ["etappe", "etp", "navn", "loper", "distanse", "hastighet", "kmh", "kmt"].includes(h));

  const idx = (names, fallback) => {
    const found = normalized.findIndex(h => names.includes(h));
    return found >= 0 ? found : fallback;
  };

  const indexes = {
    stage: hasHeader ? idx(["etappe", "etp", "stage"], 0) : 0,
    name: hasHeader ? idx(["navn", "loper", "deltaker", "name"], 1) : 1,
    distance: hasHeader ? idx(["distanse", "distansekm", "km", "lengde"], 2) : 2,
    speed: hasHeader ? idx(["hastighet", "hastighetkmt", "kmt", "kmh", "speed", "speedkmh"], 3) : 3,
    start: hasHeader ? idx(["start", "startsted", "fra"], 4) : 4,
    finish: hasHeader ? idx(["mal", "maal", "veksling", "til", "finish", "malsted"], 5) : 5,
  };

  return lines.slice(hasHeader ? 1 : 0).map(line => {
    const cells = splitLine(line).map(x => x.trim());
    return {
      stage: parseInt(cells[indexes.stage], 10),
      name: cells[indexes.name] || "Uten navn",
      distance_km: parseNumber(cells[indexes.distance]),
      speed_kmh: parseNumber(cells[indexes.speed]),
      start_place: cells[indexes.start] || "",
      finish_place: cells[indexes.finish] || ""
    };
  }).filter(r => r.stage && r.name && r.distance_km && r.speed_kmh)
    .sort((a, b) => a.stage - b.stage);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
}

async function sync(options = {}) {
  const silent = Boolean(options.silent);
  if (!supabaseClient) return render();
  try {
    await loadRemote();
    saveLocal();
    render();
  } catch (e) {
    if (!silent) alert("Kunne ikke synkronisere: " + e.message);
    console.warn("Kunne ikke synkronisere", e);
  }
}

async function boot() {
  if (isAdmin && $("resetButton")) $("resetButton").classList.remove("hidden");
  if (isAdmin && $("adminBadge")) $("adminBadge").classList.remove("hidden");
  loadLocal();
  const hasRemote = await initSupabase();
  if (hasRemote) await sync({ silent: true });
  render();
  selectCurrentRunnerForRegistration(true);

  $("stage").addEventListener("change", e => fillForm(e.target.value));
  $("runnerForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const runner = {
      stage: Number($("stage").value),
      name: $("name").value.trim(),
      distance_km: Number($("distance").value),
      speed_kmh: Number($("speed").value),
      start_place: $("startPlace").value.trim(),
      finish_place: $("finishPlace").value.trim()
    };
    runners = runners.filter(r => r.stage !== runner.stage).concat(runner).sort((a, b) => a.stage - b.stage);
    saveLocal();
    await saveRunnerRemote(runner);
    render();
  });

  $("finishStage").addEventListener("change", () => {
    finishStageManualOverride = true;
  });

  $("finishTime").addEventListener("input", () => {
    finishTimeManualOverride = true;
  });

  $("finishTime").addEventListener("change", () => {
    finishTimeManualOverride = true;
  });

  $("nowButton").addEventListener("click", () => {
    finishTimeManualOverride = true;
    $("finishTime").value = oneMinuteAgo();
  });

  $("finishButton").addEventListener("click", async () => {
    const stage = Number($("finishStage").value);
    const time = $("finishTime").value;
    if (!time) return alert("Velg klokkeslett først");
    actuals[stage] = time;
    actualMeta[stage] = { updated_at: new Date().toISOString() };
    saveLocal();
    await saveActualRemote(stage, time);
    await sync({ silent: true });
    selectStageAfterRegistered(stage);
    render();
    fillForm($("stage").value || stage);
  });

  $("syncButton").addEventListener("click", sync);
  if ($("resetButton")) $("resetButton").addEventListener("click", async () => {
    if (!isAdmin) return alert("Admin-lenke kreves");
    if (!confirm("Start nytt løp? Dette sletter registrerte vekslingstider, men beholder løperlisten.")) return;
    actuals = {};
    actualMeta = {};
    saveLocal();
    await resetRemote();
    render();
  });

  refreshFinishTime(true);

  setInterval(() => {
    refreshFinishTime(false);
    if (supabaseClient) sync({ silent: true });
  }, 20000);
}

boot();


// v34 visual-only status styling
(function () {
  function styleStatuses() {
    document.querySelectorAll(".row-status").forEach((el) => {
      const txt = (el.textContent || "").trim().toLowerCase();
      el.classList.toggle("status-running", txt.includes("løper nå"));
      el.classList.toggle("status-not-started", txt.includes("ikke startet"));
    });
  }
  document.addEventListener("DOMContentLoaded", styleStatuses);
  const observer = new MutationObserver(styleStatuses);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
})();


// v35 visual-only: status color classes and optional mobile badge status placement
(function () {
  function decorateRows() {
    document.querySelectorAll(".row-status").forEach((el) => {
      const txt = (el.textContent || "").trim().toLowerCase();
      el.classList.toggle("status-running", txt.includes("løper nå"));
      el.classList.toggle("status-not-started", txt.includes("ikke startet"));
    });
  }
  document.addEventListener("DOMContentLoaded", decorateRows);
  new MutationObserver(decorateRows).observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });
})();
