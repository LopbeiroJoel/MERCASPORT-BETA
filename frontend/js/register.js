// =====================================================================
//  register.js — Page d'inscription MercaSport
//  Rôle du script :
//    1. afficher uniquement le bloc du rôle choisi (Joueur ou Club) ;
//    2. à l'envoi, vérifier les mots de passe, construire l'objet JSON
//       attendu par le serveur et l'envoyer à POST /auth/register ;
//    3. afficher la réponse du serveur (succès ou erreur).
// =====================================================================


// ===== 1. RÉCUPÉRER LES ÉLÉMENTS =====
// getElementById récupère l'ÉLÉMENT (qui ne bouge pas) : on peut le faire
// une seule fois, tout en haut, au chargement de la page.
const clubRadio = document.getElementById("club");               // la radio « Club »
const playerRadio = document.getElementById("player");           // la radio « Joueur »
const clubFields = document.getElementById("club-fields");       // le <fieldset> du profil club
const playerFields = document.getElementById("player-fields");   // le <fieldset> du profil joueur


// ===== 2. AFFICHER LE BON BLOC =====
// hidden   → le bloc est invisible ;
// disabled → les champs du bloc sont désactivés : le navigateur ne vérifie pas
//            leurs "required" et ils ne gênent pas l'envoi.
function updateFields() {
  if (playerRadio.checked) {
    // Joueur choisi : on montre et active le bloc joueur, on cache et désactive le bloc club
    playerFields.removeAttribute("hidden");
    playerFields.removeAttribute("disabled");
    clubFields.setAttribute("hidden", "");
    clubFields.setAttribute("disabled", "");
  } else if (clubRadio.checked) {
    // Club choisi : l'inverse
    clubFields.removeAttribute("hidden");
    clubFields.removeAttribute("disabled");
    playerFields.setAttribute("hidden", "");
    playerFields.setAttribute("disabled", "");
  }
  // Rien de coché : on ne touche à rien (les deux blocs restent cachés, comme dans le HTML)
}


// ===== 3. QUAND ÇA SE DÉCLENCHE =====
// "change" se déclenche quand la radio est cochée, à la souris OU au clavier.
playerRadio.addEventListener("change", () => {
  updateFields();
});
clubRadio.addEventListener("change", () => {
  updateFields();
});


// ===== 4. AU CHARGEMENT =====
// Si le navigateur restaure une radio déjà cochée (après un rafraîchissement),
// on affiche tout de suite le bon bloc.
updateFields();


// ===== 5. À L'ENVOI DU FORMULAIRE =====
const form = document.getElementById("register-form");         // le <form>
const message = document.getElementById("register-message");   // le <p> où on affiche succès ou erreurs
const button = document.getElementById("register-button");     // le bouton d'envoi du formulaire

// "submit" = l'utilisateur valide le formulaire (bouton ou touche Entrée).
// async : nécessaire pour pouvoir utiliser await (attendre la réponse du serveur).
form.addEventListener("submit", async (event) => {
  event.preventDefault();   // empêche le rechargement de la page : c'est notre script qui envoie

  // .value se lit ICI (dans le listener) : au moment du clic, l'utilisateur a déjà tout rempli.
  const password = document.getElementById("password").value;
  const confirmPassword = document.getElementById("confirm-password").value;

  // --- 5a. Vérifier que les deux mots de passe sont identiques ---
  if (password !== confirmPassword) {
    message.textContent = "Les mots de passe ne correspondent pas.";
    return;   // on arrête tout : rien n'est envoyé au serveur
  }

  message.textContent = "";   // tout va bien : on efface un ancien message d'erreur

  // --- 5b. Construire le profil selon le rôle ---
  // let (et pas const) : la variable est créée vide, puis remplie dans le if ou le else.
  let profile;

  if (playerRadio.checked) {
    // .value donne toujours du TEXTE : "182" ou "" si le champ est vide.
    const heightValue = document.getElementById("height_cm").value;

    // NOUVEAU : les postes cochés.
    // querySelectorAll récupère TOUTES les cases du groupe "positions" qui sont cochées (:checked).
    // Array.from(...).map(...) transforme cette liste de cases en tableau de leurs valeurs,
    // par exemple ["GOALKEEPER", "CENTRE_BACK"]. Aucune case cochée → tableau vide [].
    const checkedBoxes = document.querySelectorAll('input[name="positions"]:checked');
    const positions = Array.from(checkedBoxes).map((box) => box.value);

    profile = {
      first_name: document.getElementById("first_name").value.trim(),                // obligatoire
      last_name: document.getElementById("last_name").value.trim(),                  // obligatoire
      birth_date: document.getElementById("birth_date").value || null,               // "" → null
      positions: positions,                                                          // tableau, [] si aucun poste
      preferred_foot: document.getElementById("preferred_foot").value || null,       // "" → null
      height_cm: heightValue === "" ? null : Number(heightValue),                    // vide → null, sinon "182" → 182 (nombre)
      current_club: document.getElementById("current_club").value.trim() || null,    // "" → null
    };
  } else {
    profile = {
      name: document.getElementById("name").value.trim(),                     // obligatoire
      city: document.getElementById("city").value.trim(),                     // obligatoire
      divisions: document.getElementById("divisions").value.trim() || null,   // facultatif : "" → null
    };
  }

  // --- 5c. L'objet complet, au format attendu par le serveur (validation.js) ---
  const data = {
    email: document.getElementById("email").value.trim(),
    username: document.getElementById("username").value.trim(),
    password: password,   // pas de .trim() : les espaces font partie du mot de passe
    role: playerRadio.checked ? playerRadio.value : clubRadio.value,   // ternaire → "PLAYER" ou "CLUB"
    profile: profile,
  };

  // Affiche une COPIE de data avec le mot de passe masqué (data lui-même n'est pas modifié).
  console.log({ ...data, password: "***" });

  // --- 5d. Envoyer au serveur et afficher la réponse ---
  button.disabled = true;  // désactive le bouton pour éviter les clics multiples pendant l'attente de la réponse
  try {
    const response = await fetch("/auth/register", {
      method: "POST",                                    // POST = créer quelque chose sur le serveur
      headers: { "Content-Type": "application/json" },   // on prévient le serveur : c'est du JSON
      body: JSON.stringify(data),                        // objet JS → texte JSON (le réseau ne transporte que du texte)
    });

    const result = await response.json();   // la réponse du serveur (texte JSON) → objet JS

    if (response.ok) {
      // Code 200 à 299 (ici 201) : compte créé → { message: "Compte et profil créés.", ... }
      message.textContent = result.message;
    } else {
        if (result.fields) {
            message.textContent = "Erreur dans les champs : " + Object.values(result.fields).join(", ");
        } else {
        // Code 400, 409, 429, 503… → { error: "..." } déjà rédigé en français par le serveur
            message.textContent = result.error;
        }
    }
  } catch (error) {
    // Le serveur n'a pas répondu du tout (back éteint, pas de réseau…)
    // ou sa réponse n'était pas du JSON : on affiche un message fixe.
    console.error(error);   // message pour le développeur
    message.textContent = "Impossible de créer le compte. Veuillez réessayer plus tard.";
  } finally {
    button.disabled = false;   // on réactive le bouton, que la requête ait réussi ou échoué
  }
});   // fin du listener "submit"