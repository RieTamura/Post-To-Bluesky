# Post To Bluesky

## Language / 言語

[🇯🇵 日本語 README](./README_JA.md) | [🇺🇸 English README](./README_EN.md)

---

**Version / バージョン**: 0.3.0

**Features (EN)**:

- Post to Bluesky from Obsidian
- Post from draft notes in your vault
- Automatic post history notes
- Link posts to a note of your choice (date variables supported)
- Desktop and mobile
- Attach up to 4 images (desktop only)
- Emoji picker
- Default hashtags

**機能概要 (JP)**:

- ObsidianからBlueskyへ投稿
- vault内の下書きノートから投稿
- 投稿履歴ノートの自動作成
- 任意のノートへの紐づけ（日付変数に対応）
- デスクトップ・モバイル両対応
- 画像最大4枚添付（デスクトップのみ）
- 絵文字ピッカー
- デフォルトハッシュタグ設定

---

ObsidianからBlueskyへ投稿できるプラグインです。
下書きノート・投稿履歴・Images・Emoji対応

Post to Bluesky from notes, with post history, images & emoji.

詳しい使い方・設定手順は各言語のREADMEをご覧ください。

---

## Installation / インストール

**From Community plugins (EN):**

1. Open **Settings → Community plugins** in Obsidian.
2. Select **Browse** and search for "Post To Bluesky".
3. Select **Install**, then **Enable**.

**Manual install (EN):** Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/RieTamura/Post-To-Bluesky/releases) and place them in `<your-vault>/.obsidian/plugins/post-to-bluesky/`, then enable the plugin in **Settings → Community plugins**.

**コミュニティプラグインから (JP):**

1. Obsidianの **設定 → コミュニティプラグイン** を開きます。
2. **閲覧** から「Post To Bluesky」を検索します。
3. **インストール** し、**有効化** します。

**手動インストール (JP):** [最新リリース](https://github.com/RieTamura/Post-To-Bluesky/releases) から `main.js`・`manifest.json`・`styles.css` をダウンロードし、`<vault>/.obsidian/plugins/post-to-bluesky/` に配置して、コミュニティプラグイン設定で有効化してください。

## Usage / 使い方

**EN:**

1. Open **Settings → Post To Bluesky** and enter your Bluesky handle and an [app password](https://bsky.app/settings/app-passwords).
2. Open the command palette and run **Open post composer**.
3. Write your post, optionally attach up to 4 images or emoji, and select **Post**.

To post from a note, add `type: bluesky-draft` to its frontmatter and run **Post from draft notes**.

**JP:**

1. **設定 → Post To Bluesky** で Bluesky のハンドルと[アプリパスワード](https://bsky.app/settings/app-passwords)を入力します。
2. コマンドパレットから **Open post composer** を実行して投稿モーダルを開きます。
3. 本文を入力し、必要に応じて画像(最大4枚)や絵文字を追加して **投稿** を押します。

ノートから投稿する場合は、frontmatter に `type: bluesky-draft` を書いて **Post from draft notes** を実行します。

詳細な設定項目は [日本語 README](./README_JA.md) / [English README](./README_EN.md) を参照してください。

---

| Link | 説明 / Description |
|------|--------------------|
| [日本語 README](./README_JA.md) | 日本語の完全なドキュメント |
| [English README](./README_EN.md) | Full documentation in English |
| [Issues](https://github.com/RieTamura/Post-To-Bluesky/issues) | Bug / Feature requests |
| [Releases](https://github.com/RieTamura/Post-To-Bluesky/releases) | 最新リリース / Latest releases |
| [Sponsor](https://github.com/sponsors/RieTamura) | Support the author |

---

## Roadmap / ロードマップ

- ~~Mobile support / モバイル版対応~~ (v0.2.0)
- ~~Obsidian Bases integration (save posts and hashtags) / Obsidian Bases対応（投稿文やハッシュタグを記録）~~ (v0.2.0)
- Base file generation for drafts and post history / 下書き・投稿履歴用のBaseファイル自動生成
- Thread support / スレッド対応

---

© 2025 RieTamura – [0BSD License](./LICENSE)

