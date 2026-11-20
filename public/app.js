const RULES = {
  duel: { label: "1v1", glyph: "1v1", size: 2, winners: 1, points: 3, desc: "Head to head" },
  tournament: { label: "Tournament", glyph: "3P", size: 3, winners: 1, points: 2, desc: "3 rotate, first to 10" },
  team: { label: "Team", glyph: "2v2", size: 4, winners: 2, points: 1, desc: "Two vs two" },
};
const TYPES = Object.keys(RULES);
// Categorical palettes per theme, validated for CVD separation in this order; light yellow takes dark text.
const PALETTES = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#0ca30c", "#9085e9", "#e66767"],
};
const DARK_TEXT = new Set(["#eda100"]);
const theme = () => (document.documentElement.dataset.theme === "light" ? "light" : "dark");
const REDUCED_MOTION = matchMedia("(prefers-reduced-motion: reduce)").matches;

const ICON = {
  trophy: `<svg class="trophy" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10v2h3v3a4 4 0 0 1-4 4h-.3A5 5 0 0 1 13 14.9V18h3v3H8v-3h3v-3.1A5 5 0 0 1 8.3 12H8a4 4 0 0 1-4-4V5h3V3zm0 4H6v1a2 2 0 0 0 1 1.7V7zm10 0v2.7A2 2 0 0 0 18 8V7h-1z"/></svg>`,
  trash: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10"/></svg>`,
  check: `<svg class="check" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7"/></svg>`,
  ball: `<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="17"/><path d="M20 12l6 4.5-2.3 7h-7.4L14 16.5z"/></svg>`,
};

const state = {
  players: [],
  matches: [],
  period: "all",
  draft: { type: "duel", players: [], winners: [] },
  drawerId: null,
  lastAdded: null,
};

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

/* ---------- API ---------- */

async function api(path, options = {}) {
  const headers = { "content-type": "application/json" };
  const pin = store.get("pin");
  if (pin) headers["x-pin"] = pin;
  const res = await fetch(path, { ...options, headers });
  if (res.status === 401 && options.method) {
    const entered = prompt("Enter the league PIN to make changes");
    if (!entered) throw new Error("PIN required");
    store.set("pin", entered);
    return api(path, options);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.status === 204 ? null : res.json();
}

async function load() {
  try {
    const data = await api("/api/state");
    state.players = data.players;
    state.matches = data.matches;
    $("#banner").hidden = true;
    render();
  } catch (err) {
    const banner = $("#banner");
    banner.textContent = `Could not load the league: ${err.message}`;
    banner.hidden = false;
  }
}

/* ---------- Helpers ---------- */

const player = (id) => state.players.find((p) => p.id === id);
const nameOf = (id) => player(id)?.name ?? "Unknown";
const colorOf = (id) => {
  const colors = PALETTES[theme()];
  return colors[Math.max(0, state.players.findIndex((p) => p.id === id)) % colors.length];
};
const initials = (name) => name.slice(0, 1).toUpperCase() + name.slice(1, 2).toLowerCase();
const avatar = (id, size = "") => {
  const c = colorOf(id);
  return `<span class="avatar ${size}" style="--c:${c};--ci:${DARK_TEXT.has(c) ? "#141414" : "#fff"}">${esc(initials(nameOf(id)))}</span>`;
};
const names = (ids) => ids.map(nameOf).join(" & ");
const losersOf = (m) => m.players.filter((p) => !m.winners.includes(p));
const pct = (x) => `${Math.round(x * 100)}%`;
const emptyState = (msg) => `<div class="empty">${ICON.ball}<div>${msg}</div></div>`;

function periodStart(period) {
  const now = new Date();
  if (period === "month") return new Date(now.getFullYear(), now.getMonth(), 1);
  if (period === "week") {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d;
  }
  return null;
}

function inPeriod() {
  const start = periodStart(state.period);
  return start ? state.matches.filter((m) => new Date(m.played_at) >= start) : state.matches;
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
function relTime(iso) {
  const secs = (new Date(iso) - Date.now()) / 1000;
  const units = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]];
  for (const [unit, size] of units) if (Math.abs(secs) >= size) return rtf.format(Math.round(secs / size), unit);
  return "just now";
}
const fullDate = (iso) => new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function countUp(root) {
  root.querySelectorAll("[data-count]").forEach((el) => {
    const to = Number(el.dataset.count);
    if (REDUCED_MOTION || !to) { el.textContent = to; return; }
    const t0 = performance.now();
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / 900);
      el.textContent = Math.round(to * (1 - (1 - k) ** 3));
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/* ---------- Stats ---------- */

function computeStats(matches) {
  const stats = new Map(state.players.map((p) => [p.id, {
    id: p.id, name: p.name, points: 0, played: 0, wins: 0, results: [],
    byType: Object.fromEntries(TYPES.map((t) => [t, { played: 0, wins: 0, points: 0 }])),
  }]));
  for (const m of matches) {
    for (const pid of m.players) {
      const s = stats.get(pid);
      const won = m.winners.includes(pid);
      const bucket = s.byType[m.type];
      s.played++; bucket.played++;
      if (won) { s.wins++; s.points += m.points; bucket.wins++; bucket.points += m.points; }
      s.results.push(won);
    }
  }
  const list = [...stats.values()];
  for (const s of list) {
    s.winRate = s.played ? s.wins / s.played : 0;
    s.ppm = s.played ? s.points / s.played : 0;
    let streak = 0;
    for (let i = s.results.length - 1; i >= 0 && s.results[i]; i--) streak++;
    s.streak = streak;
    let best = 0, cur = 0;
    for (const r of s.results) { cur = r ? cur + 1 : 0; best = Math.max(best, cur); }
    s.bestStreak = best;
  }
  list.sort((a, b) => b.points - a.points || b.winRate - a.winRate || b.played - a.played || a.name.localeCompare(b.name));
  for (const s of list) s.rank = 1 + list.filter((o) => o.points > s.points).length;
  return list;
}

function duelRecords(matches) {
  const rec = new Map();
  for (const m of matches) {
    if (m.type !== "duel") continue;
    const w = m.winners[0];
    const l = losersOf(m)[0];
    const key = `${w}:${l}`;
    rec.set(key, (rec.get(key) || 0) + 1);
  }
  return (a, b) => rec.get(`${a}:${b}`) || 0;
}

function pairRecords(matches) {
  const pairs = new Map();
  for (const m of matches) {
    if (m.type !== "team") continue;
    for (const [side, won] of [[m.winners, true], [losersOf(m), false]]) {
      const ids = [...side].sort((a, b) => a - b);
      const key = ids.join("-");
      const r = pairs.get(key) ?? { ids, wins: 0, played: 0 };
      r.played++;
      if (won) r.wins++;
      pairs.set(key, r);
    }
  }
  return [...pairs.values()]
    .map((r) => ({ ...r, rate: r.wins / r.played }))
    .sort((a, b) => b.rate - a.rate || b.wins - a.wins || b.played - a.played);
}

/* ---------- Render ---------- */

function render(animateChart = true) {
  const matches = inPeriod();
  const stats = computeStats(matches);
  $("#edition").textContent = `No. ${state.matches.length}`;
  $("#dateline").textContent = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  renderPeriod();
  renderKpis(matches, stats);
  renderPodium(stats);
  renderLeaderboard(stats);
  renderRace(matches, animateChart);
  renderH2H(matches);
  renderDuos(matches);
  renderFeed(matches);
  if (state.drawerId) renderDrawer(state.drawerId);
}

function renderPeriod() {
  const seg = $("#period");
  let active;
  seg.querySelectorAll("button").forEach((b) => {
    const on = b.dataset.period === state.period;
    b.setAttribute("aria-selected", on);
    if (on) active = b;
  });
  const thumb = $(".seg-thumb", seg);
  thumb.style.width = `${active.offsetWidth}px`;
  thumb.style.transform = `translateX(${active.offsetLeft}px)`;
}

function renderKpis(matches, stats) {
  const counts = Object.fromEntries(TYPES.map((t) => [t, matches.filter((m) => m.type === t).length]));
  const leader = stats[0]?.played ? stats[0] : null;
  const hot = [...stats].sort((a, b) => b.streak - a.streak)[0];
  const busy = [...stats].sort((a, b) => b.played - a.played)[0];
  const lastDays = new Set(matches.map((m) => m.played_at.slice(0, 10))).size;

  const cards = [
    {
      label: "Matches played",
      value: `<span data-count="${matches.length}">0</span>`,
      sub: `${counts.duel} 1v1, ${counts.tournament} tournament, ${counts.team} team`,
    },
    {
      label: "League leader",
      value: leader ? `${avatar(leader.id)}<span>${esc(leader.name)}</span>` : "-",
      sub: leader ? `${leader.points} pts at ${pct(leader.winRate)} win rate` : "No winner yet",
      player: leader?.id,
    },
    {
      label: "Longest run",
      value: hot?.streak ? `${avatar(hot.id)}<span data-count="${hot.streak}">0</span>` : "-",
      sub: hot?.streak ? `${esc(hot.name)}, ${hot.streak} win${hot.streak > 1 ? "s" : ""} in a row` : "Nobody on a run yet",
      player: hot?.streak ? hot.id : null,
    },
    {
      label: "Most active",
      value: busy?.played ? `${avatar(busy.id)}<span>${esc(busy.name)}</span>` : "-",
      sub: busy?.played ? `${busy.played} matches over ${lastDays} day${lastDays > 1 ? "s" : ""}` : "Go play a match",
      player: busy?.played ? busy.id : null,
    },
  ];
  const el = $("#kpis");
  el.innerHTML = cards.map((c) => `
    <div class="kpi" ${c.player ? `data-player="${c.player}"` : ""}>
      <div class="kpi-label">${c.label}</div>
      <div class="kpi-value">${c.value}</div>
      <div class="kpi-sub">${c.sub}</div>
    </div>`).join("");
  countUp(el);
}

function renderPodium(stats) {
  const el = $("#podium");
  const top = stats.filter((s) => s.played).slice(0, 3);
  if (!top.length) { el.innerHTML = emptyState("The podium is waiting for its first champion."); return; }
  const slots = [[top[1], 2], [top[0], 1], [top[2], 3]];
  const podium = slots.map(([s, place]) => {
    if (!s) return "<div></div>";
    const delay = { 1: 300, 2: 150, 3: 0 }[place];
    return `
      <div class="place place-${place}" data-player="${s.id}" style="--d:${delay}ms;--d2:${delay + 400}ms">
        ${avatar(s.id, "lg")}
        <div class="place-name">${esc(s.name)}</div>
        <div class="place-pts"><b data-count="${s.points}">0</b> pts</div>
        <div class="block"><span>${s.rank}</span></div>
      </div>`;
  }).join("");
  const [first, second] = top;
  const gap = second ? first.points - second.points : 0;
  const copy = !second
    ? `<b>${esc(first.name)}</b> has the table to themselves for now.`
    : gap === 0
      ? `<b>${esc(first.name)}</b> and <b>${esc(second.name)}</b> are level on ${first.points} points.`
      : `<b>${esc(first.name)}</b> leads by ${gap} point${gap === 1 ? "" : "s"} over <b>${esc(second.name)}</b>.`;
  el.innerHTML = `<div class="podium">${podium}</div><p class="lead-copy">${copy}</p>`;
  countUp(el);
}

const formDots = (results, n = 5) => {
  const last = results.slice(-n);
  const pad = Array(n - last.length).fill('<span class="res none"></span>');
  return pad.concat(last.map((w) => `<span class="res ${w ? "w" : "l"}">${w ? "W" : "L"}</span>`)).join("");
};

function renderLeaderboard(stats) {
  const el = $("#leaderboard");
  if (!stats.length) { el.innerHTML = emptyState("Add players to get started."); return; }
  const rows = stats.map((s) => `
    <tr class="${s.played ? "" : "dim"} ${s.played && s.rank === 1 ? "leader" : ""}" data-player="${s.id}" tabindex="0">
      <td class="rank">${s.played ? s.rank : "-"}</td>
      <td><div class="who">${avatar(s.id)}<span>${esc(s.name)}</span>${s.streak >= 2 ? `<span class="streak" data-tip="${s.streak} wins in a row">W${s.streak}</span>` : ""}</div></td>
      <td class="num cnum">${s.played}</td>
      <td class="num cnum hide-sm">${s.wins}</td>
      <td class="num cnum hide-sm">${s.played - s.wins}</td>
      <td class="hide-sm"><div class="rate"><div class="rate-bar"><span style="width:${s.winRate * 100}%"></span></div><span class="rate-n">${s.played ? pct(s.winRate) : "-"}</span></div></td>
      <td class="hide-md"><div class="split">${TYPES.map((t) => `<span class="mini type-${t}" data-tip="${RULES[t].label}: ${s.byType[t].wins} won of ${s.byType[t].played}">${RULES[t].glyph} ${s.byType[t].wins}</span>`).join("")}</div></td>
      <td class="hide-sm"><div class="form" data-tip="Last 5 results, oldest to newest">${formDots(s.results)}</div></td>
      <td class="pts" data-count="${s.points}">0</td>
    </tr>`).join("");
  el.innerHTML = `
    <table class="leaderboard">
      <thead><tr>
        <th>Pos</th><th>Player</th><th class="num">P</th><th class="num hide-sm">W</th><th class="num hide-sm">L</th>
        <th class="hide-sm">Win %</th><th class="hide-md">Wins by type</th><th class="hide-sm">Form</th><th class="num">Pts</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  countUp(el);
}

/* ---------- Points race chart ---------- */

function niceStep(max, ticks = 4) {
  const raw = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return Math.max(1, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag);
}

function renderRace(matches, animate) {
  const el = $("#race");
  const active = state.players.filter((p) => matches.some((m) => m.players.includes(p.id)));
  $("#race-legend").innerHTML = active.length > 1
    ? active.map((p) => `<span class="legend-item"><i style="background:${colorOf(p.id)}"></i>${esc(p.name)}</span>`).join("")
    : "";
  if (!matches.length) { el.innerHTML = emptyState("No matches in this period yet."); return; }

  const n = matches.length;
  const series = active.map((p) => {
    let total = 0;
    return { id: p.id, pts: [0, ...matches.map((m) => (total += m.winners.includes(p.id) ? m.points : 0))] };
  });
  const W = Math.max(300, el.clientWidth);
  const narrow = W < 560;
  const H = narrow ? 230 : 300;
  const M = { t: 14, r: narrow ? 12 : 104, b: 30, l: 34 };
  const top = Math.max(3, ...series.map((s) => s.pts[n]));
  const step = niceStep(top);
  const yMax = Math.ceil(top / step) * step;
  const x = (i) => M.l + (i / n) * (W - M.l - M.r);
  const y = (v) => M.t + (1 - v / yMax) * (H - M.t - M.b);

  let grid = "";
  for (let v = 0; v <= yMax; v += step) {
    grid += `<line class="grid ${v === 0 ? "base" : ""}" x1="${M.l}" x2="${W - M.r}" y1="${y(v)}" y2="${y(v)}"/>`;
    grid += `<text class="axis" x="${M.l - 10}" y="${y(v)}" text-anchor="end" dominant-baseline="middle">${v}</text>`;
  }
  const xStep = Math.max(1, Math.ceil(n / (narrow ? 4 : 8)));
  for (let i = xStep; i <= n; i += xStep) {
    grid += `<text class="axis" x="${x(i)}" y="${H - 8}" text-anchor="middle">#${i}</text>`;
  }

  const lines = series.map((s) => {
    const d = s.pts.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
    return `<path class="line ${animate ? "draw" : ""}" pathLength="1" style="stroke:${colorOf(s.id)}" d="${d}"/>`;
  }).join("");

  let labels = "";
  if (!narrow) {
    const ends = series.map((s) => ({ id: s.id, v: s.pts[n], y: y(s.pts[n]) })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 15);
    const overflow = ends.length ? ends[ends.length - 1].y - (H - M.b) : 0;
    if (overflow > 0) ends.forEach((e) => (e.y -= overflow));
    labels = ends.map((e) => `
      <g class="${animate ? "fade" : ""}">
        <circle class="end-dot" cx="${x(n)}" cy="${y(e.v)}" r="4" fill="${colorOf(e.id)}"/>
        <text class="end-label" x="${x(n) + 10}" y="${e.y}" dominant-baseline="middle">${esc(nameOf(e.id))} <tspan class="v">${e.v}</tspan></text>
      </g>`).join("");
  }

  el.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Cumulative points per player across matches">
      ${grid}${lines}${labels}
      <g class="hover" visibility="hidden">
        <line class="cross" y1="${M.t}" y2="${H - M.b}"/>
        ${series.map((s) => `<circle r="5" data-id="${s.id}" fill="${colorOf(s.id)}"/>`).join("")}
      </g>
      <rect class="hit" x="${M.l - 10}" y="0" width="${W - M.l - M.r + 20}" height="${H}"/>
    </svg>`;

  const svg = $("svg", el);
  const hover = $(".hover", svg);
  const hit = $(".hit", svg);
  hit.addEventListener("pointermove", (e) => {
    const box = svg.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const i = Math.min(n, Math.max(0, Math.round(((px - M.l) / (W - M.l - M.r)) * n)));
    hover.setAttribute("visibility", "visible");
    $(".cross", hover).setAttribute("x1", x(i));
    $(".cross", hover).setAttribute("x2", x(i));
    hover.querySelectorAll("circle").forEach((c) => {
      const s = series.find((ss) => ss.id === Number(c.dataset.id));
      c.setAttribute("cx", x(i));
      c.setAttribute("cy", y(s.pts[i]));
    });
    const ranked = [...series].sort((a, b) => b.pts[i] - a.pts[i]);
    const m = matches[i - 1];
    const head = m
      ? `<div class="tip-title">Match #${i} · ${RULES[m.type].label}</div><div class="tip-sub">${esc(names(m.winners))} won (+${m.points}) · ${esc(fullDate(m.played_at))}</div>`
      : `<div class="tip-title">Start of period</div><div class="tip-sub">Everyone at 0</div>`;
    showTip(head + ranked.map((s) => `<div class="tip-row"><i style="background:${colorOf(s.id)}"></i>${esc(nameOf(s.id))}<b>${s.pts[i]}</b></div>`).join(""), e.clientX, e.clientY);
  });
  hit.addEventListener("pointerleave", () => { hover.setAttribute("visibility", "hidden"); hideTip(); });
}

/* ---------- Head to head ---------- */

function renderH2H(matches) {
  const el = $("#h2h");
  const duels = matches.filter((m) => m.type === "duel");
  const ids = state.players.filter((p) => duels.some((m) => m.players.includes(p.id))).map((p) => p.id);
  if (ids.length < 2) { el.innerHTML = emptyState("Play some 1v1s to unlock the rivalry grid."); return; }
  const wins = duelRecords(duels);
  const head = ids.map((id) => `<th><div class="colhead" data-tip="${esc(nameOf(id))}">${avatar(id, "sm")}</div></th>`).join("");
  const rows = ids.map((a) => `
    <tr>
      <td><div class="rowhead" data-player="${a}">${avatar(a, "sm")}${esc(nameOf(a))}</div></td>
      ${ids.map((b) => {
        if (a === b) return `<td><div class="cell self"></div></td>`;
        const w = wins(a, b), l = wins(b, a);
        if (!w && !l) return `<td><div class="cell none" data-tip="${esc(nameOf(a))} and ${esc(nameOf(b))} have not played 1v1">·</div></td>`;
        const share = w / (w + l);
        const amount = Math.round(Math.abs(share - 0.5) * 2 * 85);
        const pole = share >= 0.5 ? "var(--pos)" : "var(--neg)";
        const tip = `${nameOf(a)} vs ${nameOf(b)}: ${w} win${w === 1 ? "" : "s"}, ${l} loss${l === 1 ? "" : "es"}`;
        return `<td><div class="cell" style="--bgc:color-mix(in oklab, ${pole} ${amount}%, var(--mid))" data-tip="${esc(tip)}">${w}-${l}</div></td>`;
      }).join("")}
    </tr>`).join("");
  el.innerHTML = `
    <table class="h2h"><thead><tr><th></th>${head}</tr></thead><tbody>${rows}</tbody></table>
    <div class="scale"><span>Losing</span><span class="scale-bar"></span><span>Winning</span></div>`;
}

/* ---------- Duos ---------- */

function renderDuos(matches) {
  const el = $("#duos");
  const pairs = pairRecords(matches).slice(0, 6);
  if (!pairs.length) { el.innerHTML = emptyState("Play a team match to find the dream team."); return; }
  el.innerHTML = pairs.map((p, i) => `
    <div class="duo" style="--d:${i * 50}ms">
      <span class="stack">${p.ids.map((id) => avatar(id)).join("")}</span>
      <div>
        <div class="duo-name">${esc(names(p.ids))}</div>
        <div class="duo-meta">${p.wins}-${p.played - p.wins} together · ${p.played} match${p.played === 1 ? "" : "es"}</div>
      </div>
      <div class="duo-rate">${pct(p.rate)}</div>
      <div class="duo-bar"><span style="width:${p.rate * 100}%"></span></div>
    </div>`).join("");
}

/* ---------- Feed ---------- */

function renderFeed(matches) {
  const el = $("#feed");
  const recent = matches.slice(-20).reverse();
  $("#feed-count").textContent = matches.length ? `Latest ${recent.length} of ${matches.length}` : "";
  if (!recent.length) { el.innerHTML = `<li>${emptyState("No matches yet. Hit Record match after your next game.")}</li>`; return; }
  el.innerHTML = recent.map((m, i) => {
    const losers = losersOf(m);
    return `
      <li class="match ${m.id === state.lastAdded ? "new" : ""}" style="--d:${Math.min(i, 10) * 35}ms">
        <span class="badge type-${m.type}">${RULES[m.type].label}<b>+${m.points}</b></span>
        <div class="match-body">
          <span class="side">${ICON.trophy}<span class="stack">${m.winners.map((id) => avatar(id, "sm")).join("")}</span>${esc(names(m.winners))}</span>
          <span class="vs">def.</span>
          <span class="side lose"><span class="stack">${losers.map((id) => avatar(id, "sm")).join("")}</span>${esc(names(losers))}</span>
        </div>
        <time datetime="${m.played_at}" data-tip="${esc(fullDate(m.played_at))}">${relTime(m.played_at)}</time>
        <button type="button" class="del" data-del="${m.id}" aria-label="Delete match">${ICON.trash}</button>
      </li>`;
  }).join("");
}

async function onDelete(btn) {
  if (!btn.classList.contains("armed")) {
    btn.classList.add("armed");
    btn.innerHTML = `${ICON.trash}Delete?`;
    setTimeout(() => {
      if (!btn.isConnected) return;
      btn.classList.remove("armed");
      btn.innerHTML = ICON.trash;
    }, 3000);
    return;
  }
  const id = Number(btn.dataset.del);
  try {
    await api(`/api/matches/${id}`, { method: "DELETE" });
    state.matches = state.matches.filter((m) => m.id !== id);
    render();
    toast("Match removed");
  } catch (err) {
    toast(err.message, true);
  }
}

/* ---------- Player drawer ---------- */

function bestBy(list, key) {
  return list.filter((x) => x[key] > 0).sort((a, b) => b[key] - a[key])[0];
}

function renderDrawer(id) {
  const matches = inPeriod();
  const s = computeStats(matches).find((x) => x.id === id);
  if (!s) return;
  const wins = duelRecords(matches);
  const opponents = state.players.filter((p) => p.id !== id).map((p) => ({ id: p.id, w: wins(id, p.id), l: wins(p.id, id) }));
  const victim = bestBy(opponents, "w");
  const nemesis = bestBy(opponents, "l");
  const partner = pairRecords(matches).filter((p) => p.ids.includes(id))[0];

  const rival = (label, other, value) => other ? `
    <div class="rival" data-player="${other}">${avatar(other)}
      <div><div class="rival-l">${label}</div><div class="rival-n">${esc(nameOf(other))}</div></div>
      <div class="rival-v">${value}</div>
    </div>` : "";
  const rivals = [
    rival("Favourite opponent", victim?.id, victim && `${victim.w}-${victim.l}`),
    rival("Nemesis", nemesis?.id, nemesis && `${nemesis.w}-${nemesis.l}`),
    rival("Best partner", partner?.ids.find((x) => x !== id), partner && pct(partner.rate)),
  ].join("");

  $("#drawer-body").innerHTML = `
    <div class="profile-head">
      ${avatar(id, "xl")}
      <div>
        <h2>${esc(s.name)}</h2>
        <div class="profile-rank">${s.played ? `Rank <b>#${s.rank}</b> · ${s.points} pts` : "No matches in this period"}</div>
      </div>
    </div>
    <div class="tiles">
      <div class="tile"><div class="tile-v" data-count="${s.played}">0</div><div class="tile-l">Played</div></div>
      <div class="tile"><div class="tile-v" data-count="${s.wins}">0</div><div class="tile-l">Wins</div></div>
      <div class="tile"><div class="tile-v">${s.played ? pct(s.winRate) : "-"}</div><div class="tile-l">Win rate</div></div>
      <div class="tile"><div class="tile-v">${s.ppm.toFixed(2)}</div><div class="tile-l">Points per match</div></div>
      <div class="tile"><div class="tile-v" data-count="${s.streak}">0</div><div class="tile-l">Current streak</div></div>
      <div class="tile"><div class="tile-v" data-count="${s.bestStreak}">0</div><div class="tile-l">Best streak</div></div>
    </div>
    <div class="section-title">By match type</div>
    ${TYPES.map((t) => {
      const b = s.byType[t];
      return `<div class="type-row type-${t}">
        <span>${RULES[t].label}</span>
        <div class="bar" data-tip="${b.wins} won of ${b.played}"><span style="width:${b.played ? (b.wins / b.played) * 100 : 0}%"></span></div>
        <span class="v">${b.wins}/${b.played} · ${b.points}p</span>
      </div>`;
    }).join("")}
    <div class="section-title">Last 10 results</div>
    <div class="form">${formDots(s.results, 10)}</div>
    ${rivals ? `<div class="section-title">Rivals and partners</div><div class="rivals">${rivals}</div>` : ""}`;
  countUp($("#drawer-body"));
}

function openDrawer(id) {
  state.drawerId = id;
  renderDrawer(id);
  $("#drawer").classList.add("open");
  $("#drawer").setAttribute("aria-hidden", "false");
  $("#scrim").classList.add("show");
  $("#drawer-close").focus();
}

function closeDrawer() {
  state.drawerId = null;
  $("#drawer").classList.remove("open");
  $("#drawer").setAttribute("aria-hidden", "true");
  $("#scrim").classList.remove("show");
}

/* ---------- Record match ---------- */

function openRecord() {
  state.draft = { type: state.draft.type, players: [], winners: [] };
  renderRecord();
  $("#record").showModal();
}

function renderRecord() {
  const d = state.draft;
  const rule = RULES[d.type];

  $("#type-grid").innerHTML = TYPES.map((t) => `
    <button type="button" class="type-card type-${t}" data-type="${t}" aria-pressed="${d.type === t}">
      <span class="type-pts">+${RULES[t].points}${RULES[t].winners > 1 ? " each" : ""}</span>
      <div class="type-glyph">${RULES[t].glyph}</div>
      <div class="type-name">${RULES[t].label}</div>
      <div class="type-desc">${RULES[t].desc}</div>
    </button>`).join("");

  const full = d.players.length >= rule.size;
  $("#who-label").innerHTML = `Who played?<span class="count">${d.players.length}/${rule.size}</span>`;
  $("#who").innerHTML = state.players.map((p) => {
    const on = d.players.includes(p.id);
    return `<button type="button" class="chip" data-pick="${p.id}" aria-pressed="${on}" ${!on && full ? "disabled" : ""}>${avatar(p.id)}${esc(p.name)}${ICON.check}</button>`;
  }).join("");

  $("#win-label").innerHTML = `${rule.winners > 1 ? "Which two won?" : "Who won?"}<span class="count">${d.winners.length}/${rule.winners}</span>`;
  const winFull = d.winners.length >= rule.winners;
  $("#winners").innerHTML = full
    ? d.players.map((id) => {
      const on = d.winners.includes(id);
      return `<button type="button" class="chip win" data-win="${id}" aria-pressed="${on}" ${!on && winFull ? "disabled" : ""}>${avatar(id)}${esc(nameOf(id))}${ICON.check}</button>`;
    }).join("")
    : `<span class="hint">Pick all ${rule.size} players first.</span>`;

  const ready = full && winFull;
  const preview = $("#preview");
  preview.classList.toggle("ready", ready);
  preview.innerHTML = ready
    ? `${ICON.trophy}<span><b>${esc(names(d.winners))}</b> beat ${esc(names(d.players.filter((p) => !d.winners.includes(p))))}</span>
       <span class="gain">+${rule.points} ${rule.winners > 1 ? "each" : "pts"}</span>`
    : `<span>Select the players and the winner${rule.winners > 1 ? "s" : ""} to see the result.</span>`;
  $("#save-record").disabled = !ready;
}

function onRecordClick(e) {
  const d = state.draft;
  const typeBtn = e.target.closest("[data-type]");
  const pick = e.target.closest("[data-pick]");
  const win = e.target.closest("[data-win]");
  if (e.target.closest("[data-close]")) { $("#record").close(); return; }
  if (typeBtn) {
    d.type = typeBtn.dataset.type;
    d.players = d.players.slice(0, RULES[d.type].size);
    d.winners = [];
  } else if (pick) {
    const id = Number(pick.dataset.pick);
    d.players = d.players.includes(id) ? d.players.filter((x) => x !== id) : [...d.players, id];
    d.winners = d.winners.filter((x) => d.players.includes(x));
  } else if (win) {
    const id = Number(win.dataset.win);
    d.winners = d.winners.includes(id) ? d.winners.filter((x) => x !== id) : [...d.winners, id];
  } else {
    return;
  }
  renderRecord();
}

async function onAddPlayer() {
  const input = $("#new-player");
  const name = input.value.trim();
  if (!name) { input.focus(); return; }
  try {
    const p = await api("/api/players", { method: "POST", body: JSON.stringify({ name }) });
    state.players.push(p);
    input.value = "";
    if (state.draft.players.length < RULES[state.draft.type].size) state.draft.players.push(p.id);
    renderRecord();
    render(false);
    toast(`${p.name} joined the league`);
  } catch (err) {
    toast(err.message, true);
  }
}

async function onSave(e) {
  e.preventDefault();
  const d = state.draft;
  const btn = $("#save-record");
  btn.disabled = true;
  try {
    const match = await api("/api/matches", { method: "POST", body: JSON.stringify(d) });
    state.matches.push(match);
    state.lastAdded = match.id;
    $("#record").close();
    if (state.period !== "all" && !inPeriod().some((m) => m.id === match.id)) state.period = "all";
    render();
    confetti(match.winners.map(colorOf));
    toast(`${names(match.winners)} +${match.points}${match.winners.length > 1 ? " each" : ""}`);
  } catch (err) {
    toast(err.message, true);
    btn.disabled = false;
  }
}

/* ---------- Overlays ---------- */

const tipEl = $("#tooltip");
function showTip(html, cx, cy) {
  tipEl.innerHTML = html;
  tipEl.hidden = false;
  const r = tipEl.getBoundingClientRect();
  let left = cx + 16, top = cy + 16;
  if (left + r.width > innerWidth - 8) left = cx - r.width - 16;
  if (top + r.height > innerHeight - 8) top = cy - r.height - 16;
  tipEl.style.transform = `translate(${Math.max(8, left)}px, ${Math.max(8, top)}px)`;
}
function hideTip() { tipEl.hidden = true; }

function toast(msg, error = false) {
  const el = document.createElement("div");
  el.className = `toast ${error ? "error" : ""}`;
  el.textContent = msg;
  $("#toasts").append(el);
  setTimeout(() => { el.classList.add("out"); el.addEventListener("animationend", () => el.remove()); }, 2800);
}

function confetti(colors) {
  if (REDUCED_MOTION) return;
  const canvas = $("#confetti");
  const ctx = canvas.getContext("2d");
  const dpr = devicePixelRatio || 1;
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  ctx.scale(dpr, dpr);
  const palette = [...colors, "#d7261e", "#e0b43a", "#c99a1a"];
  const parts = Array.from({ length: 180 }, (_, i) => {
    const fromLeft = i % 2 === 0;
    const angle = (fromLeft ? -60 : -120) * (Math.PI / 180) + (Math.random() - 0.5) * 0.9;
    const speed = 9 + Math.random() * 9;
    return {
      x: fromLeft ? 0 : innerWidth, y: innerHeight * 0.75,
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      w: 6 + Math.random() * 6, h: 3 + Math.random() * 4,
      rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
      color: palette[i % palette.length],
    };
  });
  const t0 = performance.now();
  const frame = (now) => {
    const elapsed = now - t0;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.globalAlpha = Math.max(0, 1 - Math.max(0, elapsed - 1800) / 900);
    for (const p of parts) {
      p.vy += 0.28; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (elapsed < 2700) requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, innerWidth, innerHeight);
  };
  requestAnimationFrame(frame);
}

/* ---------- Wiring ---------- */

function skeleton() {
  $("#kpis").innerHTML = Array.from({ length: 4 }, () => `<div class="kpi"><div class="skeleton" style="height:12px;width:50%"></div><div class="skeleton" style="height:30px;width:70%"></div><div class="skeleton" style="height:12px;width:80%"></div></div>`).join("");
  for (const sel of ["#podium", "#leaderboard", "#race", "#h2h", "#duos", "#feed"]) {
    $(sel).innerHTML = `<div class="skeleton" style="height:${sel === "#race" ? 260 : 160}px;width:100%"></div>`;
  }
}

$("#period").addEventListener("click", (e) => {
  const b = e.target.closest("[data-period]");
  if (!b || b.dataset.period === state.period) return;
  state.period = b.dataset.period;
  store.set("period", state.period);
  render();
});

document.addEventListener("click", (e) => {
  const del = e.target.closest("[data-del]");
  if (del) { onDelete(del); return; }
  const p = e.target.closest("[data-player]");
  if (p && !e.target.closest("dialog")) openDrawer(Number(p.dataset.player));
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && state.drawerId) closeDrawer();
  if (e.key === "Enter" && e.target.matches("tr[data-player]")) openDrawer(Number(e.target.dataset.player));
});
document.addEventListener("pointermove", (e) => {
  const t = e.target.closest?.("[data-tip]");
  if (t) showTip(esc(t.dataset.tip), e.clientX, e.clientY);
  else if (!e.target.closest?.(".hit")) hideTip();
});

$("#open-record").addEventListener("click", openRecord);
$("#record").addEventListener("click", (e) => { if (e.target === $("#record")) $("#record").close(); else onRecordClick(e); });
$("#record-form").addEventListener("submit", onSave);
$("#add-player").addEventListener("click", onAddPlayer);
$("#new-player").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); onAddPlayer(); } });
$("#scrim").addEventListener("click", closeDrawer);
$("#drawer-close").addEventListener("click", closeDrawer);

let resizeTimer;
addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { renderPeriod(); renderRace(inPeriod(), false); }, 150);
});

const THEME_LABEL = {
  dark: `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3.5"/><path d="M7.4 0h1.2v2.5H7.4zM7.4 13.5h1.2V16H7.4zM0 7.4h2.5v1.2H0zM13.5 7.4H16v1.2h-2.5z"/></svg>Day edition`,
  light: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.5 1.5A6.5 6.5 0 1 0 14.5 11 5.5 5.5 0 0 1 10.5 1.5z"/></svg>Night edition`,
};
function applyTheme(next) {
  document.documentElement.dataset.theme = next;
  $('meta[name="theme-color"]').content = next === "dark" ? "#171612" : "#f4f0e8";
  $("#theme-toggle").innerHTML = THEME_LABEL[next];
}
$("#theme-toggle").addEventListener("click", () => {
  const next = theme() === "dark" ? "light" : "dark";
  store.set("theme", next);
  applyTheme(next);
  render(false);
});

applyTheme(theme());
state.period = ["all", "month", "week"].includes(store.get("period")) ? store.get("period") : "all";
skeleton();
renderPeriod();
document.fonts?.ready.then(renderPeriod);
load();
