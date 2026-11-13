import React from "react";

export function EdgeShine() {
  return <span className="openglass-edge-shine" aria-hidden="true" />;
}

// A fixed studio reflection. Event-driven motion is handled by the native presenters;
// decorative chrome needs neither a frame loop nor visibility/preference observers.
export function installMaterialMotion(root) {
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
  };
}
