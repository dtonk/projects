// emPloyeeMarket — everything below is invented, hardcoded, and forgotten on reload.
// No backend, no storage, no real money. It's a joke.

const DAN_MARKETS = [
  { q: "Dan has a new job by August 2026", line: 6, ends: "Aug 31, 2026" },
  { q: "Dan has a new job by end of September 2026", line: 11, ends: "Sep 30, 2026" },
  { q: "Dan has a new job by end of 2026", line: 19, ends: "Dec 31, 2026" },
  { q: "Dan has a new job by end of 2027", line: 34, ends: "Dec 31, 2027" },
  { q: "Dan pivots to full-time Lower Technology LLC instead", line: 48, ends: "Dec 31, 2026" },
  { q: 'Dan is still "exploring opportunities" in 2030', line: 62, ends: "Dec 31, 2030" },
];

const AI_MARKETS = [
  { q: "AI does Dan's job search for him by end of 2026", line: 89, ends: "Dec 31, 2026" },
  { q: "AI conducts Dan's next job interview by 2026", line: 77, ends: "Dec 31, 2026" },
  { q: "AI replaces most white-collar jobs by 2028", line: 71, ends: "Dec 31, 2028" },
  { q: "Mass tech layoffs blamed on AI by end of 2027", line: 84, ends: "Dec 31, 2027" },
  { q: "CEOs realize AI is more expensive than people but stubbornly stick with AI anyway", line: 85, ends: "Dec 31, 2027" },
  { q: "The AI bubble bursts by end of 2027", line: 79, ends: "Dec 31, 2027" },
];

function jitter(line) {
  // deviates randomly within 10% of the set line, clamped to a sane 1-99 range
  const delta = line * 0.1 * (Math.random() * 2 - 1);
  return Math.min(99, Math.max(1, Math.round(line + delta)));
}

function fakeVolume() {
  const v = Math.round(400 + Math.random() * 24000);
  return v >= 1000 ? `$${(v / 1000).toFixed(1)}k Vol.` : `$${v} Vol.`;
}

// Fake "historical" price path — a random walk that lands on today's line.
// Regenerated fresh every page load, same as everything else here.
function fakeHistory(finalValue, points = 18) {
  const path = [Math.min(95, Math.max(5, finalValue + (Math.random() * 30 - 15)))];
  for (let i = 1; i < points - 1; i++) {
    const prev = path[i - 1];
    const step = (Math.random() * 16 - 8);
    path.push(Math.min(97, Math.max(3, prev + step)));
  }
  path.push(finalValue);
  return path;
}

function sparklineSvg(values) {
  const w = 96;
  const h = 40;
  const pad = 3;
  const step = (w - pad * 2) / (values.length - 1);
  const coords = values.map((v, i) => {
    const x = pad + i * step;
    const y = pad + (1 - v / 100) * (h - pad * 2);
    return [x, y];
  });
  const line = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${pad},${h - pad} ${line} ${w - pad},${h - pad}`;
  return `
    <svg class="sparkline" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      <polygon class="sparkline-area" points="${area}"></polygon>
      <polyline class="sparkline-line" points="${line}"></polyline>
    </svg>
  `;
}

const cardHistories = new WeakMap();
const MAX_HISTORY_POINTS = 24;

function makeCard(market, idOverride) {
  const id = idOverride;
  const yes = jitter(market.line);
  const no = 100 - yes;
  const history = fakeHistory(yes);

  const card = document.createElement("div");
  card.className = "card";
  card.dataset.yes = yes;
  cardHistories.set(card, history);
  card.innerHTML = `
    <div class="card-title">${market.q}</div>
    <div class="chart-row">
      <div class="odds-stack">
        <span class="odds-pct">${yes}%</span>
        <div class="odds-label-row">
          <span class="odds-label">chance</span>
          <span class="odds-delta" data-delta></span>
        </div>
      </div>
      ${sparklineSvg(history)}
    </div>
    <div class="meter">
      <div class="meter-yes" style="width:${yes}%"></div>
      <div class="meter-gap"></div>
      <div class="meter-no" style="width:${no}%"></div>
    </div>
    <div class="buy-row">
      <button class="buy-btn buy-yes" data-side="yes">Buy Yes <span class="buy-price">${yes}¢</span></button>
      <button class="buy-btn buy-no" data-side="no">Buy No <span class="buy-price">${no}¢</span></button>
    </div>
    <div class="card-meta">
      <span>${fakeVolume()}</span>
      <span>Ends ${market.ends}</span>
    </div>
  `;

  card.querySelectorAll(".buy-btn").forEach((btn) => {
    btn.addEventListener("click", () => handleBuy(card, market, btn.dataset.side));
  });

  return card;
}

function handleBuy(card, market, side) {
  let yes = Number(card.dataset.yes);
  const nudge = 1 + Math.round(Math.random() * 4); // 1-5 points
  yes = side === "yes"
    ? Math.min(99, yes + nudge)
    : Math.max(1, yes - nudge);
  const no = 100 - yes;
  card.dataset.yes = yes;

  card.querySelector(".odds-pct").textContent = `${yes}%`;
  card.querySelector(".meter-yes").style.width = `${yes}%`;
  card.querySelector(".meter-no").style.width = `${no}%`;
  card.querySelector('[data-side="yes"] .buy-price').textContent = `${yes}¢`;
  card.querySelector('[data-side="no"] .buy-price').textContent = `${no}¢`;

  const history = cardHistories.get(card);
  history.push(yes);
  if (history.length > MAX_HISTORY_POINTS) history.shift();
  card.querySelector(".sparkline").outerHTML = sparklineSvg(history);

  const delta = card.querySelector("[data-delta]");
  const went = side === "yes" ? "up" : "down";
  delta.textContent = `${went === "up" ? "▲" : "▼"} ${nudge}%`;
  delta.className = `odds-delta show ${went}`;
  setTimeout(() => delta.classList.remove("show"), 1600);

  showToast(
    `Order placed: ${side.toUpperCase()} on "${market.q}" — not real, nothing was saved. 😄`
  );
}

let toastTimer;
function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}

function renderGroup(containerId, markets) {
  const container = document.getElementById(containerId);
  markets.forEach((market, i) => container.appendChild(makeCard(market, `${containerId}-${i}`)));
}

renderGroup("danMarkets", DAN_MARKETS);
renderGroup("aiMarkets", AI_MARKETS);

document.getElementById("walletBtn").addEventListener("click", () => {
  showToast("Wallet connected: 0xJOKE...LOL — Balance: $0.00 (this was never real)");
});
