document.addEventListener("DOMContentLoaded", () => {
  const CONFIG = {
    demoUrl: "https://liff.line.me/2009586903-hyNXZaW7",
    consultationUrl: "#contact",
    headerScrolledClass: "is-scrolled",
    revealClass: "is-visible",
    activeClass: "is-active",
    formEndpoint: "https://script.google.com/macros/s/AKfycbz8zBVqcxOQE-fRYh3Cc44DWPBb_vVNTnaQoQ4vgQNyYsPbKAEmhsiBHJC_VMbZVP0P/exec",
  };

  const $ = (selector, parent = document) => parent.querySelector(selector);
  const $$ = (selector, parent = document) => Array.from(parent.querySelectorAll(selector));

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const smoothScrollTo = (target) => {
    if (!target) return;
    target.scrollIntoView({
      behavior: prefersReducedMotion ? "auto" : "smooth",
      block: "start",
    });
  };

  const lockMenuBody = () => document.body.classList.add("menu-open");
  const unlockMenuBody = () => document.body.classList.remove("menu-open");

  const openBodyModalState = () => document.body.classList.add("modal-open");
  const closeBodyModalState = () => document.body.classList.remove("modal-open");

  const header = $(".site-header");
  const navToggle = $(".nav-toggle");
  const mobileNav = $(".mobile-nav");
  const mobileNavLinks = $$(".mobile-nav a");

  const updateHeaderState = () => {
    if (!header) return;
    header.classList.toggle(CONFIG.headerScrolledClass, window.scrollY > 10);
  };

  updateHeaderState();
  window.addEventListener("scroll", updateHeaderState);

  if (navToggle && mobileNav) {
    navToggle.addEventListener("click", () => {
      const expanded = navToggle.getAttribute("aria-expanded") === "true";
      navToggle.setAttribute("aria-expanded", String(!expanded));
      mobileNav.classList.toggle(CONFIG.activeClass, !expanded);

      if (!expanded) {
        lockMenuBody();
      } else {
        unlockMenuBody();
      }
    });

    mobileNavLinks.forEach((link) => {
      link.addEventListener("click", () => {
        mobileNav.classList.remove(CONFIG.activeClass);
        navToggle.setAttribute("aria-expanded", "false");
        unlockMenuBody();
      });
    });
  }

  $$('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener("click", (e) => {
      const href = anchor.getAttribute("href");
      if (!href || href === "#") return;

      const target = $(href);
      if (!target) return;

      e.preventDefault();
      smoothScrollTo(target);
    });
  });

  const modal = $(".modal");
  const modalCloseButtons = $$(".js-close-modal");
  const modalBackdrop = $(".modal-backdrop");
  const demoButtons = $$(".js-open-demo");
  const directDemoButtons = $$(".js-open-demo-direct");
  const consultationButtons = $$(".js-open-consultation");

  const openModal = () => {
    if (!modal) {
      window.open(CONFIG.demoUrl, "_blank", "noopener,noreferrer");
      return;
    }

    modal.classList.add(CONFIG.activeClass);
    modal.setAttribute("aria-hidden", "false");
    openBodyModalState();
  };

  const closeModal = () => {
    if (!modal) return;
    modal.classList.remove(CONFIG.activeClass);
    modal.setAttribute("aria-hidden", "true");
    closeBodyModalState();
  };

  demoButtons.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      openModal();
    });
  });

  directDemoButtons.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      window.open(CONFIG.demoUrl, "_blank", "noopener,noreferrer");
    });
  });

  consultationButtons.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      closeModal();
      const target = $(CONFIG.consultationUrl);
      if (target) smoothScrollTo(target);
    });
  });

  modalCloseButtons.forEach((btn) => {
    btn.addEventListener("click", closeModal);
  });

  if (modalBackdrop) {
    modalBackdrop.addEventListener("click", closeModal);
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });

  const revealElements = $$(".js-reveal");
  const staggerGroups = $$(".js-stagger");

  if ("IntersectionObserver" in window) {
    const revealObserver = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add(CONFIG.revealClass);
          observer.unobserve(entry.target);
        });
      },
      {
        threshold: 0.12,
        rootMargin: "0px 0px -5% 0px",
      }
    );

    revealElements.forEach((el) => revealObserver.observe(el));

    const staggerObserver = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;

          const items = $$(".js-stagger-item", entry.target);
          items.forEach((item, index) => {
            if (prefersReducedMotion) {
              item.classList.add(CONFIG.revealClass);
              return;
            }

            setTimeout(() => {
              item.classList.add(CONFIG.revealClass);
            }, index * 90);
          });

          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.15 }
    );

    staggerGroups.forEach((group) => staggerObserver.observe(group));
  } else {
    revealElements.forEach((el) => el.classList.add(CONFIG.revealClass));
    staggerGroups.forEach((group) => {
      $$(".js-stagger-item", group).forEach((item) => item.classList.add(CONFIG.revealClass));
    });
  }

  const hero = $(".hero");
  const heroGlows = $$(".hero-glow");

  if (hero && heroGlows.length && !prefersReducedMotion) {
    hero.addEventListener("mousemove", (e) => {
      const rect = hero.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;

      heroGlows.forEach((glow, index) => {
        const factor = index === 0 ? 12 : 18;
        glow.style.transform = `translate(${(x - 50) / factor}px, ${(y - 50) / factor}px)`;
      });
    });

    hero.addEventListener("mouseleave", () => {
      heroGlows.forEach((glow) => {
        glow.style.transform = "translate(0, 0)";
      });
    });
  }

  const tiltCards = $$(".js-tilt-card");
  const isDesktopPointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  if (isDesktopPointer && !prefersReducedMotion) {
    tiltCards.forEach((card) => {
      card.addEventListener("mousemove", (e) => {
        const rect = card.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const rotateX = ((y - rect.height / 2) / rect.height) * -5;
        const rotateY = ((x - rect.width / 2) / rect.width) * 5;

        card.style.transform = `perspective(900px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-2px)`;
      });

      card.addEventListener("mouseleave", () => {
        card.style.transform = "";
      });
    });
  }

  const faqItems = $$(".faq-item");

  faqItems.forEach((item) => {
    const button = $(".faq-question", item);
    const answer = $(".faq-answer", item);

    if (!button || !answer) return;

    button.addEventListener("click", () => {
      const isOpen = item.classList.contains(CONFIG.activeClass);

      faqItems.forEach((faq) => {
        faq.classList.remove(CONFIG.activeClass);
        const btn = $(".faq-question", faq);
        const panel = $(".faq-answer", faq);
        if (btn) btn.setAttribute("aria-expanded", "false");
        if (panel) panel.style.maxHeight = null;
      });

      if (!isOpen) {
        item.classList.add(CONFIG.activeClass);
        button.setAttribute("aria-expanded", "true");
        answer.style.maxHeight = answer.scrollHeight + "px";
      }
    });
  });

  const counters = $$(".js-counter");

  const animateCounter = (el) => {
    const target = Number(el.dataset.target || "0");
    const duration = Number(el.dataset.duration || "1200");
    const startTime = performance.now();

    const step = (currentTime) => {
      const progress = Math.min((currentTime - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const value = Math.floor(target * eased);

      el.textContent = value.toLocaleString("ja-JP");

      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        el.textContent = target.toLocaleString("ja-JP");
      }
    };

    requestAnimationFrame(step);
  };

  if ("IntersectionObserver" in window && counters.length) {
    const counterObserver = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          animateCounter(entry.target);
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.5 }
    );

    counters.forEach((counter) => counterObserver.observe(counter));
  }

  const filterButtons = $$(".js-filter-btn");
  const filterCards = $$(".js-filter-card");

  if (filterButtons.length && filterCards.length) {
    filterButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const category = btn.dataset.filter;

        filterButtons.forEach((b) => b.classList.remove(CONFIG.activeClass));
        btn.classList.add(CONFIG.activeClass);

        filterCards.forEach((card) => {
          const tags = (card.dataset.category || "").split(" ");
          const show = category === "all" || tags.includes(category);

          card.hidden = !show;
          card.classList.toggle("is-hidden", !show);
        });
      });
    });
  }

  const form = $(".contact-form");
  const formMessage = $(".form-message");

  const validators = {
    name: (value) => value.trim().length >= 2,
    business: (value) => value.trim().length >= 2,
    line: (value) => value.trim().length >= 2,
    email: (value) => {
      if (!value.trim()) return true;
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
    },
    message: (value) => value.trim().length >= 8,
  };

  const setFieldState = (field, isValid) => {
    const wrapper = field.closest(".field");
    if (!wrapper) return;
    wrapper.classList.toggle("is-error", !isValid);
    wrapper.classList.toggle("is-valid", isValid);
  };

  const validateField = (field) => {
    const validator = validators[field.name];
    if (!validator) return true;
    const valid = validator(field.value);
    setFieldState(field, valid);
    return valid;
  };

  async function submitLead(payload) {
    if (!CONFIG.formEndpoint || CONFIG.formEndpoint.includes("YOUR_WEBAPP_ID")) {
      throw new Error("FORM_ENDPOINT_NOT_SET");
    }

    const response = await fetch(CONFIG.formEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8",
      },
      body: JSON.stringify(payload),
    });

    const text = await response.text();

    let data = {};
    try {
      data = JSON.parse(text);
    } catch (error) {
      data = { status: response.ok ? "success" : "error" };
    }

    if (!response.ok || (data.status && data.status !== "success") || data.ok === false) {
      throw new Error(data.error || data.message || "SUBMIT_FAILED");
    }

    return data;
  }

  if (form) {
    const fields = $$("input, textarea, select", form);

    fields.forEach((field) => {
      field.addEventListener("blur", () => validateField(field));
      field.addEventListener("input", () => {
        const wrapper = field.closest(".field");
        if (wrapper && wrapper.classList.contains("is-error")) {
          validateField(field);
        }
      });
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      let isFormValid = true;

      fields.forEach((field) => {
        const valid = validateField(field);
        if (!valid) isFormValid = false;
      });

      if (!isFormValid) {
        if (formMessage) {
          formMessage.textContent = "入力内容をご確認ください。";
          formMessage.classList.add("is-error");
          formMessage.classList.remove("is-success");
        }
        return;
      }

      const submitBtn = $('button[type="submit"]', form);

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.dataset.originalText = submitBtn.textContent;
        submitBtn.textContent = "送信中...";
      }

      try {
        const payload = {
          mode: "lead",
          name: form.querySelector('[name="name"]').value.trim(),
          business: form.querySelector('[name="business"]').value.trim(),
          line: form.querySelector('[name="line"]').value.trim(),
          email: form.querySelector('[name="email"]').value.trim(),
          message: form.querySelector('[name="message"]').value.trim(),
          source: form.dataset.source || "line-booking-v5-final",
          page: window.location.href,
          userAgent: navigator.userAgent,
          submittedAt: new Date().toISOString(),
        };

        await submitLead(payload);

        form.reset();

        fields.forEach((field) => {
          const wrapper = field.closest(".field");
          if (wrapper) wrapper.classList.remove("is-valid", "is-error");
        });

        if (formMessage) {
          formMessage.textContent = "送信しました。ありがとうございます。";
          formMessage.classList.add("is-success");
          formMessage.classList.remove("is-error");
        }
      } catch (error) {
        if (formMessage) {
          if (String(error.message) === "FORM_ENDPOINT_NOT_SET") {
            formMessage.textContent = "フォーム送信先URLがまだ設定されていません。";
          } else {
            formMessage.textContent = "送信に失敗しました。時間をおいて再度お試しください。";
          }

          formMessage.classList.add("is-error");
          formMessage.classList.remove("is-success");
        }
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = submitBtn.dataset.originalText || "送信";
        }
      }
    });
  }

  const copyButtons = $$(".js-copy-demo-url");

  copyButtons.forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(CONFIG.demoUrl);
        const original = btn.textContent;
        btn.textContent = "コピーしました";
        setTimeout(() => {
          btn.textContent = original;
        }, 1400);
      } catch (error) {
        alert("コピーできませんでした");
      }
    });
  });

  const sections = $$("section[id]");
  const navLinks = $$('.site-nav a[href^="#"], .mobile-nav a[href^="#"]');

  if ("IntersectionObserver" in window && sections.length && navLinks.length) {
    const sectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const id = entry.target.getAttribute("id");

          navLinks.forEach((link) => {
            const href = link.getAttribute("href");
            link.classList.toggle(CONFIG.activeClass, href === `#${id}`);
          });
        });
      },
      {
        rootMargin: "-40% 0px -45% 0px",
        threshold: 0.01,
      }
    );

    sections.forEach((section) => sectionObserver.observe(section));
  }

  const yearEl = $(".js-year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  window.addEventListener("load", () => {
    $$(".js-reveal, .js-stagger-item").forEach((el) => {
      if (!el.classList.contains(CONFIG.revealClass)) {
        el.classList.add(CONFIG.revealClass);
      }
    });
  });
});