# 実装計画書: `main.ts` のリファクタリング（後始末・分割・通信処理の統一）

作成日: 2026-11-12
対象バージョン: v0.6.0（リリースは v0.7.0 に同梱。単独リリースはしない）
実装状況: フェーズ1・2とも実装済み（ブランチ `refactor/split-main`）。node ハーネスで確認済みで、**デスクトップ実機での確認は未実施**

---

## 背景・目的

- `main.ts` 1ファイルが **3,289 行**あり、変換ロジック・ロケール文字列（約1,000行）・通信・プラグイン本体・モーダル4つ・設定画面が同居している
- lint（`eslint-plugin-obsidianmd`）と `tsc` はどちらもクリーンで、**品質上の問題は無い**。本件は次のメンション対応（`docs/plan-mention-support.md`）を入れやすくするための整理
- 特にメンション対応では handle→DID 解決の通信を1本追加する。今は通信の再試行処理が2通りある（後述）ので、先に1本化しておく

**動作は変えない**のが原則。例外はフェーズ2-3（英語環境で日本語エラーが出る翻訳漏れの修正）だけ。

---

## フェーズ1: 後始末（見た目・メタ情報のみ）

| # | 内容 | 場所（v0.6.0 時点） |
|---|------|------|
| 1-1 | 削除済みコードの名残コメントを消す（`// (Removed stray malformed code block ...)`） | `main.ts:1192` |
| 1-2 | `countGraphemes` とプラグインクラスのインデント崩れを直す（深さ4/2/1が混在） | `main.ts:1194-1956` |
| 1-3 | `createHttpError` の閉じ括弧と次のメソッドが同じ行に続いているのを分ける | `main.ts:1418` |
| 1-4 | 同じ文言のロケールキー `pleaseEnterContent` を `postContentEmpty` に統合 | `main.ts:740` ほか |
| 1-5 | `package.json` / `package-lock.json` の `name`・`description` をサンプルのままから実名へ | `package.json:2-4` |
| 1-6 | 2025-11 の旧レビューメモ `obsidianReview.md` を削除（経緯は `docs/plan-obsidian-review-fixes-2026-07.md` に残っている） | リポジトリ直下 |

**確認:** `git diff -w` で、1-2 が空白以外の差分を生んでいないことを確かめる。あわせて lint と tsc を実行する。

---

## フェーズ2: 分割と通信処理の統一

### 2-1 ファイル分割

`main.ts` はエントリポイントとしてリポジトリ直下に残す。esbuild の `entryPoints` も `manifest.json` も変えない。出力は従来どおり `main.js` 1本。

```
main.ts                     プラグイン本体（コマンド登録・設定読込・下書き/履歴ノート）
src/
  text.ts                   URL・ハッシュタグ検出、countGraphemes、絵文字リスト
  frontmatter.ts            frontmatter・日付テンプレート・wikilink
  images.ts                 画像判定・vault 取り込み・アップロード用の縮小
  markdown.ts               Markdown → 投稿テキスト変換
  i18n.ts                   LocaleStrings と日英の文字列
  settings.ts               設定の型・既定値・設定タブ・フォルダ/ファイルのサジェスト
  bluesky.ts                Bluesky API の型
  bluesky-client.ts         通信クライアント BlueskyClient（2-2）
  facets.ts                 detectFacets（プラグインのメソッドだったが this を使っていなかったので関数にした）
  modals/
    post-modal.ts
    draft-save-confirm-modal.ts
    draft-select-modal.ts
    vault-image-suggest-modal.ts
```

- モーダルは、プラグインを `import type` で参照する（循環 import を実行時に起こさないため）
- 下書き・履歴ノートの作成処理はプラグインの private メソッドに依存しているので、今回はプラグイン本体に残す
- `package.json` の `lint` を `eslint main.ts src` に変える（スキャンと同じ範囲を手元でも見るため）

### 2-2 通信処理の統一

現状:

- `postToBluesky`（`main.ts:1585`）は `retryWithBackoff` を使う。401 なら1回だけ再ログイン、429 なら `retry-after` を見て待つ
- `uploadBlob`（`main.ts:1529`）は同じことを**自前のループ**で書いている

方針:

- 通信まわり（セッション保持・`login`・`fetchProfileAvatar`・`uploadBlob`・`createRecord`・`requestWithTimeout`・`retryWithBackoff`）を `BlueskyClient` クラスとして `src/bluesky-client.ts` に移す。プラグインは `plugin.client` として持つ
- 401/429 の扱いは、`authedRequest(params, failureLabel)` という共通処理1本にまとめる。`uploadBlob` と `createRecord` はどちらもこれを通す
- 投稿前の文字数・空チェックと `Notice` の表示は、今と同じ `postToBluesky` が受け持つ。呼び出し側（モーダル）の挙動は変えない
- メンション対応で追加する `resolveHandle` も、この `authedRequest` に乗せる

統一で変わる細部（どれも許容範囲と判断）。node ハーネスで旧実装と突き合わせ、変わったのはこの4点だけと確認した:

- 画像アップロードの 429 で待つ時間が変わる。旧は「`retry-after`（なければ 1.5 秒）× 試行回数」。新は投稿と同じく「`retry-after` の秒数 ＋ 0.6 秒 × 試行回数」
- 画像アップロードの 401 で再ログインする回数が、最大2回から投稿と同じ1回になる
- ログイン失敗の通知は、前置きが「ログインに失敗しました: ログインに失敗しました: 401」と二重になっていた。サーバーが返す理由（例: Invalid identifier or password）を出すように直した
- APIがエラー文言を返さなかったときの文言を、「投稿に失敗しました: 500」から `HTTP 500` にした。通知側が「投稿に失敗しました: 」を付けるので、二重にならないようにするため

### 2-3 翻訳漏れの修正

`uploadBlob` の例外メッセージ5件が日本語で固定されており、英語環境でも日本語で表示される。2-2 の統一で、「認証エラー」「レート制限」「失敗しました: 500」の3種は、APIが返す文言（無ければ `HTTP 401` など）に置き換わった。残るタイムアウトとログイン失敗は `LocaleStrings` を使う。**追加したキーは `imageUploadTimeout` の1件だけ**。

---

## 検証

| 段階 | 方法 |
|------|------|
| フェーズ1 | `git diff -w` の目視、`npm run lint`、`npm run build` |
| フェーズ2 | `npm run lint`（`src` を含む）、`npm run build`。node ハーネス（obsidian をスタブにして esbuild でバンドル）で、変換・facet 検出の結果が分割前と一致することを確認する |
| 実機 | デスクトップで テキスト投稿 / 画像付き投稿 / 下書きから投稿 / 履歴ノート作成 / 設定画面の表示 を各1回。英語表示でもエラー文言を確認する |

---

## 進め方

- ブランチ `refactor/split-main` で、フェーズ1とフェーズ2を別コミットにする
- 実機で確認できたら master に入れる。単独リリースはせず、v0.7.0（メンション対応）に同梱する
- 分割後は `docs/plan-mention-support.md` の行番号参照（v0.6.0 の `main.ts` 基準）が合わなくなる。メンション対応に着手するときに、新しいファイル名に読み替える
