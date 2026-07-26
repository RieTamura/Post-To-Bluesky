# 実装計画書: BASE連携 下書き投稿機能 + モバイル対応

作成日: 2026-03-10
更新日: 2026-07-26（実装コードと突き合わせて実績値・実装差異を反映）
対象バージョン: v0.1.5 → v0.2.0（Base連携は v0.2.1）
実装状況: フェーズ1・2とも実装済み。README 3ファイルも更新済み。
　　　　　デスクトップ実機テスト済み / モバイル未検証・バージョンbump未実施

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
| 9 | 履歴ノートの `tags` 出力と本文からのハッシュタグ削除 | 新機能（実装中に追加） |
| 10 | 投稿済みをチェックボックス（`bluesky_posted`）で表現 | 新機能（実機テスト後に追加） |

**スコープ外**
- BASE APIの直接利用（API不安定のため）
- 画像アップロードのモバイル対応
- Base ファイルの自動生成・ノートフォルダの一本化（→ v0.2.1・後述）

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
   - 投稿本文・日時・投稿URL・タグを持つ履歴ノートが自動作成される（B）
     本文中のハッシュタグは frontmatter の tags に移される
   - 下書きノートから投稿した場合は、そのノートのfrontmatterから
     bluesky-draft が取り除かれ bluesky_posted: true が付き、
     下書き一覧から消える（C）

7. BASEで bluesky_posted のチェック有無でビューを作れば
   下書きと投稿履歴を切り替えて表示できる（任意）
```

---

## ファイル変更一覧

| ファイル | 変更内容 | 変更規模 |
|---------|---------|---------|
| `manifest.json` | `isDesktopOnly: false` | +1 / -1行 |
| `main.ts` | 設定・ロケール・コマンド・モーダル追加、モバイル分岐、投稿履歴、タグ抽出、FolderSuggest、既存バグ修正4件 | +570 / -59行 |
| `styles.css` | 下書き一覧モーダルのスタイル | +57行 |
| `README.md` | 機能概要・下書き投稿の導線・ロードマップ更新 | +18 / -7行 |
| `README_JA.md` | 下書き投稿・投稿履歴・モバイル対応の節と設定4件、変更履歴 | +144 / -10行 |
| `README_EN.md` | 同上（英語） | +146 / -4行 |
| `versions.json` | 誤ったキー `1.0.0` を `0.1.0` に修正（本計画とは無関係の既存の誤記） | +1 / -1行 |

当初見積もりは main.ts +約225行だったが、ロケール文字列の日英2系統・設定UIの
二重管理（宣言的API + `display()` フォールバック）・タグ処理の追加で倍規模になった。

**切り出した定数:** 実装中に散在していたマジックナンバーをモジュール定数にまとめた。
`MAX_POST_LENGTH`（300・投稿長とDraftSelectModalのバッジで共用）、
`MAX_TAG_LENGTH`（64）、`HASHTAG_DETECTION_REGEX`、
`POSTED_FRONTMATTER_VALUE`（`bluesky-posted`）、`POSTED_CHECKBOX_PROPERTY`（`bluesky_posted`）。

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
  postHistoryFolder: string;   // 追加(B): 履歴ノートの保存先フォルダパス (デフォルト: "Bluesky Posts")
                               //         設定画面ではフォルダサジェストで選択する（詳細設計 7-2）
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
draftFilterNote: string;     // "※ 表示条件" / "Filter"（一覧下部のフィルタ条件表示）
draftFilterUnposted: string; // "未チェック" / "unchecked"（同上。bluesky_posted の条件）
draftTooLong: string;        // "投稿内容が300字を超えています。編集してください。"
draftLoadFailed: string;     // "下書きの読み込みに失敗しました"
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

コマンド名（`Post from draft notes`）はObsidianの規約に従い英語固定でローカライズしない。

### 4. DraftSelectModal（新規クラス）

文字数を各ノートの横に表示し、300字超の場合は赤で警告する。

```
┌──────────────────────────────────────────┐
│  下書き一覧                               │
│──────────────────────────────────────────│
│  📄 2026-03-10 朝の気づき      245/300    │
│  📄 週次振り返り             🔴 412/300   │  ← 300字超は赤表示
│  📄 新機能のアナウンス          89/300    │
│──────────────────────────────────────────│
│  ※ 表示条件: type = bluesky-draft /       │
│     bluesky_posted 未チェック             │
└──────────────────────────────────────────┘
```

**処理フロー:**

1. `app.vault.getMarkdownFiles()` で全Markdownファイルを取得
2. `app.metadataCache.getFileCache(file)?.frontmatter` で各ファイルのfrontmatterを確認
3. `draftProperty` / `draftValue` の設定値でフィルタ（配列型のfrontmatterも考慮）
4. 更新日時（`file.stat.mtime`）の降順に並べる
5. 各ファイルの本文（frontmatter除去後）を `countGraphemes()` で計測。
   本文の読み込みは `vault.cachedRead()`
6. 一覧をModal上に表示（ファイル名 + 文字数バッジ。300字超は赤色クラス付与）
7. ノート選択時:
   - 本文が300字を超える場合 `new Notice(...)` で警告を表示
   - `PostModal` を開き本文をセット（ユーザーが自分で編集して投稿）
8. 該当ノートが0件の場合は `new Notice(...)` で通知してモーダルを閉じる

**実装メモ:** frontmatter除去は `metadataCache` の `frontmatterPosition.end.offset` を
優先し、キャッシュ未生成時のみ正規表現でフォールバックする。
非同期読み込み中にモーダルが閉じられた場合は描画を中断する（`isRendering` フラグ）。
各行はキーボード操作できるよう `role="button"` / `tabindex="0"` と Enter・Space を付与。
文字数バッジは投稿モーダルと同じ `245/300` 形式で出す（数値だけだと上限が分からないため）。

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
  getDraftFiles(): TFile[]                                    // frontmatterフィルタリング
  stripFrontmatter(content: string, file: TFile): string      // frontmatterブロック除去
  renderDraftItem(listEl: HTMLElement, file: TFile, body: string): void // 文字数バッジ付きで行を描画
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

// リボンアイコンからも開けるようにする
this.addRibbonIcon('file-text', 'Post from draft notes', () => this.openDraftSelectModal());
```

既存の `add-image` コマンドは**モバイルでは登録自体を行わない**（`Platform.isMobile` で
分岐）。モバイルでは対応するUIが存在しないため、押しても何も起きないコマンドが
コマンドパレット・ホットキー設定に並ぶのを避ける。

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

これに伴い `PostModal.fileInput` の型を `HTMLInputElement!` から
`HTMLInputElement | null`（初期値 `null`）に変更し、参照箇所はすべて `?.` にする。
モバイルで生成されない要素を definite assignment のまま扱うと実行時に落ちるため。

### 7. 設定画面追加

設定は `getSettingDefinitions()`（Obsidian 1.13+ 宣言的設定API）と `display()`（1.13未満フォールバック）の**両方**に追加する（2026-07-25 のレビュー対応で二重管理構成になったため）。

```
[ 下書きプロパティ名 ]  入力欄: "type"
  BASEの下書きノートを識別するfrontmatterのキー名

[ 下書き判定値 ]       入力欄: "bluesky-draft"
  上記キーに対応する値。この値を持つノートが下書き一覧に表示されます

[ 投稿履歴を保存 ]      トグル: オフ（デフォルト）
  投稿成功時に本文・日時・URL入りのノートを自動作成します

[ 履歴ノートの保存先 ]  フォルダ選択欄: "Bluesky Posts"
  履歴ノートを作成するフォルダ（存在しなければ自動作成）
  → vault内フォルダのサジェスト付き。詳細は 7-2
```

#### 7-2. 履歴ノート保存先のフォルダ選択

保存先はプレーンなテキスト入力ではなく、**vault内フォルダのサジェスト付き入力**にする。
フォルダ名のタイポで意図しない場所にノートが量産される事故を防ぐため。
設定UIが二重管理（1.13+ 宣言的API / 1.13未満 `display()`）なので、実装も2系統必要。

**(a) Obsidian 1.13+ — `getSettingDefinitions()`**

`SettingFolderControl`（`obsidian.d.ts` / API 1.13.0〜）が標準で用意されている。
`control.type` を `'folder'` にするだけでフォルダサジェスト付き入力になる。

```typescript
{
  name: locale.postHistoryFolderLabel,
  desc: locale.postHistoryFolderDesc,
  control: {
    type: 'folder',
    key: 'postHistoryFolder',
    placeholder: 'Bluesky Posts',
    defaultValue: 'Bluesky Posts',
    includeRoot: true,                // vault ルート "/" も候補に含める
    disabled: () => !this.plugin.settings.postHistoryEnabled
  }
}
```

- `validate?: (value) => string | void` — 不正なパスをインラインのエラーメッセージで弾ける
- `disabled?: boolean | (() => boolean)` — 「投稿履歴を保存」がオフのとき欄をグレーアウト。
  トグル切替後は `PluginSettingTab.refreshDomState()`（API 1.13.0〜）を呼んで再評価させる。
  設定値の保存フック（`onSettingChange`）内で `key === 'postHistoryEnabled'` のときだけ呼ぶ
- `filter?: (folder: TFolder) => boolean` — 候補の絞り込み（今回は未使用）

**(b) Obsidian 1.13未満 — `display()` フォールバック**

宣言的APIがないため `AbstractInputSuggest`（API 1.4.10〜）を継承した小クラスを自前で用意する。
`minAppVersion: 1.8.7` のまま利用可能。`vault.getAllFolders()` も API 1.6.6〜で問題なし。

```typescript
class FolderSuggest extends AbstractInputSuggest<TFolder> {
  getSuggestions(query: string): TFolder[] {
    const q = query.toLowerCase();
    return this.app.vault.getAllFolders(true)
      .filter(f => f.path.toLowerCase().contains(q));
  }
  renderSuggestion(folder: TFolder, el: HTMLElement) { el.setText(folder.path); }
  selectSuggestion(folder: TFolder) { /* setValue + onSelect コールバック + close */ }
}

// display() 側
.addText(text => {
  text.setPlaceholder('Bluesky Posts')
      .setValue(this.plugin.settings.postHistoryFolder)
      .onChange(async v => {
        this.plugin.settings.postHistoryFolder = v;
        await this.plugin.saveSettings();
      });
  new FolderSuggest(this.app, text.inputEl, path => {
    text.setValue(path);
    this.plugin.settings.postHistoryFolder = path;
    void this.plugin.saveSettings();
  });
})
```

`onSelect` の後付けメソッドではなくコンストラクタでコールバックを受け取る形にした
（`AbstractInputSuggest` を継承しただけのクラスにビルダーAPIを足す必要がないため）。
グレーアウトは `Setting.setDisabled()` と `TextComponent.setDisabled()` の両方に渡し、
トグル変更時は `this.display()` で設定画面全体を描き直して反映する
（1.13+ の `refreshDomState()` に相当する部分再描画がないため）。

**注意点**

- どちらの方式でも**存在しないフォルダ名を手入力できる**ため、
  8章の「なければ `vault.createFolder()` で作成」は引き続き必須
- OSのフォルダ選択ダイアログ（Electron の `dialog.showOpenDialog`）は
  モバイルで動作しないため**採用しない**。vault内サジェストがデスクトップ・モバイル
  両対応の唯一の手段

---

### 8. 投稿履歴ノート自動作成（B）

`postHistoryEnabled` がオンのとき、投稿成功後に1投稿=1ノートを自動作成する。
`type: bluesky-posted` は履歴ノートの種別を示す機械可読な識別子として残し、
投稿済みかどうかの目視・フィルタには `bluesky_posted` のチェックボックス（9章）を使う。
これにより下書き由来ノート（C）と履歴ノートを同じ条件で「投稿済み」として拾える。

**作成されるノートの例**（`Bluesky Posts/2026-07-25 1730.md`）:

```markdown
---
type: bluesky-posted
bluesky_posted: true
posted_at: 2026-07-25T17:30:00
url: https://bsky.app/profile/xxx.bsky.social/post/3kabc...
tags:
  - Obsidian
---
投稿した本文が残る。ハッシュタグは tags に移されるため本文からは除かれる。
```

frontmatterのキー名は `draftProperty` の設定値に追従する（デフォルト `type`）。
日時はローカルタイム。`postUrl` が取得できなかった場合は `url` 行を出力しない。
ハッシュタグが1つも無い投稿では `tags` 行を出力しない（詳細は 8-2）。

**前提となる変更:**

- 現在 `postToBluesky()` は createRecord レスポンスの body を捨てて `boolean` を返している。
  レスポンス JSON の `uri`（`at://{did}/app.bsky.feed.post/{rkey}` 形式）を取得し、
  戻り値を `{ success: boolean; postUrl?: string }` 等に変更する
- `at://` URI → 表示用URL変換: rkey を取り出し
  `https://bsky.app/profile/{handle}/post/{rkey}` を組み立てる（handle は設定値）

**処理フロー（投稿成功後）:**

1. `postHistoryEnabled` がオフなら何もしない（従来どおり）
2. `normalizePath()` で保存先フォルダを正規化し、`vault.getFolderByPath()` で存在確認して
   なければ `vault.createFolder()` で作成
   （設定値が `/` またはvaultルートの場合はフォルダを作らずルート直下に作成）
3. ファイル名は投稿日時から生成（例: `2026-07-25 1730.md`）。
   同名ファイルが存在する場合は ` (2)` などの連番を付与
4. 本文からハッシュタグを抽出して `tags` に出力し、本文からは取り除く（8-2）
5. `vault.create()` で frontmatter + 本文のノートを作成
6. 履歴保存に失敗しても**投稿自体は成功扱い**とし、`postHistorySaveFailed` の Notice のみ表示
   （投稿の成否と履歴の成否を混同させない）

使用APIはすべて Vault コアAPI（モバイル対応済み）。

#### 8-2. ハッシュタグの扱い

投稿本文中のハッシュタグを frontmatter の `tags` に移す。BASEのビューで
タグをプロパティとしてフィルタ・グループ化できるようにするため。

```text
投稿本文: "tagsテスト\n#Obsidian #テスト"
          ↓
frontmatter: tags: [Obsidian, テスト]
本文:        "tagsテスト"
```

- **抽出条件はBlueskyのfacetと共有する。** ハッシュタグ検出の正規表現を
  `HASHTAG_DETECTION_REGEX` としてモジュール定数に切り出し、`detectFacets()`（Blueskyへ
  送るタグ）と `extractHashtags()`（frontmatterに書くタグ）の双方が使う。64字超を除外する
  条件も `MAX_TAG_LENGTH` で共通化し、**実際に投稿されたタグとノートの `tags` が
  食い違わない**ようにする
- 大文字小文字違いは重複とみなし、最初の表記だけ残す（Obsidianのタグは大小を区別しない）
- 数字始まりのタグは YAML が数値として解釈するため引用符で囲む（`#1_000` → `"1_000"`）
- **本文から削除するのは `tags` に昇格したタグだけ。** 64字超などで `tags` に入らなかった
  タグは情報が消えないよう本文に残す
- タグを消したあとの空白は前後の文字種で決める。和文は詰め（`今日は #Obsidian を` →
  `今日はを`）、欧文は単語が繋がらないよう1つ残す（`I use #Obsidian daily` →
  `I use daily`）。タグと無関係な空白は変更しない
- タグだけで構成されていた行は行ごと削除する。元から空だった行は段落区切りとして残す
- 副作用として、履歴ノートの本文は「実際に投稿された文字列そのもの」ではなくなる。
  完全な原文が必要な場合は `url` から実物を辿る

### 9. 下書きノートのfrontmatter更新（C）

下書き一覧（DraftSelectModal）経由で投稿した場合のみ、投稿成功後に
**元の下書きノート自体**を `FileManager.processFrontMatter()` で更新する。

```yaml
# 更新前                # 更新後
type:                →  type:
  - bluesky-draft         - note              # bluesky-draft を削除、他の値は残す
  - note                bluesky_posted: true  # チェックボックス表示
                        posted_at: 2026-07-25T17:30:00
                        url: https://bsky.app/profile/.../post/...
```

- **投稿済みの表現は真偽値プロパティ `bluesky_posted` に一本化する。** Obsidian の
  Properties UI は真偽値をチェックボックスとして描画するため、開いた瞬間に投稿済みか
  判別できる。`bluesky-draft` → `bluesky-posted` の文字列置換は「見分けにくい」という
  実機テストのフィードバックで廃止した（2026-07-26）
- `draftProperty` からは `draftValue` に一致する要素を**削除**する。値が配列なら
  一致要素だけを取り除き（`[bluesky-draft, note]` → `[note]`）、他のタグは残す。
  下書き値しか入っていなかった場合は空配列・空文字を残さずキーごと削除する
- 下書き一覧のフィルタは「`draftProperty` が `draftValue` を含む **かつ**
  `bluesky_posted` が true でない」。下書き値の削除だけでも一覧から消えるが、
  利用者が手動でチェックを付けて一時的に隠す使い方もできる
- プロパティ名 `bluesky_posted` は定数 `POSTED_CHECKBOX_PROPERTY` にハードコードする。
  設定項目は既に4件追加しており、これ以上増やさない判断
- **トレードオフ:** `bluesky-draft` が消えるためチェックを外しただけでは下書きに戻らない。
  再投稿するには `draftProperty` に下書き値を書き戻す必要がある
- Bで履歴ノートも有効な場合、下書きノートの更新（C）を優先し、
  **履歴ノートの新規作成はスキップ**する（同じ投稿が二重にノート化されるのを防ぐ）
- PostModal から下書きの由来ノート（`TFile`）を保持するフィールドを追加し、
  ポップアップ直接投稿（由来なし）と下書き投稿（由来あり）を区別する。
  投稿成功後の分岐は `BlueskyPlugin.recordPostResult(text, postUrl, sourceFile)` に集約し、
  由来ありなら C（`markDraftAsPosted`）、由来なしかつ設定オンなら B（`createPostHistoryNote`）
  を呼ぶ。この関数全体を try/catch で包み、失敗時は Notice のみで投稿は成功扱いにする
- **`openPostModal()` の引数を `(initialText, sourceFile)` に拡張する。** 従来は常に空欄で
  開いていたため引数を持たなかった。下書き由来のときだけ本文をセットし、
  カーソルは続けて編集できるよう末尾に置く（通常起動時は従来どおり先頭）
- **8-2 のタグ処理はCには適用しない。** 下書きノートには利用者が付けた既存の `tags` が
  ある可能性が高く、マージすると意図しない書き換えになるため、`tags` と本文には触れない

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
        フォルダ欄は 1.13+ = control type:'folder' / 1.13未満 = FolderSuggest クラス（7-2）

--- フェーズ2: 下書き機能 + frontmatter更新 (C) ---
Step 7  DraftSelectModal クラス新規作成
Step 8  BlueskyPlugin.openDraftSelectModal() メソッド追加
Step 9  コマンド登録 (open-draft-composer)
Step 10 BlueskySettingTab に下書き設定2件追加
Step 11 PostModal に由来ノート保持フィールド追加、
        投稿成功時の processFrontMatter 更新（C・履歴ノート作成はスキップ）

--- 追加対応（実機テスト中に発生） ---
Step 12 履歴ノートの tags 出力 + 本文からのハッシュタグ削除（8-2）
Step 13 投稿済みを bluesky_posted チェックボックスに変更（9章）。
        下書き値の削除・一覧フィルタ・履歴ノート出力・ロケール1件を併せて更新
```

Step 1〜13 はすべて実装済み。

---

## 実装中に判明した既存不具合の修正

計画そのものとは別に、実装・実機テストの過程で既存コードの不具合が4件見つかったため
併せて修正した。いずれも本計画の変更が引き金で顕在化したもの。

| # | 不具合 | 症状 | 対応 |
|---|--------|------|------|
| 1 | textareaの `input` リスナーが `debounceUpdatePreviews()` を呼んでいない | 入力してもリンクプレビューが出ず、external embed が生成されない | リスナーから呼ぶよう修正。初期テキスト（下書き本文）にも適用 |
| 2 | リンクプレビューのサムネイル blob を手で組み直す際に `$type` を `_type` にリネームしていた | サムネイル付き投稿が **createRecord 400** で失敗 | `BlueskyBlobRef` を `$type: 'blob'` に修正し、uploadBlob のレスポンスをそのまま渡す |
| 3 | `requestUrl` は既定で 400+ を例外にするため、ステータス判定に到達しない | 401の再ログイン・429のバックオフ再試行・APIエラーメッセージ抽出が全て機能せず、`Request failed, status 400` としか出ない | `requestWithTimeout()` で `throw: false` を指定 |
| 4 | `new URL()` を素で呼んでいた（`extractFirstUrl` の結果と、プレビュー取得失敗時のフォールバック） | 入力途中の不完全なURL（例: `https://`）で例外が投げられ、以降の入力に反応しなくなる | `parseUrlSafe()` を追加し、解析できないURLは未検出扱いにする。`LinkPreviewData.domain` は元から optional のため型変更は不要 |

1と2は連鎖している。プレビューが表示されない（1）せいでサムネイル付き external embed の
生成経路が実質死んでおり、2の `$type` バグが長期間踏まれずに残っていた。1を直した直後の
実機テストで2が400として表面化した。4も同じ経路で、1の修正によって「入力の1文字ごとに
URL解析が走る」ようになったことで初めて踏むようになった。

---

## 工数・保守性評価

| 観点 | 評価 | 備考 |
|------|------|------|
| 工数 | 中（main.ts 実績 +570/-59行、本計画書を除く全体で +937/-82行） | 既存コードの大規模変更なし（postToBlueskyの戻り値変更のみ） |
| 保守性 | 高 | コアAPIのみ使用、BASE API依存なし |
| モバイル対応 | 完全 | テキスト投稿の全機能が動作 |
| リスク | 低 | 安定したObsidian APIのみ使用 |
| BASEとの統合度 | 浅（運用規則レベル） | BASE APIが安定したら再検討 |

---

## 前提条件・注意事項

| 項目 | 内容 |
|------|------|
| Obsidianバージョン | `Platform.isMobile` は v0.9.11以上（minAppVersion: 1.8.7 で問題なし） |
| フォルダサジェスト | `AbstractInputSuggest` は API 1.4.10〜、`vault.getAllFolders()` は 1.6.6〜。宣言的APIの `type: 'folder'` は 1.13.0〜のため、1.13未満は自前クラスで代替（7-2） |
| frontmatterの型 | 値が文字列・配列どちらも対応（例: `type: [bluesky-draft, note]`） |
| 投稿済みの判定 | 真偽値プロパティ `bluesky_posted`（チェックボックス表示）。文字列 `bluesky-posted` は履歴ノートの種別識別子としてのみ使う |
| 本文の扱い | frontmatterブロックは除外してPostModalにセット |
| 300文字制限 | 一覧に文字数バッジを表示（300字超は赤）。選択時にNoticeで警告。PostModalで編集して投稿 |
| 画像機能 | モバイルでは非表示。デスクトップでは従来通り動作 |
| ハッシュタグ | 履歴ノートでは frontmatter の `tags` に移し、本文からは削除（8-2）。下書きノート側（C）は対象外 |
| デフォルトハッシュタグ | 下書きから開いた場合は本文を優先し、`defaultHashtags` の自動挿入は行わない（300字制限を押し上げないため） |

---

## 残作業

**完了済み**

- ~~README（README.md / README_JA.md / README_EN.md）への追記~~
  → 3ファイルとも更新済み。新コマンド・新設定4件・投稿履歴・モバイル対応の節、
  対応環境（0.15.0+ → 1.8.7+ / モバイル追加）、トラブルシュート2件、
  変更履歴（v0.1.0〜v0.2.0）を反映

**未着手**

- **バージョンbump（v0.2.0）。** `manifest.json` / `package.json` は **0.1.6 のまま**。
  一方 README は既に「Version: 0.2.0」と書いており**食い違っている**ので、
  リリース前に必ず揃える。`npm version` が `version-bump.mjs` を呼ぶ構成のため
  `versions.json` はそこで追記される
  （今回の `versions.json` 差分は bump ではなく、誤って `1.0.0` になっていた
  初版キーを `0.1.0` に直しただけ）
- 投稿済みチェックボックス（9章・Step 13）のデスクトップ実機再テスト
- モバイル実機での動作確認（デスクトップは確認済み）
- Obsidian 1.13+ 環境での宣言的設定API側の描画確認
  （検証機は 1.12.7 のため `display()` フォールバック側のみ確認済み）
- `POSTED_CHECKBOX_PROPERTY` 宣言部のコメントが Step 13 以前の仕様のまま
  （「下書きノートは draftProperty の値を保ったまま」と書いてあるが、
  実装は `draftValue` を削除する）。動作影響はないが次のコミットで直す

---

## v0.2.1 計画: ノートフォルダの一本化 + Base 自動生成

v0.2.0 の実機テスト中に出た「下書きフォルダと履歴フォルダが分かれていて見通しが悪い」
という課題への対応。**v0.2.0 には含めない**（フォルダ設定の意味を変える改修になり、
デスクトップ実機テストのやり直し範囲が広がるため）。

### 前提: 1フォルダ運用は現時点でも成立している

下書きノートはフォルダで縛っておらず `draftProperty` の frontmatter だけで判定するため、
下書きを履歴フォルダ内に作れば統合される。さらに下書き由来の投稿は元ノートを更新するだけで
履歴ノートを別途作らない（8章・9章）ので、1つのノートが下書き→投稿済みへ育ち重複しない。
つまり v0.2.1 で足すのは**その運用を既定の導線にするための補助**であって、新しい仕組みではない。

### スコープ

| # | 内容 |
|---|------|
| 1 | 設定「履歴ノートの保存先」を「Bluesky ノートフォルダ」に改称（下書き・履歴の共通置き場） |
| 2 | コマンド「新規下書きを作成」— 設定フォルダに `type: bluesky-draft` 入りの空ノートを作って開く |
| 3 | コマンド「Bluesky 用の Base を作成」— 下書き／投稿済みの2ビューを持つ `.base` を生成 |

設定キー `postHistoryFolder` 自体は互換のため改名しない（既存 `data.json` を壊さない）。
変更するのはラベルと説明文のみ。

### 生成する Base ファイル

検証機（Obsidian 1.12.7）の既存 `.base` から確認した書式に合わせる。
frontmatter プロパティは `note.` 接頭辞、フォルダ絞り込みは `file.folder ==`。

```yaml
filters:
  and:
    - file.ext == "md"
    - file.folder == "Bluesky Posts"   # postHistoryFolder の設定値を埋め込む
views:
  - type: table
    name: 下書き
    filters:
      and:
        - note.bluesky_posted != true
    order: [file.name, file.mtime]
  - type: table
    name: 投稿済み
    filters:
      and:
        - note.bluesky_posted == true
    order: [file.name, posted_at, url, tags]
    sort:
      - property: posted_at
        direction: DESC
```

9章のチェックボックスがそのまま2ビューの振り分け条件になる。

### 設計上の判断

- **生成はコマンド実行時（手動）に限る。** 投稿のたびにファイルが増えるのは驚きがあり、
  利用者が Base を編集していた場合の上書き是非も判断できない。
  既存ファイルがある場合は生成せず開くだけにする
- **Bases は Obsidian 1.9+ の機能。** `minAppVersion: 1.8.7` のままなら、
  1.9 未満では生成した `.base` が単に開けないだけ。コマンドを出すかどうかは要検討
- `type` を `tags` に統合する案は**採用しない**。`tags` には投稿本文から抽出した
  利用者のハッシュタグが入るため、プラグイン管理の識別子を混ぜると
  利用者のタグ整理でプラグインの状態管理が壊れる。vault 全体のタグ名前空間も汚す

### 未検証

- `note.bluesky_posted != true` が Bases のフィルタ構文として通るかは
  Obsidian 側でしか判定できない。生成後に実際に開いて確認する一往復が必要

---

## 将来的な拡張候補（スコープ外）

- BASE API v1.10以降が安定したらカスタムビューとして統合
- 複数のfrontmatterフィルタ条件に対応
- 履歴ノートのファイル名・frontmatterキーのカスタマイズ
- `bluesky_posted` のプロパティ名を設定可能にする（現状はハードコード）
