// ===== 1. RÉCUPÉRER LES ÉLÉMENTS DE LA PAGE =====

const list = document.getElementById("ads-list");       // la <ul> qui contiendra les cartes d'offres
const detail = document.getElementById("ads-detail");   // le <dialog> (la modale entière)
const content = document.getElementById("ads-content"); // la <div> dans la modale, vidée et remplie à chaque clic
const closeBtn = document.getElementById("x-detail");   // la croix, qui reste en place dans la modale
const API_URL = "";        // l'adresse de l'API
const adsStatus = document.getElementById("ads-status");   // le <p> qui affiche le nombre d'offres ou un message d'erreur
const previousBtn = document.getElementById("ads-previous");   // le bouton "Précédent" du carrousel
const nextBtn = document.getElementById("ads-next");           // le bouton "Suivant" du carrousel
// ===== 2. CHARGER LES OFFRES ET CRÉER LES CARTES =====

async function loadAds() {
  try {
    const response = await fetch(API_URL + "/ads");     // demande la liste à l'API
    if (!response.ok) {                                 // statut 404, 500... ?
      throw new Error("Erreur " + response.status);     // saute directement au catch
    }

    const ads = await response.json();                  // tableau complet des annonces
    const mostRecent = ads.slice(0, 8);                 // garde les 8 premières (les plus récentes)

    mostRecent.forEach(ad => {                          // pour chaque annonce ; "ad" = l'annonce en cours

      // --- La carte dans la liste ---
      const li = document.createElement("li");          // crée le <li> (le parent de la carte)
      const badge = document.createElement("div");        // crée le <div> de la carte
      badge.className = "job-card-badges";                    // lui donne une classe pour le style
      const positionBadge = document.createElement("span");        // crée le <span> du badge
      positionBadge.textContent = ad.position;                          // lui donne le poste de l'annonce
      const divisionBadge = document.createElement("span");        // crée le <span> du badge
      divisionBadge.textContent = ad.division;

      li.className = "job-card";

      const title = document.createElement("h3");       // crée le titre de la carte
      title.textContent = ad.title;                     // lui donne le titre de l'offre

      const name = document.createElement("p");         // crée un paragraphe pour le club
      name.className = "job-card-club";                          // lui donne une classe pour le style
      name.textContent = ad.club;                       // lui donne le nom du club

      const location = document.createElement("p");     // crée un paragraphe pour la localisation
      location.className = "job-card-location";                  // lui donne une classe pour le style
      location.textContent = ad.location;               // lui donne la localisation

      const description = document.createElement("p");  // crée un paragraphe pour la description
      description.className = "job-card-summary";              // lui donne une classe pour le style
      description.textContent = ad.short_description || ad.description; // le résumé, sinon la description
      badge.appendChild(positionBadge);                   // le badge va dans le <li> (en premier)
      badge.appendChild(divisionBadge);                   // le badge va dans le <li> (en premier)
      li.appendChild(badge);                            // le badge va dans le <li> (en premier)
      li.appendChild(title);                            // le titre va dans le <li> (en deuxième)
      li.appendChild(name);                             // puis le club
      li.appendChild(location);                         // puis la localisation
      li.appendChild(description);                      // puis la description
      list.appendChild(li);                             // le <li> rempli est accroché à la liste (une seule fois)

      // --- Le bouton "Voir les détails" ---
      const button = document.createElement("button");  // crée le bouton
      button.textContent = "Voir les détails";              // son texte

      button.addEventListener("click", async () => {    // s'exécute AU CLIC uniquement
        try {
          const response = await fetch(API_URL + "/ads/" + ad.id);  // demande CETTE annonce à l'API
          if (!response.ok) {
            throw new Error("Erreur " + response.status);
          }
          const data = await response.json();           // l'annonce complète (un objet)

          content.innerHTML = "";                       // vide la zone de contenu (la croix reste)

          const detailTitle = document.createElement("h2");
          detailTitle.textContent = data.title;
          content.appendChild(detailTitle);

          const club = document.createElement("p");
          club.textContent = "Club : " + data.club;
          content.appendChild(club);

          const place = document.createElement("p");
          place.textContent = "Ville : " + data.location;
          content.appendChild(place);

          const fullDescription = document.createElement("p");
          fullDescription.textContent = "Description : " + data.description;
          content.appendChild(fullDescription);

          detail.showModal();                           // ouvre la modale, une fois le contenu prêt
        } catch (error) {
          console.error(error);                         // message pour le développeur
        }
      });                                               // fin de l'écouteur du bouton

      li.appendChild(button);                           // le bouton est accroché à la carte, en dernier
    });                                                 // fin de la boucle
    adsStatus.textContent = mostRecent.length + " offres à découvrir.";
    previousBtn.removeAttribute("disabled");                       // active le bouton "Précédent"
    nextBtn.removeAttribute("disabled");                           // active le bouton "Suivant"
  } catch (error) {
    console.error(error);                               // message pour le développeur
    adsStatus.textContent = "Impossible de charger les offres. Veuillez réessayer plus tard.";  // message pour le visiteur
  
  } finally {
    list.setAttribute("aria-busy", "false");                       // le chargement est terminé, même si elle est vide
  }
}                                                       // fin de la fonction loadAds()

loadAds();                                              // appel de la fonction, une seule fois

// ===== 3. FERMETURE DE LA MODALE =====

closeBtn.addEventListener("click", () => {              // clic sur la croix
  detail.close();
});
previousBtn.addEventListener("click", () => {
    list.scrollBy({ left: -300, behavior: "smooth" });
    });
nextBtn.addEventListener("click", () => {
    list.scrollBy({ left: 300, behavior: "smooth" });
    });

detail.addEventListener("click", (event) => {           // clic n'importe où sur le <dialog>
  if (event.target === detail) {                        // seulement si c'est le fond assombri
    detail.close();
  }
});