// ===== 1. LES ÉLÉMENTS =====
const list = document.getElementById("offers-list");
const count = document.getElementById("offers-count");
const searchInput = document.getElementById("filter-search");
const locationInput = document.getElementById("filter-location-search");
const companyInput = document.getElementById("filter-company");

// L'URL fait le lien entre la recherche de l'accueil et les filtres de cette page.
const searchParams = new URLSearchParams(window.location.search);
searchInput.value = searchParams.get("keywords") ?? "";
locationInput.value = searchParams.get("location") ?? "";
companyInput.value = searchParams.get("company") ?? "";
const positionFilter = document.getElementById("filter-position");
const divisionFilter = document.getElementById("filter-division");
const locationFilter = document.getElementById("filter-location");
const detail = document.getElementById("ads-detail");     // la <dialog>
const content = document.getElementById("ads-content");    // la <div> qu'on remplit
const closeBtn = document.getElementById("x-detail");   // la croix
const applyForm = document.getElementById("apply-form");
const applyMessage = document.getElementById("apply-message");
const applyButton = document.getElementById("apply-submit");
// ===== ORDRES D'AFFICHAGE DES FILTRES =====
const POSITION_ORDER = [
  "Gardien",
  "Défenseur central", "Latéral droit", "Latéral gauche", "Piston droit", "Piston gauche",
  "Milieu défensif", "Milieu central", "Milieu offensif", "Milieu droit", "Milieu gauche",
  "Ailier droit", "Ailier gauche", "Avant-centre", "Buteur",
];

const DIVISION_ORDER = [
  "D8", "D7", "D6", "D5", "D4", "D3", "D2", "D1",
  "R3", "R2", "R1",
  "N3", "N2", "N1",
];

// Ajoute "Libellé : valeur" dans la modale, seulement si la valeur existe
function addLine(label, value) {
  if (!value) return;                      // pas de valeur → on n'ajoute rien
  const p = document.createElement("p");
  const heading = document.createElement("strong");
  heading.textContent = label;
  p.append(heading, document.createTextNode(value));
  p.className = "offer-detail-field";
  content.appendChild(p);
}

let currentAdId = null;   // l'id de l'offre affichée dans la modale (null = aucune)
let allAds = [];   // toutes les offres reçues du serveur, gardées pour le filtrage

// ===== 2. AFFICHER UNE LISTE D'OFFRES =====
function renderAds(ads) {
  list.innerHTML = "";                         // on vide la liste avant de la remplir
  count.textContent = ads.length + (ads.length === 1 ? " offre" : " offres");
  if (!ads.length) {
    const message = document.createElement("li");
    message.className = "offers-empty";
    message.textContent = "Aucune offre ne correspond à votre recherche. Modifiez les filtres ou réinitialisez-les.";
    list.appendChild(message);
  }

  ads.forEach((ad) => {
    const li = document.createElement("li");          // la carte
    li.className = "job-card";
    const badges = document.createElement("div");
    badges.className = "job-card-badges";
    for (const value of [ad.position, ad.division].filter(Boolean)) {
      const badge = document.createElement("span");
      badge.textContent = value;
      badges.appendChild(badge);
    }

    const title = document.createElement("h3");
    title.textContent = ad.title;

    const club = document.createElement("p");
    club.textContent = ad.club || "Club non précisé";
    club.className = "job-card-club";

    const location = document.createElement("p");
    location.textContent = ad.location || "Localisation non précisée";
    location.className = "job-card-location";

    const description = document.createElement("p");
    description.textContent = ad.short_description || ad.description || "";
    description.className = "job-card-summary";


    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Voir les détails";
    button.addEventListener("click", () => {
      showDetail(ad);
    });
    li.appendChild(badges);
    li.appendChild(club);
    li.appendChild(title);
    li.appendChild(location);
    li.appendChild(description);
    li.appendChild(button);    
    list.appendChild(li);                              // la carte est ajoutée à la liste
  });
}
// ===== 3. CHARGER LES OFFRES =====
async function loadAds() {
  try {
    const response = await fetch("/ads");
    if (!response.ok) {
      throw new Error("Erreur " + response.status);
    }
    allAds = await response.json();
    if (!Array.isArray(allAds)) throw new Error("Réponse API invalide");
    buildCheckboxes(positionFilter, "position", POSITION_ORDER);
    buildCheckboxes(divisionFilter, "division", DIVISION_ORDER);
    buildCheckboxes(locationFilter, "location");
    // Les cases existent seulement après le chargement des annonces.
    for (const [field, parameter] of [["position", "position"], ["division", "division"], ["location", "city"]]) {
      const selected = searchParams.getAll(parameter);
      for (const box of document.querySelectorAll(`input[name="${field}"][type="checkbox"]`)) {
        box.checked = selected.includes(box.value);
      }
    }
    applyFilters(); // Affiche directement les résultats, sans passer par toutes les offres.
  } catch (error) {
    console.error(error);
    count.textContent = "Impossible de charger les offres. Veuillez réessayer plus tard.";
  } finally {
    list.setAttribute("aria-busy", "false");
  }
}

// ===== 4. CRÉER LES CASES À COCHER D'UN FILTRE =====

// Trie values selon l'ordre de la liste order, sans tenir compte des majuscules ni des accents.
// Une valeur absente de order est placée à la fin, par ordre alphabétique.
function sortByOrder(values, order) {
  const normalizedOrder = order.map(normalizeText);   // ["gardien", "defenseur central", ...]

  function rank(value) {
    const index = normalizedOrder.indexOf(normalizeText(value));
    return index === -1 ? order.length : index;       // -1 = introuvable → à la fin
  }

  return values.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

// Crée une case à cocher par valeur différente trouvée dans les offres.
// fieldset : le <fieldset> où ajouter les cases
// field    : le nom de la propriété dans les offres ("position", "division" ou "location")
// order    : (facultatif) la liste qui donne l'ordre d'affichage

function buildCheckboxes(fieldset, field, order) {
  let values = [...new Set(allAds.map((ad) => ad[field]))].filter(Boolean);

  if (order) {
    values = sortByOrder(values, order);   // ordre personnalisé (postes, divisions)
  } else {
    values.sort();                         // sinon, ordre alphabétique (villes)
  }

  values.forEach((value) => {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.name = field;
    checkbox.value = value;

    label.appendChild(checkbox);
    label.append(" " + value);    // le texte affiché à côté de la case
    fieldset.appendChild(label);
  });
}

// ===== 5. LES VALEURS COCHÉES D'UN FILTRE =====
// renvoie par exemple ["R3", "R2"], ou [] si rien n'est coché
function getChecked(field) {
  const checkedBoxes = document.querySelectorAll('input[name="' + field + '"]:checked');
  return Array.from(checkedBoxes).map((box) => box.value);
}

// ===== RENDRE UN TEXTE COMPARABLE =====
// "Défenseur Central" → "defenseur central"
function normalizeText(value) {
  return (value ?? "")
    .trim()
    .toLowerCase()                          // "Défenseur Central" → "défenseur central"
    .normalize("NFD")                       // sépare chaque lettre de son accent : "é" → "e" + "´"
    .replace(/[\u0300-\u036f]/g, "");       // supprime les accents isolés → "defenseur central"
}
// ===== 6. FILTRER ET RÉAFFICHER =====
function applyFilters() {
  const search = normalizeText(searchInput.value);
  const locationSearch = normalizeText(locationInput.value);
  const companySearch = normalizeText(companyInput.value);
  const positions = getChecked("position");
  const divisions = getChecked("division");
  const locations = getChecked("location");

  const filtered = allAds.filter((ad) => {
    // 1. La recherche : le titre OU le club contient le texte tapé
    const text = normalizeText((ad.title || "") + " " + (ad.club || "") + " " + (ad.position || ""));
    const words = search.split(" ").filter(Boolean);              // "gardien strasbourg" → ["gardien", "strasbourg"]
    const matchSearch = words.every((word) => text.includes(word)); // chaque mot doit être présent

    // 2. Le poste : aucune case cochée, OU le poste de l'annonce fait partie des cases cochées
    const matchPosition = positions.length === 0 || positions.includes(ad.position);

    // 3. La division : même logique
    const matchDivision = divisions.length === 0 || divisions.includes(ad.division);

    // 4. La ville : même logique
    const matchLocation = locations.length === 0 || locations.includes(ad.location);

    // Les trois champs se combinent avec les cases à cocher, sans modifier allAds.
    const matchLocationSearch = normalizeText(ad.location).includes(locationSearch);
    const matchCompany = normalizeText(ad.club).includes(companySearch);
    return matchSearch && matchPosition && matchDivision && matchLocation && matchLocationSearch && matchCompany;
  });

  renderAds(filtered);
}

// Mémorise les filtres dans l'adresse sans recharger la page.
// "city" sert aux cases Ville, pour ne pas confondre avec le champ texte "location".
function updateSearchUrl() {
  const url = new URL(window.location.href);
  for (const [name, input] of [["keywords", searchInput], ["location", locationInput], ["company", companyInput]]) {
    const value = input.value.trim();
    if (value) url.searchParams.set(name, value);
    else url.searchParams.delete(name);
  }
  for (const [field, parameter] of [["position", "position"], ["division", "division"], ["location", "city"]]) {
    url.searchParams.delete(parameter);
    for (const value of getChecked(field)) url.searchParams.append(parameter, value);
  }
  window.history.replaceState(null, "", url);
}

// ===== 7. QUAND ÇA SE DÉCLENCHE =====
const filtersForm = document.getElementById("filters");

function refreshSearch() {
  applyFilters();
  updateSearchUrl();
}

filtersForm.addEventListener("input", refreshSearch);
filtersForm.addEventListener("submit", (event) => {
  event.preventDefault(); // Entrée applique les filtres sans recharger la page.
  refreshSearch();
});
filtersForm.addEventListener("reset", () => {
  // Attend que le navigateur ait réellement vidé les champs et décoché les cases.
  setTimeout(refreshSearch);
});

// ===== 8. AFFICHER LE DÉTAIL D'UNE OFFRE =====
function showDetail(ad) {
  currentAdId = ad.id;                 // on retient l'offre ouverte
  applyForm.reset();                   // on vide le formulaire
  applyMessage.textContent = "";     // on efface l'ancien message

  content.innerHTML = "";                  // on vide le contenu de l'offre précédente

  const title = document.createElement("h2");
  title.id = "offer-detail-title";
  title.textContent = ad.title;
  content.appendChild(title);

  addLine("Club", ad.club);
  addLine("Ville", ad.location);
  addLine("Poste", ad.position);
  addLine("Division", ad.division);
  addLine("Contrat", ad.contract);
  addLine("Rythme", ad.work_time);
  addLine("Rémunération", ad.salary);
  addLine("Profil recherché", ad.requirements);
  addLine("Missions", ad.missions);
  addLine("Description", ad.description);

  detail.showModal();                            // on ouvre la modale
}

closeBtn.addEventListener("click", () => {
  detail.close();
});

detail.addEventListener("click", (event) => {
  if (event.target === detail) {
    detail.close();
  }
});

// ===== Téléphone : on ne garde que les chiffres (et un + au début) =====
const phoneInput = document.getElementById("apply-phone");

phoneInput.addEventListener("input", () => {
  phoneInput.value = phoneInput.value.replace(/[^0-9+]/g, "");
});

// ===== 9. ENVOYER UNE CANDIDATURE =====
applyForm.addEventListener("submit", async (event) => {
  event.preventDefault();                                   // pas de rechargement de la page

  const data = {
    ad_id: currentAdId,                                  // l'offre ouverte
    name: document.getElementById("apply-name").value.trim(),
    email: document.getElementById("apply-email").value.trim(),
    phone: phoneInput.value || null, 
    message: document.getElementById("apply-text").value.trim() || null,
  };

  applyButton.disabled = true;                    // bloque le bouton pendant l'envoi
  applyMessage.textContent = "Envoi en cours…";

  try {
    const response = await fetch("/applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const result = await response.json();

    if (response.ok) {
      applyMessage.textContent = "Candidature envoyée ! Le club reviendra vers vous.";
      applyForm.reset();                         // on vide le formulaire après succès
    } else {
      applyMessage.textContent = result.error;   // message du serveur
    }
  } catch (error) {
    console.error(error);
    applyMessage.textContent = "Impossible de joindre le serveur. Réessayez plus tard.";
  } finally {
    applyButton.disabled = false;                  // on réactive le bouton
  }
});

loadAds();