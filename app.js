const TABLE_RUNNERS = "stafett_runners";
const TABLE_ACTUALS = "stafett_actuals";
const ADMIN_CODE = "ronny";

let supabaseClient = null;
let runners = [];
let actuals = [];

const el = (id) => document.getElementById(id);

function isAdmin() {
  const params = new URLSearchParams(window.location.search);
  return params.get("admin") === ADMIN_CODE;
}

function setStatus(text) {
  const status = el("syncStatus");
  if (status) status.textContent = text;
}

function localDateTimeValue(date = new Date()) {
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

function oneMinuteAgoValue() {
  return localDateTimeValue(new Date(Date.now() - 60 * 1000));
}

function toDate(value) {
  return value ? new Date(value) : null;
}

function fmtTime(value) {
  const date = toDate(value);
  if (!date || Number.isNaN(date.getTime())) return "Ikke registrert";
  return date.toLocaleTimeString("no-NO", { hour: "2-digit", minute: "2-digit" });
}

function addMinutes(value, minutes) {
  const date = toDate(value);
  if (!date || !Number.isFinite(minutes)) return null;
  return new Date(date.getTime() + minutes * 60000).toISOString();
}

function estimateMinutes(runner) {
  const distance = Number(runner.distanse_km || 0);
  const speed = Number(runner.hastighet_kmt || 0);
  if (!distance || !speed) return null;
  return Math.round((distance / speed) * 60);
}

function sortRunners(items) {
  return [...items].sort((a, b) => Number(a.etappe || 0) - Number(b.etappe || 0));
}

function getActualForRunner(runnerId) {
  return actuals.find((a) => String(a.runner_id) === String(runnerId));
}

function calculateSchedule() {
  const sorted = sortRunners(runners);
  let lastStart = null;
  return sorted.map((runner) => {
    const actual = getActualForRunner(runner.id);
    const minutes = estimateMinutes(runner);
    const start = actual?.faktisk_vekslingstid || lastStart;
    const estimatedNext = start && minutes ? addMinutes(start, minutes) : null;
    if (estimatedNext) lastStart = estimatedNext;
    return { runner, actual, start, estimatedNext, minutes };
  });
}

function initSupabase() {
  if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) {
    setStatus("Mangler Supabase");
    return;
  }
  supabaseClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
}

async function loadData() {
  if (!supabaseClient) return;
  setStatus("Synker...");
  const [runnerRes, actualRes] = await Promise.all([
    supabaseClient.from(TABLE_RUNNERS).select("*").order("etappe", { ascending: true }),
    supabaseClient.from(TABLE_ACTUALS).select("*")
  ]);

  if (runnerRes.error || actualRes.error) {
    console.error(runnerRes.error || actualRes.error);
    setStatus("Feil ved synk");
    return;
  }

  runners = runnerRes.data || [];
  actuals = actualRes.data || [];
  renderAll();
  setStatus("Synket " + new Date().toLocaleTimeString("no-NO", { hour: "2-digit", minute: "2-digit" }));
}

function renderRunnerSelect() {
  const select = el("runnerSelect");
  select.innerHTML = "";
  sortRunners(runners).forEach((runner) => {
    const option = document.createElement("option");
    option.value = runner.id;
    option.textContent = `${runner.etappe} - ${runner.navn || "Uten navn"}`;
    select.appendChild(option);
  });
}

function renderNextRunner() {
  const schedule = calculateSchedule();
  const next = schedule.find((item) => !item.actual?.faktisk_vekslingstid);
  el("nextRunner").textContent = next
    ? `Etappe ${next.runner.etappe}: ${next.runner.navn || "Uten navn"}`
    : "Alle registrerte vekslinger er lagt inn";
}

function renderRunnerList() {
  const list = el("runnerList");
  list.innerHTML = "";

  sortRunners(runners).forEach((runner) => {
    const card = document.createElement("div");
    card.className = "runner-card";
    card.innerHTML = `
      <div class="grid">
        <input data-field="etappe" type="number" value="${runner.etappe ?? ""}" placeholder="Etappe" />
        <input data-field="navn" type="text" value="${runner.navn ?? ""}" placeholder="Navn" />
      </div>
      <div class="grid">
        <input data-field="distanse_km" type="number" step="0.01" value="${runner.distanse_km ?? ""}" placeholder="Km" />
        <input data-field="hastighet_kmt" type="number" step="0.1" value="${runner.hastighet_kmt ?? ""}" placeholder="Km/t" />
      </div>
      <div class="runner-actions">
        <button class="save-runner" type="button">Lagre</button>
        <button class="remove-runner" type="button">Slett</button>
      </div>
    `;

    card.querySelector(".save-runner").addEventListener("click", async () => {
      const payload = {};
      card.querySelectorAll("input").forEach((input) => {
        const field = input.dataset.field;
        payload[field] = ["etappe", "distanse_km", "hastighet_kmt"].includes(field) ? Number(input.value) : input.value;
      });
      await supabaseClient.from(TABLE_RUNNERS).update(payload).eq("id", runner.id);
      await loadData();
    });

    card.querySelector(".remove-runner").addEventListener("click", async () => {
      if (!confirm(`Slette etappe ${runner.etappe} - ${runner.navn}?`)) return;
      await supabaseClient.from(TABLE_ACTUALS).delete().eq("runner_id", runner.id);
      await supabaseClient.from(TABLE_RUNNERS).delete().eq("id", runner.id);
      await loadData();
    });

    list.appendChild(card);
  });
}

function renderTimeline() {
  const timeline = el("timeline");
  timeline.innerHTML = "";

  calculateSchedule().forEach(({ runner, actual, start, estimatedNext, minutes }) => {
    const card = document.createElement("div");
    card.className = "time-card";
    card.innerHTML = `
      <div>
        <strong>${runner.etappe} - ${runner.navn || "Uten navn"}</strong>
        <div class="time-meta">Veksling: ${fmtTime(actual?.faktisk_vekslingstid)} · Neste estimat: ${fmtTime(estimatedNext)}</div>
        <div class="time-meta">${runner.distanse_km ?? "?"} km · ${runner.hastighet_kmt ?? "?"} km/t · ${minutes ?? "?"} min</div>
      </div>
      <span class="time-badge">${actual?.faktisk_vekslingstid ? "Registrert" : "Venter"}</span>
    `;
    timeline.appendChild(card);
  });
}

function renderAll() {
  renderRunnerSelect();
  renderNextRunner();
  renderRunnerList();
  renderTimeline();
}

async function registerChangeover() {
  const runnerId = el("runnerSelect").value;
  const time = el("actualTime").value;
  if (!runnerId || !time) return alert("Velg løper og tidspunkt først.");

  const payload = {
    runner_id: Number(runnerId),
    faktisk_vekslingstid: new Date(time).toISOString()
  };

  const existing = getActualForRunner(runnerId);
  const result = existing
    ? await supabaseClient.from(TABLE_ACTUALS).update(payload).eq("id", existing.id)
    : await supabaseClient.from(TABLE_ACTUALS).insert(payload);

  if (result.error) {
    console.error(result.error);
    alert("Kunne ikke lagre veksling. Sjekk Supabase-policy.");
    return;
  }

  await loadData();
}

async function addRunner() {
  const nextEtappe = runners.length ? Math.max(...runners.map((r) => Number(r.etappe || 0))) + 1 : 1;
  await supabaseClient.from(TABLE_RUNNERS).insert({
    etappe: nextEtappe,
    navn: "Ny løper",
    distanse_km: 1.5,
    hastighet_kmt: 12
  });
  await loadData();
}

async function resetRace() {
  if (!confirm("Start nytt løp? Dette sletter registrerte tider, men beholder løpere/oppsett.")) return;
  const { error } = await supabaseClient.from(TABLE_ACTUALS).delete().neq("id", 0);
  if (error) {
    alert("Kunne ikke nullstille tider. Kjør supabase.sql hvis delete-policy mangler.");
    console.error(error);
    return;
  }
  await loadData();
}

function bindEvents() {
  el("actualTime").value = oneMinuteAgoValue();
  el("oneMinuteAgoBtn").addEventListener("click", () => {
    el("actualTime").value = oneMinuteAgoValue();
  });
  el("registerBtn").addEventListener("click", registerChangeover);
  el("syncBtn").addEventListener("click", loadData);
  el("addRunnerBtn").addEventListener("click", addRunner);

  if (isAdmin()) {
    el("adminTools").classList.remove("hidden");
    el("resetRaceBtn").addEventListener("click", resetRace);
  }
}

async function boot() {
  initSupabase();
  bindEvents();
  await loadData();
  setInterval(loadData, 15000);
}

boot();
