const CONFIG = {
  demoUrl: "https://line-app-xi.vercel.app/",
  demoLeadUrl: "https://line-app-xi.vercel.app/?screen=lead",
  webhookUrl:
    "https://script.google.com/macros/s/AKfycbxyez8t9ni93cJrqdJxuyOYzUezCKEFr9Pr2cG9bQlZWsqnJInmJDPIake7Z1Esxx7z/exec",
  source: "line-booking-v3-site",
};

document.addEventListener("DOMContentLoaded", () => {
  initMobileNav();
  initReveal();
  initCounters();
  initFaq();
  initModal();
  initTilt();
  initContactForm();
  initYear();
  initSmoothCloseMobileNav();
});

function initMobileNav() {
  const body = document.body;
  const toggle = document.querySelector(".nav-toggle");
  const mobileNav = document.querySelector(".mobile-nav");

  if (!toggle || !mobileNav) return;

  toggle.addEventListener("click", () => {
    const isOpen = body.classList.toggle("menu-open");
    toggle.setAttribute("aria-expanded", String(isOpen));
  });
}

function initSmoothCloseMobileNav() {
  const body = document.body;
  const mobileLinks = document.querySelectorAll(".mobile-nav a");

  mobileLinks.forEach((link) => {
    link.addEventListener("click", () => {
      body.classList.remove("menu-open");
      const toggle = document.querySelector(".nav-toggle");
      if (toggle) toggle.setAttribute("aria-expanded", "false");
    });
  });
}

function initReveal() {
  const items = document.querySelectorAll(".reveal");
  if (!items.length) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    },
    {
      threshold: 0.14,
      rootMargin: "0px 0px -8% 0px",
    }
  );

  items.forEach((item) => observer.observe(item));
}

function initCounters() {
  const counters = document.querySelectorAll(".js-counter");
  if (!counters.length) return;

  const started = new WeakSet();

  const animateCounter = (el) => {
    if (started.has(el)) return;
    started.add(el);

    const target = Number(el.dataset.target || 0);
    const duration = 1200;
    const startTime = performance.now();

    const formatter =
      target >= 1000
        ? (value) => Math.floor(value).toLocaleString("ja-JP")
        : (value) => Math.floor(value).toString();

    const tick = (now) => {
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = formatter(target * eased);

      if (progress < 1) {
        requestAnimationFrame(tick);
      } else {
        el.textContent = formatter(target);
      }
    };

    requestAnimationFrame(tick);
  };

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          animateCounter(entry.target);
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.5 }
  );

  counters.forEach((counter) => observer.observe(counter));
}

function initFaq() {
  const items = document.querySelectorAll(".faq-item");

  items.forEach((item) => {
    const button = item.querySelector(".faq-question");
    if (!button) return;

    button.addEventListener("click", () => {
      const isOpen = item.classList.contains("is-open");

      items.forEach((other) => {
        other.classList.remove("is-open");
        const otherButton = other.querySelector(".faq-question");
        if (otherButton) otherButton.setAttribute("aria-expanded", "false");
      });

      if (!isOpen) {
        item.classList.add("is-open");
        button.setAttribute("aria-expanded", "true");
      }
    });
  });
}

function initModal() {
  const modal = document.getElementById("demoModal");
  const openers = document.querySelectorAll(".js-open-demo");
  const closeBtn = modal?.querySelector(".modal-close");
  const backdrop = modal?.querySelector(".modal-backdrop");

  if (!modal) return;

  const openModal = (e) => {
    if (e) e.preventDefault();
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  };

  const closeModal = () => {
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  };

  openers.forEach((btn) => btn.addEventListener("click", openModal));
  closeBtn?.addEventListener("click", closeModal);
  backdrop?.addEventListener("click", closeModal);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.classList.contains("is-open")) {
      closeModal();
    }
  });
}

function initTilt() {
  const cards = document.querySelectorAll(".tilt-card");
  if (!cards.length) return;

  const isTouch = window.matchMedia("(pointer: coarse)").matches;
  if (isTouch) return;

  cards.forEach((card) => {
    card.addEventListener("mousemove", (e) => {
      const rect = card.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width;
      const py = (e.clientY - rect.top) / rect.height;

      const rotateY = (px - 0.5) * 10;
      const rotateX = (0.5 - py) * 10;

      card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-2px)`;
    });

    card.addEventListener("mouseleave", () => {
      card.style.transform = "";
    });
  });
}

function initContactForm() {
  const form = document.getElementById("contactForm");
  const messageEl = document.getElementById("formMessage");
  const submitBtn = document.getElementById("submitBtn");

  if (!form || !messageEl || !submitBtn) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const honeypot = document.getElementById("website");
    if (honeypot && honeypot.value.trim() !== "") {
      return;
    }

    const name = (document.getElementById("name")?.value || "").trim();
    const business = (document.getElementById("business")?.value || "").trim();
    const line = (document.getElementById("line")?.value || "").trim();
    const email = (document.getElementById("email")?.value || "").trim();
    const message = (document.getElementById("message")?.value || "").trim();

    if (!name || !business || !line || !message) {
      setFormMessage("必須項目を入力してください。", "error");
      return;
    }

    const businessType = guessBusinessType(business, message);
    const contact = email ? `${line} / ${email}` : line;

    const payload = {
      mode: "lead",
      userId: "",
      displayName: "",
      salonName: business,
      ownerName: name,
      contact,
      businessType,
      needs: buildNeedsText({ line, email, message }),
      source: CONFIG.source,
    };

    try {
      submitBtn.disabled = true;
      submitBtn.textContent = "送信中...";
      setFormMessage("送信しています...", "");

      const response = await fetch(CONFIG.webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain;charset=utf-8",
        },
        body: JSON.stringify(payload),
      });

      let result = {};
      try {
        result = await response.json();
      } catch (jsonError) {
        result = { status: "ok" };
      }

      if (result.status === "error") {
        throw new Error("submit failed");
      }

      form.reset();
      setFormMessage("送信完了しました。内容を確認後、ご案内いたします。", "success");
    } catch (error) {
      console.error("Lead form submit error:", error);
      setFormMessage("送信に失敗しました。時間をおいて再度お試しください。", "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "無料で相談する";
    }
  });

  function setFormMessage(text, type) {
    messageEl.textContent = text;
    messageEl.classList.remove("is-success", "is-error");
    if (type === "success") messageEl.classList.add("is-success");
    if (type === "error") messageEl.classList.add("is-error");
  }
}

function buildNeedsText({ line, email, message }) {
  const parts = [
    "Landing page lead",
    `LINE or contact: ${line || "-"}`,
    `Email: ${email || "-"}`,
    `Message: ${message || "-"}`,
  ];
  return parts.join("\n");
}

function guessBusinessType(business, message) {
  const text = `${business} ${message}`.toLowerCase();

  if (text.includes("ネイル")) return "ネイル";
  if (text.includes("まつげ") || text.includes("眉")) return "まつげ";
  if (text.includes("美容室") || text.includes("ヘア") || text.includes("バーバー")) return "美容室";
  if (text.includes("マッサージ") || text.includes("整体")) return "マッサージ";
  if (text.includes("spa") || text.includes("スパ")) return "SPA";
  if (text.includes("エステ") || text.includes("脱毛")) return "エステ";
  if (text.includes("クリニック") || text.includes("医院")) return "クリニック";

  return "その他";
}

function initYear() {
  const year = document.getElementById("year");
  if (year) year.textContent = new Date().getFullYear().toString();
}