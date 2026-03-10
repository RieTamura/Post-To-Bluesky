# 実装計画書: BASE連携 下書き投稿機能 + モバイル対応

作成日: 2026-03-10
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

**スコープ外**
- BASE APIの直接利用（API不安定のため）
- 画像アップロードのモバイル対応
- 投稿後のfrontmatterステータス自動更新

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
```

---

## ファイル変更一覧

| ファイル | 変更内容 | 変更規模 |
|---------|---------|---------|
| `manifest.json` | `isDesktopOnly: false` | 1行 |
| `main.ts` | 設定・ロケール・コマンド・モーダル追加、モバイル分岐 | +約130行 |

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
  draftProperty: string;  // 追加: frontmatterキー (デフォルト: "type")
  draftValue: string;     // 追加: frontmatter値   (デフォルト: "bluesky-draft")
}

const DEFAULT_SETTINGS: BlueskyPluginSettings = {
  // ...既存
  draftProperty: 'type',
  draftValue: 'bluesky-draft'
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

`BlueskySettingTab.display()` 末尾に2項目追加する。

```
[ 下書きプロパティ名 ]  入力欄: "type"
  BASEの下書きノートを識別するfrontmatterのキー名

[ 下書き判定値 ]       入力欄: "bluesky-draft"
  上記キーに対応する値。この値を持つノートが下書き一覧に表示されます
```

---

## 実装順序

```
Step 1  manifest.json: isDesktopOnly: false
Step 2  LocaleStrings 型 + 日英テキスト追加
Step 3  BlueskyPluginSettings + DEFAULT_SETTINGS 更新
Step 4  PostModal: Platform.isMobile による画像UI分岐
Step 5  DraftSelectModal クラス新規作成
Step 6  BlueskyPlugin.openDraftSelectModal() メソッド追加
Step 7  コマンド登録 (open-draft-composer)
Step 8  BlueskySettingTab に設定項目2件追加
```

---

## 工数・保守性評価

| 観点 | 評価 | 備考 |
|------|------|------|
| 工数 | 小（約130行追加） | 既存コードの大規模変更なし |
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

- 投稿後に frontmatter の `status` を `posted` に自動更新
- BASE API v1.10以降が安定したらカスタムビューとして統合
- 複数のfrontmatterフィルタ条件に対応
