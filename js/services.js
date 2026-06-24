// ============================================
// SERVICES — render treatment cards + tabs
// ============================================
(function () {
  const grid = document.getElementById("serviceGrid");
  const tabs = document.querySelectorAll(".tab-btn");
  const treatmentSelect = document.getElementById("treatmentSelect");

  function renderGrid(tabKey) {
    grid.innerHTML = "";
    TREATMENTS[tabKey].forEach((t) => {
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

  // Populate booking dropdown with all treatments, grouped
  function populateSelect() {
    const sculptGroup = document.createElement("optgroup");
    sculptGroup.label = "Body sculpting";
    TREATMENTS.sculpt.forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = `${t.name} — ${formatCurrency(t.price)} (${t.duration})`;
      sculptGroup.appendChild(opt);
    });

    const faceGroup = document.createElement("optgroup");
    faceGroup.label = "Face rejuvenation";
    TREATMENTS.face.forEach((t) => {
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

  renderGrid("sculpt");
  populateSelect();
})();
