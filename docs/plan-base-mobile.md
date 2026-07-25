# 実装計画書: BASE連携 下書き投稿機能 + モバイル対応

作成日: 2026-03-10
更新日: 2026-07-25（投稿履歴機能 B / 下書きfrontmatter更新 C を追記）
対象バージョン: v0.1.5 → v0.2.0

---

## 背景・目的

- 現状 `isDesktopOnly: true` のためモバイルで使用不可
- ObsidianのBASE機能（frontmatterベースのデータベースビュー）と連携し、下書きノートをBlueskyに投稿できるワークフローを実現する
- モバイルでも同機能を使用できるようにする

---

## スコープ

| # | 内容 | 種別 |
|---|------|------|
| 1 | `isDesktopOnly: false` に変更 | モバイル対応 |
| 2 | モバイルで画像ボタンを非表示 | モバイル対応 |
| 3 | 設定項目2件追加（下書き検索条件） | 新機能 |
| 4 | 下書き一覧モーダル（新規クラス `DraftSelectModal`） | 新機能 |
| 5 | 「下書き一覧から投稿」コマンド追加 | 新機能 |
| 6 | ロケール文字列追加（日英） | 新機能 |
| 7 | 投稿履歴ノート自動作成（B・設定でオン/オフ） | 新機能 |
| 8 | 下書きから投稿時にfrontmatterを更新（C・下書き機能とセット） | 新機能 |

**スコープ外**
- BASE APIの直接利用（API不安定のため）
- 画像アップロードのモバイル対応

---

## ユーザーワークフロー

```
1. ノートにfrontmatterを追加して下書きを作成
   ---
   type: bluesky-draft
   ---
   今日の投稿内容をここに書く。

2. BASEで type=bluesky-draft のビューを作って管理（任意）

3. コマンドパレット or リボン から「Post from draft notes」を実行

4. 下書き一覧モーダルが開く → ノートを選択

5. PostModalが開き本文がセットされる → 投稿

6. 投稿成功時（履歴設定オンの場合）:
   - 投稿本文・日時・投稿URLを持つ履歴ノートが自動作成される（B）
   - 下書きノートから投稿した場合は、そのノートのfrontmatterが
     posted 状態に更新され、下書き一覧から消える（C）

7. BASEで type=bluesky-posted のビューを作れば投稿履歴を
   テーブル表示できる（任意）
```

---

## ファイル変更一覧

| ファイル | 変更内容 | 変更規模 |
|---------|---------|---------|
| `manifest.json` | `isDesktopOnly: false` | 1行 |
| `main.ts` | 設定・ロケール・コマンド・モーダル追加、モバイル分岐、投稿履歴 | +約200行 |

---

## 詳細設計

### 1. manifest.json

```json
{
  "isDesktopOnly": false
}
```

### 2. 設定インターフェース追加

`BlueskyPluginSettings` に2フィールドを追加する。

```typescript
interface BlueskyPluginSettings {
  handle: string;
  password: string;
  networkTimeoutMs: number;
  defaultHashtags: string;
  draftProperty: string;      // 追加: frontmatterキー (デフォルト: "type")
  draftValue: string;         // 追加: frontmatter値   (デフォルト: "bluesky-draft")
  postHistoryEnabled: boolean; // 追加(B): 投稿履歴ノートを自動作成するか (デフォルト: false)
  postHistoryFolder: string;   // 追加(B): 履歴ノートの保存先フォルダ (デフォルト: "Bluesky Posts")
}

const DEFAULT_SETTINGS: BlueskyPluginSettings = {
  // ...既存
  draftProperty: 'type',
  draftValue: 'bluesky-draft',
  postHistoryEnabled: false,
  postHistoryFolder: 'Bluesky Posts'
};
```

### 3. ロケール文字列追加

`LocaleStrings` 型に以下を追加する。

```typescript
draftSelectTitle: string;    // "下書き一覧" / "Draft notes"
noDraftsFound: string;       // "下書きが見つかりません" / "No drafts found"
draftPropertyLabel: string;  // "下書きプロパティ名"
draftPropertyDesc: string;
draftValueLabel: string;     // "下書き判定値"
draftValueDesc: string;
postHistoryLabel: string;      // "投稿履歴を保存" / "Save post history"
postHistoryDesc: string;       // "投稿成功時に本文・日時・URL入りのノートを自動作成します"
postHistoryFolderLabel: string; // "履歴ノートの保存先" / "History note folder"
postHistoryFolderDesc: string;
postHistorySaveFailed: string; // "投稿履歴の保存に失敗しました"（投稿自体は成功扱い）
```

### 4. DraftSelectModal（新規クラス）

文字数を各ノートの横に表示し、300字超の場合は赤で警告する。

```
┌──────────────────────────────────────────┐
│  下書き一覧                               │
│──────────────────────────────────────────│
│  📄 2026-03-10 朝の気づき        245字    │
│  📄 週次振り返り               🔴 412字   │  ← 300字超は赤表示
│  📄 新機能のアナウンス            89字    │
│──────────────────────────────────────────│
│  ※ type = bluesky-draft のノートを表示    │
└──────────────────────────────────────────┘
```

**処理フロー:**

1. `app.metadataCache.getMarkdownFiles()` で全Markdownファイルを取得
2. `app.metadataCache.getFileCache(file)?.frontmatter` で各ファイルのfrontmatterを確認
3. `draftProperty` / `draftValue` の設定値でフィルタ（配列型のfrontmatterも考慮）
4. 各ファイルの本文（frontmatter除去後）を `countGraphemes()` で計測
5. 一覧をModal上に表示（ファイル名 + 文字数バッジ。300字超は赤色クラス付与）
6. ノート選択時:
   - 本文が300字を超える場合 `new Notice(...)` で警告を表示（モーダルは閉じない）
   - `PostModal` を開き本文をセット（ユーザーが自分で編集して投稿）
7. 該当ノートが0件の場合は `new Notice(...)` で通知してモーダルを閉じる

**300字超の場合のUXフロー:**

```text
ノート選択（412字）
  → Notice: "投稿内容が300字を超えています。編集してください。(412/300)"
  → PostModal が開く（文字カウンターが赤）
  → ユーザーが不要な部分を削除 → 投稿
```

**主要メソッド:**

```typescript
class DraftSelectModal extends Modal {
  getDraftFiles(): TFile[]                           // frontmatterフィルタリング
  stripFrontmatter(content: string): string          // frontmatterブロック除去
  renderDraftItem(file: TFile, content: string): void // 文字数バッジ付きで行を描画
  onOpen(): void
  onClose(): void
}
```

### 5. コマンド追加

```typescript
this.addCommand({
  id: 'open-draft-composer',
  name: 'Post from draft notes',
  callback: () => this.openDraftSelectModal()
});
```

### 6. PostModal モバイル対応

`Platform.isMobile` で画像関連UIを条件分岐する。

```typescript
import { Platform } from 'obsidian';

// PostModal.onOpen() 内
if (!Platform.isMobile) {
  // 画像追加ボタン
  new ButtonComponent(actionsEl)
    .setIcon('image-file')
    ...

  // ファイルinput
  this.fileInput = contentEl.createEl('input', {
    attr: { type: 'file', accept: 'image/*' }
  });
  this.fileInput.multiple = true;
  this.fileInput.onchange = (e) => this.handleFileSelect(e);
}
```

### 7. 設定画面追加

設定は `getSettingDefinitions()`（Obsidian 1.13+ 宣言的設定API）と `display()`（1.13未満フォールバック）の**両方**に追加する（2026-07-25 のレビュー対応で二重管理構成になったため）。

```
[ 下書きプロパティ名 ]  入力欄: "type"
  BASEの下書きノートを識別するfrontmatterのキー名

[ 下書き判定値 ]       入力欄: "bluesky-draft"
  上記キーに対応する値。この値を持つノートが下書き一覧に表示されます

[ 投稿履歴を保存 ]      トグル: オフ（デフォルト）
  投稿成功時に本文・日時・URL入りのノートを自動作成します

[ 履歴ノートの保存先 ]  入力欄: "Bluesky Posts"
  履歴ノートを作成するフォルダ（存在しなければ自動作成）
```

---

### 8. 投稿履歴ノート自動作成（B）

`postHistoryEnabled` がオンのとき、投稿成功後に1投稿=1ノートを自動作成する。
フロントマターを `type: bluesky-posted` で統一することで、下書き（`bluesky-draft`）と
同じ流儀のままBASEで「投稿履歴」ビューを作れる。

**作成されるノートの例**（`Bluesky Posts/2026-07-25 1730.md`）:

```markdown
---
type: bluesky-posted
posted_at: 2026-07-25T17:30:00
url: https://bsky.app/profile/xxx.bsky.social/post/3kabc...
---
投稿した本文がそのまま残る。
```

**前提となる変更:**

- 現在 `postToBluesky()` は createRecord レスポンスの body を捨てて `boolean` を返している。
  レスポンス JSON の `uri`（`at://{did}/app.bsky.feed.post/{rkey}` 形式）を取得し、
  戻り値を `{ success: boolean; postUrl?: string }` 等に変更する
- `at://` URI → 表示用URL変換: rkey を取り出し
  `https://bsky.app/profile/{handle}/post/{rkey}` を組み立てる（handle は設定値）

**処理フロー（投稿成功後）:**

1. `postHistoryEnabled` がオフなら何もしない（従来どおり）
2. `normalizePath()` で保存先フォルダを正規化し、なければ `vault.createFolder()` で作成
3. ファイル名は投稿日時から生成（例: `2026-07-25 1730.md`）。
   同名ファイルが存在する場合は ` (2)` などの連番を付与
4. `vault.create()` で frontmatter + 本文のノートを作成
5. 履歴保存に失敗しても**投稿自体は成功扱い**とし、`postHistorySaveFailed` の Notice のみ表示
   （投稿の成否と履歴の成否を混同させない）

使用APIはすべて Vault コアAPI（モバイル対応済み）。

### 9. 下書きノートのfrontmatter更新（C）

下書き一覧（DraftSelectModal）経由で投稿した場合のみ、投稿成功後に
**元の下書きノート自体**を `FileManager.processFrontMatter()` で更新する。

```yaml
# 更新前                # 更新後
type: bluesky-draft  →  type: bluesky-posted
                        posted_at: 2026-07-25T17:30:00
                        url: https://bsky.app/profile/.../post/...
```

- `draftProperty` の値を `bluesky-posted` に書き換えることで、下書き一覧から自然に消え、
  BASEの「投稿済み」ビューに移動する
- Bで履歴ノートも有効な場合、下書きノートの更新（C）を優先し、
  **履歴ノートの新規作成はスキップ**する（同じ投稿が二重にノート化されるのを防ぐ）
- PostModal から下書きの由来ノート（`TFile`）を保持するフィールドを追加し、
  ポップアップ直接投稿（由来なし）と下書き投稿（由来あり）を区別する

**実装タイミング:** Bは投稿モーダル単体で完結するため先行実装できる。
Cは下書き機能（DraftSelectModal）の実装とセットで入れる。

---

## 実装順序

フェーズ1（モバイル対応 + 投稿履歴B）→ フェーズ2（下書き機能 + C）の順で実装する。
フェーズ1は単体でリリース可能。

```
--- フェーズ1: モバイル対応 + 投稿履歴 (B) ---
Step 1  manifest.json: isDesktopOnly: false
Step 2  LocaleStrings 型 + 日英テキスト追加（履歴関連含む）
Step 3  BlueskyPluginSettings + DEFAULT_SETTINGS 更新（4フィールド）
Step 4  PostModal: Platform.isMobile による画像UI分岐
Step 5  postToBluesky() の戻り値変更（投稿URLを返す）
Step 6  投稿履歴ノート作成処理 + 設定2件（トグル・フォルダ）追加

--- フェーズ2: 下書き機能 + frontmatter更新 (C) ---
Step 7  DraftSelectModal クラス新規作成
Step 8  BlueskyPlugin.openDraftSelectModal() メソッド追加
Step 9  コマンド登録 (open-draft-composer)
Step 10 BlueskySettingTab に下書き設定2件追加
Step 11 PostModal に由来ノート保持フィールド追加、
        投稿成功時の processFrontMatter 更新（C・履歴ノート作成はスキップ）
```

---

## 工数・保守性評価

| 観点 | 評価 | 備考 |
|------|------|------|
| 工数 | 中（約200行追加） | 既存コードの大規模変更なし（postToBlueskyの戻り値変更のみ） |
| 保守性 | 高 | コアAPIのみ使用、BASE API依存なし |
| モバイル対応 | 完全 | テキスト投稿の全機能が動作 |
| リスク | 低 | 安定したObsidian APIのみ使用 |
| BASEとの統合度 | 浅（運用規則レベル） | BASE APIが安定したら再検討 |

---

## 前提条件・注意事項

| 項目 | 内容 |
|------|------|
| Obsidianバージョン | `Platform.isMobile` は v0.9.11以上（minAppVersion: 1.8.0 で問題なし） |
| frontmatterの型 | 値が文字列・配列どちらも対応（例: `type: [bluesky-draft, note]`） |
| 本文の扱い | frontmatterブロックは除外してPostModalにセット |
| 300文字制限 | 一覧に文字数バッジを表示（300字超は赤）。選択時にNoticeで警告。PostModalで編集して投稿 |
| 画像機能 | モバイルでは非表示。デスクトップでは従来通り動作 |

---

## 将来的な拡張候補（スコープ外）

- BASE API v1.10以降が安定したらカスタムビューとして統合
- 複数のfrontmatterフィルタ条件に対応
- 履歴ノートのファイル名・frontmatterキーのカスタマイズ
