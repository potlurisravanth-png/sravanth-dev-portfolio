/**
 * Main Portfolio JavaScript
 * Handles: Hero-to-Nav Transform, Scroll Indicator, Typewriter, Section Animations
 */

// ========== ELEMENT REFERENCES ==========
const navbar = document.getElementById('navbar');
const hero = document.getElementById('hero');
const heroContent = document.querySelector('.hero-content');
const scrollIndicator = document.getElementById('scrollIndicator');
const navLinks = document.querySelectorAll('.nav-link');
const sections = document.querySelectorAll('section[id]');

// ========== HERO-TO-NAVBAR TRANSFORMATION ==========
// Instead of sliding from top, navbar "emerges" from hero position
function handleNavbarTransform() {
    const heroRect = hero.getBoundingClientRect();
    const heroBottom = heroRect.bottom;
    const scrollY = window.scrollY;
    const heroHeight = hero.offsetHeight;

    // Calculate transition progress (0 = hero visible, 1 = hero scrolled away)
    const progress = Math.min(1, Math.max(0, scrollY / (heroHeight * 0.7)));

    if (scrollY > heroHeight - 150) {
        navbar.classList.add('visible');
    } else {
        navbar.classList.remove('visible');
    }

    // Fade out hero content as we scroll
    if (heroContent) {
        const fadeProgress = Math.min(1, scrollY / (heroHeight * 0.5));
        heroContent.style.opacity = 1 - fadeProgress;
        heroContent.style.transform = `translateY(${fadeProgress * -30}px)`;
    }
}

// ========== SCROLL INDICATOR ==========
function handleScrollIndicator() {
    const scrollY = window.scrollY;
    const opacity = Math.max(0, 1 - scrollY / 200);
    scrollIndicator.style.opacity = opacity;

    if (scrollY > 50) {
        scrollIndicator.style.pointerEvents = 'none';
    } else {
        scrollIndicator.style.pointerEvents = 'auto';
    }
}

// Click to scroll down
scrollIndicator.addEventListener('click', () => {
    const aboutSection = document.getElementById('about');
    if (aboutSection) {
        aboutSection.scrollIntoView({ behavior: 'smooth' });
    }
});

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
                if (link.getAttribute('href') === `#${sectionId}`) {
                    link.classList.add('active');
                }
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

    function type() {
        if (i < text.length) {
            heroName.textContent += text.charAt(i);
            i++;
            setTimeout(type, speed);
        }
    }

    // Start typing after a brief delay
    setTimeout(type, 500);
}

// ========== INTERSECTION OBSERVER FOR SECTION ANIMATIONS ==========
// IMPROVED: Animations trigger every time element enters viewport
function initSectionAnimations() {
    const observerOptions = {
        root: null,
        rootMargin: '0px',
        threshold: 0.15
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('animate-in');
            } else {
                // Remove class when out of view so it animates again
                entry.target.classList.remove('animate-in');
            }
        });
    }, observerOptions);

    // Observe all sections
    sections.forEach(section => {
        section.classList.add('fade-up');
        observer.observe(section);
    });

    // Observe timeline items for staggered animation
    const timelineItems = document.querySelectorAll('.timeline-item');
    timelineItems.forEach((item, index) => {
        item.style.transitionDelay = `${index * 0.1}s`;
        item.classList.add('fade-up');
        observer.observe(item);
    });

    // Observe project cards
    const projectCards = document.querySelectorAll('.project-card');
    projectCards.forEach((card, index) => {
        card.style.transitionDelay = `${index * 0.15}s`;
        card.classList.add('fade-up');
        observer.observe(card);
    });

    // Observe cert cards
    const certCards = document.querySelectorAll('.cert-card');
    certCards.forEach((card, index) => {
        card.style.transitionDelay = `${index * 0.1}s`;
        card.classList.add('fade-up');
        observer.observe(card);
    });

    // Observe skill tags
    const skillTags = document.querySelectorAll('.skill-tag');
    skillTags.forEach((tag, index) => {
        tag.style.transitionDelay = `${index * 0.03}s`;
        tag.classList.add('fade-up');
        observer.observe(tag);
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

window.addEventListener('scroll', onScroll);

// ========== SMOOTH SCROLL FOR NAV LINKS ==========
navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const targetId = link.getAttribute('href');
        const targetSection = document.querySelector(targetId);
        if (targetSection) {
            targetSection.scrollIntoView({ behavior: 'smooth' });
        }
    });
});

// ========== INITIALIZE ON DOM READY ==========
document.addEventListener('DOMContentLoaded', () => {
    typewriterEffect();
    initSectionAnimations();
    handleNavbarTransform();
    handleScrollIndicator();
});
