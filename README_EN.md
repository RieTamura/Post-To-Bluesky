# Post To Bluesky - Obsidian Plugin

Language: **English** | [日本語](./README_JA.md)

This plugin lets you post from Obsidian to Bluesky. Open the post modal to compose freely and send your content to Bluesky.

## Main Features

### 📝 Posting

- **Create Post**: Open the post modal to compose freely and send to Bluesky

### ✍️ Write in Markdown (off by default)

- `[display text](URL)` is posted as **a real link** (long URLs no longer eat into the 300 characters)
- Markers for bold, italic, headings, bullet lists, code and quotes are **stripped**
- `[[note name|display name]]` keeps only the display name
- Bluesky posts are plain text, so **bold and italic themselves cannot be represented** (see below)

### 📄 Post from Draft Notes

- Use any note in your vault as a draft
- Notes with `type: bluesky-draft` in their frontmatter appear in the draft list
- The list shows a character count badge (red when over 300)
- Posting updates the draft note itself to a posted state (see below)

### 💾 Keep Unsent Content as a Draft Note

- Closing the composer without posting asks whether to keep the content in a draft note (on by default)
- Three choices: "Save draft", "Discard", "Keep editing". Esc and clicking outside count as "Keep editing"
- When the composer was opened from a draft note, **that note is updated** instead of creating a new one
- Attached images are kept as well

### 📋 Automatic Post History Notes

- Creates a note with the text, timestamp, post URL and tags after a successful post (off by default)
- Hashtags in the text are moved to the `tags` frontmatter property
- The destination folder is picked through an input with folder suggestions

### 🔗 Linking Notes Together

- Automatically adds a link to a note of your choice into the frontmatter of draft and history notes
- Draft notes and history notes can point at different targets, picked through an input with note suggestions
- Date variables such as `{{date:YYYY-MM-DD}}` are supported, so posts can link to that day's daily note

### 📱 Mobile Support

- Works in the Obsidian mobile app on iOS and Android
- Every feature is available on mobile, image attachment included

### 🖼️ Image Attachment

- Attach up to 4 images (desktop and mobile alike)
- Two sources: pick **from the vault**, or **from the device** file/photo picker
- Attached images are recorded in draft and history notes as `![[...]]`
- Images embedded in a draft note are attached automatically when you post from it
- Automatic aspect ratio handling, plus automatic compression to fit Bluesky's size limit

### 😊 Emoji Picker

- Categorized emoji groups
- Categories: emotions, hands, hearts, nature, food, activity, etc.
- Quick access via hotkey

### ⚙️ Customizable Settings

- Bluesky account (handle + app password)
- Default hashtags
- Whether Markdown is converted before posting
- Network timeout
- Custom hotkeys
- Draft detection rule (frontmatter key and value)
- Whether closing the composer asks to save a draft, and the folder those drafts go to
- Post history saving and its destination folder
- Link target notes and the property name the link is written to
- Whether images picked from the device are saved into the vault

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

### 2-0. Attaching Images

The image button in the post modal (or the "Add image" command) opens a menu that asks
where the image comes from.

- **Choose from vault**: search the vault's images, newest first. They already live in the
  vault, so they are recorded in the note as-is
- **Choose from device**: use the OS file/photo picker. When "Save device images to the
  vault" is on, the image is imported into the vault after posting and embedded in the note

Up to 4 images per post. Attaching an image hides the link card preview — Bluesky cannot
carry images and a link card in the same post.

After a successful post the attached images are appended to the draft or history note as
`![[path/to/image]]`.

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

   Images embedded in the note (`![[photo.png]]`) are **carried over as attachments and
   removed from the body text**. Posting the embed syntax verbatim would spend characters
   without attaching anything. The draft list shows how many images will be carried over.
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

   Images you **add in the post modal** are appended to the draft note as `![[...]]`.
   Images that were already embedded in the note are not appended again.

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

### 2-3. Linking Notes to Another Note

Set a link target in settings and a link to that note is added automatically to the
frontmatter of draft and history notes. Posts then gather in the target note's backlinks,
so you can browse a day's posts from a daily note or an MOC.

```yaml
---
posted_at: 2026-07-27T17:50:42
url: https://bsky.app/profile/xxx.bsky.social/post/3kabc...
related: "[[01_data/2026/07/2026-07-27]]"   # added automatically
---
```

- Draft notes and history notes have **separate targets**. Leave one empty to disable it
- The property name is configurable (default: `related`)
- The target note itself is never modified — the link is only written to the posting note
- If the property already holds a value it is **not overwritten**; the new link is appended
  alongside the existing values. A link that is already there is left alone, so re-posting
  never creates duplicates

#### Using Date Variables

Link targets accept date variables, using the same syntax as the Daily notes and Templates
core plugins.

```
01_data/{{date:YYYY/MM/YYYY-MM-DD}}   →   related: "[[01_data/2026/07/2026-07-27]]"
```

| Variable | Expands to |
|----------|------------|
| `{{date}}` | `2026-07-27` (default format `YYYY-MM-DD`) |
| `{{date:YYYY/MM}}` | `2026/07` |
| `{{time:HHmm}}` | `1750` (default format is `HH:mm`; prefer `HHmm` inside a path) |

- A single setting can contain several variables
- Variables expand against the **posting time** (the same instant as `posted_at`)
- Escape syntax such as `{{date:gggg-[W]ww}}` works as well

#### When the Target Note Does Not Exist

Behaviour depends on how the target is written.

- **With variables**: the link is written even if the note does not exist yet, as an
  unresolved link. Creating that daily note later connects it automatically
- **Fixed path**: no link is added and a notice is shown instead, so a renamed target or a
  typo in the path does not go unnoticed

Either way the post itself is still treated as successful.

### 2-4. Writing a Post in Markdown

Turning on "Convert Markdown before posting" converts the Markdown you type into plain text
before it is sent to Bluesky (off by default).

**Know this first: Bluesky posts are plain text.** A post record carries text plus facets, and
the only facet types are link, mention and tag — there is no facet for decoration, so
**bold and italic themselves cannot be posted**. All this plugin can do is turn link syntax into
a real link and strip the markers it cannot represent.

| What you type | What gets posted |
|---|---|
| `[here](https://example.com/very-long-url)` | **here** (a clickable link) |
| `**bold**` / `*italic*` / `~~strike~~` / `==highlight==` | bold / italic / strike / highlight (markers removed) |
| `## Heading` | Heading |
| `- bullet` | ・bullet |
| `1. numbered` | 1. numbered (left as is) |
| `` `code` `` / ```` ```code block``` ```` | code / code block (fences removed) |
| `> quote` | quote |
| `[[note name]]` / `[[note name\|display name]]` | note name / display name |
| `<https://example.com>` | https://example.com |
| `\*kept as symbols\*` | \*kept as symbols\* (backslash escape) |

#### How Markdown Actually Looks on Bluesky

The conversion applies to every syntax listed above, but **only two of them leave a visible result
on Bluesky: links and bullets.**

| Result | Syntax |
|---|---|
| **Visible on Bluesky** | `[display text](URL)` (becomes a blue link), `- bullet` (`・` remains), `1. numbered` (left as is) |
| **Markers simply disappear** | `**bold**` / `*italic*` / `## Heading` / `> quote` / `~~strike~~` / `==highlight==` / `` `code` `` / code blocks |

Bold and headings turning into plain text is **the intended result, not a failed conversion**.
A Bluesky post record carries only plain text plus facets (link, mention, tag), and no facet for
decoration exists in the spec, so no client can render one.

The value of this setting is therefore not "adding decoration" but **being able to use a note written
the normal Obsidian way as a draft without leaving marker litter in the post**. While off, `**bold**`
is posted with its markers and eats four extra characters of the 300 limit.

Notes:

- **The character counter counts the converted text**, so it reads shorter than what you typed
- With `[display text](URL)`, the link card (URL preview) is built from that URL
- **`snake_case` and `2*3*4` are left alone.** Markers inside a word are not treated as syntax,
  so symbols never disappear unintentionally
- History and draft notes keep **the Markdown as you typed it**, not the converted plain text
- While off, `**` and `#` are posted as typed and count towards the character limit

### 2-5. Keeping Unsent Content as a Draft

Closing the composer with unsent content asks whether to keep it in a draft note (on by default).

- **Save draft**: creates a new note in the "Draft note folder". It gets the draft frontmatter
  property, so it shows up in the draft list right away
- **Discard**: does nothing
- **Keep editing**: reopens the composer with the text and attached images.
  **Esc and clicking outside behave the same way**, so unsent content is never dropped silently

When the composer was opened from a draft note this becomes "Update draft" and **rewrites that
note**. The frontmatter is left untouched. Attached images are re-embedded at the end of the note
(the composer takes embeds out of the body and handles them as attachments, so their original
positions cannot be restored).

You are not asked when:

- the text is empty and no image is attached
- nothing changed since the composer was opened (for example opening a draft note and closing it)
- "Ask to save a draft when closing" is off

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
- **Convert Markdown before posting**: Post `[display text](URL)` as a link and strip the markers of
  bold, headings, bullet lists and so on (default: **off**)
  - It is off by default because Bluesky has no bold, so some people type `*` meaning the symbol
    itself. Updating the plugin should not silently change what gets posted
  - See [Usage 2-4](#2-4-writing-a-post-in-markdown) for exactly what is converted
- **Network Timeout**: Request timeout (ms)

### Drafts

- **Draft property name**: Frontmatter key used to identify draft notes (default: `type`)
- **Draft property value**: Value for the key above. Notes with this value appear in the draft list (default: `bluesky-draft`)
- **Ask to save a draft when closing**: Ask whether to keep unsent content in a draft note when the
  composer is closed (default: on)
- **Draft note folder**: Folder those draft notes are created in (default: `Bluesky Drafts`)
  - An input with vault folder suggestions. A folder name that does not exist yet is created when saving
  - Greyed out while "Ask to save a draft when closing" is off

### Post History

- **Save post history**: Create a history note after a successful post (default: off)
- **History note folder**: Folder to create history notes in (default: `Bluesky Posts`)
  - An input with vault folder suggestions. A folder name that does not exist yet is created when posting
  - Greyed out while "Save post history" is off

### Note Linking

- **Link property name**: Frontmatter key the link to the target note is written to (default: `related`)
- **Draft note link target**: Note to link a draft to when it is posted (default: empty — no link)
- **History note link target**: Note to link newly created history notes to (default: empty — no link)
  - Greyed out while "Save post history" is off

Both targets are inputs with vault note suggestions, and accept date variables such as
`{{date:YYYY-MM-DD}}` (see [Usage 2-3](#2-3-linking-notes-to-another-note)).

### Images

- **Save device images to the vault**: Import images attached from the device into the
  vault and embed them in draft and history notes (default: on)
  - The location follows Obsidian's own **"Default location for new attachments"**
    setting. The plugin does not add a folder setting of its own
  - When off, posting still works but no image is kept in the note
  - **Images chosen from the vault are recorded regardless of this setting** — they are
    already in the vault, so nothing new is written

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

5. **An image does not appear in the note**: Check "Save device images to the vault" in
   settings. When it is off, images picked from the device are posted but not kept in the
   vault, so there is nothing for the note to embed. Images picked from the vault are
   always recorded

6. **`**` or `#` shows up in the posted text**: "Convert Markdown before posting" is off
   (that is the default). Turn it on in settings

7. **Closing the composer does not ask to save a draft**: nothing is asked when the text has not
   changed since the composer was opened, or when "Ask to save a draft when closing" is off

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
- Video attachment is not supported
- Animated GIFs are posted as a still first frame (they are re-encoded before upload)
- SVG cannot be attached — it is not decodable as an image, so it never appears in the picker
- Images cannot be added by drag & drop or paste; use the button or the command
- 300 characters per post (an error is shown before sending if exceeded)
- No automatic retry on rate limit errors — you get a notice and resend after waiting
- **Bluesky posts have no bold, italic or headings.** A post record can only carry plain text plus
  facets (link, mention, tag) — the format simply has no facet for decoration. Markdown conversion
  can therefore only turn link syntax into links and strip what cannot be represented
- Embeds other than images, such as `![[another note]]`, are posted as literal syntax while
  Markdown conversion is off (with it on, only the display name is kept)

## Changelog

### v0.5.0

- **Added a setting to convert Markdown before posting** (default: off).
  `[display text](URL)` is posted as a real link, and the markers of bold, headings, bullet lists,
  code, quotes and `[[wikilinks]]` are stripped
  - The character counter now counts the converted text (so does the badge in the draft list)
  - With `[display text](URL)`, the link card is built from that URL
  - History and draft notes keep the Markdown as you typed it
- **Closing the composer without posting now asks whether to keep the content as a draft note**
  (default: on). Three choices — "Save draft", "Discard", "Keep editing" — with Esc and clicking
  outside counting as "Keep editing"
- When the composer was opened from a draft note, that note is updated instead of creating a new one
- Attached images are kept too (images picked from the device are imported into the vault)
- Three new settings (Convert Markdown before posting, Ask to save a draft when closing,
  Draft note folder)

### v0.4.0

- **Image attachment now works on mobile** (it was desktop-only before)
- **Attached images are now recorded in draft and history notes.** Previously they were
  posted to Bluesky but nothing was left in the note
- Added **choosing images from the vault** as an attachment source. The image button now
  opens a menu with "Choose from vault" and "Choose from device"
- **Images embedded in a draft note (`![[photo.png]]`) are now attached to the post.**
  Previously the embed syntax was posted verbatim as text, spending characters without
  attaching the image (bug fix)
- Added a setting to import device images into the vault (default: on). The location
  follows Obsidian's own attachment folder setting
- The draft list now shows how many images a draft will carry over
- Images over Bluesky's blob size limit (~1 MB) are compressed automatically, so a large
  PNG from the vault no longer fails to upload

### v0.3.0

- Added note linking. A link to a note of your choice is added automatically to the
  frontmatter of draft and history notes
- Draft notes and history notes have separate targets, picked through an input with vault
  note suggestions
- Link targets accept `{{date:YYYY-MM-DD}}` / `{{time:HHmm}}` date variables, so posts can
  link to that day's daily note
- A target written with variables is linked even when the note does not exist yet (creating
  it later connects the link). A fixed path that does not exist adds no link and shows a
  notice instead
- Added 3 settings (link property name, draft note link target, history note link target)

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


