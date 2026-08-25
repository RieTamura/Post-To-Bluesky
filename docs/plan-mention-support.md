# 実装計画書: メンション対応（`@handle`）+ 履歴ノートのプロフィールリンク化

作成日: 2026-08-25
対象バージョン: v0.6.0 → v0.7.0
実装状況: 未着手（本書は着手前の計画。行番号はすべて v0.6.0 時点の `main.ts`）

---

## 背景・目的

- 本文に `@alice.bsky.social` と書いても、現在は**平文のまま投稿される**。`detectFacets()`（`main.ts:1473`）が link と tag の facet しか組み立てていないため
- Bluesky の投稿レコードが持てる facet は `link` / `mention` / `tag` の3種。うち**未実装なのは mention だけ**で、装飾用 facet は規格として存在しない（→ README_JA/EN 2-4節「BlueskyでのMarkdown記法の見え方」）。つまり本件は**この規格の天井まで到達させる最後の1件**にあたる
- ロードマップ（`README.md:112`）の未着手3件のうち、実装コストが最も小さいものとして先頭に置いてある

あわせて、履歴ノートに残る `@handle` を Obsidian 上からもたどれるようにする（後述の「案B」）。

---

## スコープ

| # | 内容 | 種別 |
|---|------|------|
| 1 | `MentionFacetFeature` 型の追加 | 型 |
| 2 | `findMentionCandidates()` — 本文からメンション候補を抽出する純粋関数 | 新規 |
| 3 | `com.atproto.identity.resolveHandle` によるDID解決＋セッション内キャッシュ | 新規 |
| 4 | `detectFacets()` の async 化と mention facet の生成 | 既存改修 |
| 5 | `reserved` 範囲に生成済み link facet を含める（範囲衝突の防止） | 既存改修 |
| 6 | 履歴ノート本文の `@handle` をプロフィールリンクに変換（案B） | 新規 |
| 7 | README 3ファイルの更新（ロードマップ行の打ち消し＋説明の追加） | ドキュメント |

**スコープ外**

- 新規UI・新規設定・ロケール文字列の追加（**本件では1件も増やさない**）
- 下書きノート（C）の本文書き換え。理由は「詳細設計 6」を参照
- frontmatter への `mentions:` 出力。一覧・Bases で絞り込みたい要求が出た時点で別途検討する
- メンション候補のオートコンプリート（入力補助）。別機能として切り出す
- スレッド対応・Base ファイル自動生成（ロードマップの残り2件）

---

## ユーザーワークフロー

```
本文:  @alice.bsky.social おはよう #朝活

【投稿されるもの】
  text   : "@alice.bsky.social おはよう #朝活"   ← テキストは一切変えない
  facets : mention(did:plc:xxxx) / tag(朝活)

【Bluesky での見た目】
  @alice.bsky.social が青いリンクになり、プロフィールへ飛べる

【履歴ノート（B）】
  ---
  bluesky_posted: true
  posted_at: 2026-08-25T17:30:00
  url: https://bsky.app/profile/.../post/...
  tags:
    - 朝活
  ---
  [@alice.bsky.social](https://bsky.app/profile/alice.bsky.social) おはよう
                    ↑ 案B。ハッシュタグは従来どおり frontmatter に昇格して本文から消える
```

解決できないハンドル（打ち間違い・退会済み・オフライン）は **facet を作らず平文のまま投稿する**。投稿そのものは絶対に止めない。

---

## ファイル変更一覧

| ファイル | 変更内容 |
|----------|----------|
| `main.ts` | 上記スコープ 1〜6 |
| `README.md` | ロードマップのメンション行を打ち消し線に |
| `README_JA.md` / `README_EN.md` | メンションの説明を追記（2-4節の近く） |
| `manifest.json` / `versions.json` / `package.json` | 0.7.0 へ bump（`npm version` 経由） |

`styles.css` の変更なし（UIを増やさないため）。`minAppVersion` は **1.11.5 のまま**（新しいAPIを使わない）。

---

## 詳細設計

### 1. 型追加（`main.ts:940-943` 付近）

```ts
type MentionFacetFeature = { $type: 'app.bsky.richtext.facet#mention'; did: string };
type Facet = {
	index: FacetByteRange;
	features: (LinkFacetFeature | TagFacetFeature | MentionFacetFeature)[];
};
```

### 2. `findMentionCandidates()`（モジュールスコープの純粋関数）

`URL_DETECTION_REGEX` / `HASHTAG_DETECTION_REGEX`（`main.ts:14-16`）の並びに定数を足し、検出だけを行う関数を**クラスの外**に置く。
ネットワークに触れない形にしておくことで、node ハーネス（`obsidian` をスタブ化した esbuild `--alias`。→ `plan` 外だがメモリの検証手順）で実機なしに網羅テストできる。v0.5.0 のコードフェンス不具合をリリース前に潰せたのと同じやり方。

```ts
const MENTION_DETECTION_REGEX = /(^|[\s(])@([a-zA-Z0-9][a-zA-Z0-9.-]*[a-zA-Z0-9])/g;
const MAX_HANDLE_LENGTH = 253;   // AT Protocol のハンドル長上限

type MentionCandidate = { handle: string; start: number; end: number };  // 文字単位
```

判定ルール:

1. `@` の直前は**行頭・空白・`(` のいずれか**。これで `foo@example.com`（メールアドレス）と `https://example.com/@user`（URL中の @）を除外する
2. 末尾の `.` は落とす（`@alice.bsky.social.` → `alice.bsky.social`）
3. **ドットを1つ以上含まないものは捨てる**（`@alice` はハンドルとして成立しない）
4. 全体が `MAX_HANDLE_LENGTH` を超えるものは捨てる
5. 全角 `＠` は対象外（Bluesky 本体の挙動に合わせる）

**実装上の落とし穴**: 直前1文字をキャプチャ `(^|[\s(])` で取っているため、`match.index` は**空白の位置**を指す。開始位置は必ず `match.index + match[1].length` から計算すること。ここを間違えると facet が1バイトずれて、直前の文字までリンクに巻き込まれる。

### 3. ハンドル解決とキャッシュ

```ts
private handleDidCache = new Map<string, string | null>();   // null = 解決失敗
```

- エンドポイント: `https://bsky.social/xrpc/com.atproto.identity.resolveHandle?handle=...`
  - **認証不要の公開エンドポイント**。ログイン前でも呼べる
  - 既存コードのホストが `bsky.social` で統一されているのでそれに合わせる（`main.ts:1422` 他）
- 通信は既存の `requestWithTimeout()`（`main.ts:1372`）を使い、**第2引数で 5000ms を明示的に渡す**
  - 既定の `effectiveTimeout` は 15秒（`main.ts:1364`）。打ち間違い1件で投稿が15秒止まるのは許容できない
- ユニークなハンドルだけを `Promise.all` で並列解決する。同一ハンドルを本文中に何度書いても**API呼び出しは1回**
- 解決失敗（404 / 400 / タイムアウト / オフライン）は `null` をキャッシュし、facet を作らない。`console` に出すだけで **Notice は出さない**
  - Notice を出すと locale 文字列が日英2言語ぶん必要になり、「新規文言ゼロ」という本件の利点が消える
  - 平文で投稿されること自体が利用者から見て十分わかりやすいフィードバックになる

キャッシュはプラグインのライフサイクル中のみ保持（永続化しない）。ハンドルは変更され得るので、Obsidian の再起動で自然に破棄されるくらいが妥当。

### 4. `detectFacets()` の async 化

```ts
async detectFacets(text: string, markdownLinks: MarkdownLink[] = []): Promise<Facet[] | undefined>
```

**本件で唯一の構造変更**。呼び出し元は `postToBluesky()` の `main.ts:1602` の**1箇所だけ**なので、`await` を1つ足せば済む。`postToBluesky()` はすでに async。

mention の検出は **URL・ハッシュタグの後**に走らせ、既存 facet と重なる候補は捨てる。

### 5. `reserved` 範囲の拡張

現状 `reserved` に入るのは **Markdown リンクの範囲だけ**（`main.ts:1477-1485`）。URL と タグは互いに衝突しないので今まで表面化していなかったが、mention は URL と重なり得る。

生成した link facet の範囲も `reserved` に push しておく（3行程度）。正規表現側で `@` の直前に空白を要求しているので大半は防げるが、**二重の保険**として入れる。範囲の重なった facet を送ると Bluesky 側でリンクが壊れる（既存コメント `main.ts:1468-1472` に記載のとおり）。

### 6. 履歴ノートのプロフィールリンク化（案B）

**適用先は履歴ノート（B）だけ。下書きノート（C）には適用しない。**

`markDraftAsPosted()` は「下書きは利用者の文章なので追記に留め、既存の本文には手を入れない」という方針で作られている（`main.ts:1927-1928`）。ここを書き換えるとその原則が崩れる。履歴ノートはプラグインが新規作成するノートなので、整形して構わない。

差し込み位置は `createPostHistoryNote()` の `stripHashtags()` の**後**（`main.ts:1894`）:

```ts
const body = tags.length > 0 ? stripHashtags(text, tags) : text;
const linkedBody = linkifyMentions(body);
```

- **候補検出は `body` に対してやり直す**。`text` の位置をそのまま使うと、タグ除去でずれたオフセットで置換して本文が壊れる
- 置換は**後ろから前へ**（先頭から置換すると以降の位置が全部ずれる）
- URL は `https://bsky.app/profile/{handle}`。**handle でも解決するので DID を持ち回る必要がない**（`at://` から表示用URLを組み立てている `main.ts:1667-1675` と同じ考え方）。結果として `PostResult` の型も `recordPostResult()` のシグネチャも**変更なし**で済む
- 二重リンク化の回避: `body` 内の `[表示](URL)` ・裸URL・`[[wikilink]]` の範囲を先に拾い、重なる候補は捨てる
  - 履歴ノートは**変換前の Markdown のまま**なので `convertMarkdownForPost()` は通せない（通すと本文が変換されてしまう）。軽量な範囲スキャンを別に用意する
- 画像のみの投稿では `body` が空。既存の空行制御（`main.ts:1911-1913`）に影響を与えないこと

`convertMarkdown` 設定のオン/オフは本件に影響しない。オフでも `@handle` はそのまま残るので mention facet は同じように作られる。

---

## 実装順序

1. 型追加（1）→ `findMentionCandidates()`（2）
2. node ハーネスで 2 のテストを通す（**ここで検出ロジックを確定させてから通信に進む**）
3. 解決＋キャッシュ（3）→ `detectFacets()` の async 化（4）→ `reserved` 拡張（5）
4. `linkifyMentions()`（6）と履歴ノートへの適用。node ハーネスでテスト
5. `npm run lint`（`eslint-plugin-obsidianmd`）→ `npm run build`
6. デスクトップ実機検証
7. iOS 実機検証（**同期対象外の vault にビルドを置いて検証する。Sync 経由でリリース前ビルドは配れない**）
8. README 3ファイル更新
9. bump とタグ push（後述）

---

## テスト計画

### node ハーネス（純粋関数）

`findMentionCandidates()`:

| 入力 | 期待 |
|------|------|
| `@alice.bsky.social おはよう` | 検出 |
| `foo@example.com` | 非検出（メールアドレス） |
| `https://example.com/@user` | 非検出（URL中） |
| `(@alice.bsky.social)` | 検出（`(` は許可） |
| `@alice.bsky.social.` | 検出、末尾ピリオドは含めない |
| `@alice` | 非検出（ドットなし） |
| `こんにちは@alice.bsky.social` | **非検出**（直前が空白でない。Bluesky 本体と同じ挙動） |
| `＠alice.bsky.social` | 非検出（全角） |
| 254文字のハンドル | 非検出（長さ上限） |
| `@a.b @a.b` | 2件検出、ハンドルは重複1件 |
| 日本語混じりでのバイト位置 | `byteStart`/`byteEnd` が正しい |

`linkifyMentions()`:

| 入力 | 期待 |
|------|------|
| `@alice.bsky.social #tag` をタグ除去した後 | 正しい位置に置換される |
| `[@alice.bsky.social](https://…)` | 二重リンクにしない |
| `![[image.png]]` を含む本文 | 壊さない |
| 空文字 | 空文字のまま |
| 同一ハンドル複数回 | すべて置換され、位置ずれが起きない |

### 実機（デスクトップ / iOS）

1. 実在ハンドル1件 → Bluesky上で青リンクになり、プロフィールへ飛べる
2. 存在しないハンドル → 平文のまま投稿され、**投稿は成功する**
3. 実在＋存在しない＋URL＋ハッシュタグの混在 → それぞれ正しく facet 化され、リンクが壊れていない
4. 機内モード（オフライン）で投稿 → メンションだけ平文になり、投稿処理自体はいつもどおり
5. 履歴ノートの本文が案Bの形式になっている
6. 下書きから投稿（C）→ **下書きノートの本文が書き換わっていないこと**
7. 文字数カウンターが投稿前後で変化しないこと（テキストを変えないので当然だが、念のため）

---

## 設計上の判断

| 論点 | 採用 | 理由 |
|------|------|------|
| 解決できないハンドル | 平文で投稿 | 打ち間違い1件で投稿を止めない |
| 失敗時の通知 | Notice を出さない（console のみ） | 出すと日英2言語の文言が必要になり「新規文言ゼロ」が崩れる |
| 設定でのON/OFF | 設ける必要なし | URL・ハッシュタグと同じく常時有効。`convertMarkdown` と違い、見た目が壊れる方向の副作用がない |
| DIDの持ち回り | しない | `bsky.app/profile/{handle}` が handle で解決するため。シグネチャ変更を回避できる |
| 履歴ノートへの記録方法 | 本文をプロフィールリンクに（案B） | 平文のまま残す案Aは0行で済むが、ノートから相手をたどれない。wikilink 案Cは未作成ノートが人数分増えて vault が荒れる |
| 下書きノート（C） | 対象外 | 「利用者の文章に手を入れない」既存方針を守る |
| タイムアウト | 5秒を明示 | 既定15秒では投稿が体感で止まる |

---

## 前提条件・注意事項

- `main.ts` を触ったら **push 前に必ず `npm run lint`**。`eslint-plugin-obsidianmd` で Obsidian 側のスキャンを手元再現できる
- 新しい Obsidian API は使わないので `requireApiVersion()` ガードは不要。`minAppVersion` も据え置き
- **bump とタグ push は1コマンドで連結する**。分離するとコミュニティ一覧から delist される（v0.3.0 以降4回連続で回避に成功している手順）
- `release.yml` は draft 作成で止まるので、**GitHub 上での公開操作が必須**
- リリース後、Obsidian の Reviews が Completed になり `community-plugins.json` に `post-to-bluesky` が残っていることを確認する

---

## 工数見積もり

| # | 作業 | 規模 |
|---|------|------|
| 1 | 型追加 | 2行 |
| 2 | `findMentionCandidates()` | 20行 |
| 3 | 解決＋キャッシュ＋タイムアウト | 30行 |
| 4 | `detectFacets()` async 化 | 15行 |
| 5 | `reserved` 拡張 | 3行 |
| 6 | `linkifyMentions()` + 履歴ノート適用 | 15〜20行 |
| | **合計** | **90〜110行** |

新規UI・新規設定・ロケール文字列は**ゼロ**。2 と 6 は純粋関数なので、実装量の約4割は実機なしでテストできる。
