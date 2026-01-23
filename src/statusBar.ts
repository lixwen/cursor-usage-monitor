import * as vscode from 'vscode';
import { UsageData, DisplayMode, BillingModel, CombinedUsageData } from './types';

/**
 * Status Bar Manager
 * Handles the display of usage information in VS Code status bar
 */
export class StatusBarManager {
  private statusBarItem: vscode.StatusBarItem;
  private displayMode: DisplayMode;
  private cachedCombinedData: CombinedUsageData | null = null;

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.statusBarItem.command = 'cursorUsage.showDetails';
    this.displayMode = 'both';
    this.setLoading();
  }

  /**
   * Get cached combined data for details panel
   */
  public getCachedCombinedData(): CombinedUsageData | null {
    return this.cachedCombinedData;
  }

  /**
   * Update display mode
   */
  public setDisplayMode(mode: DisplayMode): void {
    this.displayMode = mode;
  }

  /**
   * Show the status bar item
   */
  public show(): void {
    this.statusBarItem.show();
  }

  /**
   * Hide the status bar item
   */
  public hide(): void {
    this.statusBarItem.hide();
  }

  /**
   * Set loading state
   */
  public setLoading(): void {
    this.statusBarItem.text = '$(sync~spin) Cursor Usage';
    this.statusBarItem.tooltip = 'Loading usage data...';
    this.statusBarItem.show();
  }

  /**
   * Set error state
   */
  public setError(message: string): void {
    this.statusBarItem.text = '$(warning) Cursor Usage';
    this.statusBarItem.tooltip = `Error: ${message}\nClick to retry`;
    this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    this.statusBarItem.show();
  }

  /**
   * Set not authenticated state
   */
  public setNotAuthenticated(): void {
    this.statusBarItem.text = '$(key) Cursor: Set Token';
    this.statusBarItem.tooltip = 'Click to set your Cursor session token';
    this.statusBarItem.command = 'cursorUsage.setToken';
    this.statusBarItem.backgroundColor = undefined;
    this.statusBarItem.show();
  }

  /**
   * Update status bar with usage data
   */
  public updateUsage(data: UsageData): void {
    const text = this.formatStatusBarText(data);
    const tooltip = this.formatTooltip(data);

    this.statusBarItem.text = text;
    this.statusBarItem.tooltip = tooltip;
    this.statusBarItem.command = 'cursorUsage.showDetails';
    this.statusBarItem.backgroundColor = this.getBackgroundColor(data);
    this.statusBarItem.show();
  }

  /**
   * Update status bar with combined usage data (supports both billing types)
   */
  public updateCombinedUsage(data: CombinedUsageData): void {
    this.cachedCombinedData = data;
    
    let text: string;
    let tooltip: vscode.MarkdownString;

    if (data.billingType === 'usage-based' && data.usageBased) {
      // Usage-based: show today's cost
      const cost = data.usageBased.todayCost;
      
      // Format cost - show cents if < $0.01, otherwise show dollars
      let costStr: string;
      if (cost === 0) {
        costStr = '$0.00';
      } else if (cost < 0.01) {
        costStr = `${(cost * 100).toFixed(2)}¢`;
      } else if (cost < 1) {
        costStr = `$${cost.toFixed(3)}`;
      } else {
        costStr = `$${cost.toFixed(2)}`;
      }
      
      text = `Cursor ${costStr}`;
      
      tooltip = this.formatUsageBasedTooltip(data);
    } else if (data.requestBased) {
      // Request-based: show requests used/limit
      const { used, limit, percentage } = data.requestBased;
      
      switch (this.displayMode) {
        case 'requests':
          text = `Cursor ${used}/${limit}`;
          break;
        case 'percentage':
          text = `Cursor ${percentage}%`;
          break;
        case 'both':
        default:
          text = `Cursor ${used}/${limit}`;
      }
      
      tooltip = this.formatRequestBasedTooltip(data);
    } else {
      text = 'Cursor';
      tooltip = new vscode.MarkdownString('No usage data available');
    }

    this.statusBarItem.text = text;
    this.statusBarItem.tooltip = tooltip;
    this.statusBarItem.command = 'cursorUsage.showDetails';
    this.statusBarItem.backgroundColor = undefined;
    this.statusBarItem.show();
  }

  /**
   * Get icon for request-based billing
   */
  private getRequestBasedIcon(percentage: number): string {
    if (percentage >= 100) {
      return '$(credit-card)';
    } else if (percentage >= 90) {
      return '$(rocket)';
    } else if (percentage >= 75) {
      return '$(zap)';
    } else if (percentage >= 50) {
      return '$(graph-line)';
    } else {
      return '$(check)';
    }
  }

  /**
   * Format tooltip for usage-based billing
   */
  private formatUsageBasedTooltip(data: CombinedUsageData): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;

    if (data.usageBased) {
      const { todayCost, todayTokens, recentEvents } = data.usageBased;
      
      // Format cost
      let costStr: string;
      if (todayCost === 0) {
        costStr = '$0.00';
      } else if (todayCost < 0.01) {
        costStr = `${(todayCost * 100).toFixed(2)}¢`;
      } else {
        costStr = `$${todayCost.toFixed(3)}`;
      }
      
      md.appendMarkdown(`**Today** ${costStr} · ${todayTokens.toLocaleString()} tokens · ${recentEvents.length} requests\n\n`);
      
      if (recentEvents.length > 0) {
        const showEvents = recentEvents.slice(0, 3);
        for (const event of showEvents) {
          const time = new Date(parseInt(event.timestamp)).toLocaleTimeString('en-US', { 
            hour: 'numeric', minute: '2-digit', hour12: true 
          });
          md.appendMarkdown(`${time} · ${event.model} · ${event.costDisplay}\n\n`);
        }
      }
    }

    const daysLeft = this.calculateDaysLeft(data.periodEnd);
    md.appendMarkdown(`---\n\n`);
    md.appendMarkdown(`${daysLeft} days left · Click for details`);

    return md;
  }

  /**
   * Format tooltip for request-based billing
   */
  private formatRequestBasedTooltip(data: CombinedUsageData): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    
    if (data.requestBased) {
      const { used, limit, percentage } = data.requestBased;
      const remaining = Math.max(0, limit - used);
      
      md.appendMarkdown(`**${used}** / ${limit} requests · ${remaining} remaining\n\n`);
      
      // Show today's activity if available
      const recentEvents = data.recentEvents || [];
      if (recentEvents.length > 0) {
        const todayTokens = recentEvents.reduce((sum, e) => sum + e.tokens, 0);
        md.appendMarkdown(`**Today** ${recentEvents.length} requests · ${todayTokens.toLocaleString()} tokens\n\n`);
        
        // Show last 3 events
        const showEvents = recentEvents.slice(0, 3);
        for (const event of showEvents) {
          const time = new Date(parseInt(event.timestamp)).toLocaleTimeString('en-US', { 
            hour: 'numeric', minute: '2-digit', hour12: true 
          });
          md.appendMarkdown(`${time} · ${event.model} · ${event.tokens.toLocaleString()} tokens\n\n`);
        }
      }
    }

    const daysLeft = this.calculateDaysLeft(data.periodEnd);
    md.appendMarkdown(`---\n\n`);
    md.appendMarkdown(`${daysLeft} days left · Click for details`);

    return md;
  }

  /**
   * Format the status bar text based on display mode
   */
  private formatStatusBarText(data: UsageData): string {
    // If premium requests are exhausted, show On-Demand Usage
    if (data.isPremiumExhausted && data.usageBasedCostCents !== undefined) {
      const costDollars = (data.usageBasedCostCents / 100).toFixed(2);
      return `$(credit-card) On-Demand: $${costDollars}`;
    }

    const icon = this.getUsageIcon(data);
    const pct = this.calculatePercentage(data.premiumRequestsUsed, data.premiumRequestsLimit);
    
    switch (this.displayMode) {
      case 'requests':
        return `${icon} ${data.premiumRequestsUsed}/${data.premiumRequestsLimit}`;
      
      case 'percentage':
        return `${icon} ${pct}%`;
      
      case 'both':
      default:
        return `${icon} ${data.premiumRequestsUsed}/${data.premiumRequestsLimit} (${pct}%)`;
    }
  }

  /**
   * Get appropriate icon based on usage level
   * Using friendly icons without pressure
   */
  private getUsageIcon(data: UsageData): string {
    // On-Demand mode
    if (data.isPremiumExhausted) {
      return '$(credit-card)';
    }

    const percentage = this.calculatePercentage(data.premiumRequestsUsed, data.premiumRequestsLimit);
    
    if (percentage >= 100) {
      return '$(credit-card)';
    } else if (percentage >= 90) {
      return '$(rocket)';      // Rocket: fast consumption, but exciting not scary
    } else if (percentage >= 75) {
      return '$(zap)';         // Zap: energy/speed, neutral feeling
    } else if (percentage >= 50) {
      return '$(graph-line)';  // Graph: showing usage trend
    } else {
      return '$(check)';       // Check: everything is fine
    }
  }

  /**
   * Get background color based on usage level
   * Only highlight when exhausted, otherwise keep clean
   */
  private getBackgroundColor(data: UsageData): vscode.ThemeColor | undefined {
    // On-Demand mode - use prominent color
    if (data.isPremiumExhausted) {
      return new vscode.ThemeColor('statusBarItem.prominentBackground');
    }

    const percentage = this.calculatePercentage(data.premiumRequestsUsed, data.premiumRequestsLimit);
    
    // Only show background color when completely exhausted
    if (percentage >= 100) {
      return new vscode.ThemeColor('statusBarItem.prominentBackground');
    }
    
    // No background color for normal usage - cleaner look
    return undefined;
  }

  /**
   * Format detailed tooltip
   */
  private formatTooltip(data: UsageData): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;

    const premiumPct = this.calculatePercentage(data.premiumRequestsUsed, data.premiumRequestsLimit);
    const progressBar = this.createProgressBar(Math.min(100, premiumPct));

    md.appendMarkdown(`## Cursor Usage Statistics\n\n`);
    md.appendMarkdown(`**Billing Plan:** ${this.formatBillingModel(data.billingModel)}\n\n`);
    
    if (data.teamName) {
      md.appendMarkdown(`**Team:** ${data.teamName}\n\n`);
    }
    
    md.appendMarkdown(`---\n\n`);
    
    md.appendMarkdown(`### Premium Requests (Fast)\n`);
    md.appendMarkdown(`${progressBar} **${Math.min(100, premiumPct)}%**\n\n`);
    md.appendMarkdown(`Used: **${data.premiumRequestsUsed}** / ${data.premiumRequestsLimit}\n\n`);
    
    if (data.isPremiumExhausted) {
      md.appendMarkdown(`⚠️ **Premium requests exhausted!**\n\n`);
    } else {
      md.appendMarkdown(`Remaining: **${Math.max(0, data.premiumRequestsLimit - data.premiumRequestsUsed)}**\n\n`);
    }
    
    // Show On-Demand Usage if applicable
    if (data.usageBasedCostCents !== undefined) {
      md.appendMarkdown(`---\n\n`);
      md.appendMarkdown(`### 💳 On-Demand Usage\n`);
      const costDollars = (data.usageBasedCostCents / 100).toFixed(2);
      md.appendMarkdown(`**$${costDollars}** this billing cycle\n\n`);
    }
    
    md.appendMarkdown(`---\n\n`);
    
    md.appendMarkdown(`### Billing Period\n`);
    md.appendMarkdown(`📅 ${this.formatDate(data.periodStart)} - ${this.formatDate(data.periodEnd)}\n\n`);
    
    const daysLeft = this.calculateDaysLeft(data.periodEnd);
    md.appendMarkdown(`⏳ **${daysLeft}** days remaining\n\n`);

    md.appendMarkdown(`---\n\n`);
    md.appendMarkdown(`*Click to view details • Last updated: ${new Date().toLocaleTimeString()}*`);

    return md;
  }

  /**
   * Create a visual progress bar
   */
  private createProgressBar(percentage: number): string {
    const filled = Math.round(percentage / 10);
    const empty = 10 - filled;
    const filledChar = '█';
    const emptyChar = '░';
    
    return filledChar.repeat(filled) + emptyChar.repeat(empty);
  }

  /**
   * Calculate percentage
   */
  private calculatePercentage(used: number, limit: number): number {
    if (limit === 0 || limit === 999999) {
      return 0;
    }
    return Math.round((used / limit) * 100);
  }

  /**
   * Format billing model for display
   */
  private formatBillingModel(model: BillingModel): string {
    const modelNames: Record<BillingModel, string> = {
      'free': '🆓 Free',
      'pro': '⭐ Pro',
      'business': '🏢 Business',
      'usage-based': '📊 Usage-Based'
    };
    return modelNames[model] || model;
  }

  /**
   * Format date for display
   */
  private formatDate(date: Date): string {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }

  /**
   * Calculate days left in billing period
   */
  private calculateDaysLeft(endDate: Date): number {
    const now = new Date();
    const diffTime = endDate.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return Math.max(0, diffDays);
  }

  /**
   * Dispose of resources
   */
  public dispose(): void {
    this.statusBarItem.dispose();
  }
}
