const accent = document.querySelector('.connexion-accent');
const mark = accent?.querySelector('span');

if (mark && typeof mark.animate === 'function') {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let visible = true;
  let timer;
  let animation;
  const canPlay = () => visible && !document.hidden && !reducedMotion.matches;

  function schedule(first = false) {
    clearTimeout(timer);
    if (!canPlay()) return;
    timer = setTimeout(() => {
      if (!canPlay()) return;
      const reverse = Math.random() < .5;
      animation = mark.animate([
        { transform: `translateX(${reverse ? 80 : -22}px)`, opacity: 0 },
        { opacity: .7, offset: .4 },
        { transform: `translateX(${reverse ? -22 : 80}px)`, opacity: 0 }
      ], { duration: 750 + Math.random() * 300, easing: 'ease-in-out' });
      animation.finished.then(() => schedule()).catch(() => {});
    }, first ? 1000 + Math.random() * 1000 : 9000 + Math.random() * 8000);
  }

  function update() {
    clearTimeout(timer);
    animation?.cancel();
    schedule();
  }

  reducedMotion.addEventListener('change', update);
  document.addEventListener('visibilitychange', update);
  window.addEventListener('pagehide', () => { visible = false; update(); });
  window.addEventListener('pageshow', () => { if (!visible) { visible = true; update(); } });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => {
      const nowVisible = entries[0].isIntersecting;
      if (nowVisible !== visible) { visible = nowVisible; update(); }
    }).observe(accent);
  }
  schedule(true);
}
