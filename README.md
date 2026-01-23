# Cursor Usage Monitor

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![VS Code](https://img.shields.io/badge/VS%20Code-1.85+-blue.svg)](https://code.visualstudio.com/)

A VS Code extension that displays real-time Cursor AI usage statistics in the status bar. Monitor your API usage, track remaining requests, and stay informed about your billing cycle.

![Status Bar Preview](./images/preview.png)

## Current Status

> **⚠️ Note**: This extension is currently in early development. Only **Team accounts with request-based billing** have been tested and verified. Other account types (Free, Pro individual, Business, Usage-Based) are not yet fully adapted.

## Features

- **Auto Token Detection**: Automatically reads your Cursor authentication token from local SQLite database
- **Real-time Status Bar Display**: See your Cursor usage at a glance in the VS Code status bar
- **Multiple Display Modes**: Choose between requests count, percentage, or both
- **Team Account Support**: Currently optimized for Team accounts with request-based billing
- **Visual Indicators**: Color-coded warnings when approaching usage limits
- **Detailed Usage Panel**: Click to view comprehensive usage statistics
- **Auto-refresh**: Configurable automatic refresh interval
- **Secure Token Storage**: Your API credentials are stored securely using VS Code's secret storage
- **Debug Logging**: Output channel for troubleshooting token detection issues

## Installation

### From VS Code Marketplace

1. Open VS Code
2. Press `Ctrl+P` / `Cmd+P`
3. Type `ext install cursor-usage`
4. Press Enter

### From VSIX File

1. Download the `.vsix` file from [Releases](https://github.com/lixwen/cursor-usage-monitor/releases)
2. Open VS Code
3. Press `Ctrl+Shift+P` / `Cmd+Shift+P`
4. Type "Install from VSIX"
5. Select the downloaded file

### Build from Source

```bash
# Clone the repository
git clone https://github.com/lixwen/cursor-usage-monitor.git
cd cursor-usage-monitor

# Install dependencies
npm install

# Compile
npm run compile

# Package
npm run package
```

## Configuration

### Automatic Token Detection

The extension automatically detects your Cursor authentication token from Cursor's local SQLite database. No manual configuration is needed - it works out of the box on all platforms.

**How it works:**
- Uses sql.js (pure JavaScript SQLite implementation)
- No external dependencies required
- Falls back to `sqlite3` command if available

### Manual Token Setup (if auto-detection fails)

1. Open Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Type "Cursor Usage: Set Session Token"
3. Follow the instructions to get your token from browser cookies

**How to get your token manually:**
1. Open https://cursor.com/settings in your browser
2. Press F12 to open Developer Tools
3. Go to **Application** → **Cookies** → `cursor.com`
4. Find `WorkosCursorSessionToken` and copy its value
5. Paste the token when prompted

### Extension Settings

Configure the extension in VS Code settings (`File > Preferences > Settings`):

| Setting | Description | Default |
|---------|-------------|---------|
| `cursorUsage.refreshInterval` | Refresh interval in seconds (minimum 60) | `60` |
| `cursorUsage.showInStatusBar` | Show usage information in status bar | `true` |
| `cursorUsage.displayMode` | Display mode: `requests`, `percentage`, or `both` | `both` |
| `cursorUsage.billingModel` | Your billing plan: `free`, `pro`, `business`, or `usage-based` | `pro` |
| `cursorUsage.autoDetectToken` | Automatically detect token from Cursor's local database | `true` |

### Example Settings

```json
{
  "cursorUsage.refreshInterval": 300,
  "cursorUsage.showInStatusBar": true,
  "cursorUsage.displayMode": "both",
  "cursorUsage.billingModel": "pro",
  "cursorUsage.autoDetectToken": true
}
```

## Commands

| Command | Description |
|---------|-------------|
| `Cursor Usage: Refresh Usage Data` | Manually refresh usage statistics |
| `Cursor Usage: Show Usage Details` | Open detailed usage panel |
| `Cursor Usage: Set Session Token` | Configure your Cursor session token |
| `Cursor Usage: Clear Saved Token` | Clear stored token (useful for debugging) |

## Status Bar Indicators

The status bar icon changes based on your usage level (friendly, non-intrusive design):

| Icon | Usage Level | Description |
|------|-------------|-------------|
| $(check) | < 50% | Everything is fine |
| $(graph-line) | 50-74% | Usage trending up |
| $(zap) | 75-89% | Getting busy |
| $(rocket) | ≥ 90% | Fast consumption |
| $(credit-card) | 100% | Exhausted / On-Demand mode |

## Billing Plans Reference

| Plan | Premium Requests | Standard Requests |
|------|-----------------|-------------------|
| Free | 50/month | 200/month |
| Pro | 500/month | Unlimited |
| Business | 500/month | Unlimited |
| Usage-Based | Pay-as-you-go | Pay-as-you-go |

## Privacy & Security

- **Secure Storage**: Your API credentials are stored using VS Code's secure secret storage
- **Local Processing**: All data processing happens locally on your machine
- **No Telemetry**: This extension does not collect or transmit any usage data

## Troubleshooting

### "Not authenticated" Error

1. Ensure you're logged in to Cursor (the application, not the browser)
2. Check if `sqlite3` is installed: run `sqlite3 --version` in terminal
3. Check the Output panel (`Ctrl+Shift+U` → select "Cursor Usage Monitor") for detailed logs
4. Try setting the session token manually via Command Palette
5. Make sure to copy the complete token value (including `user_XXXXX::` prefix)
6. Restart VS Code after setting the token

### Auto-detection Not Working

1. Ensure Cursor is installed and you have logged in at least once
2. Verify `sqlite3` is installed on your system
3. Check the Output panel for error messages
4. Try disabling auto-detection (`cursorUsage.autoDetectToken: false`) and set token manually

### Data Not Updating

1. Check your internet connection
2. Try the "Refresh Usage Data" command
3. Session tokens may expire - try setting a new token from browser cookies

### Status Bar Not Visible

1. Check that `cursorUsage.showInStatusBar` is set to `true`
2. Look for the item on the right side of the status bar
3. Try reloading VS Code (`Ctrl+Shift+P` → "Reload Window")

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## Development

```bash
# Install dependencies
npm install

# Watch mode for development
npm run watch

# Run linter
npm run lint

# Build for production
npm run compile
```

### Project Structure

```
cursor-usage/
├── src/
│   ├── extension.ts      # Extension entry point
│   ├── cursorApi.ts      # Cursor API service
│   ├── statusBar.ts      # Status bar management
│   └── types.ts          # TypeScript type definitions
├── package.json          # Extension manifest
├── tsconfig.json         # TypeScript configuration
├── README.md             # This file
└── LICENSE               # MIT License
```

## Roadmap

### Account Type Support

| Account Type | Status | Notes |
|--------------|--------|-------|
| Team (Request-based) | ✅ Supported | Currently tested and working |
| Pro (Individual) | 🚧 Planned | API integration pending |
| Business | 🚧 Planned | API integration pending |
| Free | 🚧 Planned | API integration pending |
| Usage-Based (Pay-as-you-go) | 🚧 Planned | API integration pending |

### Planned Features

- [ ] Support for Pro individual accounts
- [ ] Support for Free tier accounts
- [ ] Support for Business accounts
- [ ] Support for Usage-Based billing (cost tracking)
- [ ] Auto-detect account type from API response
- [ ] Multi-account switching support
- [ ] Usage history and trends visualization
- [ ] Export usage data to CSV/JSON

## Changelog

### 0.1.4

- **New**: Support for usage-based billing detection
  - Automatically detects billing type (request-based vs usage-based)
  - Shows cost for usage-based billing, requests for request-based
  - Detailed tooltip shows recent requests and costs
- **Improved**: Cleaner status bar display

### 0.1.3

- **Improved**: No longer requires `sqlite3` to be installed
  - Uses sql.js (pure JavaScript SQLite) for token detection
  - Falls back to sqlite3 command if sql.js fails
  - Works out of the box on all platforms

### 0.1.2

- **Improved**: Friendlier status bar icons without pressure
  - Replaced warning/flame icons with check/graph/zap/rocket
  - Removed colored backgrounds for normal usage levels
  - Only highlight when requests are completely exhausted

### 0.1.1

- **New**: Automatic token detection from Cursor's local SQLite database
- **New**: `autoDetectToken` configuration option (default: enabled)
- **New**: `Clear Saved Token` command for debugging
- **New**: Output channel logging for troubleshooting
- **Improved**: Error handling and logging throughout the extension

### 0.1.0

- Initial release
- Real-time status bar display
- Team account support (request-based billing)
- Detailed usage panel
- Configurable refresh interval

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [Cursor](https://cursor.sh) - The AI-first code editor
- [VS Code Extension API](https://code.visualstudio.com/api) - For excellent documentation

---

**Enjoy!** If you find this extension helpful, please consider giving it a ⭐ on GitHub!
