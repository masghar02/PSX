function riskColor(risk) {
  console.log("mutual-funds.js loaded");
  const r = (risk || "").toLowerCase();

  if (r.includes("high")) return "risk-high";
  if (r.includes("medium")) return "risk-medium";
  if (r.includes("low")) return "risk-low";

  return "risk-default";
}

function createFundCard(f) {
  const card = document.createElement("div");
  card.className = "bg-gray-900 border border-gray-700 rounded-xl p-4";

  const title = document.createElement("h3");
  title.className = "font-bold text-white mb-2";
  title.textContent = f.name;

  const category = document.createElement("p");
  category.className = "text-xs text-gray-500 mb-2";
  category.textContent = f.category || "N/A";

  const nav = document.createElement("p");
  nav.className = "text-sm text-gray-400";
  nav.textContent = `NAV: ${f.nav}`;

  const offer = document.createElement("p");
  offer.className = "text-sm text-gray-400";
  offer.textContent = `Offer: ${f.offer === "0.00" ? "N/A" : f.offer}`;

  const risk = document.createElement("p");
  risk.className = `text-xs mt-2 inline-block px-2 py-1 rounded border ${riskColor(f.risk)}`;
  risk.textContent = f.risk || "N/A";

  card.appendChild(title);
  card.appendChild(category);
  card.appendChild(nav);
  card.appendChild(offer);
  card.appendChild(risk);

  return card;
}

async function loadMutualFunds() {
  const container = document.getElementById("mutualFundsContainer");

  try {
    container.innerHTML = `<div class="text-gray-400 text-sm">Loading funds...</div>`;

    const res = await fetch("/api/hbl-funds");
    const json = await res.json();

    if (!json.success || !Array.isArray(json.funds)) {
      throw new Error("Invalid API response");
    }

    container.innerHTML = "";

    json.funds.forEach((f) => {
      container.appendChild(createFundCard(f));
    });

  } catch (err) {
    console.error(err);
    container.innerHTML = `<div class="text-red-400 text-sm">Failed to load funds</div>`;
  }
}

loadMutualFunds();