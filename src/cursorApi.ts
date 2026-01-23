import * as vscode from 'vscode';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { URL } from 'url';
import { execSync } from 'child_process';
import { UsageData, BillingModel, CursorUsageResponse, BILLING_LIMITS, ApiResponse, TeamsResponse, TeamSpendResponse, TeamInfo, UsageEvent, UsageEventsResponse, CombinedUsageData, StripeBillingInfo } from './types';

// Use asm.js version of sql.js (pure JavaScript, no WASM needed)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const initSqlJs = require('sql.js/dist/sql-asm.js');

// Import log function from extension (will be set after activation)
let logFn: ((message: string) => void) | null = null;

export function setLogFunction(fn: (message: string) => void) {
  logFn = fn;
}

function log(message: string) {
  if (logFn) {
    logFn(`[API] ${message}`);
  } else {
    console.log(`[CursorUsage API] ${message}`);
  }
}

/**
 * Cursor API Service
 * Handles communication with Cursor's usage API
 */
export class CursorApiService {
  private static instance: CursorApiService;
  private sessionToken: string | null = null;
  private userId: string | null = null;
  private detectedBillingModel: BillingModel | null = null;
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
   * @param autoDetect Whether to auto-detect token from Cursor's local database
   */
  public async initialize(autoDetect: boolean = true): Promise<boolean> {
    log(`Initialize called, autoDetect=${autoDetect}`);
    
    try {
      // Try to load token from secret storage first
      const storedToken = await this.context.secrets.get('cursorSessionToken');
      if (storedToken) {
        log('Found token in secret storage');
        this.sessionToken = storedToken;
        this.userId = this.extractUserId(storedToken);
        if (this.userId) {
          log(`Loaded stored token, userId=${this.userId}`);
          return true;
        }
      } else {
        log('No token in secret storage');
      }

      // Try to auto-detect from Cursor's config (if enabled)
      if (autoDetect) {
        log('Attempting auto-detect from SQLite...');
        const autoDetectedToken = await this.autoDetectToken();
        if (autoDetectedToken) {
          log(`Auto-detected token (length=${autoDetectedToken.length})`);
          this.sessionToken = autoDetectedToken;
          this.userId = this.extractUserId(autoDetectedToken);
          if (this.userId) {
            log(`Extracted userId=${this.userId}`);
            await this.context.secrets.store('cursorSessionToken', autoDetectedToken);
            return true;
          } else {
            log('Failed to extract userId from token');
          }
        } else {
          log('Auto-detect failed, no token found in SQLite');
        }
      } else {
        log('Auto-detect disabled, skipping');
      }

      log('Initialize failed, no valid token');
      return false;
    } catch (error) {
      log(`Initialize error: ${error}`);
      return false;
    }
  }

  /**
   * Extract user ID from session token
   * Token format: 
   * - user_XXXXX::JWT_TOKEN (WorkosCursorSessionToken cookie format)
   * - Pure JWT (from SQLite database)
   */
  private extractUserId(token: string): string | null {
    try {
      // Handle URL encoded token
      let decodedToken: string;
      try {
        decodedToken = decodeURIComponent(token);
      } catch {
        decodedToken = token;
      }
      
      // Extract userId from format: user_XXXXX::JWT
      if (decodedToken.includes('::')) {
        return decodedToken.split('::')[0];
      }
      
      // Try to parse JWT and extract user ID
      const parts = decodedToken.split('.');
      if (parts.length === 3) {
        // Decode base64url to base64
        let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        // Add padding if needed
        while (base64.length % 4) {
          base64 += '=';
        }
        const payload = JSON.parse(Buffer.from(base64, 'base64').toString());
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
    // First, try to read from SQLite database (newer Cursor versions)
    const sqliteToken = await this.readTokenFromSqlite();
    if (sqliteToken) {
      return sqliteToken;
    }

    // Fallback: try JSON config files (older Cursor versions)
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
   * Read token from Cursor's SQLite database
   */
  private async readTokenFromSqlite(): Promise<string | null> {
    const dbPath = this.getCursorDbPath();
    log(`SQLite DB path: ${dbPath}`);
    
    if (!dbPath) {
      log('DB path is null');
      return null;
    }
    
    if (!fs.existsSync(dbPath)) {
      log('DB file does not exist');
      return null;
    }

    // Try sql.js first (pure JavaScript, no external dependencies)
    const tokenFromSqlJs = await this.readTokenUsingSqlJs(dbPath);
    if (tokenFromSqlJs) {
      return tokenFromSqlJs;
    }

    // Fallback to sqlite3 command line
    const tokenFromCommand = this.readTokenUsingCommand(dbPath);
    if (tokenFromCommand) {
      return tokenFromCommand;
    }

    log('Failed to read token using both methods');
    return null;
  }

  /**
   * Read token using sql.js (pure JavaScript SQLite - asm.js version)
   */
  private async readTokenUsingSqlJs(dbPath: string): Promise<string | null> {
    try {
      log('Reading token using sql.js (asm.js)...');
      
      // Initialize sql.js (asm.js version, no WASM needed)
      const SQL = await initSqlJs();
      
      // Read database file into buffer
      const fileBuffer = fs.readFileSync(dbPath);
      const db = new SQL.Database(fileBuffer);
      
      try {
        // Query for token
        const result = db.exec("SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken'");
        
        if (result.length > 0 && result[0].values.length > 0) {
          const token = result[0].values[0][0] as string;
          log(`Found token via sql.js (length=${token.length})`);
          return token;
        } else {
          log('No token found in SQLite via sql.js');
        }
      } finally {
        db.close();
      }
    } catch (error) {
      log(`sql.js error: ${error}`);
    }
    return null;
  }

  /**
   * Read token using sqlite3 command line (fallback)
   */
  private readTokenUsingCommand(dbPath: string): string | null {
    try {
      log('Fallback: Reading token using sqlite3 command...');
      const command = `sqlite3 "${dbPath}" "SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken';"`;
      const result = execSync(command, { 
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim();

      if (result) {
        log(`Found token via sqlite3 command (length=${result.length})`);
        return result;
      } else {
        log('No token found via sqlite3 command');
      }
    } catch (error) {
      log(`sqlite3 command not available: ${error}`);
    }
    return null;
  }

  /**
   * Get Cursor SQLite database path based on OS
   */
  private getCursorDbPath(): string | null {
    const homeDir = os.homedir();
    const platform = os.platform();

    let dbPath: string;
    if (platform === 'win32') {
      dbPath = path.join(homeDir, 'AppData', 'Roaming', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
    } else if (platform === 'darwin') {
      dbPath = path.join(homeDir, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
    } else {
      // Linux
      dbPath = path.join(homeDir, '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
    }

    return dbPath;
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
      // Cookie format should be: user_XXXXX%3A%3AJWT or user_XXXXX::JWT
      let cookieValue = this.sessionToken!;
      if (!cookieValue.includes('::') && !cookieValue.includes('%3A%3A')) {
        // Pure JWT token (from SQLite), need to prepend user ID
        if (this.userId) {
          cookieValue = `${this.userId}%3A%3A${cookieValue}`;
        } else {
          cookieValue = encodeURIComponent(cookieValue);
        }
      } else if (cookieValue.includes('::') && !cookieValue.includes('%3A%3A')) {
        // URL encode the :: separator
        cookieValue = cookieValue.replace('::', '%3A%3A');
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
    log('Clearing credentials...');
    this.sessionToken = null;
    this.userId = null;
    this.detectedBillingModel = null;
    await this.context.secrets.delete('cursorSessionToken');
    log('Credentials cleared');
  }

  /**
   * Fetch billing info from Stripe API
   */
  public async fetchBillingInfo(): Promise<ApiResponse<StripeBillingInfo>> {
    if (!this.sessionToken || !this.userId) {
      return { success: false, error: 'Not authenticated' };
    }

    return this.makeApiRequest<StripeBillingInfo>('GET', '/auth/stripe');
  }

  /**
   * Auto-detect billing model from API
   */
  public async detectBillingModel(): Promise<BillingModel> {
    // Return cached if available
    if (this.detectedBillingModel) {
      return this.detectedBillingModel;
    }

    try {
      const response = await this.fetchBillingInfo();
      
      if (response.success && response.data) {
        const info = response.data;
        let model: BillingModel;

        // Check team membership first
        if (info.isTeamMember && info.teamMembershipType) {
          // Team member - check team type
          if (info.teamMembershipType === 'business' || info.teamMembershipType === 'enterprise') {
            model = 'business';
          } else if (info.teamMembershipType === 'usage_based' || info.isOnBillableAuto) {
            model = 'usage-based';
          } else {
            model = 'pro';
          }
        } else {
          // Individual membership
          const memberType = info.membershipType || info.individualMembershipType;
          
          if (memberType === 'free' || memberType === 'free_trial') {
            model = 'free';
          } else if (memberType === 'pro' || memberType === 'hobby') {
            model = 'pro';
          } else if (memberType === 'business' || memberType === 'enterprise') {
            model = 'business';
          } else {
            // Default to free if unknown
            model = 'free';
          }
        }

        this.detectedBillingModel = model;
        log(`Auto-detected billing model: ${model} (membershipType=${info.membershipType}, isTeamMember=${info.isTeamMember})`);
        return model;
      }
    } catch (error) {
      log(`Failed to detect billing model: ${error}`);
    }

    // Default to free if detection fails
    return 'free';
  }

  /**
   * Get detected or configured billing model
   */
  public getDetectedBillingModel(): BillingModel | null {
    return this.detectedBillingModel;
  }

  /**
   * Fetch usage events for usage-based billing
   */
  public async fetchUsageEvents(timeRange: 'today' | 'last24h' = 'today'): Promise<ApiResponse<UsageEvent[]>> {
    if (!this.sessionToken || !this.userId) {
      return {
        success: false,
        error: 'Not authenticated'
      };
    }

    try {
      const now = Date.now();
      let startTime: number;
      
      if (timeRange === 'today') {
        // Start of today
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        startTime = today.getTime();
      } else {
        // Last 24 hours
        startTime = now - (24 * 60 * 60 * 1000);
      }

      const response = await this.makeApiRequest<UsageEventsResponse>('POST', '/dashboard/get-filtered-usage-events', {
        teamId: 0,
        startDate: startTime.toString(),
        endDate: now.toString(),
        page: 1,
        pageSize: 100
      });

      if (!response.success || !response.data) {
        return {
          success: false,
          error: response.error || 'Failed to fetch usage events'
        };
      }

      // Handle empty response (e.g., free plan returns {})
      if (!response.data.usageEventsDisplay) {
        return {
          success: true,
          data: []
        };
      }

      const events = this.transformUsageEvents(response.data);
      return {
        success: true,
        data: events
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Transform usage events response
   */
  private transformUsageEvents(response: UsageEventsResponse): UsageEvent[] {
    if (!response.usageEventsDisplay) {
      return [];
    }

    return response.usageEventsDisplay.map(event => {
      const eventDate = new Date(parseInt(event.timestamp));
      const costInfo = this.parseCost(event.usageBasedCosts);
      const tokens = (event.tokenUsage?.cacheWriteTokens || 0) +
                     (event.tokenUsage?.cacheReadTokens || 0) +
                     (event.tokenUsage?.inputTokens || 0) +
                     (event.tokenUsage?.outputTokens || 0);

      return {
        timestamp: event.timestamp,
        date: eventDate.toLocaleDateString(),
        time: eventDate.toLocaleTimeString(),
        model: event.model || 'Unknown',
        tokens,
        cost: costInfo.numericValue,
        costDisplay: costInfo.displayValue,
        kind: event.kind || 'Unknown'
      };
    });
  }

  /**
   * Parse cost from various formats
   */
  private parseCost(usageBasedCosts: string | number | object | undefined): { numericValue: number; displayValue: string } {
    if (!usageBasedCosts) {
      return { numericValue: 0, displayValue: '$0.00' };
    }

    if (typeof usageBasedCosts === 'string') {
      const cleanCost = usageBasedCosts.replace(/[$,]/g, '');
      const parsedCost = parseFloat(cleanCost);
      return {
        numericValue: isNaN(parsedCost) ? 0 : parsedCost,
        displayValue: usageBasedCosts
      };
    }

    if (typeof usageBasedCosts === 'number') {
      return {
        numericValue: usageBasedCosts,
        displayValue: `$${usageBasedCosts.toFixed(2)}`
      };
    }

    return { numericValue: 0, displayValue: '$0.00' };
  }

  /**
   * Fetch combined usage data with automatic billing type detection
   */
  public async fetchCombinedUsageData(configBillingModel: BillingModel): Promise<ApiResponse<CombinedUsageData>> {
    if (!this.sessionToken || !this.userId) {
      return {
        success: false,
        error: 'Not authenticated'
      };
    }

    try {
      // Auto-detect billing model if not already detected
      const billingModel = await this.detectBillingModel();
      log(`Using billing model: ${billingModel} (config: ${configBillingModel})`);

      // Calculate period dates
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

      // First, fetch request-based usage data
      const usageResponse = await this.fetchUsageData(billingModel);
      
      // If usage-based billing or premium exhausted, try to fetch usage events
      if (billingModel === 'usage-based' || 
          (usageResponse.success && usageResponse.data?.isPremiumExhausted)) {
        
        const eventsResponse = await this.fetchUsageEvents('today');
        
        if (eventsResponse.success && eventsResponse.data && eventsResponse.data.length > 0) {
          const events = eventsResponse.data;
          const todayCost = events.reduce((sum, e) => sum + e.cost, 0);
          const todayTokens = events.reduce((sum, e) => sum + e.tokens, 0);

          return {
            success: true,
            data: {
              billingType: 'usage-based',
              usageBased: {
                todayCost,
                todayTokens,
                recentEvents: events.sort((a, b) => parseInt(b.timestamp) - parseInt(a.timestamp))
              },
              periodStart: startOfMonth,
              periodEnd: endOfMonth
            }
          };
        }
        
        // If usage events are empty but we're on usage-based, show $0
        if (billingModel === 'usage-based') {
          return {
            success: true,
            data: {
              billingType: 'usage-based',
              usageBased: {
                todayCost: 0,
                todayTokens: 0,
                recentEvents: []
              },
              periodStart: startOfMonth,
              periodEnd: endOfMonth
            }
          };
        }
      }

      // Return request-based data
      if (usageResponse.success && usageResponse.data) {
        const data = usageResponse.data;
        const limit = data.premiumRequestsLimit || 50; // Default to free plan limit
        return {
          success: true,
          data: {
            billingType: 'request-based',
            requestBased: {
              used: data.premiumRequestsUsed,
              limit: limit,
              percentage: limit > 0 ? Math.round((data.premiumRequestsUsed / limit) * 100) : 0
            },
            periodStart: data.periodStart,
            periodEnd: data.periodEnd
          }
        };
      }

      return {
        success: false,
        error: usageResponse.error || 'Failed to fetch usage data'
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}
