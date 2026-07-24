# Obsidian レビュー警告 修正計画 (2026-07-24)

対象: 2026-05-07 実施の Obsidian 公式レビュー (v0.1.5, commit `926efda`) で指摘された警告。
リポジトリ内の `obsidianReview.md` は 2025-11 の旧レビューのメモであり、本計画は新レビューのスクリーンショットに基づく。

## 現状サマリ

| カテゴリ | 状態 |
|---|---|
| RELEASES (attestation 推奨) | 対応中 — `.github/workflows/release.yml` 作成済み・未コミット |
| SOURCE CODE (main.ts / package.json) | 未修正 |
| README | 未修正 |
| CSS LINT (`!important`) | 未修正 |
| DEPENDENCIES (脆弱な推移的依存) | 未修正 |
| BUILD VERIFICATION | Pass (対応不要) |

## 修正項目

### 1. manifest.json — `getLanguage` と minAppVersion の不整合

- 警告: `'getLanguage' requires Obsidian v1.8.7, but minAppVersion is 1.8.0` (main.ts:384)
- 対応: `minAppVersion` を `1.8.0` → `1.8.7` に変更。コード側は変更不要。
- 注: `versions.json` への反映は次回リリース時の `version-bump.mjs` で行われる。

### 2. main.ts — DOM ヘルパー / activeDocument / activeWindow

| 警告 | 箇所 | 対応 |
|---|---|---|
| `createDiv()` を使う | 710, 715 | `activeDocument.body.createDiv()` / 親要素の `createDiv()` に置換 |
| `activeDocument` を使う | 710, 712, 715, 718, 858, 870, 1052 | 絵文字ピッカー生成・外側クリック検知の `document` を `activeDocument` に置換 |
| `createSpan()` を使う | 718 | `grid.createSpan({ cls, text })` に置換 |
| `activeWindow.setTimeout()` | 776 | `activeWindow.setTimeout` に置換 |
| `activeWindow.clearTimeout()` | 969, 1128 | `activeWindow.clearTimeout` に置換 (対の 970 の `window.setTimeout` も `activeWindow` に揃える) |
| `createEl('canvas')` | 1052 | Obsidian グローバルの `createEl('canvas')` に置換 |

対象は警告で指摘された箇所のみ。Promise の遅延用途で使っている `window.setTimeout` (408, 434, 561, 637 行など) は指摘対象外のため変更しない。

### 3. main.ts — 型の警告

| 警告 | 箇所 | 対応 |
|---|---|---|
| `Unexpected any` | 823 | `(this.app as any).hotkeyManager` → `hotkeyManager` を持つ型を交差型で宣言してアクセス (`App & { hotkeyManager?: ... }`) |
| `Unexpected any` | 838 | `Hotkey` 型の `modifiers` を obsidian の `Modifier[]` で定義し、`as any` を削除 |
| `'index' is defined but never used` | 938 | `forEach((file, index)` の未使用引数 `index` を削除 |

### 4. package.json / esbuild.config.mjs — builtin-modules と依存関係の脆弱性

- 警告1: `"builtin-modules" should be replaced with an alternative package` (package.json:18)
  - 対応: 依存から `builtin-modules` を削除し、`esbuild.config.mjs` で Node 標準の `node:module` から `builtinModules` を import する(公式推奨の代替)。
- 警告2: 脆弱な推移的依存 (js-yaml / minimatch / ajv / flatted / brace-expansion / picomatch) — すべて `@typescript-eslint/eslint-plugin` 5.29.0 経由。
  - 対応: `@typescript-eslint/eslint-plugin` / `@typescript-eslint/parser` を最新の v8 系へ更新。v8 は TypeScript >= 4.8.4 を要求するため `typescript` も 5.x へ更新する。
  - 検証: `npm install` 後に `npm run build` (tsc -noEmit + esbuild) が通ること。TS 5 で新たな型エラーが出た場合は個別に修正。
  - フォールバック: 更新でビルドが壊れる場合は package.json の `overrides` で推移的依存のみパッチ版に固定する。

### 5. README.md — インストール・使い方セクションの追加

- 警告: `README does not appear to include installation or usage instructions`
- 対応: `README.md` 本体に「Installation / インストール」「Usage / 使い方」セクションを追記(英日併記・簡潔に)。詳細は既存の README_JA / README_EN へのリンクを維持。

### 6. styles.css — `!important` の除去

- 警告: `Avoid !important` (styles.css:139)
- 対応: `.bluesky-hidden` の使用箇所は絵文字ピッカーコンテナとファイル選択 `input` の2つ。セレクタを `.bluesky-emoji-picker-container.bluesky-hidden, input.bluesky-hidden` に変更して詳細度を上げ、`!important` を削除。

### 7. RELEASES — artifact attestation (Recommendation)

- 作成済みの `.github/workflows/release.yml` (attestation + tag/manifest 一致チェック) をコミット対象に含める。
- 効果が出るのは次回リリース (タグ push) から。

## 対象外(別途判断)

- `manifest.json` の `isDesktopOnly: true` — 直近コミットでモバイル対応を追加済みのため、モバイル対応をリリースする際に `false` へ変更が必要。リリース方針と合わせて判断。
- `package.json` の `name`/`description` がサンプルプラグインのままの点(レビュー指摘外)。
- DEPENDENCIES 警告は「プラグインに影響しないか確認せよ」という趣旨であり、すべて devDependencies 経由のためランタイム(main.js)には含まれない。更新は警告解消と衛生目的。

## 実施順序

1. manifest.json (minAppVersion)
2. main.ts (DOM / activeDocument / activeWindow / 型)
3. styles.css
4. README.md
5. esbuild.config.mjs + package.json → `npm install` → `npm run build` で検証
6. ビルド確認後、変更一式(release.yml 含む)をコミット可能な状態にする

## 実施結果 (2026-07-24)

- 上記 1〜6 すべて完了。`npm run build` (tsc -noEmit + esbuild production) 成功、`npm audit` 0 vulnerabilities、`npx eslint main.ts` 警告ゼロ。
- 計画外の追加対応:
  - `esbuild` 0.17.3 → ^0.25.0 に更新 (0.17 系自体に moderate 脆弱性 GHSA-67mh-4wv8-2f99 が残っていたため。API 互換で build 成功を確認)。
  - `eslint@^9` を devDependencies に追加し、旧 `.eslintrc` / `.eslintignore` をフラット設定 `eslint.config.mjs` に移行 (@typescript-eslint v8 は ESLint 9 系とペアで動作するため。ルール内容は旧設定と同一)。
  - `typescript` は ^5.5.4 を指定 (@typescript-eslint v8 の要求)。型チェックは修正なしで通過。
- 旧レビュー由来の `hotkeyConflictDetector.ts` は既にリポジトリから削除済みだった。
