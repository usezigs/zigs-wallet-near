// Fixed educational example. No wallet state, network access, signing or approval actions.
import { interfaceIcon } from './sidebar-icons.js';
const chapters = [
  { title: "Keep shares separate", short: "Shares", copy: "Each device keeps its own signing share. The devices agree on one public wallet address; no device holds the complete spending key.", caption: "Three independent devices. Separate signing shares." },
  { title: "Propose one payment", short: "Propose", copy: "A proposal names the recipients, amounts and fees. Requesting approvals shares that proposal with the wallet’s devices. It does not sign or send the payment.", caption: "One proposal for every approving device to inspect." },
  { title: "Review and approve", short: "Approve", copy: "Each approving device checks the actual transaction. In this example, any two of the three distinct devices must approve. Two copies of one device’s share still count as one signer.", caption: "Example: two approvals. The signing shares stay separate." },
  { title: "Sign, prove and submit", short: "Submit", copy: "After enough approvals, the devices produce the signature shares and a browser builds the Zcash proof. Submission sends the transaction to the network. Inclusion in a block and confirmation are separate steps.", caption: "Submission comes after signing and proving. Confirmation follows." },
];

export function paymentStory(el, openChapter) {
  let selected = 0;
  const root = el("section", { class: "hw-payment-story", id: "hw-payment-story", "data-step": "0",
    "aria-label": "A Zcash payment, illustrated" });
  const media = (query) => globalThis.matchMedia?.(query) || { matches: false, addEventListener() {} };
  const mobile = media("(max-width:800px)");
  const reduced = media("(prefers-reduced-motion:reduce)");
  const readout = el("p", { class: "hw-story-caption" }, chapters[0].caption);
  const announcement = el("span", { class: "sr-only", role: "status", "aria-live": "polite" });
  const buttons = [], articles = [];
  const controls = el("div", { class: "hw-story-choices", role: "group", "aria-label": "Payment illustration steps" });
  const figure = el("figure", { class: "hw-story-figure" },
    el("figcaption", { class: "hw-story-example" }, "Illustration · Any 2 of 3 devices"),
    el("div", { class: "hw-story-devices", "aria-label": "Three independent signing devices" },
      [1, 2, 3].map((id) => el("div", { class: "hw-story-device" },
        el("span", { class: "hw-story-device-face", "aria-hidden": "true" }, String(id).padStart(2, "0")),
        el("span", {}, "Device " + id), el("span", { class: "hw-story-share" }, "Separate share")))),
    el("div", { class: "hw-story-connection", "aria-hidden": "true" }),
    el("div", { class: "hw-story-ticket" },
      el("span", { class: "hw-story-ticket-label" }, "Example Zcash payment"),
      el("strong", {}, "0.25", el("span", {}, " ZEC")),
      el("span", { class: "hw-story-ticket-note" }, "Same transaction on each device")),
    el("div", { class: "hw-story-network" },
      interfaceIcon('forward'), el("div", {}, el("strong", {}, "Zcash network"),
        el("span", {}, "Block confirmation follows submission"))), readout);
  const narrative = el("div", { class: "hw-story-narrative" });
  function pick(index, explicit = false) {
    selected = Math.max(0, Math.min(chapters.length - 1, index));
    root.setAttribute("data-step", String(selected));
    buttons.forEach((button, i) => button.setAttribute("aria-pressed", String(i === selected)));
    articles.forEach((article, i) => {
      article.hidden = mobile.matches && i !== selected;
      article.setAttribute("data-current", String(i === selected));
    });
    readout.textContent = chapters[selected].caption;
    if (explicit) announcement.textContent = `Step ${selected + 1} of ${chapters.length}: ${chapters[selected].title}`;
  }
  function navigate(index) {
    pick(index, true);
    if (mobile.matches) return;
    const scroller = root.closest(".home-how-content"), target = articles[selected];
    if (scroller) scroller.scrollTo({ top: scroller.scrollTop + target.getBoundingClientRect().top
      - scroller.getBoundingClientRect().top - Math.max(24, (scroller.clientHeight - target.offsetHeight) / 2),
    behavior: reduced.matches ? "auto" : "smooth" });
  }
  chapters.forEach((chapter, index) => {
    const button = el("button", { class: "hw-story-choice", type: "button", "aria-pressed": String(index === 0),
      "aria-controls": "hw-story-chapter-" + index, onclick: () => navigate(index),
      onkeydown: (event) => {
        const next = { ArrowRight: (index + 1) % 4, ArrowLeft: (index + 3) % 4, Home: 0, End: 3 }[event.key];
        if (next === undefined) return;
        event.preventDefault(); navigate(next); buttons[next].focus({ preventScroll: true });
      } }, el("span", { "aria-hidden": "true" }, String(index + 1).padStart(2, "0")), chapter.short);
    buttons.push(button); controls.append(button);
    const article = el("article", { class: "hw-story-chapter", id: "hw-story-chapter-" + index,
      "data-story-step": String(index) },
    el("p", { class: "hw-story-chapter-number" }, "0" + (index + 1) + " / 04"),
    el("h4", {}, chapter.title), el("p", {}, chapter.copy));
    articles.push(article); narrative.append(article);
  });
  root.append(el("header", { class: "hw-story-heading" },
    el("p", { class: "hw-eyebrow" }, "One payment. Shared control."),
    el("h3", {}, "Separate shares.", el("span", {}, "A shared decision.")),
    el("p", {}, "Follow an illustrated Zcash payment from its proposal to the network.")),
  el("div", { class: "hw-story-layout" }, el("div", { class: "hw-story-stage" }, controls, figure), narrative),
  el("footer", { class: "hw-story-foot" },
    el("p", {}, "Illustration only. This walkthrough never reads your wallet, collects approvals or sends a payment."),
    el("button", { class: "hw-reference-link", type: "button", 'data-interface-control': '', onclick: () => openChapter("payments") }, "Read the complete payment guide", interfaceIcon('forward'))),
  announcement);
  // Native scrolling changes the illustration without pinning or changing reading focus.
  const ratios = new Map();
  const observer = typeof globalThis.IntersectionObserver === "function" ? new globalThis.IntersectionObserver((entries) => {
    if (mobile.matches || !root.isConnected || root.closest("[hidden]")) return;
    entries.forEach((entry) => ratios.set(entry.target, entry.isIntersecting ? entry.intersectionRatio : 0));
    const visible = articles.map((article, index) => ({ index, ratio: ratios.get(article) || 0 }))
      .sort((a, b) => b.ratio - a.ratio);
    if (visible[0]?.ratio > .35) pick(visible[0].index);
  }, { threshold: [0, .25, .5, .75, 1] }) : null;
  articles.forEach((article) => observer?.observe(article));
  mobile.addEventListener("change", () => pick(selected));
  globalThis.window?.addEventListener("pagehide", (event) => { if (!event.persisted) observer?.disconnect(); });
  pick(0);
  return root;
}
