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
const cfg = window.STAFETT_CONFIG || {};

const $ = (id) => document.getElementById(id);

function configured() {
  return Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);
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

function calculate() {
  const sorted = [...runners].sort((a, b) => a.stage - b.stage);
  let start = toMinutes(DEFAULT_START_TIME);
  return sorted.map((runner) => {
    const startTime = start;
    const finishEstimate = startTime + legMinutes(runner);
    const actualFinish = actuals[runner.stage] ? toMinutes(actuals[runner.stage]) : null;
    const status = actualFinish ? "done" : (Date.now() && sorted.findIndex(x => x.stage === runner.stage) === firstOpenIndex(sorted) ? "live" : "waiting");
    const row = { ...runner, startTime, finishEstimate, actualFinish, status };
    start = actualFinish ?? finishEstimate;
    return row;
  });
}

function firstOpenIndex(sorted) {
  return sorted.findIndex(r => !actuals[r.stage]);
}

function saveLocal() {
  localStorage.setItem(STORE_KEY, JSON.stringify({ runners, actuals }));
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
    .select("stage, finish_time")
    .eq("event_id", cfg.EVENT_ID);
  if (res.error) throw res.error;
  actuals = Object.fromEntries((res.data || []).map(x => [x.stage, x.finish_time.slice(0, 5)]));
}

async function saveRunnerRemote(runner) {
  if (!supabaseClient) return;
  await supabaseClient.from("stafett_runners").upsert({ ...runner, event_id: cfg.EVENT_ID }, { onConflict: "event_id,stage" });
}

async function saveActualRemote(stage, finishTime) {
  if (!supabaseClient) return;
  await supabaseClient.from("stafett_actuals").upsert({ event_id: cfg.EVENT_ID, stage, finish_time: finishTime }, { onConflict: "event_id,stage" });
}

async function resetRemote() {
  if (!supabaseClient) return;
  await supabaseClient.from("stafett_actuals").delete().eq("event_id", cfg.EVENT_ID);
}

function fillSelects() {
  const stages = runners.map(r => r.stage).sort((a, b) => a - b);
  for (const id of ["stage", "finishStage"]) {
    $(id).innerHTML = stages.map(s => `<option value="${s}">${s}</option>`).join("");
  }
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
}

function render() {
  fillSelects();
  if (!$('name').value) fillForm($("stage").value || 1);
  const rows = calculate();
  $("list").innerHTML = rows.map(r => {
    const statusText = r.status === "done" ? "Registrert" : r.status === "live" ? "Løper nå" : "Ikke startet";
    return `<article class="row ${r.status}">
      <div class="badge">${r.stage}</div>
      <div>
        <div class="name">${escapeHtml(r.name || "Uten navn")}</div>
        <div class="meta">${escapeHtml(r.start_place || "")} → ${escapeHtml(r.finish_place || "")}</div>
        <div class="meta">${Number(r.distance_km).toFixed(3)} km · ${Number(r.speed_kmh).toFixed(1)} km/t · ${Math.round(legMinutes(r))} min</div>
        <div class="meta">${statusText}${r.actualFinish ? ` · faktisk inn ${toTime(r.actualFinish)}` : ""}</div>
      </div>
      <div>
        <div class="time">${toTime(r.startTime)}</div>
        <div class="small">estimert inn ${toTime(r.finishEstimate)}</div>
      </div>
    </article>`;
  }).join("");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
}

async function sync() {
  if (!supabaseClient) return render();
  try {
    await loadRemote();
    saveLocal();
    render();
  } catch (e) {
    alert("Kunne ikke synkronisere: " + e.message);
  }
}

async function boot() {
  loadLocal();
  const hasRemote = await initSupabase();
  if (hasRemote) await sync();
  render();

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

  $("nowButton").addEventListener("click", () => {
    const d = new Date();
    $("finishTime").value = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  });

  $("finishButton").addEventListener("click", async () => {
    const stage = Number($("finishStage").value);
    const time = $("finishTime").value;
    if (!time) return alert("Velg klokkeslett først");
    actuals[stage] = time;
    saveLocal();
    await saveActualRemote(stage, time);
    render();
  });

  $("syncButton").addEventListener("click", sync);
  $("resetButton").addEventListener("click", async () => {
    if (!confirm("Nullstille registrerte vekslingstider? Løpere beholdes.")) return;
    actuals = {};
    saveLocal();
    await resetRemote();
    render();
  });
}

boot();
