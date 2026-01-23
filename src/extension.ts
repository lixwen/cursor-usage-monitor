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
 */
function getWebviewContent(data: CombinedUsageData): string {
  const periodStart = data.periodStart.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const periodEnd = data.periodEnd.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const daysLeft = Math.max(0, Math.ceil((data.periodEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));

  // Generate content based on billing type
  let usageContent = '';
  
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

    // Generate events table
    let eventsHtml = '';
    if (recentEvents.length > 0) {
      const eventRows = recentEvents.map(event => {
        const time = new Date(parseInt(event.timestamp)).toLocaleTimeString();
        return `
          <tr>
            <td>${time}</td>
            <td>${event.model}</td>
            <td>${event.tokens.toLocaleString()}</td>
            <td>${event.costDisplay}</td>
          </tr>
        `;
      }).join('');

      eventsHtml = `
        <div class="card">
          <h2>📋 Today's Requests (${recentEvents.length})</h2>
          <table class="events-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Model</th>
                <th>Tokens</th>
                <th>Cost</th>
              </tr>
            </thead>
            <tbody>
              ${eventRows}
            </tbody>
          </table>
        </div>
      `;
    }

    usageContent = `
      <div class="card">
        <h2>💳 Today's Usage</h2>
        <div class="stats-grid">
          <div class="stat-item">
            <div class="stat-value">${costDisplay}</div>
            <div class="stat-label">Cost</div>
          </div>
          <div class="stat-item">
            <div class="stat-value">${todayTokens.toLocaleString()}</div>
            <div class="stat-label">Tokens</div>
          </div>
          <div class="stat-item">
            <div class="stat-value">${recentEvents.length}</div>
            <div class="stat-label">Requests</div>
          </div>
          <div class="stat-item">
            <div class="stat-value">${daysLeft}</div>
            <div class="stat-label">Days Left</div>
          </div>
        </div>
      </div>
      ${eventsHtml}
    `;
  } else if (data.requestBased) {
    const { used, limit, percentage } = data.requestBased;
    const remaining = Math.max(0, limit - used);

    usageContent = `
      <div class="card">
        <h2>Premium Requests</h2>
        <div class="progress-container">
          <div class="progress-bar ${percentage >= 90 ? 'high' : percentage >= 75 ? 'medium' : 'low'}" 
               style="width: ${Math.min(100, percentage)}%"></div>
        </div>
        <div class="stats-grid">
          <div class="stat-item">
            <div class="stat-value">${used}</div>
            <div class="stat-label">Used</div>
          </div>
          <div class="stat-item">
            <div class="stat-value">${remaining}</div>
            <div class="stat-label">Remaining</div>
          </div>
          <div class="stat-item">
            <div class="stat-value">${limit}</div>
            <div class="stat-label">Total Limit</div>
          </div>
          <div class="stat-item">
            <div class="stat-value">${percentage}%</div>
            <div class="stat-label">Usage</div>
          </div>
        </div>
      </div>
    `;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cursor Usage Details</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      padding: 20px;
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
    }
    .container {
      max-width: 700px;
      margin: 0 auto;
    }
    h1 {
      color: var(--vscode-textLink-foreground);
      border-bottom: 1px solid var(--vscode-panel-border);
      padding-bottom: 10px;
    }
    .card {
      background-color: var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 20px;
    }
    .card h2 {
      margin-top: 0;
      font-size: 1.1em;
      color: var(--vscode-textPreformat-foreground);
    }
    .progress-container {
      background-color: var(--vscode-progressBar-background);
      border-radius: 10px;
      height: 20px;
      overflow: hidden;
      margin: 15px 0;
    }
    .progress-bar {
      height: 100%;
      border-radius: 10px;
      transition: width 0.3s ease;
    }
    .progress-bar.low { background-color: #4caf50; }
    .progress-bar.medium { background-color: #ff9800; }
    .progress-bar.high { background-color: #f44336; }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 15px;
      margin-top: 15px;
    }
    .stat-item {
      text-align: center;
      padding: 15px;
      background-color: var(--vscode-editor-background);
      border-radius: 8px;
    }
    .stat-value {
      font-size: 1.8em;
      font-weight: bold;
      color: var(--vscode-textLink-foreground);
    }
    .stat-label {
      font-size: 0.85em;
      color: var(--vscode-descriptionForeground);
      margin-top: 5px;
    }
    .billing-badge {
      display: inline-block;
      padding: 5px 12px;
      border-radius: 15px;
      background-color: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      font-size: 0.9em;
    }
    .period-info {
      color: var(--vscode-descriptionForeground);
      font-size: 0.9em;
      margin-top: 10px;
    }
    .last-updated {
      text-align: center;
      color: var(--vscode-descriptionForeground);
      font-size: 0.8em;
      margin-top: 20px;
    }
    .events-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
      font-size: 0.9em;
    }
    .events-table th, .events-table td {
      padding: 10px;
      text-align: left;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .events-table th {
      color: var(--vscode-descriptionForeground);
      font-weight: normal;
    }
    .events-table tr:hover {
      background-color: var(--vscode-list-hoverBackground);
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>📊 Cursor Usage Statistics</h1>
    
    <div class="card">
      <h2>Billing</h2>
      <span class="billing-badge">${data.billingType === 'usage-based' ? '💳 Usage-Based (Token)' : '📊 Request-Based'}</span>
      <p class="period-info">
        📅 ${periodStart} - ${periodEnd}<br>
        ⏳ ${daysLeft} days remaining
      </p>
    </div>

    ${usageContent}

    <p class="last-updated">Last updated: ${new Date().toLocaleString()}</p>
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
