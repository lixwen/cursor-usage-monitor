# Cursor Usage Monitor

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![VS Code](https://img.shields.io/badge/VS%20Code-1.85+-blue.svg)](https://code.visualstudio.com/)

A VS Code extension that displays real-time Cursor AI usage statistics in the status bar. Monitor your API usage, track remaining requests, and stay informed about your billing cycle.

![Status Bar Preview](./images/preview.png)

## Features

- **Real-time Status Bar Display**: See your Cursor usage at a glance in the VS Code status bar
- **Multiple Display Modes**: Choose between requests count, percentage, or both
- **Support for All Billing Plans**: Works with Free, Pro, Business, and Usage-Based plans
- **Visual Indicators**: Color-coded warnings when approaching usage limits
- **Detailed Usage Panel**: Click to view comprehensive usage statistics
- **Auto-refresh**: Configurable automatic refresh interval
- **Secure Token Storage**: Your API credentials are stored securely using VS Code's secret storage

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

### Setting Up Your Session Token

1. Open Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Type "Cursor Usage: Set Session Token"
3. Follow the instructions to get your token from browser cookies

**How to get your token:**
1. Open https://cursor.com/settings in your browser
2. Press F12 to open Developer Tools
3. Go to **Application** → **Cookies** → `cursor.com`
4. Find `WorkosCursorSessionToken` and copy its value
5. Paste the token when prompted

> **Note**: The extension will attempt to auto-detect your Cursor credentials from the local Cursor installation. If auto-detection fails, you'll need to manually set your session token.

### Extension Settings

Configure the extension in VS Code settings (`File > Preferences > Settings`):

| Setting | Description | Default |
|---------|-------------|---------|
| `cursorUsage.refreshInterval` | Refresh interval in seconds (minimum 60) | `60` |
| `cursorUsage.showInStatusBar` | Show usage information in status bar | `true` |
| `cursorUsage.displayMode` | Display mode: `requests`, `percentage`, or `both` | `both` |
| `cursorUsage.billingModel` | Your billing plan: `free`, `pro`, `business`, or `usage-based` | `pro` |

### Example Settings

```json
{
  "cursorUsage.refreshInterval": 300,
  "cursorUsage.showInStatusBar": true,
  "cursorUsage.displayMode": "both",
  "cursorUsage.billingModel": "pro"
}
```

## Commands

| Command | Description |
|---------|-------------|
| `Cursor Usage: Refresh Usage Data` | Manually refresh usage statistics |
| `Cursor Usage: Show Usage Details` | Open detailed usage panel |
| `Cursor Usage: Set Session Token` | Configure your Cursor session token |

## Status Bar Indicators

The status bar icon changes based on your usage level:

| Icon | Usage Level | Description |
|------|-------------|-------------|
| $(pulse) | < 50% | Normal usage |
| $(dashboard) | 50-74% | Moderate usage |
| $(warning) | 75-89% | High usage (yellow background) |
| $(flame) | ≥ 90% | Critical usage (red background) |

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

1. Ensure you're logged in to cursor.com in your browser
2. Try setting the session token manually via Command Palette
3. Make sure to copy the complete token value (including `user_XXXXX::` prefix)
4. Restart VS Code after setting the token

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

## Changelog

### 0.1.0

- Initial release
- Real-time status bar display
- Support for multiple billing models
- Detailed usage panel
- Configurable refresh interval

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [Cursor](https://cursor.sh) - The AI-first code editor
- [VS Code Extension API](https://code.visualstudio.com/api) - For excellent documentation

---

**Enjoy!** If you find this extension helpful, please consider giving it a ⭐ on GitHub!
