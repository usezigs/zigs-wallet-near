export type PortfolioAsset = "zec" | "sol" | "usdc";
export type PortfolioRange = "1D" | "1W" | "1M" | "3M" | "1Y" | "ALL";
export interface PortfolioPrice { usd: number; at: number }
export interface PortfolioHolding {
  asset: PortfolioAsset;
  amount: number | null;
  at: number | null;
}
export interface PortfolioObservation {
  at: number;
  value: number;
  scope: string;
  holdings: Array<{ asset: PortfolioAsset; amount: number; usd: number;
    priceAt: number; balanceAt: number }>;
}
export interface PortfolioPoint extends PortfolioObservation { breakBefore: boolean }
export interface PortfolioValuation {
  value: number | null;
  missing: PortfolioAsset[];
  observation: PortfolioObservation | null;
}
export interface PortfolioChartProps {
  observations: PortfolioObservation[];
  current: PortfolioValuation;
  loading: boolean;
  failed: boolean;
  priceSource?: "" | "coingecko" | "kraken";
  priceError?: "" | "not_configured" | "unavailable";
  retryAfterMs?: number;
  storageNote: string;
  now: number;
  range: PortfolioRange;
  onRange: (range: PortfolioRange) => void;
  onRetry: () => void;
  onInteractionEnd?: () => void;
}
