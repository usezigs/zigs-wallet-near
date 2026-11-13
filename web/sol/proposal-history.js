// Local presentation/subscription selection. Protocol validity and signing gates stay in their
// existing controllers. Browsing old records must not remove the bounded subscription limit.
export const HISTORY_PAGE_SIZE = 12;
export function proposalPage(sessions, requested = 0) {
  const pages = Math.max(1, Math.ceil(sessions.length / HISTORY_PAGE_SIZE));
  const page = Number.isSafeInteger(requested) ? Math.max(0, Math.min(requested, pages - 1)) : 0;
  const start = page * HISTORY_PAGE_SIZE;
  return { page, pages, total: sessions.length, start,
    items: sessions.slice(start, start + HISTORY_PAGE_SIZE) };
}

export function proposalWatchIds(sessions, page, cap) {
  const eligible = (ss) => !["sent", "failed"].includes(ss.status) && /^[\w-]{1,64}$/.test(ss.id);
  const recent = sessions.filter(eligible);
  const selected = proposalPage(sessions, page).items.filter(eligible);
  return [...new Set([...selected, ...recent].map((ss) => ss.id))].slice(0, cap);
}
