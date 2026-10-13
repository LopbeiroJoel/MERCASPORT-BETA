// ===== 1. LES ÉLÉMENTS =====
const list = document.getElementById("offers-list");
const count = document.getElementById("offers-count");

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
  } catch (error) {
    console.error(error);
    count.textContent = "Impossible de charger les offres. Veuillez réessayer plus tard.";
  }
}

loadAds();