# ObsidianReview



Thank you for your submission, an automated scan of your plugin code's revealed the following issues:

## Action Plan (2025-11-17)

### Priority 0 – Must fix before submission

- API usage: replace every `fetch` call with `requestUrl`. Respect configurable timeouts. Avoid hard-coded `.obsidian` paths by using `Vault#configDir`.
- UX compliance: rename the post command (ID + label) and drop the default hotkey. Enforce sentence case strings. Use the Obsidian `Setting` API for headings.
- DOM safety: stop using `innerHTML`/`style.display`. Prefer CSS classes and semantic DOM construction. Await or intentionally `void` all Promises.

### Priority 1 – Quality & lint parity

- Type safety: remove `any` usages.
	Tighten `uploadBlob`/facet typings.
	Replace deprecated `navigator.platform` checks with `Platform` helpers.
- Locale helpers: fix the `locale ?? getCurrentLocale()` stringification path.
	Tidy the optional hotkey detector utilities.
- UI polish: keep link regexes lean.
	Ensure blob thumbnails stay typed without redundant assertions.

### Priority 2 – Optional cleanups

- Remove or properly type unused symbols (`LocaleStrings`, `parsed`, `MarkdownView`).
- Revisit doc copies if needed once the code settles.

# Required

## 'locale ?? getCurrentLocale() ?? ''' may use Object's default stringification format ('[object Object]') when stringified.
[1](https://github.com/RieTamura/Post-To-Bluesky/blob/4a950a5bd051cb7672f0c99aa31b6d8b6122c814/hotkeyConflictDetector.ts#L292-L292)

## Unexpected any. Specify a different type.
[1](https://github.com/RieTamura/Post-To-Bluesky/blob/4a950a5bd051cb7672f0c99aa31b6d8b6122c814/main.ts#L290-L290)
[2](https://github.com/RieTamura/Post-To-Bluesky/blob/4a950a5bd051cb7672f0c99aa31b6d8b6122c814/main.ts#L291-L291)
[3](https://github.com/RieTamura/Post-To-Bluesky/blob/4a950a5bd051cb7672f0c99aa31b6d8b6122c814/main.ts#L332-L332)
[4](https://github.com/RieTamura/Post-To-Bluesky/blob/4a950a5bd051cb7672f0c99aa31b6d8b6122c814/main.ts#L378-L378)
[5](https://github.com/RieTamura/Post-To-Bluesky/blob/4a950a5bd051cb7672f0c99aa31b6d8b6122c814/main.ts#L384-L384)
[6](https://github.com/RieTamura/Post-To-Bluesky/blob/4a950a5bd051cb7672f0c99aa31b6d8b6122c814/main.ts#L386-L386)
[7](https://github.com/RieTamura/Post-To-Bluesky/blob/4a950a5bd051cb7672f0c99aa31b6d8b6122c814/main.ts#L458-L458)
[8](https://github.com/RieTamura/Post-To-Bluesky/blob/4a950a5bd051cb7672f0c99aa31b6d8b6122c814/main.ts#L465-L465)
[9](https://github.com/RieTamura/Post-To-Bluesky/blob/4a950a5bd051cb7672f0c99aa31b6d8b6122c814/main.ts#L489-L489)
[10](https://github.com/RieTamura/Post-To-Bluesky/blob/4a950a5bd051cb7672f0c99aa31b6d8b6122c814/main.ts#L519-L519)
[11](https://github.com/RieTamura/Post-To-Bluesky/blob/4a950a5bd051cb7672f0c99aa31b6d8b6122c814/main.ts#L539-L539)
[12](https://github.com/RieTamura/Post-To-Bluesky/blob/4a950a5bd051cb7672f0c99aa31b6d8b6122c814/main.ts#L573-L573)
[13](https://github.com/RieTamura/Post-To-Bluesky/blob/4a950a5bd051cb7672f0c99aa31b6d8b6122c814/main.ts#L816-L816)
[14](https://github.com/RieTamura/Post-To-Bluesky/blob/4a950a5bd051cb7672f0c99aa31b6d8b6122c814/main.ts#L827-L827)

## The command ID should not include the plugin ID. Obsidian will make sure that there are no conflicts with other plugins.
[1](https://github.com/RieTamura/Post-To-Bluesky/blob/4a950a5bd051cb7672f0c99aa31b6d8b6122c814/main.ts#L313-L313)

## The command name should not include the plugin name, the plugin name is already shown next to the command name in the UI.
[1](https://github.com/RieTamura/Post-To-Bluesky/blob/4a950a5bd051cb7672f0c99aa31b6d8b6122c814/main.ts#L314-L314)

## Use sentence case for UI text.
[1](https://github.com/RieTamura/Post-To-Bluesky/blob/4a950a5bd051cb7672f0c99aa31b6d8b6122c814/main.ts#L314-L314)
[2](https://github.com/RieTamura/Post-To-Bluesky/blob/4a950a5bd051cb7672f0c99aa31b6d8b6122c814/main.ts#L322-L322)
[3](https://github.com/RieTamura/Post-To-Bluesky/blob/4a950a5bd051cb7672f0c99aa31b6d8b6122c814/main.ts#L1237-L1237)
[4](https://github.com/RieTamura/Post-To-Bluesky/blob/4a950a5bd051cb7672f0c99aa31b6d8b6122c814/main.ts#L1249-L1249)
[5](https://github.com/RieTamura/Post-To-Bluesky/blob/4a950a5bd051cb7672f0c99aa31b6d8b6122c814/main.ts#L1261-L1261)

## Don't provide a default hotkey, as they might conflict with other hotkeys the user has already set, or that are included with Obsidian by default.
[1](https://github.com/RieTamura/Post-To-Bluesky/blob/4a950a5bd051cb7672f0c99aa31b6d8b6122c814/main.ts#L316-L318)

## Obsidian's configuration folder is not necessarily .obsidian, it can be configured by the user. Use Vault#configDir to get the current value
[1](https://github.com/RieTamura/Post-To-Bluesky/blob/4a950a5bd051cb7672f0c99aa31b6d8b6122c814/main.ts#L372-L372)
[2](https://github.com/RieTamura/Post-To-Bluesky/blob/4a950a5bd051cb7672f0c99aa31b6d8b6122c814/main.ts#L373-L373)
[3](https://github.com/RieTamura/Post-To-Bluesky/blob/4a950a5bd051cb7672f0c99aa31b6d8b6122c814/main.ts#L374-L374)

## Empty block statement.
[1](https://github.com/RieTamura/Post-To-Bluesky/blob/4a950a5bd051cb7672f0c99aa31b6d8b6122c814/main.ts#L405-L405)
[2](https://github.com/RieTamura/Post-To-Bluesky/blob/4a950a5bd051cb7672f0c99aa31b6d8b6122c814/main.ts#L1132-L1132)

## Unexpected use of 'fetch'. Use the built-in requestUrl function instead of fetch for network requests in Obsidian.
[1](https://github.com/RieTamura/Post-To-Bluesky/blob/4a950a5bd051cb7672f0c99aa31b6d8b6122c814/main.ts#L430-L430)
[2](https://github.com/RieTamura/Post-To-Bluesky/blob/4a950a5bd051cb7672f0c99aa31b6d8b6122c814/main.ts#L444-L444)
[3](https://github.com/RieTamura/Post-To-Bluesky/blob/4a950a5bd051cb7672f0c99aa31b6d8b6122c814/main.ts#L496-L496)
[4](https://github.com/RieTamura/Post-To-Bluesky/blob/4a950a5bd051cb7672f0c99aa31b6d8b6122c814/main.ts#L550-L550)

## Unnecessary escape character:[.
[1](https://github.com/RieTamura/Post-To-Bluesky/blob/4a950a5bd051cb7672f0c99aa31b6d8b6122c814/main.ts#L467-L467)
[2](https://github.com/RieTamura/Post-To-Bluesky/blob/4a950a5bd051cb7672f0c99aa31b6d8b6122c814/main.ts#L977-L977)

## Unnecessary escape character: }.
[1](https://github.com/RieTamura/Post-To-Bluesky/blob/4a950a5bd051cb7672f0c99aa31b6d8b6122c814/main.ts#L471-L471)
[2](https://github.com/RieTamura/Post-To-Bluesky/blob/4a950a5bd051cb7672f0c99aa31b6d8b6122c814/main.ts#L978-L978)

## Avoid setting styles directly via element.style.display. Use CSS classes for better theming and maintainability. Use the setCssProps function to change CSS properties.
[1](https://github.com/RieTamura/Post-To-Bluesky/blob/4a950a5bd051cb7672f0c99aa31b6d8b6122c814/main.ts#L646-L646)
[2](https://github.com/RieTamura/Post-To-Bluesky/blob/4a950a5bd051cb7672f0c99aa31b6d8b6122c814/main.ts#L772-L772)
[3](https://github.com/RieTamura/Post-To-Bluesky/blob/4a950a5bd051cb7672f0c99aa31b6d8b6122c814/main.ts#L789-L789)
[4](https://github.com/RieTamura/Post-To-Bluesky/blob/4a950a5bd051cb7672f0c99aa31b6d8b6122c814/main.ts#L1419-L1419)
[5](https://github.com/RieTamura/Post-To-Bluesky/blob/4a950a5bd051cb7672f0c99aa31b6d8b6122c814/main.ts#L1421-L1421)

## Do not write to DOM directly using innerHTML/outerHTML property
[1](https://github.com/RieTamura/Post-To-Bluesky/blob/4a950a5bd051cb7672f0c99aa31b6d8b6122c814/main.ts#L754-L762)
[2](https://github.com/RieTamura/Post-To-Bluesky/blob/4a950a5bd051cb7672f0c99aa31b6d8b6122c814/main.ts#L1417-L1417)

## Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the void operator.
[1](https://github.com/RieTamura/Post-To-Bluesky/blob/4a950a5bd051cb7672f0c99aa31b6d8b6122c814/main.ts#L840-L840)
[2](https://github.com/RieTamura/Post-To-Bluesky/blob/4a950a5bd051cb7672f0c99aa31b6d8b6122c814/main.ts#L956-L956)

## Avoid using the navigator API to detect the operating system. Use the Platform API instead.
[1](https://github.com/RieTamura/Post-To-Bluesky/blob/4a950a5bd051cb7672f0c99aa31b6d8b6122c814/main.ts#L866-L866)

## platform is deprecated. MDN Reference
[MDN Reference](https://developer.mozilla.org/ja/docs/Web/API/Navigator/platform)
[1](https://github.com/RieTamura/Post-To-Bluesky/blob/4a950a5bd051cb7672f0c99aa31b6d8b6122c814/main.ts#L866-L866)

## This assertion is unnecessary since it does not change the type of the expression.
[1](https://github.com/RieTamura/Post-To-Bluesky/blob/4a950a5bd051cb7672f0c99aa31b6d8b6122c814/main.ts#L934-L934)
[2](https://github.com/RieTamura/Post-To-Bluesky/blob/4a950a5bd051cb7672f0c99aa31b6d8b6122c814/main.ts#L1129-L1129)

## Promise returned in function argument where a void return was expected.
[1](https://github.com/RieTamura/Post-To-Bluesky/blob/4a950a5bd051cb7672f0c99aa31b6d8b6122c814/main.ts#L972-L972)

## For a consistent UI use new Setting(containerEl).setName(...).setHeading() instead of creating HTML heading elements directly.
[1](https://github.com/RieTamura/Post-To-Bluesky/blob/4a950a5bd051cb7672f0c99aa31b6d8b6122c814/main.ts#L1147-L1147)
[2](https://github.com/RieTamura/Post-To-Bluesky/blob/4a950a5bd051cb7672f0c99aa31b6d8b6122c814/main.ts#L1200-L1200)
[3](https://github.com/RieTamura/Post-To-Bluesky/blob/4a950a5bd051cb7672f0c99aa31b6d8b6122c814/main.ts#L1219-L1219)


## Optional

### 'LocaleStrings' is defined but never used.
[1](https://github.com/RieTamura/Post-To-Bluesky/blob/4a950a5bd051cb7672f0c99aa31b6d8b6122c814/hotkeyConflictDetector.ts#L3-L3)

### 'parsed' is assigned a value but never used.
[1](https://github.com/RieTamura/Post-To-Bluesky/blob/4a950a5bd051cb7672f0c99aa31b6d8b6122c814/hotkeyConflictDetector.ts#L188-L188)

### 'MarkdownView' is defined but never used.
[1](https://github.com/RieTamura/Post-To-Bluesky/blob/4a950a5bd051cb7672f0c99aa31b6d8b6122c814/main.ts#L1-L1)