# Post To Bluesky - Obsidian Plugin

Language: **English** | [日本語](./README_JA.md)

This plugin lets you post from Obsidian to Bluesky. Open the post modal to compose freely and send your content to Bluesky.

## Main Features

### 📝 Posting

- **Create Post**: Open the post modal to compose freely and send to Bluesky

### 📄 Post from Draft Notes

- Use any note in your vault as a draft
- Notes with `type: bluesky-draft` in their frontmatter appear in the draft list
- The list shows a character count badge (red when over 300)
- Posting updates the draft note itself to a posted state (see below)

### 📋 Automatic Post History Notes

- Creates a note with the text, timestamp, post URL and tags after a successful post (off by default)
- Hashtags in the text are moved to the `tags` frontmatter property
- The destination folder is picked through an input with folder suggestions

### 📱 Mobile Support

- Works in the Obsidian mobile app on iOS and Android
- Only the image attachment UI is hidden on mobile; every text posting feature works

### 🖼️ Image Attachment

- Attach up to 4 images (desktop only)
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
- Draft detection rule (frontmatter key and value)
- Post history saving and its destination folder

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

### 2-1. Posting from a Draft Note

1. Add the draft property to any note's frontmatter:

   ```yaml
   ---
   type: bluesky-draft
   ---
   Write your post here.
   ```

   An array value works too (e.g. `type: [bluesky-draft, note]`).
   Both the key and the value are configurable in settings.

2. Run "Post from draft notes" from the Command Palette, or click the
   ribbon icon (document icon).
3. Pick a note from the draft list. Its body (frontmatter stripped) is loaded into
   the post modal. If it exceeds 300 characters you get a warning — edit it in the
   modal before posting.
4. After a successful post, the draft note's frontmatter is updated:

   ```yaml
   ---
   type:                      # bluesky-draft is removed
     - note                   # other values are kept
   bluesky_posted: true       # rendered as a checkbox
   posted_at: 2026-07-26T17:30:00
   url: https://bsky.app/profile/xxx.bsky.social/post/3kabc...
   ---
   ```

   Notes with `bluesky_posted` checked disappear from the draft list. If the draft
   value was the only value, the key is removed entirely.

   Note that posting from a draft does **not** create a separate history note — the
   draft note itself becomes the record, so a single post never produces two notes.

### 2-2. Automatic Post History Notes

Turn on "Save post history" in settings and every post made directly from the post
modal creates one note in the destination folder.

```yaml
---
type: bluesky-posted
bluesky_posted: true
posted_at: 2026-07-26T17:30:00
url: https://bsky.app/profile/xxx.bsky.social/post/3kabc...
tags:
  - Obsidian
---
The posted text is kept here.
```

- The file name is generated from the timestamp (e.g. `2026-07-26 1730.md`)
- Hashtags are moved to `tags` and stripped from the body, so the note body is not a
  byte-for-byte copy of what was posted. Follow `url` for the original
- The destination folder is created automatically if it does not exist
- If saving the history fails, the post is still treated as successful and only a
  notice is shown

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

- **Obsidian**: 1.8.7+
- **Platforms**: Desktop (Windows, macOS, Linux) and mobile (iOS, Android)
  - Image attachment is unavailable on mobile
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
  - Not inserted when composing from a draft note, to avoid eating into the 300-character limit
- **Network Timeout**: Request timeout (ms)

### Drafts

- **Draft property name**: Frontmatter key used to identify draft notes (default: `type`)
- **Draft property value**: Value for the key above. Notes with this value appear in the draft list (default: `bluesky-draft`)

### Post History

- **Save post history**: Create a history note after a successful post (default: off)
- **History note folder**: Folder to create history notes in (default: `Bluesky Posts`)
  - An input with vault folder suggestions. A folder name that does not exist yet is created when posting
  - Greyed out while "Save post history" is off

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

4. **A note is missing from the draft list**: Check these two things
   - The frontmatter key and value match your settings (`type: bluesky-draft` by default)
   - `bluesky_posted` is not checked. Posted notes are excluded from the list. To treat
     one as a draft again, uncheck `bluesky_posted` and add `bluesky-draft` back to `type`

5. **Cannot attach images on mobile**: This is by design — the image UI is hidden on mobile

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

## Known Limitations

- Up to 4 images per post (Bluesky limit)
- Image attachment is unavailable on mobile
- 300 characters per post (an error is shown before sending if exceeded)
- No automatic retry on rate limit errors — you get a notice and resend after waiting

## Changelog

### v0.2.0

- Mobile support (`isDesktopOnly: false`). Only the image attachment UI is hidden on mobile
- Added posting from draft notes ("Post from draft notes" command and ribbon icon)
- Added automatic post history notes (off by default). Hashtags are moved to `tags`
- Posting from a draft adds `bluesky_posted`, `posted_at` and `url` to that note and
  removes the draft value
- Added four settings (draft property name, draft property value, save post history,
  history note folder)
- Fixed: link previews were not refreshed while typing
- Fixed: posts containing a link with a thumbnail failed to send
- Fixed: re-login on expired auth, rate limit retry and detailed API error messages
  were never reached
- Fixed: an incomplete URL typed into the body stopped the composer from picking up
  any further input

### v0.1.6 (2026-07-25)

- Addressed Obsidian community plugin review feedback (timer handling, declarative settings API)
- Added a release workflow

### v0.1.5 (2026-03-09)

- Hotkeys can be assigned to each action in the post modal

### v0.1.2 – v0.1.4 (2026-03-09)

- Fixed hotkey commands not appearing in Obsidian's hotkey settings
- Prevented double submission while posting and multiple modal instances

### v0.1.1 (2026-02-11)

- Addressed Obsidian community plugin review feedback
- Refactored localization handling (dropped the external locale files)

### v0.1.0 (2025-10-15)

- Initial release
- Core posting functionality
- Image attachments
- Emoji picker
- Customizable hotkey configuration

---


