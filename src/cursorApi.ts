import * as vscode from 'vscode';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { URL } from 'url';
import { UsageData, BillingModel, CursorUsageResponse, BILLING_LIMITS, ApiResponse, TeamsResponse, TeamSpendResponse, TeamInfo } from './types';

/**
 * Cursor API Service
 * Handles communication with Cursor's usage API
 */
export class CursorApiService {
  private static instance: CursorApiService;
  private sessionToken: string | null = null;
  private userId: string | null = null;
  private readonly API_BASE_URL = 'https://cursor.com/api';
  private context: vscode.ExtensionContext;

  private constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  public static getInstance(context: vscode.ExtensionContext): CursorApiService {
    if (!CursorApiService.instance) {
      CursorApiService.instance = new CursorApiService(context);
    }
    return CursorApiService.instance;
  }

  /**
   * Initialize the API service by loading credentials
   */
  public async initialize(): Promise<boolean> {
    try {
      // Try to load token from secret storage first
      const storedToken = await this.context.secrets.get('cursorSessionToken');
      if (storedToken) {
        this.sessionToken = storedToken;
        this.userId = this.extractUserId(storedToken);
        if (this.userId) {
          return true;
        }
      }

      // Try to auto-detect from Cursor's config
      const autoDetectedToken = await this.autoDetectToken();
      if (autoDetectedToken) {
        this.sessionToken = autoDetectedToken;
        this.userId = this.extractUserId(autoDetectedToken);
        if (this.userId) {
          await this.context.secrets.store('cursorSessionToken', autoDetectedToken);
          return true;
        }
      }

      return false;
    } catch (error) {
      console.error('Failed to initialize Cursor API:', error);
      return false;
    }
  }

  /**
   * Extract user ID from session token
   * Token format: user_XXXXX::JWT_TOKEN or URL encoded version
   */
  private extractUserId(token: string): string | null {
    try {
      // Handle URL encoded token
      const decodedToken = decodeURIComponent(token);
      
      // Extract userId from format: user_XXXXX::JWT
      if (decodedToken.includes('::')) {
        return decodedToken.split('::')[0];
      }
      
      // Try to parse JWT and extract user ID
      const parts = decodedToken.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
        if (payload.sub) {
          // Format: auth0|user_XXXXX
          const match = payload.sub.match(/user_[A-Za-z0-9]+/);
          if (match) {
            return match[0];
          }
        }
      }
      
      return null;
    } catch (error) {
      console.error('Failed to extract user ID:', error);
      return null;
    }
  }

  /**
   * Attempt to auto-detect Cursor session token from local config
   */
  private async autoDetectToken(): Promise<string | null> {
    const possiblePaths = this.getCursorConfigPaths();
    
    for (const configPath of possiblePaths) {
      try {
        if (fs.existsSync(configPath)) {
          const content = fs.readFileSync(configPath, 'utf-8');
          
          // Try to parse as JSON
          try {
            const config = JSON.parse(content);
            const token = this.findTokenInObject(config);
            if (token) {
              return token;
            }
          } catch {
            // Not JSON, try to find token in raw content
            const match = content.match(/WorkosCursorSessionToken[=:]["']?([^"'\s;]+)/);
            if (match) {
              return match[1];
            }
          }
        }
      } catch (error) {
        continue;
      }
    }

    return null;
  }

  /**
   * Recursively search for token in config object
   */
  private findTokenInObject(obj: Record<string, unknown>): string | null {
    const tokenKeys = ['cursorAuth/accessToken', 'accessToken', 'sessionToken', 'WorkosCursorSessionToken'];
    
    for (const key of tokenKeys) {
      if (obj[key] && typeof obj[key] === 'string') {
        return obj[key] as string;
      }
    }

    for (const value of Object.values(obj)) {
      if (value && typeof value === 'object') {
        const found = this.findTokenInObject(value as Record<string, unknown>);
        if (found) {
          return found;
        }
      }
    }

    return null;
  }

  /**
   * Get possible Cursor config file paths based on OS
   */
  private getCursorConfigPaths(): string[] {
    const homeDir = os.homedir();
    const platform = os.platform();

    if (platform === 'win32') {
      return [
        path.join(homeDir, 'AppData', 'Roaming', 'Cursor', 'User', 'globalStorage', 'storage.json'),
        path.join(homeDir, '.cursor', 'config.json'),
        path.join(homeDir, 'AppData', 'Roaming', 'Cursor', 'config.json')
      ];
    } else if (platform === 'darwin') {
      return [
        path.join(homeDir, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'storage.json'),
        path.join(homeDir, '.cursor', 'config.json'),
        path.join(homeDir, 'Library', 'Application Support', 'Cursor', 'config.json')
      ];
    } else {
      // Linux
      return [
        path.join(homeDir, '.config', 'Cursor', 'User', 'globalStorage', 'storage.json'),
        path.join(homeDir, '.cursor', 'config.json'),
        path.join(homeDir, '.config', 'Cursor', 'config.json')
      ];
    }
  }

  /**
   * Set session token manually
   */
  public async setSessionToken(token: string): Promise<boolean> {
    const userId = this.extractUserId(token);
    if (!userId) {
      return false;
    }
    
    this.sessionToken = token;
    this.userId = userId;
    await this.context.secrets.store('cursorSessionToken', token);
    return true;
  }

  /**
   * Get current user ID
   */
  public getUserId(): string | null {
    return this.userId;
  }

  /**
   * Check if authenticated
   */
  public isAuthenticated(): boolean {
    return this.sessionToken !== null && this.userId !== null;
  }

  /**
   * Fetch usage data from Cursor API
   */
  public async fetchUsageData(billingModel: BillingModel): Promise<ApiResponse<UsageData>> {
    if (!this.sessionToken || !this.userId) {
      return {
        success: false,
        error: 'Not authenticated. Please set your Cursor session token.'
      };
    }

    try {
      // Fetch basic usage data
      const response = await this.makeApiRequest<CursorUsageResponse>('GET', `/usage?user=${this.userId}`);
      
      if (!response.success || !response.data) {
        return {
          success: false,
          error: response.error || 'Failed to fetch usage data'
        };
      }

      const usageData = this.transformUsageData(response.data, billingModel);
      
      // If premium requests are exhausted, try to fetch on-demand usage
      if (usageData.isPremiumExhausted) {
        const teamSpend = await this.fetchTeamSpend();
        if (teamSpend) {
          usageData.usageBasedCostCents = teamSpend.maxUserSpendCents;
          usageData.teamName = teamSpend.teamName;
        }
      }

      return {
        success: true,
        data: usageData
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Fetch team info
   */
  private async fetchTeamInfo(): Promise<TeamInfo | null> {
    try {
      const response = await this.makeApiRequest<TeamsResponse>('POST', '/dashboard/teams', {});
      
      if (response.success && response.data && response.data.teams && response.data.teams.length > 0) {
        const teams = response.data.teams;
        // Return the first active team
        return teams.find(t => t.subscriptionStatus === 'active') || teams[0];
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Fetch team spend data
   */
  private async fetchTeamSpend(): Promise<{ maxUserSpendCents: number; teamName: string } | null> {
    try {
      const teamInfo = await this.fetchTeamInfo();
      if (!teamInfo) {
        return null;
      }

      const response = await this.makeApiRequest<TeamSpendResponse>('POST', '/dashboard/get-team-spend', {
        teamId: teamInfo.id,
        page: 1,
        pageSize: 50,
        sortBy: 'name',
        sortDirection: 'asc'
      });

      if (response.success && response.data) {
        return {
          maxUserSpendCents: response.data.maxUserSpendCents,
          teamName: teamInfo.name
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Transform API response to UsageData format
   */
  private transformUsageData(response: CursorUsageResponse, billingModel: BillingModel): UsageData {
    const limits = BILLING_LIMITS[billingModel];
    const startOfMonth = new Date(response.startOfMonth);
    const endOfMonth = new Date(startOfMonth);
    endOfMonth.setMonth(endOfMonth.getMonth() + 1);

    // GPT-4 requests are considered "premium"
    const gpt4Data = response['gpt-4'];
    const premiumUsed = gpt4Data?.numRequests || 0;
    const premiumLimit = gpt4Data?.maxRequestUsage || limits.premium;
    
    // GPT-3.5-turbo requests are standard
    const standardUsed = response['gpt-3.5-turbo']?.numRequests || 0;
    
    // Total requests
    const totalUsed = premiumUsed + standardUsed + (response['gpt-4-32k']?.numRequests || 0);
    
    // Check if premium requests are exhausted
    const isPremiumExhausted = premiumUsed >= premiumLimit;

    return {
      requestsUsed: totalUsed,
      requestsLimit: limits.standard,
      premiumRequestsUsed: premiumUsed,
      premiumRequestsLimit: premiumLimit,
      periodStart: startOfMonth,
      periodEnd: endOfMonth,
      billingModel: billingModel,
      isPremiumExhausted
    };
  }

  /**
   * Make HTTP request to Cursor API with Cookie authentication
   */
  private makeApiRequest<T>(method: 'GET' | 'POST', endpoint: string, body?: Record<string, unknown>): Promise<ApiResponse<T>> {
    return new Promise((resolve) => {
      const url = `${this.API_BASE_URL}${endpoint}`;
      const parsedUrl = new URL(url);
      
      // Prepare cookie value - ensure it's properly formatted
      let cookieValue = this.sessionToken!;
      if (!cookieValue.includes('::')) {
        // Token might already be the full value, use as-is
        cookieValue = encodeURIComponent(cookieValue);
      }
      
      const bodyStr = body ? JSON.stringify(body) : '';
      
      const options = {
        hostname: parsedUrl.hostname,
        port: 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method: method,
        headers: {
          'Cookie': `WorkosCursorSessionToken=${cookieValue}`,
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json',
          'Origin': 'https://cursor.com',
          'Referer': 'https://cursor.com/cn/dashboard',
          ...(method === 'POST' && bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr).toString() } : {})
        }
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            if (res.statusCode === 200) {
              const parsed = JSON.parse(data);
              resolve({ success: true, data: parsed });
            } else if (res.statusCode === 401 || res.statusCode === 403) {
              resolve({ success: false, error: 'Authentication failed. Please check your session token.' });
            } else {
              resolve({ success: false, error: `API returned status ${res.statusCode}: ${data}` });
            }
          } catch (error) {
            resolve({ success: false, error: `Failed to parse API response: ${data}` });
          }
        });
      });

      req.on('error', (error) => {
        resolve({ success: false, error: `Network error: ${error.message}` });
      });

      req.setTimeout(10000, () => {
        req.destroy();
        resolve({ success: false, error: 'Request timed out' });
      });

      if (method === 'POST' && bodyStr) {
        req.write(bodyStr);
      }
      req.end();
    });
  }

  /**
   * Clear stored credentials
   */
  public async clearCredentials(): Promise<void> {
    this.sessionToken = null;
    this.userId = null;
    await this.context.secrets.delete('cursorSessionToken');
  }
}
