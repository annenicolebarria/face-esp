const heroRevealSelectors = [
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
const SUPABASE_URL = "https://ofvkhrqmswxzdikzsfsw.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_9MoVy3d-me0pPvY9T9FGUQ_cmCJVNwZ";

if (contactForm && contactFeedback) {
  const submitButton = contactForm.querySelector('button[type="submit"]');
  const defaultButtonLabel = submitButton ? submitButton.textContent : "Send Message";

  contactForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(contactForm);
    const name = String(formData.get("name") || "").trim();
    const email = String(formData.get("email") || "").trim();
    const message = String(formData.get("message") || "").trim();

    contactFeedback.className = "contact-feedback";

    if (name.length < 2 || email.length < 5 || message.length < 10) {
      contactFeedback.textContent = "Please complete all fields before sending your message.";
      contactFeedback.classList.add("is-error");
      return;
    }

    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "Sending...";
    }
    contactFeedback.textContent = "Sending your message...";

    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/contact_messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_PUBLISHABLE_KEY,
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          name,
          email,
          message,
          source: "website",
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.message || payload?.hint || "Message could not be sent right now.");
      }

      contactFeedback.textContent = "Message sent successfully. We will contact you soon.";
      contactFeedback.classList.add("is-success");
      contactForm.reset();
    } catch (error) {
      contactFeedback.textContent = error.message || "Message could not be sent right now.";
      contactFeedback.classList.add("is-error");
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = defaultButtonLabel;
      }
    }
  });
}

const backToTopLink = document.getElementById("footer-back-to-top");

if (backToTopLink) {
  backToTopLink.addEventListener("click", (event) => {
    event.preventDefault();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}
