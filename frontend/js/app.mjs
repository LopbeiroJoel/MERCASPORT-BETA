// Les URL relatives utilisent le même serveur que la page, en local et sur Vercel.
const list = document.getElementById('ads-list');
const detail = document.getElementById('ads-detail');
const content = document.getElementById('ads-content');
const closeBtn = document.getElementById('x-detail');
let detailRequest = 0;
const previousBtn = document.getElementById('ads-previous');
const nextBtn = document.getElementById('ads-next');
const status = document.getElementById('ads-status');
let allAds = [];

// Les flèches sont désactivées aux extrémités et si la liste ne déborde pas.
function updateCarouselControls() {
  const maximum = list.scrollWidth - list.clientWidth;
  if (previousBtn) previousBtn.disabled = list.scrollLeft <= 8;
  if (nextBtn) nextBtn.disabled = list.scrollLeft >= maximum - 8;
}

function scrollOffers(direction) {
  const card = list.querySelector('.job-card');
  if (!card) return;
  const gap = parseFloat(getComputedStyle(list).columnGap) || 0;
  list.scrollBy({
    left: direction * (card.getBoundingClientRect().width + gap),
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
  });
}

previousBtn?.addEventListener('click', () => scrollOffers(-1));
nextBtn?.addEventListener('click', () => scrollOffers(1));
list.addEventListener('scroll', updateCarouselControls, { passive: true });
// Observe aussi les changements de largeur dus au redimensionnement ou aux polices.
new ResizeObserver(updateCarouselControls).observe(list);

function paragraph(text) {
  const node = document.createElement('p');
  node.textContent = text;
  return node;
}

async function readJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Erreur HTTP ${response.status}`);
  return response.json();
}

async function showDetail(ad, button) {
  const request = ++detailRequest;
  button.disabled = true;
  content.replaceChildren(paragraph('Chargement de l’annonce…'));
  detail.showModal();
  try {
    // Le détail est relu depuis l’API au moment du clic.
    const data = await readJson(`/ads/${ad.id}`);
    if (request !== detailRequest || !detail.open) return;
    const title = document.createElement('h2');
    title.textContent = data.title;
    content.replaceChildren(title,
      paragraph(`Club : ${data.club}`),
      paragraph(`Localisation : ${data.location || 'Non précisée'}`),
      paragraph(`Description : ${data.description || data.short_description || 'Non précisée'}`));
  } catch {
    if (request === detailRequest && detail.open) {
      content.replaceChildren(paragraph('Impossible de charger cette annonce. Fermez cette fenêtre et réessayez.'));
    }
  } finally {
    button.disabled = false;
  }
}

// Charge les données et vérifie leur forme avant de les transmettre à l'affichage.
async function loadAds() {
  list.setAttribute('aria-busy', 'true');
  try {
    const ads = await readJson('/ads');
    if (!Array.isArray(ads)) throw new Error('Réponse API invalide');
    allAds = ads;
    renderAds(ads);
  } catch {
    // Remplace un ancien affichage par le message d'erreur, sans l'ajouter à la suite.
    list.replaceChildren();
    const item = document.createElement('li');
    item.className = 'job-listings-message';
    item.textContent = 'Impossible de charger les offres. Veuillez réessayer plus tard.';
    list.append(item);
    if (status) status.textContent = '';
  } finally {
    list.setAttribute('aria-busy', 'false');
    requestAnimationFrame(updateCarouselControls);
  }
}

// Affiche le tableau reçu ; cette fonction n'effectue aucune requête réseau.
function renderAds(ads) {
  list.replaceChildren();
  if (!ads.length) {
    const item = document.createElement('li');
    item.className = 'job-listings-message';
    item.textContent = 'Aucune annonce pour le moment.';
    list.append(item);
  }
  for (const ad of ads) {
    const item = document.createElement('li');
    item.className = 'job-card';
    const badges = document.createElement('div');
    badges.className = 'job-card-badges';
    for (const value of [ad.position, ad.division].filter(Boolean)) {
      const badge = document.createElement('span');
      badge.textContent = value;
      badges.append(badge);
    }
    const club = paragraph(ad.club || 'Club non précisé');
    club.className = 'job-card-club';
    const title = document.createElement('h3');
    title.textContent = ad.title;
    const location = paragraph(ad.location || 'Localisation non précisée');
    location.className = 'job-card-location';
    const summary = paragraph(ad.short_description || ad.description || '');
    summary.className = 'job-card-summary';
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Voir les détails';
    button.addEventListener('click', () => showDetail(ad, button));
    // textContent affiche les données de l'API comme du texte, sans interpréter de HTML.
    item.append(badges, club, title, location, summary, button);
    list.append(item);
  }
  if (status) status.textContent = ads.length
    ? `${ads.length} offres à découvrir · Faites défiler pour voir la suite.`
    : 'Revenez bientôt pour découvrir de nouvelles offres.';

  requestAnimationFrame(updateCarouselControls);
}

function normalizeText(value) {
  value = value ?? '';
  value = value.trim().toLowerCase();
  value = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return value;
}

const form = document.querySelector('.search form');
form.addEventListener('submit', event => {
  event.preventDefault();
  let formKeywords = form.querySelector('input[name="keywords"]');
  let valueKeywords = formKeywords.value;
  let formLocation = form.querySelector('input[name="location"]');
  let valueLocation = formLocation.value;
  let formCompany = form.querySelector('input[name="company"]');
  let valueCompany = formCompany.value;

  // on filtre les annonces en fonction des critères de recherche
  const adsFiltered = allAds.filter(ad => {
    return normalizeText(ad.title).includes(normalizeText(valueKeywords)) &&
      normalizeText(ad.location ?? '').includes(normalizeText(valueLocation)) &&
      normalizeText(ad.club).includes(normalizeText(valueCompany));
  });

  renderAds(adsFiltered);
});

closeBtn.addEventListener('click', () => detail.close());
detail.addEventListener('close', () => { detailRequest += 1; });
detail.addEventListener('click', event => {
  if (event.target === detail) detail.close();
});
loadAds();
