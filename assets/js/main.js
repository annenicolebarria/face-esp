const heroRevealSelectors = [
  ".hero-logo",
  ".hero-links a",
  ".hero-content h1",
  ".hero-content .hero-lead",
  ".hero-actions .btn",
  ".hero-social .social-link",
];

const sectionRevealSelectors = [
  ".services-intro > *",
  ".service-card",
  ".contact-copy > *",
  ".contact-form .form-field",
  ".contact-form .btn",
  ".contact-form .contact-feedback",
  ".footer-brand > *",
  ".footer-col h4",
  ".footer-col a",
  ".footer-bottom > *",
];

heroRevealSelectors.forEach((selector) => {
  document.querySelectorAll(selector).forEach((element) => {
    if (!element.hasAttribute("data-reveal")) {
      element.setAttribute("data-reveal", "");
    }
    element.classList.add("hero-reveal");
  });
});

sectionRevealSelectors.forEach((selector) => {
  document.querySelectorAll(selector).forEach((element) => {
    if (!element.hasAttribute("data-reveal")) {
      element.setAttribute("data-reveal", "");
    }
  });
});

const heroRevealItems = Array.from(document.querySelectorAll(".hero-reveal[data-reveal]"));
const revealItems = Array.from(document.querySelectorAll("[data-reveal]:not(.hero-reveal)"));

heroRevealItems.forEach((item, index) => {
  item.style.setProperty("--reveal-delay", `${(index % 6) * 70}ms`);
});

revealItems.forEach((item, index) => {
  item.style.setProperty("--reveal-delay", `${(index % 6) * 60}ms`);
});

const replayHeroReveal = () => {
  if (heroRevealItems.length === 0) return;
  heroRevealItems.forEach((item) => item.classList.remove("is-visible"));
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      heroRevealItems.forEach((item) => item.classList.add("is-visible"));
    });
  });
};

let heroWasAtTop = false;
const syncHeroReveal = () => {
  const isAtTopZone = window.scrollY < 120;
  if (isAtTopZone && !heroWasAtTop) {
    replayHeroReveal();
  } else if (!isAtTopZone && heroWasAtTop) {
    heroRevealItems.forEach((item) => item.classList.remove("is-visible"));
  }
  heroWasAtTop = isAtTopZone;
};

syncHeroReveal();
window.addEventListener("scroll", syncHeroReveal, { passive: true });

if (revealItems.length > 0) {
  if (!("IntersectionObserver" in window)) {
    revealItems.forEach((item) => item.classList.add("is-visible"));
  } else {
    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
          } else {
            entry.target.classList.remove("is-visible");
          }
        });
      },
      {
        threshold: 0.14,
        rootMargin: "0px 0px -6% 0px",
      }
    );

    revealItems.forEach((item) => revealObserver.observe(item));
  }
}

const contactForm = document.getElementById("contact-form");
const contactFeedback = document.getElementById("contact-feedback");

if (contactForm && contactFeedback) {
  contactForm.addEventListener("submit", (event) => {
    event.preventDefault();
    contactFeedback.textContent = "Message sent successfully. We will contact you soon.";
    contactForm.reset();
  });
}

const topBar = document.querySelector(".top-bar");
const inPageLinks = Array.from(document.querySelectorAll('a[href^="#"]'));

inPageLinks.forEach((link) => {
  const targetSelector = link.getAttribute("href");
  if (!targetSelector || targetSelector === "#") {
    return;
  }

  link.addEventListener("click", (event) => {
    const targetElement = document.querySelector(targetSelector);
    if (!targetElement) {
      return;
    }

    event.preventDefault();

    if (targetSelector === "#overview") {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    const headerOffset = topBar ? topBar.offsetHeight + 12 : 12;
    const targetTop = targetElement.getBoundingClientRect().top + window.scrollY - headerOffset;
    window.scrollTo({ top: Math.max(targetTop, 0), behavior: "smooth" });
  });
});
