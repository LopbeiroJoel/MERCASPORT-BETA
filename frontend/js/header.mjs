// Navigation mobile partagée : disclosure, sans modifier les liens ni l'authentification.
const header = document.querySelector('body > header');
const toggle = header?.querySelector('.header-toggle');

if (header && toggle) {
  const mobile = window.matchMedia('(max-width: 768px)');

  function setOpen(open, returnFocus = false) {
    header.classList.toggle('is-menu-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Fermer le menu' : 'Ouvrir le menu');
    if (returnFocus) toggle.focus();
  }

  function updateViewport() {
    setOpen(false);
    if (!mobile.matches && document.activeElement === toggle) {
      header.querySelector('a')?.focus();
    }
    toggle.hidden = !mobile.matches;
  }

  header.classList.add('header-ready');
  updateViewport();
  mobile.addEventListener('change', updateViewport);
  toggle.addEventListener('click', () => {
    setOpen(toggle.getAttribute('aria-expanded') !== 'true');
  });
  header.addEventListener('keydown', event => {
    if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
      setOpen(false, true);
    }
  });
  header.addEventListener('click', event => {
    if (mobile.matches && event.target.closest('a, #logout-button')) setOpen(false);
  });
  document.addEventListener('click', event => {
    if (!header.contains(event.target)) setOpen(false);
  });
  header.addEventListener('focusout', () => {
    // Laisse le navigateur placer le focus avant de vérifier s'il est sorti du menu.
    setTimeout(() => {
      if (!header.contains(document.activeElement)) setOpen(false);
    }, 0);
  });
}
