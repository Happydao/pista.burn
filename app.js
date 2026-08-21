const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 6 });
const dateFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
let dashboard = null;
let activeRange = "all";

function formatNumber(value, useCompact = false) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "—";
  return (useCompact && Math.abs(parsed) >= 1_000_000 ? compact : nf).format(parsed);
}

function formatPrice(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? usd.format(parsed) : "—";
}

function formatDate(value) {
  if (!value) return "Awaiting first sync";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : `${dateFormat.format(date)} UTC`;
}

function renderStats(data) {
  const s = data.stats;
  document.querySelector("#total-burned").textContent = formatNumber(s.totalBurned, true);
  document.querySelector("#burn-count").textContent = nf.format(s.burnCount || 0);
  document.querySelector("#current-supply").textContent = formatNumber(s.currentSupply, true);
  document.querySelector("#burn-percent").textContent = `${formatNumber(s.burnedPercent)}% removed`;
  document.querySelector("#token-price").textContent = formatPrice(s.priceUsd);
  document.querySelector("#price-source").textContent = s.priceUsd ? "Live DexScreener market data" : "Market price not available yet";
  document.querySelector("#burn-value").textContent = s.burnedValueUsd
    ? `${usd.format(Number(s.burnedValueUsd))} at current price`
    : "Permanently removed from supply";
  document.querySelector("#last-updated").textContent = formatDate(data.updatedAt);
}

function renderBurns(burns) {
  const tbody = document.querySelector("#burn-table");
  if (!burns.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="table-message">No verified PISTA burns found yet. The engine is standing by.</td></tr>';
    return;
  }
  tbody.innerHTML = burns.map((burn, index) => `
    <tr>
      <td><span class="lap-number">#${String(burns.length - index).padStart(2, "0")}</span></td>
      <td><strong>${formatNumber(burn.amount)}</strong> <small>PISTA</small></td>
      <td>${formatDate(burn.timestamp)}</td>
      <td><a href="${burn.url}" target="_blank" rel="noreferrer">${burn.signature.slice(0, 7)}…${burn.signature.slice(-6)} ↗</a></td>
    </tr>`).join("");
}

function getChartPoints(data) {
  const allBurns = [...data.burns].filter((burn) => burn.timestamp).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const cutoff = activeRange === "all" ? null : Date.now() - Number(activeRange) * 86_400_000;
  const burns = cutoff ? allBurns.filter((burn) => new Date(burn.timestamp).getTime() >= cutoff) : allBurns;
  const current = Number(data.stats.currentSupply);
  if (!Number.isFinite(current) || !burns.length) return [];
  let supply = current + burns.reduce((sum, burn) => sum + Number(burn.amount), 0);
  const points = [{ date: new Date(burns[0].timestamp).getTime() - 1, supply }];
  burns.forEach((burn) => { supply -= Number(burn.amount); points.push({ date: new Date(burn.timestamp).getTime(), supply }); });
  return points;
}

function drawChart() {
  if (!dashboard) return;
  const canvas = document.querySelector("#supply-chart");
  const empty = document.querySelector("#chart-empty");
  const wrap = canvas.parentElement;
  const points = getChartPoints(dashboard);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(wrap.clientWidth, 320);
  const height = Math.max(wrap.clientHeight, 290);
  canvas.width = width * dpr; canvas.height = height * dpr;
  canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr); ctx.clearRect(0, 0, width, height);
  if (!points.length) { empty.hidden = false; canvas.hidden = true; return; }
  empty.hidden = true; canvas.hidden = false;

  const pad = { top: 28, right: 22, bottom: 42, left: width < 600 ? 16 : 74 };
  const min = Math.min(...points.map((p) => p.supply));
  const max = Math.max(...points.map((p) => p.supply));
  const spread = Math.max(max - min, max * 0.005, 1);
  const low = min - spread * .15; const high = max + spread * .15;
  const x = (i) => pad.left + (i / Math.max(points.length - 1, 1)) * (width - pad.left - pad.right);
  const y = (v) => pad.top + ((high - v) / (high - low)) * (height - pad.top - pad.bottom);

  ctx.font = '11px "Space Mono", monospace'; ctx.fillStyle = "#756f64"; ctx.strokeStyle = "rgba(18,18,18,.14)";
  for (let row = 0; row <= 4; row += 1) {
    const yy = pad.top + row * ((height - pad.top - pad.bottom) / 4);
    ctx.setLineDash([4, 6]); ctx.beginPath(); ctx.moveTo(pad.left, yy); ctx.lineTo(width - pad.right, yy); ctx.stroke();
    if (width >= 600) ctx.fillText(compact.format(high - row * ((high - low) / 4)), 4, yy + 4);
  }
  ctx.setLineDash([]);
  const gradient = ctx.createLinearGradient(0, pad.top, 0, height - pad.bottom);
  gradient.addColorStop(0, "rgba(244,74,46,.36)"); gradient.addColorStop(1, "rgba(244,74,46,0)");
  ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(x(i), y(p.supply)) : ctx.moveTo(x(i), y(p.supply)));
  ctx.lineTo(x(points.length - 1), height - pad.bottom); ctx.lineTo(x(0), height - pad.bottom); ctx.closePath(); ctx.fillStyle = gradient; ctx.fill();
  ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(x(i), y(p.supply)) : ctx.moveTo(x(i), y(p.supply)));
  ctx.strokeStyle = "#f44a2e"; ctx.lineWidth = 4; ctx.lineJoin = "miter"; ctx.stroke();
  points.slice(1).forEach((p, i) => { const xx = x(i + 1); const yy = y(p.supply); ctx.fillStyle = "#121212"; ctx.fillRect(xx - 5, yy - 5, 10, 10); ctx.fillStyle = "#ffc928"; ctx.fillRect(xx - 2, yy - 2, 4, 4); });
  const first = new Date(points[0].date).toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
  const last = new Date(points.at(-1).date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" });
  ctx.fillStyle = "#756f64"; ctx.fillText(first, pad.left, height - 15); ctx.fillText(last, width - pad.right - ctx.measureText(last).width, height - 15);
}

async function loadDashboard() {
  const notice = document.querySelector("#data-notice");
  try {
    const response = await fetch(`./data/dashboard.json?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    dashboard = await response.json();
    renderStats(dashboard); renderBurns(dashboard.burns || []); notice.hidden = true; drawChart();
  } catch (error) {
    notice.textContent = "Telemetry temporarily unavailable. The next hourly pit stop will retry automatically.";
    notice.classList.add("error");
    document.querySelector("#burn-table").innerHTML = '<tr><td colspan="4" class="table-message">Burn data could not be loaded.</td></tr>';
    console.error(error);
  }
}

document.querySelectorAll("[data-range]").forEach((button) => button.addEventListener("click", () => {
  activeRange = button.dataset.range;
  document.querySelectorAll("[data-range]").forEach((item) => item.classList.toggle("active", item === button));
  drawChart();
}));
window.addEventListener("resize", drawChart);
loadDashboard();
