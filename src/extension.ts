import * as vscode from 'vscode';
import { CursorApiService, setLogFunction } from './cursorApi';
import { StatusBarManager } from './statusBar';
import { ExtensionConfig, UsageData, BillingModel, DisplayMode, CombinedUsageData } from './types';

let statusBarManager: StatusBarManager | undefined;
let cursorApi: CursorApiService | undefined;
let refreshTimer: NodeJS.Timeout | undefined;
let cachedUsageData: UsageData | undefined;
let outputChannel: vscode.OutputChannel | undefined;

/**
 * Extension activation
 */
// Log function for debugging
export function log(message: string) {
  const timestamp = new Date().toLocaleTimeString();
  outputChannel?.appendLine(`[${timestamp}] ${message}`);
}

export function activate(context: vscode.ExtensionContext) {
  try {
    // Create output channel for logging
    outputChannel = vscode.window.createOutputChannel('Cursor Usage Monitor');
    context.subscriptions.push(outputChannel);
    
    // Share log function with cursorApi module
    setLogFunction(log);
    
    log('Extension activated');
    log(`Extension path: ${context.extensionPath}`);

    // Initialize components
    statusBarManager = new StatusBarManager();
    cursorApi = CursorApiService.getInstance(context);
  } catch (error) {
    console.error('Cursor Usage Monitor activation error:', error);
    vscode.window.showErrorMessage(`Cursor Usage Monitor failed to activate: ${error}`);
    return;
  }

  try {
    // Register commands
  const refreshCommand = vscode.commands.registerCommand('cursorUsage.refresh', () => {
    refreshUsageData();
  });

  const showDetailsCommand = vscode.commands.registerCommand('cursorUsage.showDetails', () => {
    showUsageDetails();
  });

  const setTokenCommand = vscode.commands.registerCommand('cursorUsage.setToken', () => {
    promptForToken();
  });

  const clearTokenCommand = vscode.commands.registerCommand('cursorUsage.clearToken', async () => {
    log('Clear token command triggered');
    await clearToken();
  });

  context.subscriptions.push(
    refreshCommand,
    showDetailsCommand,
    setTokenCommand,
    clearTokenCommand,
    statusBarManager
  );

  // Listen for configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('cursorUsage')) {
        onConfigurationChanged();
      }
    })
  );

  // Initialize and start
  initialize();
  } catch (error) {
    log(`Extension setup error: ${error}`);
    console.error('Cursor Usage Monitor setup error:', error);
  }
}

/**
 * Initialize the extension
 */
async function initialize() {
  if (!statusBarManager || !cursorApi) {
    return;
  }

  const config = getConfiguration();

  // Update display mode
  statusBarManager.setDisplayMode(config.displayMode);

  // Show or hide based on config
  if (!config.showInStatusBar) {
    statusBarManager.hide();
    return;
  }

  statusBarManager.show();
  statusBarManager.setLoading();

  // Initialize API (pass autoDetectToken config)
  const initialized = await cursorApi.initialize(config.autoDetectToken);
  
  if (!initialized) {
    statusBarManager.setNotAuthenticated();
  } else {
    // Initial fetch
    await refreshUsageData();
    
    // Start refresh timer
    startRefreshTimer(config.refreshInterval);
  }
}

/**
 * Get extension configuration
 */
function getConfiguration(): ExtensionConfig {
  const config = vscode.workspace.getConfiguration('cursorUsage');
  
  return {
    refreshInterval: config.get<number>('refreshInterval', 60),
    showInStatusBar: config.get<boolean>('showInStatusBar', true),
    displayMode: config.get<DisplayMode>('displayMode', 'both'),
    billingModel: config.get<BillingModel>('billingModel', 'pro'),
    autoDetectToken: config.get<boolean>('autoDetectToken', true)
  };
}

/**
 * Handle configuration changes
 */
function onConfigurationChanged() {
  const config = getConfiguration();

  if (statusBarManager) {
    statusBarManager.setDisplayMode(config.displayMode);

    if (!config.showInStatusBar) {
      statusBarManager.hide();
    } else {
      statusBarManager.show();
      if (cachedUsageData) {
        statusBarManager.updateUsage(cachedUsageData);
      }
    }
  }

  // Restart timer with new interval
  startRefreshTimer(config.refreshInterval);
}

/**
 * Start or restart the refresh timer
 */
function startRefreshTimer(intervalSeconds: number) {
  // Clear existing timer
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }

  // Start new timer
  refreshTimer = setInterval(() => {
    refreshUsageData();
  }, intervalSeconds * 1000);
}

/**
 * Refresh usage data from API
 */
async function refreshUsageData() {
  if (!cursorApi || !statusBarManager) {
    return;
  }

  const config = getConfiguration();
  log(`Refresh called - isAuthenticated: ${cursorApi.isAuthenticated()}, autoDetectToken: ${config.autoDetectToken}`);

  // If not authenticated, try to re-initialize (auto-detect token)
  if (!cursorApi.isAuthenticated()) {
    log('Not authenticated, trying to initialize...');
    statusBarManager.setLoading();
    const initialized = await cursorApi.initialize(config.autoDetectToken);
    if (!initialized) {
      log('Initialize failed, showing not authenticated');
      statusBarManager.setNotAuthenticated();
      return;
    }
    // Start refresh timer after successful re-initialization
    startRefreshTimer(config.refreshInterval);
  }
  
  // Use combined usage data to support both billing types
  const response = await cursorApi.fetchCombinedUsageData(config.billingModel);

  if (response.success && response.data) {
    // Also fetch legacy data for backward compatibility
    const legacyResponse = await cursorApi.fetchUsageData(config.billingModel);
    if (legacyResponse.success && legacyResponse.data) {
      cachedUsageData = legacyResponse.data;
    }
    
    // Update status bar with combined data
    statusBarManager.updateCombinedUsage(response.data);
    
    if (response.data.billingType === 'usage-based' && response.data.usageBased) {
      log(`Usage data updated - usage-based: $${response.data.usageBased.todayCost.toFixed(2)} today`);
    } else if (response.data.requestBased) {
      log(`Usage data updated - request-based: ${response.data.requestBased.used}/${response.data.requestBased.limit}`);
    }
  } else {
    statusBarManager.setError(response.error || 'Unknown error');
    log(`API error: ${response.error}`);
  }
}

/**
 * Prompt user to enter session token
 */
async function promptForToken() {
  const token = await vscode.window.showInputBox({
    title: 'Set Cursor Session Token',
    prompt: 'Get token from: cursor.com/settings → F12 → Application → Cookies → WorkosCursorSessionToken',
    placeHolder: 'user_XXXXX%3A%3AeyJhbG... or user_XXXXX::eyJhbG...',
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => {
      if (!value || value.trim().length === 0) {
        return 'Session token cannot be empty';
      }
      return null;
    }
  });

  if (token && cursorApi) {
    const success = await cursorApi.setSessionToken(token.trim());
    if (success) {
      vscode.window.showInformationMessage('Session token saved successfully!');
      await refreshUsageData();
      // Start refresh timer
      const config = getConfiguration();
      startRefreshTimer(config.refreshInterval);
    } else {
      vscode.window.showErrorMessage('Invalid token format. Token should contain user ID (e.g., user_XXXXX::...)');
    }
  }
}

/**
 * Clear saved token
 */
async function clearToken() {
  log('clearToken command called');
  
  if (!cursorApi || !statusBarManager) {
    log('ERROR: cursorApi or statusBarManager is undefined');
    return;
  }

  log('Clearing token (no confirmation for debug)...');
  
  // Stop the refresh timer
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = undefined;
    log('Refresh timer stopped');
  } else {
    log('No refresh timer to stop');
  }
  
  try {
    await cursorApi.clearCredentials();
    log('clearCredentials() completed');
  } catch (e) {
    log(`clearCredentials() error: ${e}`);
  }
  
  cachedUsageData = undefined;
  statusBarManager.setNotAuthenticated();
  
  const config = getConfiguration();
  log(`Token cleared - autoDetectToken: ${config.autoDetectToken}, isAuthenticated: ${cursorApi.isAuthenticated()}`);
  
  const message = config.autoDetectToken 
    ? 'Token cleared. Use "Cursor Usage: Refresh" to re-detect token.'
    : 'Token cleared. Auto-detect is OFF. Use "Cursor Usage: Set Session Token" to set token manually.';
  vscode.window.showInformationMessage(message);
}

/**
 * Show detailed usage information
 */
async function showUsageDetails() {
  // Get cached combined data from status bar manager
  const combinedData = statusBarManager?.getCachedCombinedData();
  
  if (!combinedData) {
    await refreshUsageData();
    const newData = statusBarManager?.getCachedCombinedData();
    if (!newData) {
      const action = await vscode.window.showWarningMessage(
        'No usage data available. Would you like to set your session token?',
        'Set Token',
        'Cancel'
      );

      if (action === 'Set Token') {
        promptForToken();
      }
      return;
    }
  }

  const data = statusBarManager?.getCachedCombinedData();
  if (!data) {
    return;
  }
  
  const panel = vscode.window.createWebviewPanel(
    'cursorUsageDetails',
    'Cursor Usage Details',
    vscode.ViewColumn.One,
    {
      enableScripts: false
    }
  );

  panel.webview.html = getWebviewContent(data);
}

/**
 * Generate webview HTML content for combined usage data
 * Design: iStats-inspired with ring gauges and compact layout
 */
function getWebviewContent(data: CombinedUsageData): string {
  const periodStart = data.periodStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const periodEnd = data.periodEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const daysLeft = Math.max(0, Math.ceil((data.periodEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
  const totalDays = Math.ceil((data.periodEnd.getTime() - data.periodStart.getTime()) / (1000 * 60 * 60 * 24));
  const daysUsedPct = Math.round(((totalDays - daysLeft) / totalDays) * 100);

  // SVG ring helper
  const createRing = (percent: number, color: string, size: number = 80) => {
    const radius = (size - 8) / 2;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (percent / 100) * circumference;
    return `
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <circle cx="${size/2}" cy="${size/2}" r="${radius}" fill="none" stroke="var(--ring-bg)" stroke-width="6"/>
        <circle cx="${size/2}" cy="${size/2}" r="${radius}" fill="none" stroke="${color}" stroke-width="6"
          stroke-dasharray="${circumference}" stroke-dashoffset="${offset}" stroke-linecap="round"
          transform="rotate(-90 ${size/2} ${size/2})"/>
      </svg>
    `;
  };

  let mainContent = '';
  
  if (data.billingType === 'usage-based' && data.usageBased) {
    const { todayCost, todayTokens, recentEvents } = data.usageBased;
    
    // Format cost
    let costDisplay: string;
    if (todayCost === 0) {
      costDisplay = '$0';
    } else if (todayCost < 0.01) {
      costDisplay = `${(todayCost * 100).toFixed(1)}¢`;
    } else if (todayCost < 1) {
      costDisplay = `$${todayCost.toFixed(2)}`;
    } else {
      costDisplay = `$${todayCost.toFixed(2)}`;
    }

    // Format tokens
    let tokensDisplay: string;
    if (todayTokens >= 1000000) {
      tokensDisplay = `${(todayTokens / 1000000).toFixed(1)}M`;
    } else if (todayTokens >= 1000) {
      tokensDisplay = `${(todayTokens / 1000).toFixed(1)}K`;
    } else {
      tokensDisplay = todayTokens.toString();
    }

    // Events list
    let eventsHtml = '';
    if (recentEvents.length > 0) {
      const eventItems = recentEvents.slice(0, 10).map(event => {
        const time = new Date(parseInt(event.timestamp)).toLocaleTimeString('en-US', { 
          hour: 'numeric', minute: '2-digit', hour12: false 
        });
        const tokens = event.tokens >= 1000 ? `${(event.tokens / 1000).toFixed(1)}K` : event.tokens;
        return `
          <div class="event-row">
            <span class="event-time">${time}</span>
            <span class="event-model">${event.model}</span>
            <span class="event-tokens">${tokens}</span>
            <span class="event-cost">${event.costDisplay}</span>
          </div>
        `;
      }).join('');

      eventsHtml = `
        <div class="panel">
          <div class="panel-header">
            <span class="panel-title">Activity</span>
            <span class="panel-badge">${recentEvents.length}</span>
          </div>
          <div class="event-list">
            <div class="event-row event-header">
              <span class="event-time">Time</span>
              <span class="event-model">Model</span>
              <span class="event-tokens">Tokens</span>
              <span class="event-cost">Cost</span>
            </div>
            ${eventItems}
          </div>
        </div>
      `;
    }

    // Calculate a pseudo percentage for the ring (based on a daily budget estimate)
    const costPct = Math.min(100, Math.round(todayCost * 100)); // $1 = 100%

    mainContent = `
      <div class="gauge-grid">
        <div class="gauge-item">
          <div class="gauge-ring">
            ${createRing(costPct, '#34C759')}
            <div class="gauge-value">${costDisplay}</div>
          </div>
          <div class="gauge-label">Cost</div>
        </div>
        <div class="gauge-item">
          <div class="gauge-ring">
            ${createRing(Math.min(100, recentEvents.length * 10), '#007AFF')}
            <div class="gauge-value">${recentEvents.length}</div>
          </div>
          <div class="gauge-label">Requests</div>
        </div>
        <div class="gauge-item">
          <div class="gauge-ring">
            ${createRing(Math.min(100, todayTokens / 500), '#AF52DE')}
            <div class="gauge-value">${tokensDisplay}</div>
          </div>
          <div class="gauge-label">Tokens</div>
        </div>
        <div class="gauge-item">
          <div class="gauge-ring">
            ${createRing(daysUsedPct, '#FF9500')}
            <div class="gauge-value">${daysLeft}</div>
          </div>
          <div class="gauge-label">Days Left</div>
        </div>
      </div>
      ${eventsHtml}
    `;
  } else if (data.requestBased) {
    const { used, limit, percentage } = data.requestBased;
    const remaining = Math.max(0, limit - used);

    mainContent = `
      <div class="gauge-grid">
        <div class="gauge-item">
          <div class="gauge-ring">
            ${createRing(percentage, percentage >= 90 ? '#FF3B30' : percentage >= 75 ? '#FF9500' : '#34C759')}
            <div class="gauge-value">${percentage}%</div>
          </div>
          <div class="gauge-label">Used</div>
        </div>
        <div class="gauge-item">
          <div class="gauge-ring">
            ${createRing(100 - percentage, '#007AFF')}
            <div class="gauge-value">${remaining}</div>
          </div>
          <div class="gauge-label">Remaining</div>
        </div>
        <div class="gauge-item">
          <div class="gauge-ring">
            ${createRing(100, '#8E8E93')}
            <div class="gauge-value">${limit}</div>
          </div>
          <div class="gauge-label">Limit</div>
        </div>
        <div class="gauge-item">
          <div class="gauge-ring">
            ${createRing(daysUsedPct, '#FF9500')}
            <div class="gauge-value">${daysLeft}</div>
          </div>
          <div class="gauge-label">Days Left</div>
        </div>
      </div>
    `;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cursor Usage</title>
  <style>
    :root {
      --ring-bg: rgba(120, 120, 128, 0.2);
    }
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', sans-serif;
      background: var(--vscode-editor-background);
      color: var(--vscode-foreground);
      font-size: 13px;
      -webkit-font-smoothing: antialiased;
    }
    .container {
      max-width: 420px;
      margin: 0 auto;
      padding: 20px;
    }
    
    /* Header */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .header-title {
      font-size: 16px;
      font-weight: 600;
    }
    .header-period {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }
    
    /* Gauge Grid */
    .gauge-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin-bottom: 20px;
    }
    .gauge-item {
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .gauge-ring {
      position: relative;
      width: 80px;
      height: 80px;
    }
    .gauge-ring svg {
      position: absolute;
      top: 0;
      left: 0;
    }
    .gauge-value {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      font-size: 14px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .gauge-label {
      margin-top: 6px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    
    /* Panel */
    .panel {
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 8px;
      overflow: hidden;
    }
    .panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .panel-title {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    .panel-badge {
      font-size: 11px;
      padding: 2px 6px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      border-radius: 10px;
    }
    
    /* Event List */
    .event-list {
      font-size: 12px;
    }
    .event-row {
      display: grid;
      grid-template-columns: 50px 1fr 60px 70px;
      padding: 8px 12px;
      align-items: center;
    }
    .event-row:not(:last-child) {
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .event-header {
      color: var(--vscode-descriptionForeground);
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    .event-time {
      font-variant-numeric: tabular-nums;
      color: var(--vscode-descriptionForeground);
    }
    .event-model {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .event-tokens {
      text-align: right;
      font-variant-numeric: tabular-nums;
      color: var(--vscode-descriptionForeground);
    }
    .event-cost {
      text-align: right;
      font-weight: 500;
      font-variant-numeric: tabular-nums;
    }
    
    /* Footer */
    .footer {
      margin-top: 16px;
      padding-top: 12px;
      border-top: 1px solid var(--vscode-panel-border);
      display: flex;
      justify-content: center;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
    }
  </style>
</head>
<body>
  <div class="container">
    <header class="header">
      <span class="header-title">Cursor Usage</span>
      <span class="header-period">${periodStart} – ${periodEnd}</span>
    </header>

    ${mainContent}

    <footer class="footer">
      Updated ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}
    </footer>
  </div>
</body>
</html>`;
}

/**
 * Extension deactivation
 */
export function deactivate() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }
}
