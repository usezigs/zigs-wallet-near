import React from "react";

export function EdgeShine() {
  return <span className="openglass-edge-shine" aria-hidden="true" />;
}

// Reflections respond to interaction; controls never bob while someone is reading or typing.
export function installMaterialMotion(root) {
  const preferences = [
    window.matchMedia("(prefers-reduced-motion: reduce)"),
    window.matchMedia("(prefers-reduced-transparency: reduce)"),
    window.matchMedia("(forced-colors: active), (prefers-contrast: more)"),
  ];
  const observed = new Set();
  const observer = typeof window.IntersectionObserver === "function"
    ? new window.IntersectionObserver((entries) => {
      for (const entry of entries)
        entry.target.toggleAttribute("data-openglass-visible", entry.isIntersecting);
    }, { threshold: 0 }) : null;
  const setMotion = () => {
    const on = !document.hidden && !preferences.some((preference) => preference.matches);
    root.toggleAttribute("data-openglass-motion", on);
    for (const overlay of document.querySelectorAll(".openglass-overlay"))
      overlay.toggleAttribute("data-openglass-motion", on);
  };
  document.addEventListener("visibilitychange", setMotion);
  for (const preference of preferences) preference.addEventListener("change", setMotion);
  setMotion();
  return () => {
    for (const node of observed) if (!node.isConnected) {
      observer?.unobserve(node); observed.delete(node);
    }
    for (const node of document.querySelectorAll("#openglass-root .openglass-edge-shine, .openglass-overlay .openglass-edge-shine")) {
      if (observed.has(node)) continue;
      observed.add(node);
      if (observer) observer.observe(node);
      else node.setAttribute("data-openglass-visible", "");
    }
    setMotion();
  };
}
