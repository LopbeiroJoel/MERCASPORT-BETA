// ===== 1. LES ÉLÉMENTS =====
const list = document.getElementById("offers-list");
const count = document.getElementById("offers-count");
const positionFilter = document.getElementById("filter-position");
const divisionFilter = document.getElementById("filter-division");
const locationFilter = document.getElementById("filter-location");
const detail = document.getElementById("ads-detail");     // la <dialog>
const content = document.getElementById("ads-content");    // la <div> qu'on remplit
const closeBtn = document.getElementById("x-detail");   // la croix

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
  p.textContent = label + " : " + value;
  content.appendChild(p);
}


let allAds = [];   // toutes les offres reçues du serveur, gardées pour le filtrage

// ===== 2. AFFICHER UNE LISTE D'OFFRES =====
function renderAds(ads) {
  list.innerHTML = "";                         // on vide la liste avant de la remplir
  count.textContent = ads.length + " offres";

  ads.forEach((ad) => {
    const li = document.createElement("li");          // la carte

    const title = document.createElement("h3");
    title.textContent = ad.title;

    const club = document.createElement("p");
    club.textContent = ad.club;

    const location = document.createElement("p");
    location.textContent = ad.location;

    const description = document.createElement("p");
    description.textContent = ad.short_description || ad.description;


    const button = document.createElement("button");
    button.textContent = "Voir les détails";
    button.addEventListener("click", () => {
      showDetail(ad);
    });
    li.appendChild(title);
    li.appendChild(club);
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
    renderAds(allAds);                         // au début : on affiche tout
    buildCheckboxes(positionFilter, "position", POSITION_ORDER);
    buildCheckboxes(divisionFilter, "division", DIVISION_ORDER);
    buildCheckboxes(locationFilter, "location");
  } catch (error) {
    console.error(error);
    count.textContent = "Impossible de charger les offres. Veuillez réessayer plus tard.";
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
  return value
    .toLowerCase()                          // "Défenseur Central" → "défenseur central"
    .normalize("NFD")                       // sépare chaque lettre de son accent : "é" → "e" + "´"
    .replace(/[\u0300-\u036f]/g, "");       // supprime les accents isolés → "defenseur central"
}
// ===== 6. FILTRER ET RÉAFFICHER =====
function applyFilters() {
  const search = normalizeText(document.getElementById("filter-search").value.trim());  
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

    return matchSearch && matchPosition && matchDivision && matchLocation;
  });

  renderAds(filtered);
}

// ===== 7. QUAND ÇA SE DÉCLENCHE =====
const filtersForm = document.getElementById("filters");

filtersForm.addEventListener("input", applyFilters);   // une case cochée ou une lettre tapée
filtersForm.addEventListener("reset", () => {
  setTimeout(applyFilters);                            // après la remise à zéro du formulaire
});

// ===== 8. AFFICHER LE DÉTAIL D'UNE OFFRE =====
function showDetail(ad) {
  content.innerHTML = "";                  // on vide le contenu de l'offre précédente

  const title = document.createElement("h2");
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

loadAds();