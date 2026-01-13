# Post To Bluesky - Obsidian Plugin

Language: **English** | [日本語](./README_JA.md)

This plugin lets you post from Obsidian to Bluesky. Open the post modal to compose freely and send your content to Bluesky.

## Main Features

### 📝 Posting

- **Create Post**: Open the post modal to compose freely and send to Bluesky

### 🖼️ Image Attachment

- Attach up to 4 images
- Drag & drop supported
- Automatic aspect ratio handling

### 😊 Emoji Picker

- Categorized emoji groups
- Categories: emotions, hands, hearts, nature, food, activity, etc.
- Quick access via hotkey

### ⚙️ Customizable Settings

- Bluesky account (handle + app password)
- Default hashtags
- Network timeout
- Custom hotkeys

### ⌨️ Hotkeys

#### About the Mod Key

`Mod` automatically maps to:

- **macOS**: `⌘` (Command)
- **Windows/Linux**: `Ctrl`

#### Customizable Hotkeys

You can configure hotkeys for the following actions in the post modal:

| Action | Default |
|--------|---------|
| Send Post | None |
| Add Image | None |
| Emoji Picker | None |
| Cancel | None |

All hotkeys can be customized in settings. For example: `Mod+Enter`, `Mod+I`, `Mod+E`, etc.

## Installation

### Manual Install

1. Clone or download this repository
2. Copy `main.js`, `styles.css`, and `manifest.json` into your `.obsidian/plugins/post-to-bluesky/` folder
3. In Obsidian open Settings → Community plugins.
  Disable Safe mode (if on) and enable Community plugins.
4. Restart Obsidian
5. Enable the plugin in Settings

### Development Setup

```bash
npm install
npm run dev
```

## Usage

### 1. Initial Setup

1. Open Obsidian Settings
2. Go to the Post To Bluesky tab
3. Enter your Bluesky handle and app password
4. (Optional) Set default hashtags

### 2. Creating a Post

- Use the Command Palette: "Open post composer"
- Click the ribbon icon (send icon)

### 3. Editing a Post

- Edit text freely
- Attach images (up to 4)
- Insert emoji
- Add hashtags

### 4. Sending a Post

- Press your configured hotkey (e.g., `Mod+Enter`)
- Or click the Post button at the bottom-right of the modal

## Technical Specs

### Environment

- **Obsidian**: 0.15.0+
- **Platforms**: Desktop (Windows, macOS, Linux)
- **Language**: TypeScript

### Key Technologies

- **Obsidian Plugin API**: Core plugin integration
- **Bluesky API**: Auth & post submission
- **TypeScript**: Type safety & dev productivity
- **ESBuild**: Fast bundling

### Architecture

- **Modular**: Functional separation by file
- **Type Safe**: Interfaces & types
- **Error Handling**: User feedback & graceful failures

## Settings

### Basic

- **Handle**: Your Bluesky handle (e.g. `@username.bsky.social`)
- **App Password**: Bluesky app password (app-specific)
- **Default Hashtags**: Automatically appended hashtags
- **Network Timeout**: Request timeout (ms)

### Hotkeys

- **Cancel**: Cancel post (default: None)
- **Post**: Submit post (default: None)
- **Add Image**: Add image (default: None)
- **Emoji**: Open emoji picker (default: None)

#### Mod Key Behavior

- macOS → `⌘`
- Windows/Linux → `Ctrl`
- Automatically resolved per platform

### Security & Privacy

- Stored locally: handle, app password, default hashtags, network timeout (in plugin `data.json`).
- App password is saved in plaintext inside your vault; protect vault access (no extra encryption).
- Images are only read and uploaded at send time; not cached after posting.
- Data sent only to Bluesky / AT Protocol endpoints (e.g. `bsky.social`) over HTTPS (TLS).
- In transit: encrypted via HTTPS. At rest: relies on your OS / disk encryption only.
- Credentials location: `.obsidian/plugins/Post-To-Bluesky/data.json`; deleting that file removes them.
- Network timeout: default 15000 ms (configurable). No automatic retry on rate limit errors.
- On rate limit or failure you get a notification; resend manually after waiting.
- Revoke the app password in Bluesky settings immediately if you suspect compromise.

## Troubleshooting

### Common Issues

1. **Login Fails**: Verify app password
   - **Note**: You need a Bluesky account and an app password. Generate the app password from your Bluesky settings page.

2. **Post Fails**: Check network & Bluesky status

3. **Hotkeys Don't Work**: Verify your hotkeys are configured correctly in settings

### Logs

- Use Obsidian developer console for errors
- Check Network tab for API requests
  - Open dev tools: `Ctrl+Shift+I` / `Cmd+Option+I`
  - Network panel: `Ctrl+Shift+E` / `Cmd+Option+E` (or select Network tab)

## Developer Info

### Project Structure

```text
Post-To-Bluesky/
├── main.ts           # Main plugin class
├── styles.css        # Styles
├── manifest.json     # Plugin manifest
└── package.json      # Dependencies
```

### Build & Test

```bash
npm run dev
npm run build
npm run lint
```

## License

Released under the 0BSD license.

## Author

**RieTamura** - [GitHub](https://github.com/RieTamura/Post-To-Bluesky)

## Support

- **Issues**: [GitHub Issues](https://github.com/RieTamura/Post-To-Bluesky/issues)
- **Sponsor**: [GitHub Sponsors](https://github.com/sponsors/RieTamura)

## Changelog

### v1.0.0

- Initial release
- Core posting functionality
- Image attachments
- Emoji picker
- Customizable hotkey configuration

---


