/**
 * TeamHue landing — tiny progressive enhancements.
 * No framework, no dependencies: the page is fully functional without JS.
 */

// Sticky nav border on scroll
const nav = document.querySelector('.nav');
const onScroll = () => nav?.classList.toggle('scrolled', window.scrollY > 8);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

// Point the GitHub link at the real repo (set at build time if available)
const REPO = 'https://github.com/Edify01/teamhue';
const repoLink = document.getElementById('repo-link');
if (repoLink) repoLink.href = REPO;

// Accordion: keep only one FAQ open at a time for a tidier read
const faqs = [...document.querySelectorAll('details.faq')];
faqs.forEach((d) =>
  d.addEventListener('toggle', () => {
    if (d.open) faqs.filter((o) => o !== d && o.open).forEach((o) => (o.open = false));
  }),
);

// Reveal sections on scroll
if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.style.animation = 'fadeUp .5s cubic-bezier(.2,.8,.2,1) backwards';
        io.unobserve(e.target);
      });
    },
    { threshold: 0.12, rootMargin: '0px 0px -40px' },
  );
  document.querySelectorAll('.feature, .step, .install-card').forEach((el) => io.observe(el));
}

// Confirm the download exists; if not, guide the user to the repo instead of 404ing.
const dl = document.getElementById('download');
if (dl) {
  dl.addEventListener('click', async (e) => {
    try {
      const res = await fetch(dl.getAttribute('href'), { method: 'HEAD' });
      if (res.ok) return; // let the download proceed
    } catch {
      /* fall through */
    }
    e.preventDefault();
    window.open(`${REPO}/releases/latest`, '_blank', 'noopener');
  });
}
