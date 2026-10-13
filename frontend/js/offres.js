// ===== 1. LES ÉLÉMENTS =====
const list = document.getElementById("offers-list");
const count = document.getElementById("offers-count");
const positionFilter = document.getElementById("filter-position");
const divisionFilter = document.getElementById("filter-division");
const locationFilter = document.getElementById("filter-location");

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

    li.appendChild(title);
    li.appendChild(club);
    li.appendChild(location);
    li.appendChild(description);
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
    buildCheckboxes(positionFilter, "position");
    buildCheckboxes(divisionFilter, "division");
    buildCheckboxes(locationFilter, "location");
  } catch (error) {
    console.error(error);
    count.textContent = "Impossible de charger les offres. Veuillez réessayer plus tard.";
  }
}

// ===== 4. CRÉER LES CASES À COCHER D'UN FILTRE =====
// fieldset : le <fieldset> où ajouter les cases
// field    : le nom de la propriété dans les offres ("position", "division" ou "location")
function buildCheckboxes(fieldset, field) {
  const values = [...new Set(allAds.map((ad) => ad[field]))].filter(Boolean).sort();

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

// ===== 6. FILTRER ET RÉAFFICHER =====
function applyFilters() {
  const search = document.getElementById("filter-search").value.trim().toLowerCase();
  const positions = getChecked("position");
  const divisions = getChecked("division");
  const locations = getChecked("location");

  const filtered = allAds.filter((ad) => {
    // 1. La recherche : le titre OU le club contient le texte tapé
    const text = (ad.title + " " + ad.club).toLowerCase();
    const matchSearch = search === "" || text.includes(search);

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
loadAds();