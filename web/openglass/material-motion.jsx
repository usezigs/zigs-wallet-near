import React from "react";

export function EdgeShine({ phase = 0 }) {
  return <span className="openglass-edge-shine" aria-hidden="true"
    style={{ "--openglass-shine-delay": `${-(phase % 23)}s` }} />;
}

// CSS does the animation. Observe only the decorative rims and eligible actions, so hidden
// cards and background tabs do not spend frames animating. No pointer/frame loop is needed.
export function installMaterialMotion(root) {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const reducedTransparency = window.matchMedia("(prefers-reduced-transparency: reduce)");
  const highContrast = window.matchMedia("(forced-colors: active), (prefers-contrast: more)");
  const observed = new Set();
  const observer = typeof window.IntersectionObserver === "function"
    ? new window.IntersectionObserver((entries) => {
      for (const entry of entries)
        entry.target.toggleAttribute("data-openglass-visible", entry.isIntersecting);
    }, { threshold: 0 }) : null;
  const setMotion = () => root.toggleAttribute("data-openglass-motion",
    !document.hidden && !reducedMotion.matches && !reducedTransparency.matches && !highContrast.matches);
  document.addEventListener("visibilitychange", setMotion);
  for (const preference of [reducedMotion, reducedTransparency, highContrast])
    preference.addEventListener("change", setMotion);
  setMotion();

  return function syncMaterialMotion() {
    // The welcome card's actual visible frame is its native hero, inside a transparent outer
    // Card. Follow that frame instead of drawing an extra outline around the outer padding.
    for (const hero of root.querySelectorAll(".home-hero")) {
      if (hero.querySelector(":scope > .openglass-edge-shine")) continue;
      hero.classList.add("openglass-reflective");
      const rim = document.createElement("span");
      rim.className = "openglass-edge-shine";
      rim.setAttribute("aria-hidden", "true");
      hero.append(rim);
    }
    // Navigation rows, quiet links and compact utility controls remain steady. Disable/press
    // states and open action menus also stop the float in CSS, keeping hit targets predictable.
    for (const button of root.querySelectorAll("button.btn, summary.btn")) {
      if (button.matches(".ghost, .sm, .wallet-menu, .side-item")) continue;
      if (!button.hasAttribute("data-openglass-float")) {
        button.setAttribute("data-openglass-float", "");
        const phase = [...(button.dataset.key || button.textContent)]
          .reduce((sum, char) => sum + char.charCodeAt(0), 0) % 64;
        button.style.setProperty("--openglass-float-delay", `${-phase / 10}s`);
      }
    }
    const current = new Set(root.querySelectorAll(".openglass-edge-shine, [data-openglass-float]"));
    for (const element of observed) if (!current.has(element)) {
      observer?.unobserve(element);
      observed.delete(element);
    }
    for (const element of current) if (!observed.has(element)) {
      observed.add(element);
      observer?.observe(element);
    }
  };
}
