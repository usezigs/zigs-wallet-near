// Explicit execution policies shared by the server, quote consumer and approving devices.
// Basic is NEAR's documented confidential mode. Public must be chosen explicitly; it is never
// a fallback for missing confidential access. Preview cannot create a deposit or payment.
export const NEAR_REQUIRED_CONFIDENTIALITY = 'basic';
export const nearExecutionMode = (value) => ['public', 'basic'].includes(value);
export const nearRouteLabel = (mode) => mode === 'public'
  ? 'Standard mainnet · public route' : mode === 'basic'
    ? 'Confidential mainnet · Basic' : 'Preview or unsupported route';

// Missing mode identifies a legacy public route. Unknown future modes fail closed.
export function nearConfidentiality(value) {
  if (value === undefined) return 'public';
  return ['public', 'basic', 'advanced'].includes(value) ? value : null;
}

export const NEAR_CONFIDENTIAL_UNAVAILABLE = 'Confidential routing could not be confirmed. '
  + 'Do not send funds. Refresh the quote to try again.';
export const NEAR_ROUTING_UNAVAILABLE = 'The requested routing mode could not be confirmed. '
  + 'Do not send funds. Refresh the quote to try again.';
