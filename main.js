/**
 * Main Portfolio JavaScript
 * Handles: Theme switching, Vanta hero, Skills Constellation, Icon injection,
 *          Navbar morph, Scroll Indicator, Typewriter, Section Animations,
 *          Project card clicks, More-Projects toggle, Contact form mailto.
 */

// ========== ELEMENT REFERENCES ==========
const navbar = document.getElementById('navbar');
const hero = document.getElementById('hero');
const heroContent = document.querySelector('.hero-content');
const scrollIndicator = document.getElementById('scrollIndicator');
const navLinks = document.querySelectorAll('.nav-link');
const sections = document.querySelectorAll('section[id]');

// ========== THEME SWITCHING ==========
// Two themes ship in tokens.css: cyberpunk (default · night) and bone (day).
// Legacy stored values (obsidian, vapor, neon-cyber) migrate to cyberpunk.
const THEMES = ['cyberpunk', 'bone'];
function initThemeSwitcher() {
    let saved = 'cyberpunk';
    try {
        const raw = localStorage.getItem('sp-theme');
        saved = (raw === 'bone') ? 'bone' : 'cyberpunk';
    } catch (_) {}
    applyTheme(saved);

    document.querySelectorAll('.theme-switch button').forEach(btn => {
        btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
    });
}
function applyTheme(theme) {
    if (!THEMES.includes(theme)) return;
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('sp-theme', theme); } catch (_) {}
    document.querySelectorAll('.theme-switch button').forEach(b => {
        b.setAttribute('aria-pressed', b.dataset.theme === theme ? 'true' : 'false');
    });
}

// ========== VANTA NEURAL NETWORK BACKGROUND ==========
// Re-init on theme change so accent + bg track the active theme.
let vantaEffect = null;
function hexFromCssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (!v) return fallback;
    if (v.startsWith('#')) {
        const h = v.slice(1);
        const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
        return parseInt(full, 16);
    }
    return fallback;
}
function initVanta() {
    if (typeof VANTA === 'undefined' || !VANTA.NET) return;
    if (vantaEffect) { try { vantaEffect.destroy(); } catch (_) {} vantaEffect = null; }
    vantaEffect = VANTA.NET({
        el: hero,
        mouseControls: false,
        touchControls: false,
        gyroControls: false,
        minHeight: 200.00,
        minWidth: 200.00,
        scale: 1.00,
        scaleMobile: 1.00,
        color: hexFromCssVar('--accent', 0x66fcf1),
        backgroundColor: hexFromCssVar('--bg', 0x0b0c10),
        points: 10.0,
        maxDistance: 25.0,
        spacing: 18.0
    });
}

// ========== ICON INJECTION ==========
// Inline-fetch SVGs once per icon name and stamp them into [data-icon=name].
const iconCache = new Map();
async function injectIcons() {
    const targets = document.querySelectorAll('[data-icon]');
    if (!targets.length) return;
    const promises = [];
    targets.forEach(el => {
        const name = el.dataset.icon;
        if (!name || el.dataset.injected === '1') return;
        if (!iconCache.has(name)) {
            iconCache.set(name, fetch(`assets/icons/${name}.svg`).then(r => r.ok ? r.text() : '').catch(() => ''));
        }
        promises.push(iconCache.get(name).then(svg => {
            if (svg) {
                el.innerHTML = svg;
                el.dataset.injected = '1';
            }
        }));
    });
    await Promise.all(promises);
}

// ========== SCROLL-REVEAL NAVIGATION ==========
function handleNavbarTransform() {
    const scrollY = window.scrollY;
    if (scrollY > 100) navbar.classList.add('visible');
    else navbar.classList.remove('visible');

    if (scrollY > 200) navbar.classList.add('nav-scrolled');
    else navbar.classList.remove('nav-scrolled');

    if (heroContent) {
        const heroHeight = hero.offsetHeight;
        const fadeProgress = Math.min(1, scrollY / (heroHeight * 0.5));
        heroContent.style.opacity = 1 - fadeProgress;
        heroContent.style.transform = `translateY(${fadeProgress * -30}px)`;
    }
}

// ========== SCROLL INDICATOR ==========
function handleScrollIndicator() {
    if (!scrollIndicator) return;
    const scrollY = window.scrollY;
    const opacity = Math.max(0, 1 - scrollY / 200);
    scrollIndicator.style.opacity = opacity;
    scrollIndicator.style.pointerEvents = scrollY > 50 ? 'none' : 'auto';
}
if (scrollIndicator) {
    scrollIndicator.addEventListener('click', () => {
        const aboutSection = document.getElementById('about');
        if (aboutSection) aboutSection.scrollIntoView({ behavior: 'smooth' });
    });
}

// ========== ACTIVE SECTION HIGHLIGHTING ==========
function highlightActiveSection() {
    const scrollY = window.scrollY + 200;
    sections.forEach(section => {
        const sectionTop = section.offsetTop;
        const sectionHeight = section.offsetHeight;
        const sectionId = section.getAttribute('id');
        if (scrollY >= sectionTop && scrollY < sectionTop + sectionHeight) {
            navLinks.forEach(link => {
                link.classList.remove('active');
                if (link.getAttribute('href') === `#${sectionId}`) link.classList.add('active');
            });
        }
    });
}

// ========== TYPEWRITER EFFECT ==========
function typewriterEffect() {
    const heroName = document.getElementById('heroName');
    if (!heroName) return;
    const text = heroName.textContent;
    heroName.textContent = '';
    heroName.style.visibility = 'visible';
    let i = 0;
    const speed = 80;
    (function type() {
        if (i < text.length) {
            heroName.textContent += text.charAt(i++);
            setTimeout(type, speed);
        }
    })();
}

// ========== INTERSECTION OBSERVER FOR SECTION ANIMATIONS ==========
function initSectionAnimations() {
    const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (entry.isIntersecting) entry.target.classList.add('animate-in');
            else entry.target.classList.remove('animate-in');
        });
    }, { root: null, rootMargin: '0px', threshold: 0.15 });

    sections.forEach(section => {
        section.classList.add('fade-up');
        observer.observe(section);
    });
    document.querySelectorAll('.timeline-item').forEach((item, i) => {
        item.style.transitionDelay = `${i * 0.1}s`;
        item.classList.add('fade-up');
        observer.observe(item);
    });
    document.querySelectorAll('.project-card').forEach((card, i) => {
        card.style.transitionDelay = `${i * 0.15}s`;
        card.classList.add('fade-up');
        observer.observe(card);
    });
    document.querySelectorAll('.cert-card').forEach((card, i) => {
        card.style.transitionDelay = `${i * 0.1}s`;
        card.classList.add('fade-up');
        observer.observe(card);
    });
    document.querySelectorAll('.contact-card').forEach((card, i) => {
        card.style.transitionDelay = `${i * 0.08}s`;
        card.classList.add('fade-up');
        observer.observe(card);
    });
    document.querySelectorAll('.bento-tile').forEach((tile, i) => {
        tile.style.transitionDelay = `${i * 0.06}s`;
        tile.classList.add('fade-up');
        observer.observe(tile);
    });
}

// ========== SCROLL EVENT LISTENERS ==========
let ticking = false;
function onScroll() {
    if (!ticking) {
        window.requestAnimationFrame(() => {
            handleNavbarTransform();
            handleScrollIndicator();
            highlightActiveSection();
            ticking = false;
        });
        ticking = true;
    }
}
window.addEventListener('scroll', onScroll, { passive: true });

// ========== SMOOTH SCROLL FOR NAV LINKS ==========
navLinks.forEach(link => {
    link.addEventListener('click', e => {
        e.preventDefault();
        const target = document.querySelector(link.getAttribute('href'));
        if (target) target.scrollIntoView({ behavior: 'smooth' });
    });
});

// ========== CONTACT FORM (mailto) ==========
function initContactForm() {
    const form = document.getElementById('contactForm');
    if (!form) return;
    form.addEventListener('submit', e => {
        e.preventDefault();
        const name = (document.getElementById('cf-name').value || '').trim();
        const from = (document.getElementById('cf-email').value || '').trim();
        const body = (document.getElementById('cf-body').value || '').trim();
        const subject = encodeURIComponent(`Portfolio inquiry from ${name || '—'}`);
        const lines = [
            `From: ${name || '—'} <${from || '—'}>`,
            '',
            body
        ].join('\n');
        window.location.href = `mailto:potlurisravanth@gmail.com?subject=${subject}&body=${encodeURIComponent(lines)}`;
    });
}

// ========== INITIALIZE ON DOM READY ==========
document.addEventListener('DOMContentLoaded', () => {
    initThemeSwitcher();
    injectIcons();
    typewriterEffect();
    initSectionAnimations();
    handleNavbarTransform();
    handleScrollIndicator();
    initContactForm();
    initVanta();

    // Re-init Vanta whenever the theme attribute on <html> changes so
    // particle color + canvas background follow the active theme.
    const mo = new MutationObserver(() => initVanta());
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    // Clickable project cards (don't hijack inner links)
    document.querySelectorAll('.project-card[data-href]').forEach(card => {
        card.style.cursor = 'pointer';
        card.addEventListener('click', e => {
            if (e.target.closest('a')) return;
            const url = card.getAttribute('data-href');
            if (url) window.open(url, '_blank');
        });
    });

    // More-Projects toggle
    const moreProjectsBtn = document.getElementById('moreProjectsBtn');
    if (moreProjectsBtn) {
        moreProjectsBtn.addEventListener('click', () => {
            const hiddenProjects = document.querySelectorAll('.hidden-project');
            const isExpanded = moreProjectsBtn.getAttribute('aria-expanded') === 'true';
            hiddenProjects.forEach(project => {
                if (isExpanded) {
                    project.style.display = 'none';
                } else {
                    project.style.display = 'block';
                    project.classList.remove('animate-in');
                    setTimeout(() => project.classList.add('animate-in'), 50);
                }
            });
            moreProjectsBtn.setAttribute('aria-expanded', String(!isExpanded));
            moreProjectsBtn.innerHTML = isExpanded
                ? 'More Projects <span class="arrow-down-small"></span>'
                : 'Show Less <span class="arrow-up-small"></span>';
        });
    }
});
