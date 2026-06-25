// ============================================
// SERVICES — render treatment cards + tabs
// ------------------------------------------------
// Treatments now come from Supabase (TreatmentStore) instead
// of a hardcoded TREATMENTS object, so admin edits appear here
// without any manual export/copy step.
// ============================================
(function () {
  const grid = document.getElementById("serviceGrid");
  const tabs = document.querySelectorAll(".tab-btn");
  const treatmentSelect = document.getElementById("treatmentSelect");

  // Cache of the active treatments, grouped by category, loaded once on
  // page load. booking.js reads this same cache via window.findTreatment.
  let treatmentsByCategory = { sculpt: [], face: [] };

  function renderGrid(tabKey) {
    grid.innerHTML = "";
    const items = treatmentsByCategory[tabKey] || [];

    if (items.length === 0) {
      grid.innerHTML = `<p class="field-hint">No treatments listed yet — check back soon.</p>`;
      return;
    }

    items.forEach((t) => {
      const card = document.createElement("article");
      card.className = "service-card";
      card.innerHTML = `
        <div class="service-card-head">
          <h3 class="service-name">${t.name}</h3>
          <span class="service-price">${formatCurrency(t.price)}</span>
        </div>
        <span class="service-duration">${t.duration}</span>
        <p class="service-desc">${t.desc}</p>
        <a href="#booking" class="btn btn-ghost" data-treatment-id="${t.id}">Book this</a>
      `;
      grid.appendChild(card);
    });
  }

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => {
        t.classList.remove("is-active");
        t.setAttribute("aria-selected", "false");
      });
      tab.classList.add("is-active");
      tab.setAttribute("aria-selected", "true");
      grid.dataset.activeTab = tab.dataset.tab;
      renderGrid(tab.dataset.tab);
    });
  });

  function populateSelect() {
    treatmentSelect.querySelectorAll("optgroup").forEach((g) => g.remove());

    const sculptGroup = document.createElement("optgroup");
    sculptGroup.label = "Body sculpting";
    treatmentsByCategory.sculpt.forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = `${t.name} — ${formatCurrency(t.price)} (${t.duration})`;
      sculptGroup.appendChild(opt);
    });

    const faceGroup = document.createElement("optgroup");
    faceGroup.label = "Face rejuvenation";
    treatmentsByCategory.face.forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = `${t.name} — ${formatCurrency(t.price)} (${t.duration})`;
      faceGroup.appendChild(opt);
    });

    treatmentSelect.appendChild(sculptGroup);
    treatmentSelect.appendChild(faceGroup);
  }

  // Clicking "Book this" on a card jumps to booking and preselects the treatment
  grid.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-treatment-id]");
    if (!btn) return;
    e.preventDefault();
    const id = btn.dataset.treatmentId;
    treatmentSelect.value = id;
    treatmentSelect.dispatchEvent(new Event("change"));
    document.getElementById("booking").scrollIntoView({ behavior: "smooth" });
  });

  // Exposes a synchronous lookup against the already-loaded cache, since
  // booking.js needs treatment details on every keystroke/step-change and
  // re-fetching from Supabase each time would be wasteful and slow.
  window.findTreatment = function (id) {
    return [...treatmentsByCategory.sculpt, ...treatmentsByCategory.face].find((t) => t.id === id);
  };

  async function init() {
    const all = await TreatmentStore.getActiveTreatments();
    treatmentsByCategory = {
      sculpt: all.filter((t) => t.category === "sculpt"),
      face: all.filter((t) => t.category === "face"),
    };
    renderGrid("sculpt");
    populateSelect();
    // Let booking.js know treatments are ready, in case it loaded first.
    document.dispatchEvent(new CustomEvent("treatments:ready"));
  }

  init();
})();
