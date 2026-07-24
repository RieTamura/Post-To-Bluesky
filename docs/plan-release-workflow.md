# 実装計画書: GitHub Actions によるリリース自動化 + ビルド来歴証明（attestation）

作成日: 2026-07-03
対象バージョン: v0.1.5 以降のリリースに適用

---

## 背景・目的

- 現状、各リリース（0.1.0〜0.1.5）は手元でビルドした `main.js` / `manifest.json` / `styles.css` を手動アップロードしている（全アセットのアップローダーが User であることを確認済み）
- そのため GitHub の artifact attestation（ビルド来歴証明）が付与されず、警告が表示される
- `actions/attest-build-provenance` は GitHub Actions 内の OIDC トークンを必要とするため、手動アップロードでは解決不可能
- リリースを GitHub Actions で自動化し、attestation を付与する

---

## スコープ

| # | 内容 | 種別 |
|---|------|------|
| 1 | `.github/workflows/release.yml` を新規作成 | CI |
| 2 | tag push をトリガーにビルド → attestation 付与 → ドラフトリリース作成 | CI |
| 3 | タグ名と `manifest.json` の version の一致チェック | CI |

**スコープ外**
- バージョン番号の自動インクリメント（既存の `npm version` + `version-bump.mjs` を継続使用）
- 過去リリース（0.1.0〜0.1.5）への attestation の遡及付与（技術的に不可能）
- テスト・lint の CI 実行（別途検討）

---

## 設計上の決定事項

### トリガーは `v*` ではなく `"*"`（全タグ）

- 本リポジトリの既存タグは `0.1.5` のように **`v` プレフィックスなし**
- Obsidian コミュニティプラグインの規約上、タグ名は `manifest.json` の `version` と完全一致（プレフィックスなし）である必要がある
- Obsidian 公式サンプルプラグインのワークフローも `tags: ["*"]` を使用
- `v*` にすると既存のタグ運用では一度も発火しないため不採用

### リリースはドラフトとして作成

- Obsidian 公式テンプレートに準拠。リリースノートを編集してから手動で公開する運用
- 誤タグ push 時にも公開前に取り消せる

### attestation の対象

- `main.js` / `manifest.json` / `styles.css` の3ファイル（Obsidian プラグインの配布物一式）
- `permissions` に `id-token: write` と `attestations: write` が必要

### バージョン整合性チェック

- タグ名 ≠ `manifest.json` の `version` の場合はビルド前に fail させる
- リリース名の揺れ（`0.1.4` / `v0.1.3` など）もタグ名基準で統一される

---

## ファイル変更一覧

| ファイル | 変更内容 | 変更規模 |
|---------|---------|---------|
| `.github/workflows/release.yml` | 新規作成 | 約50行 |

---

## ワークフローの流れ

```
tag push（例: 0.1.6）
  │
  ├─ 1. checkout
  ├─ 2. setup-node (Node 20) + npm ci
  ├─ 3. タグ名と manifest.json の version の一致チェック（不一致なら fail）
  ├─ 4. npm run build（tsc 型チェック + esbuild production ビルド）
  ├─ 5. actions/attest-build-provenance@v2 で main.js / manifest.json / styles.css に attestation 付与
  └─ 6. gh release create --draft でドラフトリリース作成（3ファイルを添付）
  │
  └─ GitHub 上でリリースノートを編集 → 手動で Publish
```

---

## 新しいリリース手順（運用）

```bash
# 1. バージョンを上げる（manifest.json / versions.json / package.json が更新される）
npm version patch   # または minor / major

# 2. コミットとタグを push（タグは v なしの素のバージョン番号）
git push origin master
git tag 0.1.6
git push origin 0.1.6

# 3. Actions の完了を待ち、GitHub 上でドラフトリリースを編集して公開
```

※ `npm version` は git tag `v0.1.6`（v あり）を自動作成するが、Obsidian の規約に合わせて v なしのタグを別途 push する。

---

## 検証方法

1. ローカルで `npm ci && npm run build` が成功すること（ワークフローと同じ手順）
2. ワークフロー追加後、次回リリース時にタグを push し、以下を確認:
   - Actions が成功しドラフトリリースが作成される
   - 各アセットのアップローダーが `github-actions (Bot)` になっている
   - アセットに attestation バッジが表示される（`gh attestation verify main.js --repo RieTamura/Post-To-Bluesky` で検証可能）
