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
 * Design: Apple-inspired, clean, minimal
 */
function getWebviewContent(data: CombinedUsageData): string {
  const periodStart = data.periodStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const periodEnd = data.periodEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const daysLeft = Math.max(0, Math.ceil((data.periodEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));

  let mainContent = '';
  
  if (data.billingType === 'usage-based' && data.usageBased) {
    const { todayCost, todayTokens, recentEvents } = data.usageBased;
    
    // Format cost
    let costDisplay: string;
    if (todayCost === 0) {
      costDisplay = '$0.00';
    } else if (todayCost < 0.01) {
      costDisplay = `${(todayCost * 100).toFixed(2)}¢`;
    } else if (todayCost < 1) {
      costDisplay = `$${todayCost.toFixed(3)}`;
    } else {
      costDisplay = `$${todayCost.toFixed(2)}`;
    }

    // Events list
    let eventsHtml = '';
    if (recentEvents.length > 0) {
      const eventItems = recentEvents.map(event => {
        const time = new Date(parseInt(event.timestamp)).toLocaleTimeString('en-US', { 
          hour: 'numeric', 
          minute: '2-digit',
          hour12: true 
        });
        return `
          <div class="list-item">
            <div class="list-item-left">
              <span class="list-title">${event.model}</span>
              <span class="list-subtitle">${time}</span>
            </div>
            <div class="list-item-right">
              <span class="list-value">${event.costDisplay}</span>
              <span class="list-detail">${event.tokens.toLocaleString()} tokens</span>
            </div>
          </div>
        `;
      }).join('');

      eventsHtml = `
        <section class="section">
          <h2 class="section-title">Activity</h2>
          <div class="list-group">
            ${eventItems}
          </div>
        </section>
      `;
    }

    mainContent = `
      <section class="section">
        <h2 class="section-title">Today</h2>
        <div class="hero-stat">
          <span class="hero-value">${costDisplay}</span>
          <span class="hero-label">spent</span>
        </div>
        <div class="stat-row">
          <div class="stat-cell">
            <span class="stat-value">${todayTokens.toLocaleString()}</span>
            <span class="stat-label">tokens</span>
          </div>
          <div class="stat-cell">
            <span class="stat-value">${recentEvents.length}</span>
            <span class="stat-label">requests</span>
          </div>
        </div>
      </section>
      ${eventsHtml}
    `;
  } else if (data.requestBased) {
    const { used, limit, percentage } = data.requestBased;
    const remaining = Math.max(0, limit - used);
    const recentEvents = data.recentEvents || [];

    // Calculate today's stats from events
    const todayTokens = recentEvents.reduce((sum, e) => sum + e.tokens, 0);
    const todayCost = recentEvents.reduce((sum, e) => sum + e.cost, 0);

    // Events list for request-based
    let eventsHtml = '';
    if (recentEvents.length > 0) {
      const eventItems = recentEvents.map(event => {
        const time = new Date(parseInt(event.timestamp)).toLocaleTimeString('en-US', { 
          hour: 'numeric', 
          minute: '2-digit',
          hour12: true 
        });
        return `
          <div class="list-item">
            <div class="list-item-left">
              <span class="list-title">${event.model}</span>
              <span class="list-subtitle">${time}</span>
            </div>
            <div class="list-item-right">
              <span class="list-value">${event.tokens.toLocaleString()} tokens</span>
              <span class="list-detail">${event.costDisplay}</span>
            </div>
          </div>
        `;
      }).join('');

      eventsHtml = `
        <section class="section">
          <h2 class="section-title">Today's Activity</h2>
          <div class="list-group">
            ${eventItems}
          </div>
        </section>
      `;
    }

    // Format today's cost
    let todayCostDisplay = '';
    if (todayCost > 0) {
      if (todayCost < 0.01) {
        todayCostDisplay = `${(todayCost * 100).toFixed(2)}¢`;
      } else {
        todayCostDisplay = `$${todayCost.toFixed(2)}`;
      }
    }

    mainContent = `
      <section class="section">
        <h2 class="section-title">This Month</h2>
        <div class="hero-stat">
          <span class="hero-value">${used}<span class="hero-total">/${limit}</span></span>
          <span class="hero-label">requests used</span>
        </div>
        <div class="progress-track">
          <div class="progress-fill" style="width: ${Math.min(100, percentage)}%"></div>
        </div>
        <div class="stat-row">
          <div class="stat-cell">
            <span class="stat-value">${remaining}</span>
            <span class="stat-label">remaining</span>
          </div>
          <div class="stat-cell">
            <span class="stat-value">${percentage}%</span>
            <span class="stat-label">used</span>
          </div>
        </div>
      </section>
      ${recentEvents.length > 0 ? `
      <section class="section">
        <h2 class="section-title">Today</h2>
        <div class="stat-row" style="border-top: none;">
          <div class="stat-cell">
            <span class="stat-value">${recentEvents.length}</span>
            <span class="stat-label">requests</span>
          </div>
          <div class="stat-cell">
            <span class="stat-value">${todayTokens.toLocaleString()}</span>
            <span class="stat-label">tokens</span>
          </div>
          ${todayCostDisplay ? `
          <div class="stat-cell">
            <span class="stat-value">${todayCostDisplay}</span>
            <span class="stat-label">cost</span>
          </div>
          ` : ''}
        </div>
      </section>
      ` : ''}
      ${eventsHtml}
    `;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Usage</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif;
      background: var(--vscode-editor-background);
      color: var(--vscode-foreground);
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
    }
    .container {
      max-width: 480px;
      margin: 0 auto;
      padding: 32px 24px;
    }
    
    /* Header */
    .header {
      margin-bottom: 32px;
    }
    .header-title {
      font-size: 28px;
      font-weight: 600;
      letter-spacing: -0.5px;
      margin-bottom: 8px;
    }
    .header-meta {
      display: flex;
      gap: 16px;
      font-size: 13px;
      color: var(--vscode-descriptionForeground);
    }
    .meta-item {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    
    /* Section */
    .section {
      margin-bottom: 32px;
    }
    .section-title {
      font-size: 13px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 16px;
    }
    
    /* Hero Stat */
    .hero-stat {
      text-align: center;
      padding: 24px 0;
    }
    .hero-value {
      font-size: 48px;
      font-weight: 300;
      letter-spacing: -2px;
      color: var(--vscode-textLink-foreground);
    }
    .hero-total {
      font-size: 24px;
      color: var(--vscode-descriptionForeground);
    }
    .hero-label {
      display: block;
      font-size: 14px;
      color: var(--vscode-descriptionForeground);
      margin-top: 4px;
    }
    
    /* Progress */
    .progress-track {
      height: 4px;
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 2px;
      overflow: hidden;
      margin: 16px 0;
    }
    .progress-fill {
      height: 100%;
      background: var(--vscode-textLink-foreground);
      border-radius: 2px;
      transition: width 0.3s ease;
    }
    
    /* Stat Row */
    .stat-row {
      display: flex;
      border-top: 1px solid var(--vscode-panel-border);
    }
    .stat-cell {
      flex: 1;
      padding: 16px;
      text-align: center;
    }
    .stat-cell:not(:last-child) {
      border-right: 1px solid var(--vscode-panel-border);
    }
    .stat-value {
      display: block;
      font-size: 20px;
      font-weight: 500;
    }
    .stat-label {
      display: block;
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      margin-top: 2px;
    }
    
    /* List */
    .list-group {
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 12px;
      overflow: hidden;
    }
    .list-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 14px 16px;
    }
    .list-item:not(:last-child) {
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .list-item-left {
      display: flex;
      flex-direction: column;
    }
    .list-item-right {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
    }
    .list-title {
      font-size: 15px;
      font-weight: 500;
    }
    .list-subtitle {
      font-size: 13px;
      color: var(--vscode-descriptionForeground);
    }
    .list-value {
      font-size: 15px;
      font-weight: 500;
      font-variant-numeric: tabular-nums;
    }
    .list-detail {
      font-size: 13px;
      color: var(--vscode-descriptionForeground);
    }
    
    /* Footer */
    .footer {
      text-align: center;
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      padding-top: 16px;
      border-top: 1px solid var(--vscode-panel-border);
    }
  </style>
</head>
<body>
  <div class="container">
    <header class="header">
      <h1 class="header-title">Usage</h1>
      <div class="header-meta">
        <span class="meta-item">${periodStart} – ${periodEnd}</span>
        <span class="meta-item">${daysLeft} days left</span>
      </div>
    </header>

    ${mainContent}

    <footer class="footer">
      Updated ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
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
