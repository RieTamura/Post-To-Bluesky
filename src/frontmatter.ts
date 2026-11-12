import { App, normalizePath, moment, TFile } from 'obsidian';

/**
 * ノート先頭の frontmatter ブロック。metadataCache が使えない・当てにできない場面で
 * 本文と frontmatter を切り分けるために使う。
 */
export const FRONTMATTER_BLOCK_REGEX = /^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/;

/**
 * frontmatter の値を下書き判定用に文字列化する。
 * 配列やオブジェクトが紛れ込んでも "[object Object]" のような無意味な文字列にせず、
 * 判定値と一致し得ない空文字を返す。
 */
export function frontmatterValueToString(value: unknown): string {
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	return '';
}

/**
 * frontmatter の値が下書き判定値と一致するか（配列の場合は要素のいずれかが一致するか）。
 * 下書き一覧のフィルタと投稿後の下書き値の削除で**同じ判定を使う**ための共通関数。
 * 別々に実装すると片方だけずれて「投稿したのに一覧から消えない」事故になる。
 */
export function frontmatterMatchesValue(value: unknown, target: string): boolean {
	if (!target || value === undefined || value === null) return false;
	if (Array.isArray(value)) return (value as unknown[]).some((v) => frontmatterValueToString(v) === target);
	return frontmatterValueToString(value) === target;
}

// 紐づけ先の設定値に書ける日付変数。デイリーノートやテンプレートのコアプラグインと同じ記法
export const TEMPLATE_PLACEHOLDER_REGEX = /\{\{(date|time)(?::([^}]*))?\}\}/g;
export const DEFAULT_DATE_FORMAT = 'YYYY-MM-DD';
export const DEFAULT_TIME_FORMAT = 'HH:mm';

/** 設定値に日付変数が含まれているか（＝紐づけ先が投稿ごとに変わり得るか） */
export function hasTemplatePlaceholder(value: string): boolean {
	return new RegExp(TEMPLATE_PLACEHOLDER_REGEX.source).test(value);
}

/**
 * 紐づけ先の設定値に含まれる {{date}} / {{time}} を投稿日時で展開する。
 * 書式は moment の記法で、既定は Obsidian コアのテンプレート設定に合わせている
 * （{{date}} = YYYY-MM-DD、{{time}} = HH:mm）。moment は obsidian が re-export
 * しているので追加依存は不要。
 */
export function expandDateTemplate(template: string, date: Date): string {
	const stamp = moment(date);
	return template.replace(new RegExp(TEMPLATE_PLACEHOLDER_REGEX.source, 'g'), (_match, kind: string, format?: string) => {
		const fallback = kind === 'time' ? DEFAULT_TIME_FORMAT : DEFAULT_DATE_FORMAT;
		return stamp.format(format?.trim() || fallback);
	});
}

/**
 * 紐づけ先ノートへの wikilink を組み立てる。
 * frontmatter 内で Obsidian がリンクとして解決するのは wikilink 形式だけなので、
 * 利用者の「[[Wikilinks]]を使用」設定に従う generateMarkdownLink() は使わない。
 * 同名ノートの取り違えを避けるため、拡張子を除いたフルパスで書く。
 */
export function buildFrontmatterWikiLink(path: string): string {
	return `[[${stripMarkdownExtension(path)}]]`;
}

/** wikilink には拡張子を書かないので取り除く */
export function stripMarkdownExtension(path: string): string {
	return path.endsWith('.md') ? path.slice(0, -('.md'.length)) : path;
}

/**
 * wikilink をYAMLとして安全な形にする。
 * `[[...]]` は引用符で囲まないとフローシーケンス（ネストした配列）として解釈され、
 * frontmatter 全体が壊れる。ノート名には引用符も入り得るのでエスケープも行う。
 */
export function toYamlLink(link: string): string {
	return `"${link.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * 設定に保存された紐づけ先パスからノートを引く。空欄は「紐づけなし」。
 * 選択UIはフルパスを保存するが、手入力では拡張子が抜けたパス（"Bluesky MOC"）が
 * 起きやすいので、そのままで見つからなければ .md を補って一度だけ再試行する。
 */
export function findNoteByPath(app: App, rawPath: string): TFile | null {
	const path = rawPath?.trim();
	if (!path) return null;
	const normalized = normalizePath(path);
	return app.vault.getFileByPath(normalized) ?? app.vault.getFileByPath(`${normalized}.md`);
}

/**
 * frontmatter の紐づけプロパティにリンクを追加する。
 * 利用者が既に別の値を入れている可能性があるため**上書きはせず**、既存値を残したまま
 * 配列に追加する（履歴ノートの tags を下書き側に適用しないのと同じ理由）。
 * 同じリンクが既にあれば何もしないので、同じノートから再投稿しても重複しない。
 */
export function addFrontmatterLink(frontmatter: Record<string, unknown>, key: string, link: string): void {
	const current: unknown = frontmatter[key];
	if (current === undefined || current === null || current === '') {
		frontmatter[key] = link;
		return;
	}
	const existing = Array.isArray(current) ? (current as unknown[]) : [current];
	if (existing.some((v) => frontmatterValueToString(v) === link)) return;
	frontmatter[key] = [...existing, link];
}

// 履歴ノート(B)の種別を示す frontmatter 値
export const POSTED_FRONTMATTER_VALUE = 'bluesky-posted';
// 投稿済みを示す真偽値プロパティ。Obsidian の Properties UI ではチェックボックスとして表示される。
// 下書きノートは draftProperty から下書き値が取り除かれ、代わりにこれが true になって下書き一覧から外れる
export const POSTED_CHECKBOX_PROPERTY = 'bluesky_posted';
