if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches && 'IntersectionObserver' in window) {
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('about-reveal');
        observer.unobserve(entry.target);
      }
    }
  }, { threshold: 0.1 });
  for (const section of document.querySelectorAll('.about-main > section')) observer.observe(section);
}
