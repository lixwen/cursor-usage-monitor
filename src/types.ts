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

/**
 * Stripe billing info from /api/auth/stripe
 */
export interface StripeBillingInfo {
  membershipType: string;
  paymentId: string;
  verifiedStudent: boolean;
  trialEligible: boolean;
  trialLengthDays: number;
  isOnStudentPlan: boolean;
  isOnBillableAuto: boolean;
  customerBalance: number | null;
  trialWasCancelled: boolean;
  isTeamMember: boolean;
  teamMembershipType: string | null;
  individualMembershipType: string;
}

export type DisplayMode = 'requests' | 'percentage' | 'both';

export interface ExtensionConfig {
  refreshInterval: number;
  showInStatusBar: boolean;
  displayMode: DisplayMode;
  billingModel: BillingModel;
  autoDetectToken: boolean;
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

/**
 * Usage event for usage-based billing
 */
export interface UsageEvent {
  timestamp: string;
  date: string;
  time: string;
  model: string;
  tokens: number;
  cost: number;
  costDisplay: string;
  kind: string;
}

/**
 * Usage events response from /api/dashboard/get-filtered-usage-events
 */
export interface UsageEventsResponse {
  totalUsageEventsCount?: number;
  usageEventsDisplay?: Array<{
    timestamp: string;
    model: string;
    kind: string;
    customSubscriptionName?: string;
    requestsCosts?: number;
    usageBasedCosts?: string | number | object;
    isTokenBasedCall?: boolean;
    tokenUsage?: {
      cacheWriteTokens?: number;
      cacheReadTokens?: number;
      inputTokens?: number;
      outputTokens?: number;
      totalCents?: number;
    };
    owningUser?: string;
    cursorTokenFee?: number;
    isChargeable?: boolean;
  }>;
}

/**
 * Combined usage data that supports both billing types
 */
export interface CombinedUsageData {
  /** Billing type detected */
  billingType: 'request-based' | 'usage-based';
  
  /** Request-based data (if applicable) */
  requestBased?: {
    used: number;
    limit: number;
    percentage: number;
  };
  
  /** Usage-based data (if applicable) */
  usageBased?: {
    todayCost: number;
    todayTokens: number;
    recentEvents: UsageEvent[];
  };
  
  /** Recent events (for both billing types) */
  recentEvents?: UsageEvent[];
  
  /** Period info */
  periodStart: Date;
  periodEnd: Date;
}
