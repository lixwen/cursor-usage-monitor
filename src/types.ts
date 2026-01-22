/**
 * Cursor Usage Types
 */

export interface UsageData {
  /** Number of requests used */
  requestsUsed: number;
  /** Total requests allowed in the billing period */
  requestsLimit: number;
  /** Premium requests used (fast model) */
  premiumRequestsUsed: number;
  /** Premium requests limit */
  premiumRequestsLimit: number;
  /** Start date of current billing period */
  periodStart: Date;
  /** End date of current billing period */
  periodEnd: Date;
  /** Current billing model */
  billingModel: BillingModel;
  /** Usage-based cost in cents (On-Demand Usage) */
  usageBasedCostCents?: number;
  /** Whether premium requests are exhausted */
  isPremiumExhausted: boolean;
  /** Team info if applicable */
  teamName?: string;
}

export type BillingModel = 'pro' | 'business' | 'free' | 'usage-based';

export type DisplayMode = 'requests' | 'percentage' | 'both';

export interface ExtensionConfig {
  refreshInterval: number;
  showInStatusBar: boolean;
  displayMode: DisplayMode;
  billingModel: BillingModel;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Cursor API response structure for usage data
 */
export interface CursorUsageResponse {
  'gpt-4': {
    numRequests: number;
    numRequestsTotal: number;
    maxRequestUsage: number | null;
    numTokens: number;
  };
  'gpt-3.5-turbo': {
    numRequests: number;
    numRequestsTotal: number;
    maxRequestUsage: number | null;
    numTokens: number;
  };
  'gpt-4-32k': {
    numRequests: number;
    numRequestsTotal: number;
    maxRequestUsage: number | null;
    numTokens: number;
  };
  startOfMonth: string;
}

/**
 * Billing plan limits
 */
export const BILLING_LIMITS: Record<BillingModel, { premium: number; standard: number }> = {
  'free': { premium: 50, standard: 200 },
  'pro': { premium: 500, standard: 999999 },
  'business': { premium: 500, standard: 999999 },
  'usage-based': { premium: 999999, standard: 999999 }
};

/**
 * Team info from /api/dashboard/teams
 */
export interface TeamInfo {
  name: string;
  id: number;
  role: string;
  seats: number;
  hasBilling: boolean;
  subscriptionStatus: string;
  billingCycleStart: string;
  billingCycleEnd: string;
}

export interface TeamsResponse {
  teams: TeamInfo[];
}

/**
 * Team spend response from /api/dashboard/get-team-spend
 */
export interface TeamSpendResponse {
  subscriptionCycleStart: string;
  nextCycleStart: string;
  totalMembers: number;
  maxUserSpendCents: number;
  hasAnySpendLimitOverrides: boolean;
  hasAnyFreeUsage: boolean;
}
