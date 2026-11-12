# 実装計画書: メンション対応（`@handle`）+ 履歴ノートのプロフィールリンク化

作成日: 2026-08-25
更新日: 2026-11-12（`main.ts` の分割後のファイル構成に合わせて全面改訂）
対象バージョン: v0.6.0 → v0.7.0
実装状況: 実装済み（`acbfca1`）。node テスト・デスクトップ実機とも確認済みで、v0.7.0 として公開。行番号はすべて着手前の `c9609a8` 時点

---

## 背景・目的

- 本文に `@alice.bsky.social` と書いても、今は**平文のまま投稿される**。`detectFacets()`（`src/facets.ts:13`）が link と tag の facet しか作っていないため
- Bluesky の投稿レコードが持てる facet は `link` / `mention` / `tag` の3種。うち**未実装なのは mention だけ**で、装飾用の facet は規格に無い（→ README_JA/EN 2-4節「BlueskyでのMarkdown記法の見え方」）。本件で、**規格上できることはすべて対応した状態**になる
- ロードマップ（`README.md:112`）の未着手3件のうち、実装コストが最も小さいので先頭に置いている

あわせて、履歴ノートに残る `@handle` を Obsidian 上からもたどれるようにする（後述の「案B」）。

### 2026-11-12 の改訂で変えた点

`main.ts` を `src/` に分割した（`docs/plan-refactor-split-main.md`）ことに合わせて、次の3点を変えた。

| 項目 | 旧計画 | 新計画 | 理由 |
|------|--------|--------|------|
| `detectFacets()` | async 化する | **同期のまま**。解決済みの handle→DID 表を引数で受け取る | 分割で `detectFacets` が純粋関数になった。通信を外に出せば、node ハーネスで mention facet まで網羅テストできる |
| ハンドル解決の置き場所 | プラグインのメソッド | `BlueskyClient.resolveHandles()` | 通信はすべて `BlueskyClient` に集めたため |
| タイムアウトの指定 | `requestWithTimeout()` の第2引数 | 同じ。ただし**この引数を戻す作業が要る** | 分割時に、使われていなかった第2引数を削除したため |

**`authedRequest` は使わない。** `resolveHandle` は認証不要の公開エンドポイント。`authedRequest` を通すと、未ログイン時にログインが走り、401 では再ログインが走ってしまう。

---

## スコープ

| # | 内容 | 場所 | 種別 |
|---|------|------|------|
| 1 | `MentionFacetFeature` 型の追加 | `src/bluesky.ts` | 型 |
| 2 | `findMentionCandidates()`：本文からメンション候補を抽出する純粋関数 | `src/mentions.ts`（新規） | 新規 |
| 3 | `requestWithTimeout()` にタイムアウト引数を戻す。`resolveHandles()` で DID を解決し、セッション内でキャッシュする | `src/bluesky-client.ts` | 新規・既存改修 |
| 4 | `detectFacets()` に handle→DID 表を渡し、mention facet を作る | `src/facets.ts` | 既存改修 |
| 5 | `reserved` 範囲に、作った link facet も含める（範囲の衝突を防ぐ） | `src/facets.ts` | 既存改修 |
| 6 | `postToBluesky()` で、解決してから `detectFacets()` を呼ぶ | `main.ts` | 既存改修 |
| 7 | 履歴ノート本文の `@handle` をプロフィールリンクに変える（案B） | `src/mentions.ts` / `main.ts` | 新規 |
| 8 | README 3ファイルの更新（ロードマップ行の打ち消し＋説明の追加） | ドキュメント | ドキュメント |

**スコープ外**

- 新規UI・新規設定・ロケール文字列の追加（**本件では1件も増やさない**）
- 下書きノート（C）の本文書き換え。理由は「詳細設計 7」を参照
- frontmatter への `mentions:` 出力。一覧や Bases で絞り込みたいという要望が出た時点で別途検討する
- メンション候補のオートコンプリート（入力補助）。別の機能として切り出す
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
                    ↑ 案B。ハッシュタグは従来どおり frontmatter に移り、本文から消える
```

解決できないハンドル（打ち間違い・退会済み・オフライン）は **facet を作らず平文のまま投稿する**。投稿そのものは絶対に止めない。

---

## ファイル変更一覧

| ファイル | 変更内容 |
|----------|----------|
| `src/mentions.ts`（新規） | `findMentionCandidates()`・`linkifyMentions()` と関連する定数（スコープ 2・7） |
| `src/bluesky.ts` | `MentionFacetFeature` 型（スコープ 1） |
| `src/bluesky-client.ts` | タイムアウト引数の復活・`resolveHandles()`（スコープ 3） |
| `src/facets.ts` | mention facet の生成・`reserved` の拡張（スコープ 4・5） |
| `main.ts` | `postToBluesky()`・`createPostHistoryNote()` の呼び出し追加（スコープ 6・7） |
| `README.md` | ロードマップのメンション行を打ち消し線に |
| `README_JA.md` / `README_EN.md` | メンションの説明を追記（2-4節の近く） |
| `manifest.json` / `versions.json` / `package.json` | 0.7.0 へ bump（`npm version` 経由） |

`styles.css` は変更なし（UIを増やさないため）。`minAppVersion` は **1.11.5 のまま**（新しいAPIを使わない）。

---

## 詳細設計

### 1. 型の追加（`src/bluesky.ts:52-55`）

```ts
export type MentionFacetFeature = { $type: 'app.bsky.richtext.facet#mention'; did: string };
export type Facet = {
	index: FacetByteRange;
	features: (LinkFacetFeature | TagFacetFeature | MentionFacetFeature)[];
};
```

### 2. `findMentionCandidates()`（`src/mentions.ts`）

URL・ハッシュタグの正規表現は `src/text.ts:13-17` にある。メンションは検出と履歴ノートの書き換えで使い回すので、専用のファイル `src/mentions.ts` にまとめる。ネットワークに触れない純粋関数なので、node ハーネス（`obsidian` をスタブにして esbuild でバンドル）で実機なしに網羅テストできる。

```ts
const MENTION_DETECTION_REGEX = /(^|[\s(])@([a-zA-Z0-9][a-zA-Z0-9.-]*[a-zA-Z0-9])/g;
const MAX_HANDLE_LENGTH = 253;   // AT Protocol のハンドル長の上限

export type MentionCandidate = { handle: string; start: number; end: number };  // 文字単位。start は @ の位置
```

判定ルール:

1. `@` の直前は**行頭・空白・`(` のいずれか**。これで `foo@example.com`（メールアドレス）と `https://example.com/@user`（URL中の @）を除外する
2. 末尾の `.` は落とす（`@alice.bsky.social.` → `alice.bsky.social`）。正規表現の末尾が英数字なので自然にそうなるが、テストで確かめる
3. **ドットを1つも含まないものは捨てる**（`@alice` はハンドルとして成立しない）
4. 全体が `MAX_HANDLE_LENGTH` を超えるものは捨てる
5. 全角の `＠` は対象外（Bluesky 本体の挙動に合わせる）
6. ハンドルは大文字小文字を区別しないので、`handle` は**小文字にそろえて**返す（キャッシュと DID 表のキーに使うため）

**実装上の落とし穴**: 直前の1文字を `(^|[\s(])` で捕捉しているので、`match.index` は**空白の位置**を指す。開始位置は必ず `match.index + match[1].length` で計算すること。ここを間違えると facet が1バイトずれ、直前の文字までリンクに巻き込まれる。

### 3. タイムアウト引数の復活とハンドル解決（`src/bluesky-client.ts`）

**3-1 タイムアウト引数を戻す（`src/bluesky-client.ts:61-62`）**

```ts
private async requestWithTimeout(params: RequestUrlParam, timeoutMs?: number): Promise<RequestUrlResponse> {
	const duration = timeoutMs ?? Math.max(1000, this.host.getTimeoutMs());
```

既定のタイムアウトは設定値（初期値 15 秒）。打ち間違い1件で投稿が15秒止まるのは許容できないので、解決は **5000ms** を明示して呼ぶ。

**3-2 `resolveHandles()`**

```ts
private readonly handleDidCache = new Map<string, string | null>();   // null = 解決失敗

/** 解決できたハンドルだけを handle→DID の表で返す。失敗しても例外は投げない */
async resolveHandles(handles: string[]): Promise<Map<string, string>>
```

- エンドポイントは `${XRPC_BASE}/com.atproto.identity.resolveHandle?handle=...`。`XRPC_BASE`（`src/bluesky-client.ts:6`）は `bsky.social` に統一されているので、それに合わせる
  - **認証不要の公開エンドポイント**なので、ログイン前でも呼べる。`authedRequest` は通さない
  - `handle` は `encodeURIComponent` してから付ける
- ユニークなハンドルだけを `Promise.all` で並列に解決する。同じハンドルを本文に何度書いても、**API呼び出しは1回**
- 解決に失敗した場合（404 / 400 / タイムアウト / オフライン）は `null` をキャッシュし、facet を作らない。`console` に出すだけで **Notice は出さない**
  - Notice を出すと locale 文字列が日英2言語分必要になり、「新規文言ゼロ」という本件の利点が消える
  - 平文のまま投稿されること自体が、利用者には十分わかりやすいフィードバックになる
- **オフラインでの失敗はキャッシュしない**（ステータスが取れなかったもの＝例外・タイムアウト）。通信が戻った次の投稿で解決し直せるようにするため。404 / 400 は「そのハンドルは存在しない」という確定した結果なので、キャッシュする

キャッシュはプラグインが動いている間だけ保持し、永続化しない。ハンドルは変更され得るので、Obsidian の再起動で破棄されるくらいが妥当。

### 4. `detectFacets()` に DID 表を渡す（`src/facets.ts:13`）

```ts
export function detectFacets(
	text: string,
	markdownLinks: MarkdownLink[] = [],
	mentionDids: ReadonlyMap<string, string> = new Map()
): Facet[] | undefined
```

- **同期のまま**。第3引数は省略できるので、既存の呼び出しはそのまま動く
- mention の検出は **URL・ハッシュタグの後**に行い、既存の facet と重なる候補は捨てる
- 候補の `handle` が `mentionDids` に無ければ facet を作らない（＝平文のまま）

### 5. `reserved` 範囲の拡張（`src/facets.ts:17-25`）

今の `reserved` には **Markdown リンクの範囲しか入っていない**。URL とタグは互いに衝突しないので問題にならなかったが、mention は URL と重なり得る。

作った link facet の範囲も `reserved` に push する（3行程度）。正規表現で `@` の直前に空白を要求しているので大半は防げるが、**二重の保険**として入れる。範囲の重なった facet を送ると Bluesky 側でリンクが壊れる（`src/facets.ts:10` のコメントのとおり）。

### 6. `postToBluesky()` の変更（`main.ts:188-202`）

```ts
const handles = [...new Set(findMentionCandidates(text).map((m) => m.handle))];
const mentionDids = handles.length > 0 ? await this.client.resolveHandles(handles) : new Map<string, string>();
const facets = detectFacets(text, markdownLinks, mentionDids);
```

- 候補の検出は、**投稿する `text`（Markdown 変換後）**に対して行う。facet のバイト位置はこのテキストが基準なので
- 解決は空チェック・文字数チェック（`main.ts:189-196`）の**後**に置く。投稿できない本文のために通信しない
- メンションが無い本文では通信が発生しない

### 7. 履歴ノートのプロフィールリンク化（案B）

**適用先は履歴ノート（B）だけ。下書きノート（C）には適用しない。**

`markDraftAsPosted()`（`main.ts:478`）は、「下書きは利用者の文章なので追記に留め、既存の本文には手を入れない」という方針で作られている（`main.ts:483-484` のコメント）。ここを書き換えるとその原則が崩れる。履歴ノートはプラグインが新規に作るノートなので、整形して構わない。

差し込み位置は、`createPostHistoryNote()` の `stripHashtags()` の**後**（`main.ts:450`）:

```ts
const body = tags.length > 0 ? stripHashtags(text, tags) : text;
const linkedBody = linkifyMentions(body);
```

- `linkifyMentions(body)` は `src/mentions.ts` に置く純粋関数。**候補の検出は `body` に対してやり直す**。`text` の位置をそのまま使うと、タグ除去でずれた位置で置換してしまい、本文が壊れる
- 置換は**後ろから前へ**行う（先頭から置換すると、以降の位置がすべてずれる）
- URL は `https://bsky.app/profile/{handle}`。**handle でも開けるので、DID を持ち回る必要がない**。at:// URI から表示用URLを組み立てる `buildPostUrl()`（`main.ts:226`）と同じ考え方。そのため `PostResult` の型も `recordPostResult()` のシグネチャも**変更なし**で済む
- 解決できたかどうかに関係なく、形が合えばリンクにする。履歴ノートを作る時点では DID 表を持ち回っていないため。存在しないハンドルのリンクは、開くと bsky.app の「見つかりません」になるだけで害はない
- 二重のリンク化を避ける: `body` 内の `[表示](URL)`・裸のURL・`[[wikilink]]`・`` `コード` `` の範囲を先に拾い、重なる候補は捨てる
  - 履歴ノートは**変換前の Markdown のまま**なので、`convertMarkdownForPost()` は通せない（通すと本文まで変換されてしまう）。軽量な範囲スキャンを別に用意する
- 画像のみの投稿では `body` が空になる。既存の空行の制御（`main.ts:469`）に影響を与えないこと（`linkifyMentions('')` は `''` を返す）
- 既知の差: Markdown 変換をオンにして `**@alice.bsky.social**` と書くと、投稿側では変換後に `@` の直前が空白になるので mention になる。一方、履歴ノート側は `*` が直前にあるのでリンクにならない。実害が小さいので、ルールを増やしてまで揃えない

`convertMarkdown` 設定のオン/オフは、検出の仕組みには影響しない。オフでも `@handle` はそのまま残るので、mention facet は同じように作られる。

---

## 実装順序

1. 型追加（1）→ `findMentionCandidates()`（2）
2. node ハーネスで 2 のテストを通す（**ここで検出ロジックを確定させてから通信に進む**）
3. `detectFacets()` の拡張（4）と `reserved` の拡張（5）。DID 表を手で渡して、node ハーネスでバイト位置まで確認する
4. タイムアウト引数の復活と `resolveHandles()`（3）。`postToBluesky()` への組み込み（6）。`requestUrl` のスタブで、成功・404・タイムアウト・同一ハンドルの重複を確認する
5. `linkifyMentions()` と履歴ノートへの適用（7）。node ハーネスでテスト
6. `npm run lint`（`eslint-plugin-obsidianmd`、`src/` も対象）→ `npm run build`
7. デスクトップ実機での検証（検証用 vault `C:\Users\kapa3\Obsidian\emdash-test`）
8. iOS 実機での検証（**同期しない vault にビルドを置いて検証する。リリース前のビルドは Sync では配れない**）
9. README 3ファイルの更新
10. bump とタグ push（後述）

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
| `@alice.bsky.social.` | 検出。末尾のピリオドは含めない |
| `@alice` | 非検出（ドットなし） |
| `こんにちは@alice.bsky.social` | **非検出**（直前が空白でない。Bluesky 本体と同じ挙動） |
| `＠alice.bsky.social` | 非検出（全角） |
| 254文字のハンドル | 非検出（長さの上限） |
| `@a.b @a.b` | 2件検出。ハンドルの重複除去後は1件 |
| `@Alice.Bsky.Social` | 検出。`handle` は小文字 |

`detectFacets()`（DID 表を手で渡す）:

| 入力 | 期待 |
|------|------|
| 日本語まじりの本文 | mention の `byteStart` / `byteEnd` が正しい |
| DID 表に無いハンドル | mention facet なし |
| URL・タグ・mention の混在 | 3種が正しく並び、範囲が重ならない |
| `[@alice.bsky.social](https://…)`（Markdown 変換後） | link facet だけ。mention は作らない |
| 第3引数を省略 | 既存の結果と完全に一致する（リファクタリング時のベースラインと突き合わせる） |

`resolveHandles()`（`requestUrl` のスタブ）:

| 状況 | 期待 |
|------|------|
| 成功 | 表に DID が入る |
| 404 / 400 | 表に入らない。2回目の投稿では通信しない（キャッシュ） |
| タイムアウト・例外 | 表に入らない。2回目の投稿では解決し直す |
| 同じハンドルを3回 | 通信は1回 |
| 未ログイン | ログインが走らない（`createSession` が呼ばれない） |

`linkifyMentions()`:

| 入力 | 期待 |
|------|------|
| `@alice.bsky.social #tag` をタグ除去した後 | 正しい位置で置換される |
| `[@alice.bsky.social](https://…)` | 二重リンクにしない |
| `![[image.png]]` を含む本文 | 壊さない |
| `` `@alice.bsky.social` `` | コード内は置換しない |
| 空文字 | 空文字のまま |
| 同じハンドルが複数回 | すべて置換され、位置ずれが起きない |

### 実機（デスクトップ / iOS）

1. 実在するハンドル1件 → Bluesky 上で青いリンクになり、プロフィールへ飛べる
2. 存在しないハンドル → 平文のまま投稿され、**投稿は成功する**
3. 実在＋存在しない＋URL＋ハッシュタグの混在 → それぞれ正しく facet になり、リンクが壊れていない
4. 機内モード（オフライン）で投稿 → 投稿自体が失敗する（いつもどおり）。メンションの解決が原因で固まったり、余計な通知が出たりしない
5. 履歴ノートの本文が案Bの形式になっている
6. 下書きから投稿（C）→ **下書きノートの本文が書き換わっていないこと**
7. 文字数カウンターが投稿前後で変化しないこと（テキストを変えないので当然だが、念のため）

---

## 設計上の判断

| 論点 | 採用 | 理由 |
|------|------|------|
| 解決できないハンドル | 平文で投稿 | 打ち間違い1件で投稿を止めない |
| 失敗時の通知 | Notice を出さない（console のみ） | 出すと日英2言語の文言が必要になり、「新規文言ゼロ」が崩れる |
| 設定でのON/OFF | 設けない | URL・ハッシュタグと同じく常に有効。`convertMarkdown` と違い、見た目が壊れる方向の副作用がない |
| `detectFacets()` の形 | 同期のまま。DID 表を受け取る | 通信を外に出せば純粋関数のまま網羅テストできる。呼び出し元の変更も最小で済む |
| 解決の経路 | `requestWithTimeout` を直接使う | 公開エンドポイントなので、`authedRequest` のログイン・再ログインは不要で害になる |
| 失敗のキャッシュ | 404/400 だけ。通信失敗はしない | オフラインから戻った後も解決できるようにする |
| DIDの持ち回り | しない | `bsky.app/profile/{handle}` が handle で開けるため。シグネチャの変更を避けられる |
| 履歴ノートへの記録方法 | 本文をプロフィールリンクに（案B） | 平文のまま残す案Aは0行で済むが、ノートから相手をたどれない。wikilink にする案Cは、未作成のノートが人数分増えて vault が散らかる |
| 下書きノート（C） | 対象外 | 「利用者の文章に手を入れない」という既存の方針を守る |
| タイムアウト | 5秒を明示 | 既定の15秒では、投稿が止まったように感じる |

---

## 前提条件・注意事項

- コードを触ったら **push 前に必ず `npm run lint`**。`eslint-plugin-obsidianmd` で Obsidian 側のスキャンを手元で再現できる（対象は `main.ts` と `src/`）
- 新しい Obsidian API は使わないので、`requireApiVersion()` のガードは不要。`minAppVersion` も据え置き
- **bump とタグ push は1コマンドで連結する**。分けるとコミュニティ一覧から外される（v0.3.0 以降4回連続でこの手順で回避している）
- `release.yml` は draft の作成で止まるので、**GitHub 上での公開操作が必須**
- リリース後、Obsidian の Reviews が Completed になり、`community-plugins.json` に `post-to-bluesky` が残っていることを確認する
- 本リリースには、リファクタリング（PR #11）の変更も含まれる。リリースノートに、利用者から見える変更（英語環境でのエラー文言・ログイン失敗の表示）も書く

---

## 工数見積もり

| # | 作業 | 規模 |
|---|------|------|
| 1 | 型追加 | 2行 |
| 2 | `findMentionCandidates()` | 25行 |
| 3 | タイムアウト引数＋`resolveHandles()`＋キャッシュ | 35行 |
| 4・5 | `detectFacets()` の拡張＋`reserved` の拡張 | 20行 |
| 6 | `postToBluesky()` への組み込み | 3行 |
| 7 | `linkifyMentions()`（範囲スキャン込み）＋履歴ノートへの適用 | 35行 |
| | **合計** | **約120行** |

旧見積もり（90〜110行）より少し増える。増えるのは、`resolveHandles()` のキャッシュ方針（通信失敗はキャッシュしない）と、`linkifyMentions()` のコード範囲の除外を明文化した分。新規UI・新規設定・ロケール文字列は**ゼロ**。通信の部分も `requestUrl` のスタブで試せるので、実機が必要なのは Bluesky 上の見た目と履歴ノートの確認だけになる。
