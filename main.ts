import { Notice, App, Modal, ButtonComponent, Setting, TextComponent, PluginSettingTab, requestUrl, setIcon, Plugin, getLanguage, AbstractInputSuggest, FuzzySuggestModal, Menu, getLinkpath, normalizePath, requireApiVersion, moment, TFile, TFolder, Modifier } from 'obsidian';
import type { RequestUrlParam, RequestUrlResponse, SettingDefinitionItem } from 'obsidian';

// 統一された絵文字リスト（複数箇所の重複定義を解消）
const EMOJI_LIST: string[] = [
	'😀','😄','😁','😂','🤣','😅','😊','🙂','😉','😍','🥰','😘','😙','😚','😋','😜','😝','😎','🤓','🤔','🤨','😐','😑','😶','🙄','😮','😲','🥱','😴','🤤','😭','😤','😡','🤯','😳','🥶','🥳','🤩','😇','😷','🤒','🤕','🤢','🤮','🤧',
	'👍','👎','👌','✌️','🤞','🤟','🤘','🤙','👏','🙌','👐','✋','🤚','👋','🤏','💪','🫶','🫰',
	'😺','😸','😹','😻','😼','😽','🙀','😿','😾',
	'❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','❣️','💕','💞','💓','💗','💖','💘','💝','💤','💢','✨','⚡','🔥','⭐','🌟','💫','🎊','🎈',
	'📝','🖊️','📎','📌','📚','💡','🖥️','📱','⌚','🕹️','🎮','🎵','🎶','🎧','🎤','🎬','📷','🗓️','⏰','📦',
	'🌞','🌙','☁️','🌧️','🌈','❄️','🌸','🌻','🍀','🍎','🍊','🍋','🍇','🍓','🥝','🥑','🍙','🍣','🍜','☕','🍺','🍻','🥂'
];

const URL_DETECTION_REGEX = /https?:\/\/[^\s<>()\]{}"']+/g;
const TRAILING_PUNCT_REGEX = /[\])}.,!?]+$/;
const HASHTAG_DETECTION_REGEX = /#[\w\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]+/g;
// Bluesky のタグ長上限
const MAX_TAG_LENGTH = 64;

function createUrlRegex(): RegExp {
	return new RegExp(URL_DETECTION_REGEX.source, 'g');
}

function createHashtagRegex(): RegExp {
	return new RegExp(HASHTAG_DETECTION_REGEX.source, 'g');
}

// 本文からタグを取り除く用。前後の空白ごと消せるよう、タグ本体を捕捉グループにする
function createHashtagStripRegex(): RegExp {
	return new RegExp(`[ \\t]*(${HASHTAG_DETECTION_REGEX.source})[ \\t]*`, 'g');
}

function trimTrailingPunctuation(url: string): string {
	return url.replace(TRAILING_PUNCT_REGEX, '');
}

function extractFirstUrl(text: string): string | null {
	const regex = new RegExp(URL_DETECTION_REGEX.source);
	const match = regex.exec(text);
	return match ? trimTrailingPunctuation(match[0]) : null;
}

/**
 * 本文からハッシュタグを抽出する（先頭の # は除去）。
 * Bluesky に facet として送るタグと同じ条件で抽出するため、履歴ノートの tags と
 * 実際の投稿タグが一致する。大文字小文字違いの重複は最初の表記を残して除去する。
 */
function extractHashtags(text: string): string[] {
	const regex = createHashtagRegex();
	const seen = new Set<string>();
	const tags: string[] = [];
	let match: RegExpExecArray | null;
	while ((match = regex.exec(text)) !== null) {
		const tag = match[0].slice(1);
		if (countGraphemes(tag) > MAX_TAG_LENGTH) continue;
		const key = tag.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		tags.push(tag);
	}
	return tags;
}

/**
 * 履歴ノートの本文からハッシュタグを取り除く。frontmatter の tags に昇格したタグだけを
 * 対象にするため、tags に入らなかったタグ（長すぎる等）は本文に残る。
 * タグだけで構成されていた行は行ごと削除し、元から空だった行は段落区切りとして残す。
 */
function stripHashtags(text: string, tags: string[]): string {
	const promoted = new Set(tags.map((tag) => tag.toLowerCase()));
	// 単語同士がくっつくのを避けたい欧文だけ空白を1つ残す（和文は詰める）
	const needsSpace = (char: string | undefined) => char !== undefined && /[\x21-\x7E]/.test(char);
	const kept: string[] = [];
	for (const line of text.split('\n')) {
		const stripped = line
			.replace(createHashtagStripRegex(), (match: string, tagToken: string, offset: number, whole: string) => {
				if (!promoted.has(tagToken.slice(1).toLowerCase())) return match;
				return needsSpace(whole[offset - 1]) && needsSpace(whole[offset + match.length]) ? ' ' : '';
			})
			.trimEnd();
		// タグ除去の結果だけで空になった行は落とす
		if (stripped.trim() === '' && line.trim() !== '') continue;
		kept.push(stripped);
	}
	return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * frontmatter に書き出すタグをYAMLとして安全な形にする。
 * 数字始まりのタグ（例: 2026、1_000）は引用符で囲まないと数値として解釈される。
 * タグに使える文字は HASHTAG_DETECTION_REGEX で制限されているため引用符の
 * エスケープは不要。
 */
function toYamlTag(tag: string): string {
	return /^[A-Za-z_\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(tag) ? tag : `"${tag}"`;
}

/**
 * frontmatter の値を下書き判定用に文字列化する。
 * 配列やオブジェクトが紛れ込んでも "[object Object]" のような無意味な文字列にせず、
 * 判定値と一致し得ない空文字を返す。
 */
function frontmatterValueToString(value: unknown): string {
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	return '';
}

/**
 * frontmatter の値が下書き判定値と一致するか（配列の場合は要素のいずれかが一致するか）。
 * 下書き一覧のフィルタと投稿後の下書き値の削除で**同じ判定を使う**ための共通関数。
 * 別々に実装すると片方だけずれて「投稿したのに一覧から消えない」事故になる。
 */
function frontmatterMatchesValue(value: unknown, target: string): boolean {
	if (!target || value === undefined || value === null) return false;
	if (Array.isArray(value)) return (value as unknown[]).some((v) => frontmatterValueToString(v) === target);
	return frontmatterValueToString(value) === target;
}

// 紐づけ先の設定値に書ける日付変数。デイリーノートやテンプレートのコアプラグインと同じ記法
const TEMPLATE_PLACEHOLDER_REGEX = /\{\{(date|time)(?::([^}]*))?\}\}/g;
const DEFAULT_DATE_FORMAT = 'YYYY-MM-DD';
const DEFAULT_TIME_FORMAT = 'HH:mm';

/** 設定値に日付変数が含まれているか（＝紐づけ先が投稿ごとに変わり得るか） */
function hasTemplatePlaceholder(value: string): boolean {
	return new RegExp(TEMPLATE_PLACEHOLDER_REGEX.source).test(value);
}

/**
 * 紐づけ先の設定値に含まれる {{date}} / {{time}} を投稿日時で展開する。
 * 書式は moment の記法で、既定は Obsidian コアのテンプレート設定に合わせている
 * （{{date}} = YYYY-MM-DD、{{time}} = HH:mm）。moment は obsidian が re-export
 * しているので追加依存は不要。
 */
function expandDateTemplate(template: string, date: Date): string {
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
function buildFrontmatterWikiLink(path: string): string {
	return `[[${stripMarkdownExtension(path)}]]`;
}

/** wikilink には拡張子を書かないので取り除く */
function stripMarkdownExtension(path: string): string {
	return path.endsWith('.md') ? path.slice(0, -('.md'.length)) : path;
}

/**
 * wikilink をYAMLとして安全な形にする。
 * `[[...]]` は引用符で囲まないとフローシーケンス（ネストした配列）として解釈され、
 * frontmatter 全体が壊れる。ノート名には引用符も入り得るのでエスケープも行う。
 */
function toYamlLink(link: string): string {
	return `"${link.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * 設定に保存された紐づけ先パスからノートを引く。空欄は「紐づけなし」。
 * 選択UIはフルパスを保存するが、手入力では拡張子が抜けたパス（"Bluesky MOC"）が
 * 起きやすいので、そのままで見つからなければ .md を補って一度だけ再試行する。
 */
function findNoteByPath(app: App, rawPath: string): TFile | null {
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
function addFrontmatterLink(frontmatter: Record<string, unknown>, key: string, link: string): void {
	const current: unknown = frontmatter[key];
	if (current === undefined || current === null || current === '') {
		frontmatter[key] = link;
		return;
	}
	const existing = Array.isArray(current) ? (current as unknown[]) : [current];
	if (existing.some((v) => frontmatterValueToString(v) === link)) return;
	frontmatter[key] = [...existing, link];
}

/** Bluesky に添付できる枚数の上限 */
const MAX_IMAGES = 4;

/**
 * 添付候補として扱う画像の拡張子。
 * createImageBitmap() でデコードできる形式に限っている（svg はデコードに失敗するため除く）。
 */
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp']);

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	avif: 'image/avif',
	bmp: 'image/bmp'
};

function isImageFile(file: TFile): boolean {
	return IMAGE_EXTENSIONS.has(file.extension.toLowerCase());
}

/** vault 内の画像を新しい順に返す。直前に保存した画像を添付することが多いため */
function getVaultImages(app: App): TFile[] {
	return app.vault.getFiles()
		.filter(isImageFile)
		.sort((a, b) => b.stat.mtime - a.stat.mtime);
}

/** vault 内の画像は File と違い type を持たないので拡張子から MIME を決める */
function mimeTypeForExtension(extension: string): string {
	return IMAGE_MIME_BY_EXTENSION[extension.toLowerCase()] || 'image/jpeg';
}

/**
 * 投稿に添付する画像1枚分。
 * 添付元が vault 内か端末かで読み出し・プレビュー・ノートへの記録が変わるため、
 * 分岐をこの型に集約して呼び出し側では区別しなくて済むようにしている。
 */
interface SelectedImage {
	/** プレビューの alt と重複判定に使う表示名 */
	name: string;
	/** vault 内の画像。端末から選んだ場合は vault へ取り込むまで null */
	vaultFile: TFile | null;
	/** 端末から選んだ元ファイル。vault 内の画像を選んだ場合は null */
	deviceFile: File | null;
	/**
	 * 下書きノートに元から埋め込まれていた画像か。
	 * 投稿後に下書きノートへ書き戻す対象から外すために持つ（既に本文にあるため）。
	 */
	fromDraft: boolean;
}

/** 同じ画像を二重に添付しないための識別子 */
function selectedImageKey(image: SelectedImage): string {
	if (image.vaultFile) return `vault:${image.vaultFile.path}`;
	const file = image.deviceFile;
	return `device:${file?.name}|${file?.size}|${file?.lastModified}`;
}

/**
 * ノート本文に埋め込む画像の wikilink。
 * 紐づけ先ノートと違い添付ファイルは拡張子込みのフルパスで書く（同名画像の取り違え防止）。
 */
function buildEmbedWikiLink(path: string): string {
	return `![[${path}]]`;
}

/**
 * 端末から選んだ画像を vault に取り込む。vault 内の画像はそのまま返す。
 * 保存先は Obsidian 本体の添付ファイル設定に従わせたいので
 * getAvailablePathForAttachment() に決めさせる（同名衝突の回避も行われる）。
 * 取り込まない設定・取り込み失敗時は null を返し、投稿の記録処理自体は続行させる。
 */
async function importImageToVault(app: App, image: SelectedImage, sourcePath: string): Promise<TFile | null> {
	if (image.vaultFile) return image.vaultFile;
	if (!image.deviceFile) return null;
	const buffer = await image.deviceFile.arrayBuffer();
	const path = normalizePath(await app.fileManager.getAvailablePathForAttachment(image.name, sourcePath));
	// 添付フォルダが未作成のことがある。createBinary は親フォルダを作らないので先に用意する
	const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
	if (folder && !app.vault.getFolderByPath(folder)) {
		await app.vault.createFolder(folder);
	}
	const created = await app.vault.createBinary(path, buffer);
	image.vaultFile = created;
	return created;
}

/**
 * Bluesky の画像 blob 上限は 1,000,000 バイト。超えると uploadBlob が失敗するので
 * 少し余裕を持たせた値を目標にする。
 */
const MAX_UPLOAD_BYTES = 950_000;
/** 長辺の初期上限。Bluesky 側の表示解像度に対して十分大きい */
const MAX_IMAGE_EDGE = 2048;

type PreparedImage = { buffer: ArrayBuffer; mimeType: string; width: number; height: number };

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality?: number): Promise<Blob> {
	return new Promise<Blob>((resolve, reject) => {
		canvas.toBlob(
			(blob) => blob ? resolve(blob) : reject(new Error('Canvas to Blob conversion failed')),
			mimeType,
			quality
		);
	});
}

/**
 * 添付画像を Bluesky に送れる形（長辺と容量の上限内）に変換する。
 *
 * vault 内の画像を直接添付できるようになったことで、端末から選ぶ場合より
 * 大きな PNG がそのまま来るようになった。上限を超えたときは
 * 「品質を下げる → JPEG に変換する → 縮小する」の順で段階的に落とす。
 * JPEG は透過を表現できないため、変換する場合は白で下地を塗ってから描画する
 * （何もしないと透過部分が黒く潰れる）。
 */
async function prepareImageForUpload(source: Blob, fallbackType: string): Promise<PreparedImage> {
	const bitmap = await createImageBitmap(source);
	try {
		const sourceType = source.type || fallbackType || 'image/jpeg';
		// canvas が確実に書き出せるのは png / jpeg / webp。それ以外は jpeg に寄せる
		const encodable = ['image/png', 'image/jpeg', 'image/webp'].includes(sourceType);
		let edge = MAX_IMAGE_EDGE;
		let mimeType = encodable ? sourceType : 'image/jpeg';
		let quality = mimeType === 'image/png' ? undefined : 0.92;
		let last: PreparedImage | null = null;

		// 「品質を下げる」→「JPEGへ変換」→「縮小」を最大8回まで試す
		for (let attempt = 0; attempt < 8; attempt++) {
			const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
			const canvas = createEl('canvas');
			canvas.width = Math.max(1, Math.round(bitmap.width * scale));
			canvas.height = Math.max(1, Math.round(bitmap.height * scale));
			const ctx = canvas.getContext('2d');
			if (!ctx) throw new Error('Failed to get canvas context');
			if (mimeType === 'image/jpeg') {
				ctx.fillStyle = '#ffffff';
				ctx.fillRect(0, 0, canvas.width, canvas.height);
			}
			ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

			const blob = await canvasToBlob(canvas, mimeType, quality);
			last = { buffer: await blob.arrayBuffer(), mimeType: blob.type || mimeType, width: canvas.width, height: canvas.height };
			if (last.buffer.byteLength <= MAX_UPLOAD_BYTES) return last;

			if (mimeType !== 'image/jpeg') {
				// 可逆形式のままでは容量が落ちないので JPEG に切り替える
				mimeType = 'image/jpeg';
				quality = 0.85;
			} else if ((quality ?? 0.92) > 0.5) {
				quality = Math.max(0.5, (quality ?? 0.92) - 0.15);
			} else {
				edge = Math.max(640, Math.round(edge * 0.75));
			}
		}
		// 上限まで試しても収まらなかった場合は最後の結果を返し、失敗は uploadBlob 側に委ねる
		if (!last) throw new Error('Failed to encode image');
		return last;
	} finally {
		bitmap.close();
	}
}

// 入力途中のURL（例: "https://"）は new URL() が例外を投げるため安全に解析する
function parseUrlSafe(url: string): URL | null {
	try {
		return new URL(url);
	} catch {
		return null;
	}
}

type SegmenterCtor = new (
	locales?: string | string[],
	options?: { granularity?: 'grapheme' | 'word' | 'sentence' }
) => { segment(input: string): IterableIterator<{ segment: string }> };

type IntlWithOptionalApis = typeof Intl & {
	Segmenter?: SegmenterCtor;
	getCanonicalLocales?: (locales?: string | string[]) => string[];
};

type ErrorResponse = { message?: string; error?: string };

// Locale表示文字列型
type LocaleStrings = {
	post: string;
	cancel: string;
	postTooLong: string;
	postContentEmpty: string;
	loginRequired: string;
	loginFailed: string;
	avatarFetchFailed: string;
	postFailed: string;
	postTimeout: string;
	postSuccess: string;
	pleaseEnterContent: string;
	imageUploadError: string;
	maxImagesReached: string;
	addImage: string;
	imageLimitHint: string;
	addImageFromVault: string;
	addImageFromDevice: string;
	imagePickerPlaceholder: string;
	noImagesInVault: string;
	imageSaveFailed: string;
	addEmoji: string;
	hotkeys: string;
	placeholderText: string;
	handleLabel: string;
	handleDesc: string;
	handlePlaceholder: string;
	passwordLabel: string;
	passwordDesc: string;
	passwordPlaceholder: string;
	timeoutLabel: string;
	timeoutDesc: string;
	timeoutPlaceholder: string;
	hashtagsLabel: string;
	hashtagsDesc: string;
	hashtagsPlaceholder: string;
	languageSettingsTitle: string;
	languageLabel: string;
	languageDesc: string;
	languageEnglish: string;
	languageJapanese: string;
	hotkeysTitle: string;
	cancelHotkeyLabel: string;
	cancelHotkeyDesc: string;
	postHotkeyLabel: string;
	postHotkeyDesc: string;
	imageHotkeyLabel: string;
	imageHotkeyDesc: string;
	emojiHotkeyLabel: string;
	emojiHotkeyDesc: string;
	appPasswordNote: string;
	hotkeyFormatNote: string;
	hotkeyConflictNote: string;
	hotkeyConflictWarning: string;
	duplicateHotkeys: string;
	posting: string;
	draftSelectTitle: string;
	noDraftsFound: string;
	draftFilterNote: string;
	draftFilterUnposted: string;
	draftTooLong: string;
	draftLoadFailed: string;
	draftPropertyLabel: string;
	draftPropertyDesc: string;
	draftValueLabel: string;
	draftValueDesc: string;
	postHistoryLabel: string;
	postHistoryDesc: string;
	postHistoryFolderLabel: string;
	postHistoryFolderDesc: string;
	postHistorySaveFailed: string;
	linkPropertyLabel: string;
	linkPropertyDesc: string;
	linkTargetPlaceholder: string;
	draftLinkTargetLabel: string;
	draftLinkTargetDesc: string;
	historyLinkTargetLabel: string;
	historyLinkTargetDesc: string;
	linkTargetMissing: string;
	saveImagesToVaultLabel: string;
	saveImagesToVaultDesc: string;
};

// 追加: 設定用インターフェース & デフォルト値
interface BlueskyPluginSettings {
	handle: string;
	password: string;
	networkTimeoutMs: number;
	defaultHashtags: string;
	draftProperty: string;
	draftValue: string;
	postHistoryEnabled: boolean;
	postHistoryFolder: string;
	linkProperty: string;
	draftLinkTarget: string;
	historyLinkTarget: string;
	saveImagesToVault: boolean;
}

const DEFAULT_SETTINGS: BlueskyPluginSettings = {
	handle: '',
	password: '',
	networkTimeoutMs: 15000,
	defaultHashtags: '',
	draftProperty: 'type',
	draftValue: 'bluesky-draft',
	postHistoryEnabled: false,
	postHistoryFolder: 'Bluesky Posts',
	linkProperty: 'related',
	// 空文字は「紐づけなし」。下書き・履歴で別々の紐づけ先を持てる
	draftLinkTarget: '',
	historyLinkTarget: '',
	// 端末から選んだ画像を vault に取り込むか。取り込まないとノートに埋め込めない
	saveImagesToVault: true
};

// 履歴ノート(B)の種別を示す frontmatter 値
const POSTED_FRONTMATTER_VALUE = 'bluesky-posted';
// 投稿済みを示す真偽値プロパティ。Obsidian の Properties UI ではチェックボックスとして表示される。
// 下書きノートは draftProperty から下書き値が取り除かれ、代わりにこれが true になって下書き一覧から外れる
const POSTED_CHECKBOX_PROPERTY = 'bluesky_posted';
const MAX_POST_LENGTH = 300;

type PostResult = { success: boolean; postUrl?: string };

interface CreateRecordResponse {
	uri: string;
	cid: string;
}

// Bluesky API embed 関連型（復元）
interface BlueskyBlobRef {
	// AT Protocol の blob ref は $type が必須。uploadBlob のレスポンスもこの形で返る
	$type: 'blob';
	ref: { $link: string };
	mimeType: string;
	size: number;
}

interface BlueskyImage {
	image: BlueskyBlobRef;
	alt: string;
	aspectRatio?: { width: number; height: number };
}

interface ImagesEmbed {
	$type: 'app.bsky.embed.images';
	images: BlueskyImage[];
}
interface ExternalEmbed {
	$type: 'app.bsky.embed.external';
	external: {
		uri: string;
		title: string;
		description: string;
		thumb?: BlueskyBlobRef;
	};
}

type Embed = ImagesEmbed | ExternalEmbed;
type Image = BlueskyImage;

interface LinkPreviewData {
	url: string;
	title?: string;
	description?: string;
	image?: string;
	domain?: string;
}

type FacetByteRange = { byteStart: number; byteEnd: number };
type LinkFacetFeature = { $type: 'app.bsky.richtext.facet#link'; uri: string };
type TagFacetFeature = { $type: 'app.bsky.richtext.facet#tag'; tag: string };
type Facet = { index: FacetByteRange; features: (LinkFacetFeature | TagFacetFeature)[] };

interface UploadBlobResponse {
	blob: BlueskyBlobRef;
}

interface BlueskyPostRecord {
	text: string;
	createdAt: string;
	$type: 'app.bsky.feed.post';
	facets?: Facet[];
	embed?: Embed;
}

interface CreateSessionResponse {
	accessJwt: string;
	refreshJwt: string;
	did: string;
}

type HttpError = Error & { status?: number; response?: RequestUrlResponse };

// ---- End added types ----


function getLocaleByObsidianLanguage(lang: string): LocaleStrings {
	// Example implementation, adjust as needed
	if (lang === 'ja' || lang.startsWith('ja')) {
		return {
			post: '投稿',
			cancel: 'キャンセル',
			postTooLong: '投稿が長すぎます。',
			postContentEmpty: '投稿内容を入力してください。',
			loginRequired: 'ログインが必要です。',
			loginFailed: 'ログインに失敗しました',
			avatarFetchFailed: 'アバター取得に失敗しました',
			postFailed: '投稿に失敗しました',
			postTimeout: '投稿がタイムアウトしました',
			postSuccess: '投稿が完了しました',
			pleaseEnterContent: '投稿内容を入力してください。',
			imageUploadError: '画像アップロードエラー',
			maxImagesReached: `画像は最大${MAX_IMAGES}枚までです。`,
			addImage: '画像追加',
			imageLimitHint: `最大${MAX_IMAGES}枚`,
			addImageFromVault: 'vault内の画像から選ぶ',
			addImageFromDevice: '端末から選ぶ',
			imagePickerPlaceholder: '添付する画像を検索',
			noImagesInVault: 'vault内に画像が見つかりませんでした',
			imageSaveFailed: '画像のvaultへの保存に失敗しました',
			addEmoji: '絵文字追加',
			hotkeys: 'ホットキー',
			placeholderText: '投稿内容を入力...',
			handleLabel: 'ハンドル',
			handleDesc: 'Bluesky のハンドル名を入力してください。',
			handlePlaceholder: 'your-handle.bsky.social',
			passwordLabel: 'パスワード',
			passwordDesc: 'Bluesky のアプリパスワードを入力してください。',
			passwordPlaceholder: 'アプリパスワード',
			timeoutLabel: 'タイムアウト',
			timeoutDesc: 'ネットワークタイムアウト (ミリ秒)',
			timeoutPlaceholder: '15000',
			hashtagsLabel: 'デフォルトハッシュタグ',
			hashtagsDesc: '投稿時に自動追加するハッシュタグ',
			hashtagsPlaceholder: '#obsidian',
			languageSettingsTitle: '言語設定',
			languageLabel: '言語',
			languageDesc: 'UI の言語を選択してください。',
			languageEnglish: '英語',
			languageJapanese: '日本語',
			hotkeysTitle: 'ホットキー設定',
			cancelHotkeyLabel: 'キャンセルホットキー',
			cancelHotkeyDesc: '投稿をキャンセルするホットキー',
			postHotkeyLabel: '投稿ホットキー',
			postHotkeyDesc: '投稿するホットキー',
			imageHotkeyLabel: '画像追加ホットキー',
			imageHotkeyDesc: '画像追加のホットキー',
			emojiHotkeyLabel: '絵文字追加ホットキー',
			emojiHotkeyDesc: '絵文字追加のホットキー',
			appPasswordNote: 'Bluesky のアプリパスワードを使用してください。',
			hotkeyFormatNote: 'ホットキーは "Mod+Enter" などの形式で指定します。',
			hotkeyConflictNote: 'ホットキーが重複している場合は警告が表示されます。',
			hotkeyConflictWarning: 'ホットキーが重複しています。',
			duplicateHotkeys: '重複ホットキー',
			posting: '投稿中...',
			draftSelectTitle: '下書き一覧',
			noDraftsFound: '下書きが見つかりません',
			draftFilterNote: '※ 表示条件',
			draftFilterUnposted: '未チェック',
			draftTooLong: '投稿内容が300字を超えています。編集してください。',
			draftLoadFailed: '下書きの読み込みに失敗しました',
			draftPropertyLabel: '下書きプロパティ名',
			draftPropertyDesc: '下書きノートを識別するfrontmatterのキー名',
			draftValueLabel: '下書き判定値',
			draftValueDesc: '上記キーに対応する値。この値を持つノートが下書き一覧に表示されます',
			postHistoryLabel: '投稿履歴を保存',
			postHistoryDesc: '投稿成功時に本文・日時・URL入りのノートを自動作成します',
			postHistoryFolderLabel: '履歴ノートの保存先',
			postHistoryFolderDesc: '履歴ノートを作成するフォルダ（存在しなければ自動作成）',
			postHistorySaveFailed: '投稿履歴の保存に失敗しました',
			linkPropertyLabel: '紐づけプロパティ名',
			linkPropertyDesc: '紐づけ先へのリンクを書き込むfrontmatterのキー名',
			linkTargetPlaceholder: '紐づけなし',
			draftLinkTargetLabel: '下書きノートの紐づけ先',
			draftLinkTargetDesc: '下書きから投稿したとき、そのノートに紐づけるノート（空欄なら紐づけません）。'
				+ '{{date:YYYY-MM-DD}} や {{time:HHmm}} で投稿日時を埋め込めます',
			historyLinkTargetLabel: '履歴ノートの紐づけ先',
			historyLinkTargetDesc: '作成した履歴ノートに紐づけるノート（空欄なら紐づけません）。'
				+ '{{date:YYYY-MM-DD}} や {{time:HHmm}} で投稿日時を埋め込めます',
			linkTargetMissing: '紐づけ先のノートが見つからないため、リンクを追加しませんでした',
			saveImagesToVaultLabel: '端末から選んだ画像をvaultに保存',
			saveImagesToVaultDesc: '端末から添付した画像をvaultに取り込み、下書きノート・履歴ノートに埋め込みます。'
				+ '保存先はObsidian本体の「添付ファイルの保存先」設定に従います。'
				+ 'オフにすると投稿はできますが、ノートには画像が残りません（vault内の画像を選んだ場合は設定に関わらず記録されます）'
		};
	}
	// Default to English
	return {
		post: 'Post',
		cancel: 'Cancel',
		postTooLong: 'Post is too long.',
		postContentEmpty: 'Please enter post content.',
		loginRequired: 'Login required.',
		loginFailed: 'Login failed',
		avatarFetchFailed: 'Failed to fetch avatar',
		postFailed: 'Post failed',
		postTimeout: 'Post timed out',
		postSuccess: 'Post successful',
		pleaseEnterContent: 'Please enter post content.',
		imageUploadError: 'Image upload error',
		maxImagesReached: `Maximum ${MAX_IMAGES} images allowed.`,
		addImage: 'Add image',
		imageLimitHint: `up to ${MAX_IMAGES}`,
		addImageFromVault: 'Choose from vault',
		addImageFromDevice: 'Choose from device',
		imagePickerPlaceholder: 'Search images to attach',
		noImagesInVault: 'No images found in the vault',
		imageSaveFailed: 'Failed to save the image to the vault',
		addEmoji: 'Add emoji',
		hotkeys: 'Hotkeys',
		placeholderText: 'Enter post content...',
		handleLabel: 'Handle',
		handleDesc: 'Enter your Bluesky handle.',
		handlePlaceholder: 'your-handle.bsky.social',
		passwordLabel: 'Password',
		passwordDesc: 'Enter your Bluesky app password.',
		passwordPlaceholder: 'App password',
		timeoutLabel: 'Timeout',
		timeoutDesc: 'Network timeout (ms)',
		timeoutPlaceholder: '15000',
		hashtagsLabel: 'Default hashtags',
		hashtagsDesc: 'Hashtags to add automatically when posting',
		hashtagsPlaceholder: '#obsidian',
		languageSettingsTitle: 'Language Settings',
		languageLabel: 'Language',
		languageDesc: 'Select UI language.',
		languageEnglish: 'English',
		languageJapanese: 'Japanese',
		hotkeysTitle: 'Hotkey Settings',
		cancelHotkeyLabel: 'Cancel Hotkey',
		cancelHotkeyDesc: 'Hotkey to cancel posting',
		postHotkeyLabel: 'Post hotkey',
		postHotkeyDesc: 'Hotkey to post (e.g., Ctrl+Enter)',
		imageHotkeyLabel: 'Add image hotkey',
		imageHotkeyDesc: 'Hotkey to add image (e.g., Ctrl+I)',
		emojiHotkeyLabel: 'Add emoji hotkey',
		emojiHotkeyDesc: 'Hotkey to add emoji (e.g., Ctrl+E)',
		appPasswordNote: 'Use your Bluesky app password.',
		hotkeyFormatNote: 'Specify hotkeys like "Mod+Enter".',
		hotkeyConflictNote: 'A warning will be shown if hotkeys conflict.',
		hotkeyConflictWarning: 'Hotkey conflict detected.',
		duplicateHotkeys: 'Duplicate hotkeys',
		posting: 'Posting...',
		draftSelectTitle: 'Draft notes',
		noDraftsFound: 'No drafts found',
		draftFilterNote: 'Filter',
		draftFilterUnposted: 'unchecked',
		draftTooLong: 'Post content exceeds 300 characters. Please edit it before posting.',
		draftLoadFailed: 'Failed to load drafts',
		draftPropertyLabel: 'Draft property name',
		draftPropertyDesc: 'Frontmatter key used to identify draft notes',
		draftValueLabel: 'Draft property value',
		draftValueDesc: 'Value for the key above. Notes with this value appear in the draft list',
		postHistoryLabel: 'Save post history',
		postHistoryDesc: 'Automatically create a note with the text, timestamp and URL after a successful post',
		postHistoryFolderLabel: 'History note folder',
		postHistoryFolderDesc: 'Folder to create history notes in (created automatically if missing)',
		postHistorySaveFailed: 'Failed to save post history',
		linkPropertyLabel: 'Link property name',
		linkPropertyDesc: 'Frontmatter key the link to the target note is written to',
		linkTargetPlaceholder: 'No link',
		draftLinkTargetLabel: 'Draft note link target',
		draftLinkTargetDesc: 'Note to link a draft to when it is posted (leave empty to disable). '
			+ 'Use {{date:YYYY-MM-DD}} or {{time:HHmm}} to embed the posting time',
		historyLinkTargetLabel: 'History note link target',
		historyLinkTargetDesc: 'Note to link newly created history notes to (leave empty to disable). '
			+ 'Use {{date:YYYY-MM-DD}} or {{time:HHmm}} to embed the posting time',
		linkTargetMissing: 'The link target note was not found, so no link was added',
		saveImagesToVaultLabel: 'Save device images to the vault',
		saveImagesToVaultDesc: 'Import images attached from the device into the vault and embed them in draft and history notes. '
			+ "The location follows Obsidian's own attachment folder setting. "
			+ 'When off, posting still works but no image is kept in the note (images chosen from the vault are recorded regardless)'
	};
}
				// (Removed stray malformed code block that caused syntax errors)
				
				// Grapheme counting utility (simple fallback for most languages)
				function countGraphemes(str: string): number {
					// For most cases, [...str] will split by Unicode code points
					// For more accurate grapheme splitting, use Intl.Segmenter if available
					const intlApi = Intl as IntlWithOptionalApis;
					const segmenterCtor = intlApi.Segmenter;
					if (typeof segmenterCtor === 'function') {
						const segmenter = new segmenterCtor(undefined, { granularity: 'grapheme' });
						return Array.from(segmenter.segment(str)).length;
					}
					return [...str].length;
				}
	
	export default class BlueskyPlugin extends Plugin {
		settings: BlueskyPluginSettings = DEFAULT_SETTINGS;
		currentLocale: LocaleStrings = getLocaleByObsidianLanguage('en');
		accessJwt: string | undefined;
		refreshJwt: string | undefined;
		did: string | undefined;
		userAvatar: string | undefined;
		activeModal: PostModal | null = null;
	
	async onload() {
		await this.loadSettings();
		this.updateLanguageSettings();
		this.addSettingTab(new BlueskySettingTab(this.app, this));

		// 投稿用コマンド登録（コマンドパレット表示 & デフォルトホットキー）
		this.addCommand({
			id: 'open-bluesky-composer',
			name: 'Open post composer',
			callback: () => this.openPostModal()
		});

		this.addCommand({
			id: 'submit-post',
			name: 'Submit post',
			callback: () => {
				if (this.activeModal && !this.activeModal.isPosting) {
					void this.activeModal.handlePost();
				}
			}
		});

		this.addCommand({
			id: 'cancel-post',
			name: 'Cancel post',
			callback: () => {
				if (this.activeModal) {
					this.activeModal.close();
				}
			}
		});

		this.addCommand({
			id: 'open-draft-composer',
			name: 'Post from draft notes',
			callback: () => this.openDraftSelectModal()
		});

		// 画像添付はモバイルでも使えるので、コマンドもプラットフォームを問わず登録する
		this.addCommand({
			id: 'add-image',
			name: 'Add image',
			callback: () => {
				if (this.activeModal && !this.activeModal.isPosting) {
					this.activeModal.openImageSourceMenu();
				}
			}
		});

		this.addCommand({
			id: 'toggle-emoji-picker',
			name: 'Toggle emoji picker',
			callback: () => {
				if (this.activeModal) {
					this.activeModal.toggleEmojiPicker();
				}
			}
		});

		// リボンアイコン（左サイドバー）
		this.addRibbonIcon('send', 'Open post composer', () => this.openPostModal());
		this.addRibbonIcon('file-text', 'Post from draft notes', () => this.openDraftSelectModal());
	}

	onunload(): void {}

	async loadSettings() {
		const loaded = await this.loadData() as Partial<BlueskyPluginSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
	}

		async saveSettings() {
			try {
				await this.saveData(this.settings);
			} catch (e) {
				console.error('Failed to save settings:', e);
			}
		}
	
		public updateLanguageSettings() {
			try {
				// Use Obsidian's getLanguage() API to get the configured language
				const obsidianLang = getLanguage();
				this.currentLocale = getLocaleByObsidianLanguage(obsidianLang);
			} catch {
				// Fallback to English if language detection fails
				this.currentLocale = getLocaleByObsidianLanguage('en');
			}
		}
	
		getLocale(): LocaleStrings {
			return this.currentLocale || getLocaleByObsidianLanguage('en');
		}

		private get effectiveTimeout(): number {
			return Math.max(1000, this.settings.networkTimeoutMs ?? 15000);
		}

		private isSuccessStatus(status: number): boolean {
			return status >= 200 && status < 300;
		}

		private async requestWithTimeout(params: RequestUrlParam, timeoutOverride?: number): Promise<RequestUrlResponse> {
			const duration = timeoutOverride ?? this.effectiveTimeout;
			let timer: number | null = null;
			const timeoutPromise = new Promise<never>((_, reject) => {
				timer = window.setTimeout(() => reject(new Error('Request timed out')), duration);
			});
			try {
				// throw: false にしないと 400+ で requestUrl が汎用エラーを投げてしまい、
				// 呼び出し側のステータス判定（401 再ログイン・429 バックオフ）とAPIの
				// エラーメッセージ抽出が働かなくなる
				return await Promise.race([requestUrl({ ...params, throw: false }), timeoutPromise]);
			} finally {
				if (timer !== null) {
					window.clearTimeout(timer);
				}
			}
		}

		private async retryWithBackoff<T>(operation: () => Promise<T>, options?: {
			maxRetries?: number;
			baseDelayMs?: number;
			shouldRetry?: (error: unknown, attempt: number) => Promise<boolean> | boolean;
		}): Promise<T> {
			const maxAttempts = Math.max(1, options?.maxRetries ?? 3);
			const baseDelay = Math.max(100, options?.baseDelayMs ?? 500);
			for (let attempt = 1; attempt <= maxAttempts; attempt++) {
				try {
					return await operation();
				} catch (error) {
					const hasAttemptsLeft = attempt < maxAttempts;
					const allowRetry = hasAttemptsLeft && (options?.shouldRetry ? await options.shouldRetry(error, attempt) : false);
					if (!allowRetry) throw error;
					const delay = baseDelay * attempt;
					await new Promise((resolve) => window.setTimeout(resolve, delay));
				}
			}
			throw new Error('Operation failed after retries');
		}

	private createHttpError(response: RequestUrlResponse, fallbackMessage: string): HttpError {
		const errorBody = (response.json as ErrorResponse) ?? {};
		const message = errorBody.message || errorBody.error || fallbackMessage;
		const err = new Error(message) as HttpError;
		err.status = response.status;
		err.response = response;
		return err;
	}		private async fetchProfileAvatar(actorDid: string): Promise<void> {
			if (!this.accessJwt) return;
			try {
				const response = await this.requestWithTimeout({
					url: `https://bsky.social/xrpc/app.bsky.actor.getProfile?actor=${actorDid}`,
					headers: { Authorization: `Bearer ${this.accessJwt}` }
				});
				if (!this.isSuccessStatus(response.status)) return;
				const profileData = response.json as { avatar?: string };
				this.userAvatar = profileData.avatar || '';
			} catch (error) {
				console.error(this.getLocale().avatarFetchFailed + ':', error);
			}
		}
	
		async login(): Promise<boolean> {
			if (!this.settings.handle || !this.settings.password) {
				new Notice(this.getLocale().loginRequired);
				return false;
			}
			try {
				const response = await this.requestWithTimeout({
					url: 'https://bsky.social/xrpc/com.atproto.server.createSession',
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ identifier: this.settings.handle, password: this.settings.password })
				});
				if (!this.isSuccessStatus(response.status)) {
					throw new Error(`${this.getLocale().loginFailed}: ${response.status}`);
				}
				const data = response.json as CreateSessionResponse;
				this.accessJwt = data.accessJwt;
				this.refreshJwt = data.refreshJwt;
				this.did = data.did;
				await this.fetchProfileAvatar(data.did);
				return true;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				new Notice(`${this.getLocale().loginFailed}: ${message}`);
				return false;
			}
		}
	
		detectFacets(text: string): Facet[] | undefined {
			const facets: Facet[] = [];
			const encoder = new TextEncoder();
			const linkRegex = createUrlRegex();
			let match: RegExpExecArray | null;
			while ((match = linkRegex.exec(text)) !== null) {
				const rawUri = match[0];
				const uri = trimTrailingPunctuation(rawUri);
				const byteStart = encoder.encode(text.slice(0, match.index)).length;
				const byteEnd = byteStart + encoder.encode(uri).length;
				const linkFacet: Facet = {
					index: { byteStart, byteEnd },
					features: [{ $type: 'app.bsky.richtext.facet#link', uri }]
				};
				facets.push(linkFacet);
			}
			const hashtagRegex = createHashtagRegex();
			while ((match = hashtagRegex.exec(text)) !== null) {
				const tag = match[0];
				const tagWithoutHash = tag.slice(1);
				if (countGraphemes(tagWithoutHash) > MAX_TAG_LENGTH) continue;
				const byteStart = encoder.encode(text.slice(0, match.index)).length;
				const byteEnd = byteStart + encoder.encode(tag).length;
				const tagFacet: Facet = {
					index: { byteStart, byteEnd },
					features: [{ $type: 'app.bsky.richtext.facet#tag', tag: tagWithoutHash }]
				};
				facets.push(tagFacet);
			}
			facets.sort((a, b) => a.index.byteStart - b.index.byteStart);
			return facets.length > 0 ? facets : undefined;
		}
	
		async uploadBlob(blob: ArrayBuffer, mimeType: string): Promise<UploadBlobResponse> {
			const maxAttempts = 3; // Guard against infinite recursion and allow limited retries
			for (let attempt = 1; attempt <= maxAttempts; attempt++) {
				if (!this.accessJwt) {
					if (!(await this.login())) throw new Error('ログインに失敗しました');
				}
				try {
					const response = await this.requestWithTimeout({
						url: 'https://bsky.social/xrpc/com.atproto.repo.uploadBlob',
						method: 'POST',
						headers: {
							'Content-Type': mimeType,
							Accept: 'application/json',
							Authorization: `Bearer ${this.accessJwt}`
						},
						body: blob
					});
					if (this.isSuccessStatus(response.status)) {
						return response.json as UploadBlobResponse;
					}

					if (response.status === 401) {
						this.accessJwt = undefined;
						this.refreshJwt = undefined;
						this.did = undefined;
						if (attempt === maxAttempts) {
							throw new Error('画像アップロードに失敗しました: 認証エラー');
						}
						continue;
					}

					if (response.status === 429) {
						if (attempt === maxAttempts) {
							throw new Error('画像アップロードに失敗しました: レート制限');
						}
						const retryAfter = Number(response.headers['retry-after']);
						const baseBackoffMs = Number.isFinite(retryAfter) ? Math.max(500, retryAfter * 1000) : 1500;
						const backoffMs = baseBackoffMs * attempt;
						await new Promise((resolve) => window.setTimeout(resolve, backoffMs));
						continue;
					}

					const errorBody = (response.json as { message?: string; error?: string }) ?? {};
					const message = errorBody.message || errorBody.error || `画像アップロードに失敗しました: ${response.status}`;
					throw new Error(message);
				} catch (error) {
					if (error instanceof Error && error.message === 'Request timed out') {
						throw new Error('画像アップロードがタイムアウトしました', { cause: error });
					}
					throw error;
				}
			}

			throw new Error('画像アップロードに失敗しました');
		}

		async postToBluesky(text: string, embed?: Embed): Promise<PostResult> {
			if (!text.trim() && (!embed || embed.$type !== 'app.bsky.embed.images')) {
				new Notice(this.getLocale().postContentEmpty);
				return { success: false };
			}
			if (countGraphemes(text) > MAX_POST_LENGTH) {
				new Notice(this.getLocale().postTooLong);
				return { success: false };
			}
			if (!this.accessJwt || !this.did) {
				if (!(await this.login())) return { success: false };
			}
			const record: BlueskyPostRecord = {
				text,
				createdAt: new Date().toISOString(),
				$type: 'app.bsky.feed.post'
			};
			const facets = this.detectFacets(text);
			if (facets) record.facets = facets;
			if (embed) record.embed = embed;
			try {
				let refreshedAuth = false;
				const createdUri = await this.retryWithBackoff(
					async () => {
						const response = await this.requestWithTimeout({
							url: 'https://bsky.social/xrpc/com.atproto.repo.createRecord',
							method: 'POST',
							headers: {
								'Content-Type': 'application/json',
								Authorization: `Bearer ${this.accessJwt}`
							},
							body: JSON.stringify({
								repo: this.did,
								collection: 'app.bsky.feed.post',
								record
							})
						});
						if (!this.isSuccessStatus(response.status)) {
							throw this.createHttpError(response, `${this.getLocale().postFailed}: ${response.status}`);
						}
						return (response.json as CreateRecordResponse | undefined)?.uri;
					},
					{
						maxRetries: 3,
						baseDelayMs: 600,
						shouldRetry: async (error) => {
							const status = typeof (error as HttpError)?.status === 'number' ? (error as HttpError).status : undefined;
							if (status === 401 && !refreshedAuth) {
								refreshedAuth = true;
								this.accessJwt = undefined;
								this.refreshJwt = undefined;
								this.did = undefined;
								return this.login();
							}
							if (status === 429) {
								const response = (error as HttpError).response;
								const retryAfter = Number(response?.headers['retry-after']);
								const delay = Number.isFinite(retryAfter) ? Math.max(500, retryAfter * 1000) : 0;
								if (delay > 0) {
									await new Promise((resolve) => window.setTimeout(resolve, delay));
								}
								return true;
							}
							return false;
						}
					}
				);
				new Notice(this.getLocale().postSuccess);
				return { success: true, postUrl: this.buildPostUrl(createdUri) };
			} catch (error) {
				const isTimeout = error instanceof Error && error.message === 'Request timed out';
				if (isTimeout) {
					new Notice(this.getLocale().postTimeout);
				} else {
					const message = error instanceof Error ? error.message : String(error);
					new Notice(`${this.getLocale().postFailed}: ${message}`);
				}
				return { success: false };
			}
		}

		/**
		 * createRecord が返す at:// URI から表示用の bsky.app URL を組み立てる
		 * at://{did}/app.bsky.feed.post/{rkey} → https://bsky.app/profile/{handle}/post/{rkey}
		 */
		private buildPostUrl(uri: string | undefined): string | undefined {
			if (!uri) return undefined;
			const rkey = uri.split('/').pop();
			const handle = this.settings.handle?.trim();
			if (!rkey || !handle) return undefined;
			return `https://bsky.app/profile/${handle}/post/${rkey}`;
		}

		/**
		 * エディタの選択文字列（なければ先頭500文字）を初期値として投稿モーダルを開く
		 */
		openPostModal(initialText = '', sourceFile: TFile | null = null, initialImages: TFile[] = []) {
			if (this.activeModal) return;
			// 予備ログイン（失敗しても無視）
			if (!this.accessJwt) {
				void this.login().catch(() => {});
			}
			const modal = new PostModal(this.app, this, initialText, sourceFile, initialImages);
			this.activeModal = modal;
			modal.open();
		}

		/**
		 * 下書き一覧モーダルを開く
		 */
		openDraftSelectModal() {
			if (this.activeModal) return;
			if (!this.accessJwt) {
				void this.login().catch(() => {});
			}
			new DraftSelectModal(this.app, this).open();
		}

		/**
		 * 投稿成功後の記録処理。
		 * 下書き由来の投稿は元ノートを投稿済みに更新し（C）、履歴ノートは作らない。
		 * それ以外は設定が有効なら履歴ノートを作成する（B）。
		 * 失敗しても投稿自体は成功扱いのまま、通知だけ出す。
		 */
		async recordPostResult(text: string, postUrl: string | undefined, sourceFile: TFile | null, images: SelectedImage[] = []): Promise<void> {
			try {
				if (sourceFile) {
					await this.markDraftAsPosted(sourceFile, postUrl, images);
					return;
				}
				if (!this.settings.postHistoryEnabled) return;
				await this.createPostHistoryNote(text, postUrl, images);
			} catch (error) {
				console.error('[Post-To-Bluesky] Failed to record post:', error);
				new Notice(this.getLocale().postHistorySaveFailed);
			}
		}

		/** 紐づけリンクを書き込む frontmatter のキー名 */
		private getLinkProperty(): string {
			return this.settings.linkProperty?.trim() || DEFAULT_SETTINGS.linkProperty;
		}

		/**
		 * 設定に保存された紐づけ先から、リンクに書くパスを決める。空欄なら紐づけなし。
		 * 日付変数を展開したうえで、未作成のノートの扱いを設定の書き方で変える。
		 *
		 * - 変数入り（例: `01_data/{{date:YYYY-MM-DD}}`）: 紐づけ先が投稿ごとに変わり、
		 *   その日のデイリーノートが投稿より後に作られることも普通にあるため、
		 *   実在しなくても**未作成リンクとして書く**（後からノートを作れば自動で繋がる）
		 * - 固定パス: 選択UIで選んだ実在ノートのはずなので、消えていればリネームか
		 *   タイポの疑いがある。リンクは付けずに通知だけ出す
		 *
		 * どちらの場合も投稿の記録処理自体は続行する。
		 */
		private resolveLinkTargetPath(rawTemplate: string, now: Date): string | null {
			const template = rawTemplate?.trim();
			if (!template) return null;
			const expanded = expandDateTemplate(template, now).trim();
			if (!expanded) return null;
			const file = findNoteByPath(this.app, expanded);
			if (file) return file.path;
			if (hasTemplatePlaceholder(template)) return normalizePath(expanded);
			new Notice(this.getLocale().linkTargetMissing);
			return null;
		}

		/** 履歴ノート・frontmatter 用のローカル日時文字列 (例: 2026-07-25T17:30:00) */
		private formatLocalTimestamp(date: Date): string {
			const pad = (n: number) => String(n).padStart(2, '0');
			return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
				+ `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
		}

		/** 履歴ノートのファイル名ベース (例: 2026-07-25 1730) */
		private formatFileStamp(date: Date): string {
			const pad = (n: number) => String(n).padStart(2, '0');
			return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
				+ ` ${pad(date.getHours())}${pad(date.getMinutes())}`;
		}

		/**
		 * 添付した画像を、ノートに埋め込める wikilink の一覧にする。
		 * 端末から選んだ画像は設定が有効なときだけ vault に取り込む。取り込みに失敗しても
		 * 投稿自体は既に成功しているので、通知だけ出して残りの記録処理は続ける。
		 *
		 * @param sourcePath 添付ファイルの保存先を決める起点。Obsidian の「ノートと同じ
		 *   フォルダ」設定を正しく効かせるため、画像を埋め込む側のノートのパスを渡す
		 * @param skipDraftImages 下書きノートに元から埋め込まれていた画像を除くか
		 *   （既に本文にあるため、書き戻すと重複する）
		 */
		private async collectImageEmbeds(images: SelectedImage[], sourcePath: string, skipDraftImages = false): Promise<string[]> {
			const links: string[] = [];
			for (const image of images) {
				if (skipDraftImages && image.fromDraft) continue;
				// vault 外の画像は取り込まない限りリンクが解決できないので飛ばす
				if (!image.vaultFile && !this.settings.saveImagesToVault) continue;
				try {
					const file = await importImageToVault(this.app, image, sourcePath);
					if (file) links.push(buildEmbedWikiLink(file.path));
				} catch (error) {
					console.error('[Post-To-Bluesky] Failed to save image to vault:', error);
					new Notice(this.getLocale().imageSaveFailed);
				}
			}
			return links;
		}

		/** 投稿履歴ノートを作成する（B） */
		private async createPostHistoryNote(text: string, postUrl: string | undefined, images: SelectedImage[] = []): Promise<void> {
			const now = new Date();
			const rawFolder = this.settings.postHistoryFolder?.trim() || DEFAULT_SETTINGS.postHistoryFolder;
			const folderPath = rawFolder === '/' ? '' : normalizePath(rawFolder);
			if (folderPath && !this.app.vault.getFolderByPath(folderPath)) {
				await this.app.vault.createFolder(folderPath);
			}

			const base = this.formatFileStamp(now);
			const prefix = folderPath ? `${folderPath}/` : '';
			let path = normalizePath(`${prefix}${base}.md`);
			for (let i = 2; this.app.vault.getAbstractFileByPath(path); i++) {
				path = normalizePath(`${prefix}${base} (${i}).md`);
			}

			const tags = extractHashtags(text);
			// タグは frontmatter の tags に持たせるので本文からは取り除く
			const body = tags.length > 0 ? stripHashtags(text, tags) : text;
			const linkTarget = this.resolveLinkTargetPath(this.settings.historyLinkTarget, now);
			const frontmatter = [
				'---',
				`${this.settings.draftProperty || DEFAULT_SETTINGS.draftProperty}: ${POSTED_FRONTMATTER_VALUE}`,
				`${POSTED_CHECKBOX_PROPERTY}: true`,
				`posted_at: ${this.formatLocalTimestamp(now)}`,
				...(postUrl ? [`url: ${postUrl}`] : []),
				...(linkTarget ? [`${this.getLinkProperty()}: ${toYamlLink(buildFrontmatterWikiLink(linkTarget))}`] : []),
				...(tags.length > 0 ? ['tags:', ...tags.map((tag) => `  - ${toYamlTag(tag)}`)] : []),
				'---'
			].join('\n');
			const noteFile = await this.app.vault.create(path, `${frontmatter}\n${body}\n`);
			// 画像の取り込みはノートを作ってから行う。getAvailablePathForAttachment() は
			// 起点ノートの場所から保存先を決めるので、存在しないパスを渡すと
			// 「ノートと同じフォルダ」設定のときに保存先がずれる
			const embeds = await this.collectImageEmbeds(images, noteFile.path);
			if (embeds.length > 0) {
				// 画像だけの投稿では本文が空なので、余分な空行を足さない
				await this.app.vault.append(noteFile, `${body ? '\n' : ''}${embeds.join('\n')}\n`);
			}
		}

		/**
		 * 下書きノートの frontmatter を投稿済みに更新する（C）。
		 * draftProperty から下書き値を取り除き、投稿済みかどうかはチェックボックス用の
		 * 真偽値プロパティで表す。下書き値以外の要素（利用者独自のタグ等）は残す。
		 */
		private async markDraftAsPosted(file: TFile, postUrl: string | undefined, images: SelectedImage[] = []): Promise<void> {
			const key = this.settings.draftProperty || DEFAULT_SETTINGS.draftProperty;
			const draftValue = this.settings.draftValue;
			const now = new Date();
			const postedAt = this.formatLocalTimestamp(now);
			// 作成画面で足した画像だけを書き戻す。下書きは利用者の文章なので追記に留め、
			// 既存の本文には手を入れない
			const embeds = await this.collectImageEmbeds(images, file.path, true);
			if (embeds.length > 0) {
				await this.app.vault.append(file, `\n\n${embeds.join('\n')}\n`);
			}
			// 下書きノート自身が紐づけ先に解決された場合は自己リンクになるので付けない
			const rawLinkTarget = this.resolveLinkTargetPath(this.settings.draftLinkTarget, now);
			const linkTarget = rawLinkTarget !== null && stripMarkdownExtension(rawLinkTarget) === stripMarkdownExtension(file.path)
				? null
				: rawLinkTarget;
			const linkProperty = this.getLinkProperty();
			await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
				const current: unknown = frontmatter[key];
				if (Array.isArray(current)) {
					const rest = (current as unknown[]).filter((v) => !frontmatterMatchesValue(v, draftValue));
					// 下書き値しか入っていなかった場合はキーごと削除する
					if (rest.length > 0) frontmatter[key] = rest;
					else delete frontmatter[key];
				} else if (frontmatterMatchesValue(current, draftValue)) {
					delete frontmatter[key];
				}
				frontmatter[POSTED_CHECKBOX_PROPERTY] = true;
				frontmatter.posted_at = postedAt;
				if (postUrl) frontmatter.url = postUrl;
				if (linkTarget) addFrontmatterLink(frontmatter, linkProperty, buildFrontmatterWikiLink(linkTarget));
			});
		}
	}

class PostModal extends Modal {
	plugin: BlueskyPlugin;
	initialText = '';
	postButton!: ButtonComponent;
	textArea!: HTMLTextAreaElement;
	linkPreviewContainer!: HTMLElement;
	imagePreviewContainer!: HTMLElement;
	emojiPickerContainer: HTMLElement | null = null;
	emojiButtonEl!: HTMLElement; // 絵文字ボタン参照
	charCountEl!: HTMLElement;
	fileInput: HTMLInputElement | null = null;
	imageButtonEl!: HTMLElement; // 添付元メニューの表示位置に使う
	sourceFile: TFile | null = null; // 下書きノート由来の投稿のみ設定される
	selectedImages: SelectedImage[] = [];
	linkPreviewData: LinkPreviewData | null = null;
	pendingLinkPreviewUrl: string | null = null;
	debounceTimer: number | null = null;
	isEmojiPickerVisible = false;
	isPosting = false;
	outsideClickHandler?: (e: MouseEvent) => void;
	private repositionEmojiPickerBound?: () => void;

	constructor(app: App, plugin: BlueskyPlugin, initialText = '', sourceFile: TFile | null = null, initialImages: TFile[] = []) {
		super(app);
		this.plugin = plugin;
		this.initialText = initialText;
		this.sourceFile = sourceFile;
		// 下書きノートに埋め込まれていた画像は最初から添付済みにしておく。
		// fromDraft を立てておくことで、投稿後に同じ画像を下書きへ書き戻さずに済む
		this.selectedImages = initialImages.slice(0, MAX_IMAGES).map((file) => ({
			name: file.name,
			vaultFile: file,
			deviceFile: null,
			fromDraft: true
		}));
	}

	toggleEmojiPicker(): void {
		if (this.isEmojiPickerVisible) this.hideEmojiPicker();
		else this.showEmojiPicker();
	}

	// モーダル外（body直下）にピッカーを生成（EMOJI_LIST を利用）
	private initExternalEmojiPicker(): void {
		if (!this.emojiPickerContainer) {
			this.emojiPickerContainer = activeDocument.body.createDiv({ cls: 'bluesky-emoji-picker-container bluesky-emoji-floating bluesky-hidden' });
		}
		this.emojiPickerContainer.replaceChildren();
		const grid = this.emojiPickerContainer.createDiv({ cls: 'bluesky-emoji-grid' });
		EMOJI_LIST.forEach(em => {
			const span = grid.createSpan({ cls: 'bluesky-emoji-item', text: em });
			span.addEventListener('click', () => this.insertEmoji(em));
		});
	}

	private repositionEmojiPicker() {
		if (!this.emojiPickerContainer || !this.emojiButtonEl || this.emojiPickerContainer.classList.contains('bluesky-hidden')) return;
		const rect = this.emojiButtonEl.getBoundingClientRect();
		const picker = this.emojiPickerContainer;
		const width = picker.offsetWidth || 300;
		const height = picker.offsetHeight || 260;
		let top = rect.bottom + 4;
		let left = rect.left;
		if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
		if (top + height > window.innerHeight - 8) top = rect.top - height - 4;
		if (top < 8) top = 8;
		if (left < 8) left = 8;
		picker.style.top = `${top}px`;
		picker.style.left = `${left}px`;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('bluesky-modal-container');

		const headerEl = contentEl.createDiv({ cls: 'bluesky-modal-header' });

		// キャンセルボタン
		new ButtonComponent(headerEl)
			.setButtonText(this.plugin.getLocale().cancel)
			.onClick(() => this.close());

		// 投稿ボタン
		this.postButton = new ButtonComponent(headerEl)
			.setButtonText(this.plugin.getLocale().post)
			.setCta()
			.onClick(() => this.handlePost());

		const mainEl = contentEl.createDiv({ cls: 'bluesky-modal-main' });
		if (this.plugin.userAvatar) {
			mainEl.createEl('img', { cls: 'bluesky-avatar', attr: { src: this.plugin.userAvatar, alt: 'User avatar' } });
		}
		this.textArea = mainEl.createEl('textarea', { cls: 'bluesky-textarea', attr: { placeholder: this.plugin.getLocale().placeholderText } });

		// 下書きから開いた場合のみ本文をセット。通常起動時は空欄（＋デフォルトハッシュタグ）。
		if (this.initialText) {
			this.textArea.value = this.initialText;
		} else if (this.plugin.settings.defaultHashtags?.trim()) {
			// デフォルトハッシュタグは空欄に続けて自動挿入（復活要求）
			this.textArea.value = this.plugin.settings.defaultHashtags.trim();
		} else {
			this.textArea.value = '';
		}

		// モーダル表示時にカーソルをテキストエリア先頭（左端）へ移動
		// （ハッシュタグ挿入済みでも先頭に配置する要求仕様）
		// 下書き本文をセットした場合のみ、続けて編集できるよう末尾へ置く
		const caretPos = this.initialText ? this.textArea.value.length : 0;
		window.setTimeout(() => {
			this.textArea.focus();
			this.textArea.setSelectionRange(caretPos, caretPos);
		}, 0);

		this.linkPreviewContainer = contentEl.createDiv({ cls: 'bluesky-preview-container' });
		this.imagePreviewContainer = contentEl.createDiv({ cls: 'bluesky-image-preview-container' });
		// 絵文字ピッカーはボタンの右隣に出すため、後で actions 内ラッパに配置する

		const footerEl = contentEl.createDiv({ cls: 'bluesky-modal-footer' });

		// フッターの上部行：アクションボタンと文字カウンター
		const footerRowEl = footerEl.createDiv({ cls: 'bluesky-footer-row' });
		const actionsEl = footerRowEl.createDiv({ cls: 'bluesky-actions' });

		// 画像添付はデスクトップ・モバイル共通。添付元（vault内 / 端末）はメニューで選ばせる
		const fileInput = contentEl.createEl('input', { cls: 'bluesky-hidden', attr: { type: 'file', accept: 'image/*' } });
		fileInput.multiple = true;
		fileInput.onchange = (e) => this.handleFileSelect(e);
		this.fileInput = fileInput;

		const imageBtn = new ButtonComponent(actionsEl)
			.setIcon('image-file')
			.setTooltip(`${this.plugin.getLocale().addImage} (${this.plugin.getLocale().imageLimitHint})`)
			.onClick((evt) => this.openImageSourceMenu(evt));
		this.imageButtonEl = imageBtn.buttonEl;

		// 絵文字ボタンのみ（ピッカー本体は body 直下に生成）
		const emojiWrapper = actionsEl.createDiv({ cls: 'bluesky-emoji-wrapper' });
		const emojiBtn = new ButtonComponent(emojiWrapper)
			.setIcon('smile')
			.setTooltip(this.plugin.getLocale().addEmoji)
			.onClick(() => this.toggleEmojiPicker());
		this.emojiButtonEl = emojiBtn.buttonEl;

		// 文字カウンターを右端に配置
		this.charCountEl = footerRowEl.createDiv({ cls: 'bluesky-char-count' });

		this.initExternalEmojiPicker();
		this.textArea.addEventListener('input', () => {
			this.updateCharCount();
			// URL入力に追従してリンクプレビュー（external embed）を更新する
			this.debounceUpdatePreviews();
		});
		this.updateCharCount();
		// 下書きノートから引き継いだ画像を最初から表示する
		if (this.selectedImages.length > 0) this.updateImagePreviews();
		// 下書き本文など初期テキストにURLが含まれる場合もプレビューを取得する
		if (this.textArea.value) this.debounceUpdatePreviews();
		// 初期表示では絵文字ピッカーは閉じたまま
		this.setupModalHotkeys();
	}

	private setupModalHotkeys(): void {
		// textareaフォーカス中はObsidianのグローバルホットキーが無効になるため、
		// モーダルスコープに直接登録することでユーザー設定のホットキーを有効にする
		type Hotkey = { modifiers: Modifier[]; key: string };
		type HotkeyManagerLike = { getHotkeys(commandId: string): Hotkey[] | null | undefined };
		const hotkeyManager = (this.app as App & { hotkeyManager?: HotkeyManagerLike }).hotkeyManager;
		if (!hotkeyManager) return;

		const getHotkeys = (commandId: string): Hotkey[] =>
			hotkeyManager.getHotkeys(`post-to-bluesky:${commandId}`) ?? [];

		const actions: Record<string, () => void> = {
			'submit-post': () => { if (!this.isPosting) void this.handlePost(); },
			'cancel-post': () => this.close(),
			'add-image': () => { if (!this.isPosting) this.openImageSourceMenu(); },
			'toggle-emoji-picker': () => this.toggleEmojiPicker(),
		};

		for (const [cmdId, action] of Object.entries(actions)) {
			for (const hk of getHotkeys(cmdId)) {
				this.scope.register(hk.modifiers, hk.key, (e: KeyboardEvent) => {
					e.preventDefault();
					action();
					return false;
				});
			}
		}
	}

	showEmojiPicker(): void {
		if (!this.emojiPickerContainer) this.initExternalEmojiPicker();
		this.emojiPickerContainer?.classList.remove('bluesky-hidden');
		this.isEmojiPickerVisible = true;
		this.repositionEmojiPicker();
		this.outsideClickHandler = (e: MouseEvent) => {
			if (!this.emojiPickerContainer) return;
			if (!this.emojiPickerContainer.contains(e.target as Node) && !this.emojiButtonEl.contains(e.target as Node)) {
				this.hideEmojiPicker();
			}
		};
		activeDocument.addEventListener('mousedown', this.outsideClickHandler);
		this.repositionEmojiPickerBound = () => this.repositionEmojiPicker();
		window.addEventListener('resize', this.repositionEmojiPickerBound);
		window.addEventListener('scroll', this.repositionEmojiPickerBound, true);
	}

	hideEmojiPicker(): void {
		if (!this.emojiPickerContainer) return;
		this.emojiPickerContainer.classList.add('bluesky-hidden');
		this.isEmojiPickerVisible = false;
		// Clean up event listeners
		if (this.outsideClickHandler) {
			activeDocument.removeEventListener('mousedown', this.outsideClickHandler);
			this.outsideClickHandler = undefined;
		}
		if (this.repositionEmojiPickerBound) {
			window.removeEventListener('resize', this.repositionEmojiPickerBound);
			window.removeEventListener('scroll', this.repositionEmojiPickerBound, true);
			this.repositionEmojiPickerBound = undefined;
		}
	}

	insertEmoji(emoji: string): void {
		const cursorPosition = this.textArea.selectionStart;
		const currentValue = this.textArea.value;
		const newValue = currentValue.slice(0, cursorPosition) + emoji + currentValue.slice(this.textArea.selectionEnd);

		this.textArea.value = newValue;
		this.textArea.setSelectionRange(cursorPosition + emoji.length, cursorPosition + emoji.length);
		this.textArea.focus();

		// 文字数カウントを更新
		this.updateCharCount();
		this.debounceUpdatePreviews();

		// 絵文字ピッカーを閉じて DOM を除去（失敗時はログ）
		this.hideEmojiPicker();
		try {
			if (this.emojiPickerContainer && this.emojiPickerContainer.parentElement) {
				this.emojiPickerContainer.remove();
				this.emojiPickerContainer = null; // 後続誤参照防止
			}
		} catch (err) {
			console.error('[Post-To-Bluesky] Failed to remove emoji picker container:', err);
		}
	}

	/**
	 * 添付元（vault内 / 端末）を選ぶメニューを開く。
	 * ボタン1つに集約しているのは、フッターのボタンが増えるとモバイルで押し間違えやすく
	 * なるため。デスクトップでもコマンド・ホットキーからここを通す。
	 */
	openImageSourceMenu(evt?: MouseEvent): void {
		// 絵文字ピッカーは z-index 9999 で Obsidian のメニューより手前に出るので、
		// 開いたままだと添付元メニューが隠れてしまう
		this.hideEmojiPicker();
		const locale = this.plugin.getLocale();
		const menu = new Menu();
		menu.addItem((item) => item
			.setTitle(locale.addImageFromVault)
			.setIcon('image-file')
			.onClick(() => this.openVaultImagePicker()));
		menu.addItem((item) => item
			.setTitle(locale.addImageFromDevice)
			.setIcon('upload')
			.onClick(() => this.fileInput?.click()));
		if (evt) {
			menu.showAtMouseEvent(evt);
			return;
		}
		const rect = this.imageButtonEl.getBoundingClientRect();
		menu.showAtPosition({ x: rect.left, y: rect.bottom }, activeDocument);
	}

	/** vault 内の画像から添付する。端末のピッカーと違い保存先が既に決まっている経路 */
	private openVaultImagePicker(): void {
		if (this.selectedImages.length >= MAX_IMAGES) {
			new Notice(this.plugin.getLocale().maxImagesReached);
			return;
		}
		const images = getVaultImages(this.app);
		if (images.length === 0) {
			new Notice(this.plugin.getLocale().noImagesInVault);
			return;
		}
		new VaultImageSuggestModal(this.app, this.plugin, images, (file) => {
			this.addImages([{ name: file.name, vaultFile: file, deviceFile: null, fromDraft: false }]);
		}).open();
	}

	handleFileSelect(event: Event) {
		const input = event.target as HTMLInputElement;
		if (!input.files) return;
		this.addImages(Array.from(input.files).map((file) => ({
			name: file.name,
			vaultFile: null,
			deviceFile: file,
			fromDraft: false
		})));
		// 同一ファイル再選択のためにクリア
		input.value = '';
	}

	/**
	 * 添付候補を上限と重複を見ながら取り込む。
	 * vault内・端末・下書き由来のどの経路もここを通すので、上限判定が一箇所で済む。
	 */
	private addImages(candidates: SelectedImage[]): void {
		const remainingSlots = MAX_IMAGES - this.selectedImages.length;
		if (remainingSlots <= 0) {
			new Notice(this.plugin.getLocale().maxImagesReached);
			return;
		}
		const existing = new Set(this.selectedImages.map(selectedImageKey));
		const added: SelectedImage[] = [];
		for (const candidate of candidates) {
			const key = selectedImageKey(candidate);
			if (existing.has(key)) continue;
			existing.add(key);
			added.push(candidate);
			if (added.length >= remainingSlots) break;
		}
		if (added.length === 0) return;
		// 画像とリンクカードは Bluesky の embed として排他なので、画像を優先する
		this.linkPreviewData = null;
		this.linkPreviewContainer.empty();
		this.pendingLinkPreviewUrl = null;
		this.selectedImages.push(...added);
		this.updateImagePreviews();
		if (added.length < candidates.length && this.selectedImages.length >= MAX_IMAGES) {
			new Notice(this.plugin.getLocale().maxImagesReached);
		}
	}

	updateImagePreviews() {
		this.releasePreviewObjectUrls();
		this.imagePreviewContainer.empty();
		this.selectedImages.forEach((image) => {
			const previewEl = this.imagePreviewContainer.createDiv({ cls: 'bluesky-image-preview' });
			const img = previewEl.createEl('img', { attr: { alt: image.name || 'image' } });
			// vault 内の画像は resource path をそのまま使えるので blob URL の解放が要らない
			img.src = image.vaultFile
				? this.app.vault.getResourcePath(image.vaultFile)
				: URL.createObjectURL(image.deviceFile as File);
			const removeBtn = previewEl.createDiv({ cls: 'bluesky-remove-image-btn' });
			setIcon(removeBtn, 'x');
			removeBtn.onclick = () => {
				const currentIndex = this.selectedImages.indexOf(image);
				if (currentIndex !== -1) this.selectedImages.splice(currentIndex, 1);
				this.updateImagePreviews();
				if (this.selectedImages.length === 0) {
					// 画像が空ならリンクプレビューを再評価
					void this.updateLinkPreview();
				}
			};
		});
	}

	/** 端末から選んだ画像のプレビューURLを解放する（vault画像の resource path は対象外） */
	private releasePreviewObjectUrls(): void {
		try {
			this.imagePreviewContainer?.querySelectorAll('img').forEach((el) => {
				if (el.src?.startsWith('blob:')) URL.revokeObjectURL(el.src);
			});
		} catch (error) {
			console.debug('[Post-To-Bluesky] Failed to release preview blobs', error);
		}
	}

	/** 添付元の違いを吸収して画像のバイト列を得る */
	private async readImageBlob(image: SelectedImage): Promise<Blob> {
		if (image.deviceFile) return image.deviceFile;
		if (!image.vaultFile) throw new Error('Image source is missing');
		const buffer = await this.app.vault.readBinary(image.vaultFile);
		return new Blob([buffer], { type: mimeTypeForExtension(image.vaultFile.extension) });
	}

	updateCharCount() {
		const charCount = countGraphemes(this.textArea.value);
		this.charCountEl.textContent = `${charCount}/${MAX_POST_LENGTH}`;
		const isOverLimit = charCount > MAX_POST_LENGTH;
		this.charCountEl.toggleClass('bluesky-over-limit', isOverLimit);
		this.postButton.setDisabled(isOverLimit);
	}

	debounceUpdatePreviews() {
		if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
		this.debounceTimer = window.setTimeout(() => {
			void this.updateLinkPreview();
		}, 500);
	}

	async updateLinkPreview() {
		if (this.selectedImages.length > 0) return;
		const detected = extractFirstUrl(this.textArea.value);
		// 入力途中の不正なURLは未検出扱いにする
		const url = detected && parseUrlSafe(detected) ? detected : null;
		if (url && url === this.linkPreviewData?.url) return;
		this.linkPreviewContainer.empty();
		this.linkPreviewData = null;
		if (url) {
			this.pendingLinkPreviewUrl = url;
			const data = await this.fetchLinkPreview(url);
			if (this.pendingLinkPreviewUrl !== url) return;
			// 画像選択が始まっていたら表示しない
			if (this.selectedImages.length > 0) return;
			this.linkPreviewData = data;
			if (this.linkPreviewData) this.displayLinkPreview(this.linkPreviewData);
		} else {
			this.pendingLinkPreviewUrl = null;
		}
	}

	async fetchLinkPreview(url: string): Promise<LinkPreviewData | null> {
		try {
			const response = await requestUrl({ url });
			const doc = new DOMParser().parseFromString(response.text, 'text/html');
			const getOg = (prop: string) => doc.querySelector(`meta[property="${prop}"]`)?.getAttribute('content') || undefined;
			const getName = (name: string) => doc.querySelector(`meta[name="${name}"]`)?.getAttribute('content') || undefined;
			const titleElement = doc.querySelector('title');
			const titleText = titleElement?.textContent?.trim() || undefined;
			const baseHref = doc.querySelector('base[href]')?.getAttribute('href') || url;
			const base = new URL(baseHref, url);
			const resolve = (u?: string) => (u ? new URL(u, base).toString() : undefined);
			const ogImageSecure = getOg('og:image:secure_url');
			const ogImage = getOg('og:image');
			const imageUrl = resolve(ogImageSecure || ogImage);
			const rawTitle = getOg('og:title') || getName('twitter:title') || titleText || url;
			const rawDesc = getOg('og:description') || getName('twitter:description') || getName('description') || '';
			const clamp = (s?: string, max = 300) => s ? (s.length > max ? s.slice(0, max) : s) : s;
			return {
				url,
				title: clamp(rawTitle, 120),
				description: clamp(rawDesc, 300),
				image: imageUrl,
				domain: new URL(url).hostname
			};
		} catch (error) {
			console.error('Failed to fetch link preview:', error);
			return { url, title: url, domain: parseUrlSafe(url)?.hostname };
		}
	}

	displayLinkPreview(preview: LinkPreviewData) {
		this.linkPreviewContainer.empty();
		const cardEl = this.linkPreviewContainer.createDiv({ cls: 'bluesky-link-card' });
		if (preview.image) cardEl.createEl('img', { cls: 'bluesky-link-image' }).src = preview.image;
		const contentEl = cardEl.createDiv({ cls: 'bluesky-link-content' });
		if (preview.title) contentEl.createDiv({ cls: 'bluesky-link-title', text: preview.title });
		if (preview.description) contentEl.createDiv({ cls: 'bluesky-link-description', text: preview.description });
		if (preview.domain) contentEl.createDiv({ cls: 'bluesky-link-domain', text: preview.domain });
		cardEl.addEventListener('click', () => window.open(preview.url, '_blank'));
	}

	async handlePost() {
		if (this.isPosting) return;
		const text = this.textArea.value.trim();
		if (!text && this.selectedImages.length === 0) {
			new Notice(this.plugin.getLocale().pleaseEnterContent);
			return;
		}
		this.isPosting = true;
		this.postButton.setButtonText(this.plugin.getLocale().posting).setDisabled(true);
		try {
		let embed: Embed | undefined;

		if (this.selectedImages.length > 0) {
			try {
				// 1枚ずつ処理する。4枚を同時にデコードするとモバイルでメモリを圧迫するため
				const uploadedImages: Image[] = [];
				for (const image of this.selectedImages) {
					const source = await this.readImageBlob(image);
					const prepared = await prepareImageForUpload(source, 'image/jpeg');
					const uploaded = await this.plugin.uploadBlob(prepared.buffer, prepared.mimeType);
					uploadedImages.push({
						image: uploaded.blob,
						alt: '',
						aspectRatio: { width: prepared.width, height: prepared.height }
					});
				}
				embed = { $type: 'app.bsky.embed.images', images: uploadedImages };
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				new Notice(`${this.plugin.getLocale().imageUploadError}: ${message}`);
				this.postButton.setButtonText(this.plugin.getLocale().post).setDisabled(false);
				return;
			}
		} else if (this.linkPreviewData?.title) {
			let thumb;
			if (this.linkPreviewData.image) {
				try {
					const imgResponse = await requestUrl({ url: this.linkPreviewData.image });
					const blob = imgResponse.arrayBuffer;
					const ctEntry = Object.entries(imgResponse.headers).find(([k]) => k.toLowerCase() === 'content-type');
					const mimeType = (ctEntry?.[1] as string) || 'image/jpeg';
					const uploadedImage = await this.plugin.uploadBlob(blob, mimeType);
					// uploadBlob のレスポンスをそのまま使う（$type を落とすと createRecord が 400 になる）
					thumb = uploadedImage.blob;
				} catch (error) {
					console.error('Image upload failed:', error);
				}
			}
			embed = {
				$type: 'app.bsky.embed.external',
				external: {
					uri: this.linkPreviewData.url,
					title: this.linkPreviewData.title,
					description: this.linkPreviewData.description || '',
					thumb: thumb
				}
			};
		}

			const result = await this.plugin.postToBluesky(text, embed);
			if (result.success) {
				await this.plugin.recordPostResult(text, result.postUrl, this.sourceFile, this.selectedImages);
				this.close();
			} else if (this.plugin.activeModal === this) {
				this.postButton.setButtonText(this.plugin.getLocale().post).setDisabled(false);
			}
		} finally {
			this.isPosting = false;
		}
	}

		onClose() {
		if (this.plugin.activeModal === this) this.plugin.activeModal = null;
		if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
		this.hideEmojiPicker();
		this.releasePreviewObjectUrls();
		this.contentEl.empty();
	}
}

/**
 * vault 内の画像を選ばせるサジェスト。
 * 端末のファイルピッカーと違い PC・モバイルで挙動が変わらず、選んだ時点でパスが
 * 確定しているのでそのままノートに埋め込める。
 */
class VaultImageSuggestModal extends FuzzySuggestModal<TFile> {
	private images: TFile[];
	private onChooseImage: (file: TFile) => void;

	constructor(app: App, plugin: BlueskyPlugin, images: TFile[], onChooseImage: (file: TFile) => void) {
		super(app);
		this.images = images;
		this.onChooseImage = onChooseImage;
		this.setPlaceholder(plugin.getLocale().imagePickerPlaceholder);
	}

	getItems(): TFile[] {
		return this.images;
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile): void {
		this.onChooseImage(file);
	}
}

/** 下書きノートを投稿本文と添付画像に分けた結果 */
type DraftContent = { body: string; images: TFile[] };

/**
 * frontmatter で下書きと判定されたノートの一覧を表示し、選択したノートの本文で
 * PostModal を開くモーダル。
 */
class DraftSelectModal extends Modal {
	plugin: BlueskyPlugin;
	private isRendering = false;

	constructor(app: App, plugin: BlueskyPlugin) {
		super(app);
		this.plugin = plugin;
	}

	/** frontmatter の値が下書き判定値と一致するか（配列型も許容） */
	private matchesDraftValue(value: unknown): boolean {
		return frontmatterMatchesValue(value, this.plugin.settings.draftValue);
	}

	getDraftFiles(): TFile[] {
		const key = this.plugin.settings.draftProperty || DEFAULT_SETTINGS.draftProperty;
		return this.app.vault.getMarkdownFiles()
			.filter((file) => {
				const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
				// 投稿済みチェックが入っているノートは一覧から外す（チェックを外せば再び表示される）
				if (frontmatter?.[POSTED_CHECKBOX_PROPERTY] === true) return false;
				return this.matchesDraftValue(frontmatter?.[key]);
			})
			.sort((a, b) => b.stat.mtime - a.stat.mtime);
	}

	/**
	 * 下書きノートの内容を、投稿本文と添付画像に分ける。
	 *
	 * 画像の埋め込みを本文に残すと `![[写真.png]]` という文字列がそのまま Bluesky に
	 * 投稿され、画像は付かないのに文字数だけ消費する。そのため埋め込みは本文から取り除き、
	 * 添付画像として扱う。埋め込み記法の揺れ（wikilink / markdown / 表示指定つき）を
	 * 自前の正規表現で追わずに済むよう、metadataCache が解決した位置情報を使う。
	 *
	 * 上限を超える分の埋め込みも本文からは取り除く。どのみち投稿できないので、
	 * 文字列として本文に残るより取り除いたほうが害が小さい。
	 */
	private extractDraftContent(file: TFile, content: string): DraftContent {
		const embeds = this.app.metadataCache.getFileCache(file)?.embeds ?? [];
		const images: TFile[] = [];
		// 後ろから消さないと、先に消した分だけ後続の埋め込みのオフセットがずれる
		const ordered = [...embeds].sort((a, b) => b.position.start.offset - a.position.start.offset);
		let stripped = content;
		for (const embed of ordered) {
			const target = this.app.metadataCache.getFirstLinkpathDest(getLinkpath(embed.link), file.path);
			if (!target || !isImageFile(target)) continue;
			// 降順に走査しているので、先頭に積むと本文中の並び順に戻る
			images.unshift(target);
			stripped = stripped.slice(0, embed.position.start.offset) + stripped.slice(embed.position.end.offset);
		}
		// 埋め込みは frontmatter より後ろにしか現れないので、除去後も frontmatter の
		// 位置（stripFrontmatter が参照するキャッシュ）はずれない
		const body = this.stripFrontmatter(stripped, file).replace(/\n{3,}/g, '\n\n').trim();
		return { body, images: images.slice(0, MAX_IMAGES) };
	}

	/** 投稿本文として使うため frontmatter ブロックを除去する */
	stripFrontmatter(content: string, file: TFile): string {
		const end = this.app.metadataCache.getFileCache(file)?.frontmatterPosition?.end.offset;
		if (typeof end === 'number' && end <= content.length) {
			return content.slice(end).trim();
		}
		return content.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/, '').trim();
	}

	renderDraftItem(listEl: HTMLElement, file: TFile, draft: DraftContent): void {
		const count = countGraphemes(draft.body);
		const itemEl = listEl.createDiv({ cls: 'bluesky-draft-item', attr: { role: 'button', tabindex: '0' } });
		setIcon(itemEl.createSpan({ cls: 'bluesky-draft-icon' }), 'file-text');
		itemEl.createSpan({ cls: 'bluesky-draft-name', text: file.basename });
		// 添付される画像の枚数を出しておかないと、本文から埋め込みが消えて見えるのが不可解になる
		if (draft.images.length > 0) {
			const imageEl = itemEl.createSpan({ cls: 'bluesky-draft-images' });
			setIcon(imageEl.createSpan({ cls: 'bluesky-draft-images-icon' }), 'image-file');
			imageEl.createSpan({ text: String(draft.images.length) });
		}
		const countEl = itemEl.createSpan({ cls: 'bluesky-draft-count', text: `${count}/${MAX_POST_LENGTH}` });
		countEl.toggleClass('bluesky-over-limit', count > MAX_POST_LENGTH);

		const select = () => this.selectDraft(file, draft, count);
		itemEl.addEventListener('click', select);
		itemEl.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				select();
			}
		});
	}

	private selectDraft(file: TFile, draft: DraftContent, count: number): void {
		if (count > MAX_POST_LENGTH) {
			new Notice(`${this.plugin.getLocale().draftTooLong} (${count}/${MAX_POST_LENGTH})`);
		}
		this.close();
		this.plugin.openPostModal(draft.body, file, draft.images);
	}

	private async renderDrafts(): Promise<void> {
		const locale = this.plugin.getLocale();
		const files = this.getDraftFiles();
		if (files.length === 0) {
			new Notice(locale.noDraftsFound);
			this.close();
			return;
		}

		const listEl = this.contentEl.createDiv({ cls: 'bluesky-draft-list' });
		try {
			for (const file of files) {
				const content = await this.app.vault.cachedRead(file);
				// 読み込み中に閉じられた場合は描画を中断
				if (!this.isRendering) return;
				this.renderDraftItem(listEl, file, this.extractDraftContent(file, content));
			}
		} catch (error) {
			console.error('[Post-To-Bluesky] Failed to load draft notes:', error);
			new Notice(locale.draftLoadFailed);
			return;
		}

		const key = this.plugin.settings.draftProperty || DEFAULT_SETTINGS.draftProperty;
		this.contentEl.createDiv({
			cls: 'bluesky-draft-note',
			text: `${locale.draftFilterNote}: ${key} = ${this.plugin.settings.draftValue}`
				+ ` / ${POSTED_CHECKBOX_PROPERTY} ${locale.draftFilterUnposted}`
		});
	}

	onOpen(): void {
		this.contentEl.empty();
		this.contentEl.addClass('bluesky-draft-modal');
		this.setTitle(this.plugin.getLocale().draftSelectTitle);
		this.isRendering = true;
		void this.renderDrafts();
	}

	onClose(): void {
		this.isRendering = false;
		this.contentEl.empty();
	}
}

/**
 * vault 内フォルダのサジェスト付き入力。
 * Obsidian 1.13+ では宣言的設定の control type:'folder' が同等機能を持つため、
 * このクラスは display() フォールバック（1.13未満）専用。
 */
class FolderSuggest extends AbstractInputSuggest<TFolder> {
	private onSelectFolder: (path: string) => void;

	constructor(app: App, inputEl: HTMLInputElement, onSelectFolder: (path: string) => void) {
		super(app, inputEl);
		this.onSelectFolder = onSelectFolder;
	}

	protected getSuggestions(query: string): TFolder[] {
		const q = query.toLowerCase();
		return this.app.vault.getAllFolders(true).filter((folder) => folder.path.toLowerCase().includes(q));
	}

	renderSuggestion(folder: TFolder, el: HTMLElement): void {
		el.setText(folder.path);
	}

	selectSuggestion(folder: TFolder): void {
		this.setValue(folder.path);
		this.onSelectFolder(folder.path);
		this.close();
	}
}

/**
 * vault 内 Markdown ノートのサジェスト付き入力。
 * FolderSuggest と同じく、宣言的設定の control type:'file' が使えない
 * display() フォールバック（1.13未満）専用。
 */
class FileSuggest extends AbstractInputSuggest<TFile> {
	private onSelectFile: (path: string) => void;

	constructor(app: App, inputEl: HTMLInputElement, onSelectFile: (path: string) => void) {
		super(app, inputEl);
		this.onSelectFile = onSelectFile;
	}

	protected getSuggestions(query: string): TFile[] {
		const q = query.toLowerCase();
		return this.app.vault.getMarkdownFiles().filter((file) => file.path.toLowerCase().includes(q));
	}

	renderSuggestion(file: TFile, el: HTMLElement): void {
		el.setText(file.path);
	}

	selectSuggestion(file: TFile): void {
		this.setValue(file.path);
		this.onSelectFile(file.path);
		this.close();
	}
}

class BlueskySettingTab extends PluginSettingTab {
	plugin: BlueskyPlugin;

	constructor(app: App, plugin: BlueskyPlugin) { super(app, plugin); this.plugin = plugin; }

	getSettingDefinitions(): SettingDefinitionItem[] {
		const locale = this.plugin.getLocale();
		return [
			{
				name: locale.handleLabel,
				desc: locale.handleDesc,
				control: { type: 'text', key: 'handle', placeholder: locale.handlePlaceholder }
			},
			{
				// パスワードは入力マスクが必要なため render で描画（宣言的 text コントロールは type='password' 不可）
				name: locale.passwordLabel,
				desc: locale.passwordDesc,
				render: (setting) => {
					setting.addText(text => {
						text.setPlaceholder(locale.passwordPlaceholder)
							.setValue(this.plugin.settings.password);
						text.inputEl.type = 'password';
						text.inputEl.autocomplete = 'current-password';
						text.onChange(async (value) => {
							this.plugin.settings.password = value;
							await this.plugin.saveSettings();
						});
					});
				}
			},
			{
				name: locale.timeoutLabel,
				desc: locale.timeoutDesc,
				control: { type: 'number', key: 'networkTimeoutMs', placeholder: locale.timeoutPlaceholder, defaultValue: 15000, min: 1000, max: 60000, step: 1 }
			},
			{
				name: locale.hashtagsLabel,
				desc: locale.hashtagsDesc,
				control: { type: 'text', key: 'defaultHashtags', placeholder: locale.hashtagsPlaceholder }
			},
			{
				name: locale.draftPropertyLabel,
				desc: locale.draftPropertyDesc,
				control: { type: 'text', key: 'draftProperty', placeholder: DEFAULT_SETTINGS.draftProperty, defaultValue: DEFAULT_SETTINGS.draftProperty }
			},
			{
				name: locale.draftValueLabel,
				desc: locale.draftValueDesc,
				control: { type: 'text', key: 'draftValue', placeholder: DEFAULT_SETTINGS.draftValue, defaultValue: DEFAULT_SETTINGS.draftValue }
			},
			{
				name: locale.postHistoryLabel,
				desc: locale.postHistoryDesc,
				control: { type: 'toggle', key: 'postHistoryEnabled', defaultValue: false }
			},
			{
				name: locale.postHistoryFolderLabel,
				desc: locale.postHistoryFolderDesc,
				control: {
					type: 'folder',
					key: 'postHistoryFolder',
					placeholder: DEFAULT_SETTINGS.postHistoryFolder,
					defaultValue: DEFAULT_SETTINGS.postHistoryFolder,
					includeRoot: true,
					disabled: () => !this.plugin.settings.postHistoryEnabled
				}
			},
			{
				name: locale.linkPropertyLabel,
				desc: locale.linkPropertyDesc,
				control: { type: 'text', key: 'linkProperty', placeholder: DEFAULT_SETTINGS.linkProperty, defaultValue: DEFAULT_SETTINGS.linkProperty }
			},
			{
				name: locale.draftLinkTargetLabel,
				desc: locale.draftLinkTargetDesc,
				control: {
					type: 'file',
					key: 'draftLinkTarget',
					placeholder: locale.linkTargetPlaceholder,
					filter: (file) => file.extension === 'md',
					validate: (value) => this.validateLinkTarget(value)
				}
			},
			{
				name: locale.historyLinkTargetLabel,
				desc: locale.historyLinkTargetDesc,
				control: {
					type: 'file',
					key: 'historyLinkTarget',
					placeholder: locale.linkTargetPlaceholder,
					filter: (file) => file.extension === 'md',
					validate: (value) => this.validateLinkTarget(value),
					disabled: () => !this.plugin.settings.postHistoryEnabled
				}
			},
			{
				name: locale.saveImagesToVaultLabel,
				desc: locale.saveImagesToVaultDesc,
				control: { type: 'toggle', key: 'saveImagesToVault', defaultValue: DEFAULT_SETTINGS.saveImagesToVault }
			}
		];
	}

	/**
	 * 紐づけ先の入力値を検証する（1.13+ の宣言的コントロール専用）。
	 * 空欄は「紐づけなし」なので有効。存在しないパスはこの場でインラインエラーにして、
	 * 投稿時に初めて気づく事態を避ける。
	 * 変数入りの設定は未作成リンクを許す仕様なので、実在しなくてもエラーにしない。
	 */
	private validateLinkTarget(value: string): string | void {
		const template = value?.trim();
		if (!template || hasTemplatePlaceholder(template)) return;
		if (!findNoteByPath(this.app, template)) {
			return this.plugin.getLocale().linkTargetMissing;
		}
	}

	setControlValue(key: string, value: unknown): Promise<void> {
		if (key === 'networkTimeoutMs') {
			const n = Number(value);
			value = Number.isFinite(n) ? Math.min(Math.max(Math.round(n), 1000), 60000) : 15000;
		}
		(this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
		// 履歴トグルの状態は保存先フォルダ欄と履歴ノート紐づけ先欄の disabled 判定に
		// 使われるため再評価させる
		// refreshDomState() は 1.13.0 で追加されたAPI。この経路自体が宣言的レンダラ
		// （1.13+）からしか呼ばれないが、minAppVersion が 1.8.7 なので明示的にガードする
		if (requireApiVersion('1.13.0') && key === 'postHistoryEnabled') this.refreshDomState();
		return this.plugin.saveSettings();
	}

	// Obsidian 1.13 未満用フォールバック（1.13+ では getSettingDefinitions から宣言的に描画される）
	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName(this.plugin.getLocale().handleLabel)
			.setDesc(this.plugin.getLocale().handleDesc)
			.addText(text => text
				.setPlaceholder(this.plugin.getLocale().handlePlaceholder)
				.setValue(this.plugin.settings.handle)
				.onChange(async (value) => {
					this.plugin.settings.handle = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(this.plugin.getLocale().passwordLabel)
			.setDesc(this.plugin.getLocale().passwordDesc)
			.addText(text => {
				text.setPlaceholder(this.plugin.getLocale().passwordPlaceholder)
					.setValue(this.plugin.settings.password);
				// パスワードをマスク
				text.inputEl.type = 'password';
				text.inputEl.autocomplete = 'current-password';
				text.onChange(async (value) => {
					this.plugin.settings.password = value;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName(this.plugin.getLocale().timeoutLabel)
			.setDesc(this.plugin.getLocale().timeoutDesc)
			.addText(text => text
				.setPlaceholder(this.plugin.getLocale().timeoutPlaceholder)
				.setValue(String(this.plugin.settings.networkTimeoutMs ?? 15000))
				.onChange(async (value) => {
					const n = Number(value);
					const clamped = Number.isFinite(n) ? Math.min(Math.max(Math.round(n), 1000), 60000) : 15000;
					this.plugin.settings.networkTimeoutMs = clamped;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(this.plugin.getLocale().hashtagsLabel)
			.setDesc(this.plugin.getLocale().hashtagsDesc)
			.addText(text => text
				.setPlaceholder(this.plugin.getLocale().hashtagsPlaceholder)
				.setValue(this.plugin.settings.defaultHashtags)
				.onChange(async (value) => {
					this.plugin.settings.defaultHashtags = value;
					await this.plugin.saveSettings();
				}));

		const locale = this.plugin.getLocale();

		new Setting(containerEl)
			.setName(locale.draftPropertyLabel)
			.setDesc(locale.draftPropertyDesc)
			.addText(text => text
				.setPlaceholder(DEFAULT_SETTINGS.draftProperty)
				.setValue(this.plugin.settings.draftProperty)
				.onChange(async (value) => {
					this.plugin.settings.draftProperty = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(locale.draftValueLabel)
			.setDesc(locale.draftValueDesc)
			.addText(text => text
				.setPlaceholder(DEFAULT_SETTINGS.draftValue)
				.setValue(this.plugin.settings.draftValue)
				.onChange(async (value) => {
					this.plugin.settings.draftValue = value;
					await this.plugin.saveSettings();
				}));

		// 履歴に依存する欄はトグルに追従してグレーアウトさせる。display() を呼び直すと
		// 設定画面ごと作り直しになり入力中のフォーカスも飛ぶので、該当欄だけを更新する
		const historyDependents: { setting: Setting | null; text: TextComponent | null }[] = [];
		const applyHistoryDisabled = () => {
			const disabled = !this.plugin.settings.postHistoryEnabled;
			for (const dependent of historyDependents) {
				dependent.setting?.setDisabled(disabled);
				dependent.text?.setDisabled(disabled);
			}
		};

		new Setting(containerEl)
			.setName(locale.postHistoryLabel)
			.setDesc(locale.postHistoryDesc)
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.postHistoryEnabled)
				.onChange(async (value) => {
					this.plugin.settings.postHistoryEnabled = value;
					await this.plugin.saveSettings();
					applyHistoryDisabled();
				}));

		const folderDependent: { setting: Setting | null; text: TextComponent | null } = { setting: null, text: null };
		historyDependents.push(folderDependent);
		folderDependent.setting = new Setting(containerEl)
			.setName(locale.postHistoryFolderLabel)
			.setDesc(locale.postHistoryFolderDesc)
			.addText(text => {
				folderDependent.text = text;
				text.setPlaceholder(DEFAULT_SETTINGS.postHistoryFolder)
					.setValue(this.plugin.settings.postHistoryFolder)
					.onChange(async (value) => {
						this.plugin.settings.postHistoryFolder = value;
						await this.plugin.saveSettings();
					});
				new FolderSuggest(this.app, text.inputEl, (path) => {
					text.setValue(path);
					this.plugin.settings.postHistoryFolder = path;
					void this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName(locale.linkPropertyLabel)
			.setDesc(locale.linkPropertyDesc)
			.addText(text => text
				.setPlaceholder(DEFAULT_SETTINGS.linkProperty)
				.setValue(this.plugin.settings.linkProperty)
				.onChange(async (value) => {
					this.plugin.settings.linkProperty = value;
					await this.plugin.saveSettings();
				}));

		this.addLinkTargetSetting(containerEl, locale.draftLinkTargetLabel, locale.draftLinkTargetDesc, 'draftLinkTarget');

		const historyLinkDependent = this.addLinkTargetSetting(
			containerEl, locale.historyLinkTargetLabel, locale.historyLinkTargetDesc, 'historyLinkTarget'
		);
		historyDependents.push(historyLinkDependent);

		new Setting(containerEl)
			.setName(locale.saveImagesToVaultLabel)
			.setDesc(locale.saveImagesToVaultDesc)
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.saveImagesToVault)
				.onChange(async (value) => {
					this.plugin.settings.saveImagesToVault = value;
					await this.plugin.saveSettings();
				}));

		applyHistoryDisabled();
	}

	/**
	 * 紐づけ先ノートの入力欄を1件描画する（display() フォールバック専用）。
	 * グレーアウト制御のために Setting と TextComponent の参照を返す。
	 */
	private addLinkTargetSetting(
		containerEl: HTMLElement,
		name: string,
		desc: string,
		key: 'draftLinkTarget' | 'historyLinkTarget'
	): { setting: Setting | null; text: TextComponent | null } {
		const dependent: { setting: Setting | null; text: TextComponent | null } = { setting: null, text: null };
		dependent.setting = new Setting(containerEl)
			.setName(name)
			.setDesc(desc)
			.addText(text => {
				dependent.text = text;
				text.setPlaceholder(this.plugin.getLocale().linkTargetPlaceholder)
					.setValue(this.plugin.settings[key])
					.onChange(async (value) => {
						this.plugin.settings[key] = value;
						await this.plugin.saveSettings();
					});
				new FileSuggest(this.app, text.inputEl, (path) => {
					text.setValue(path);
					this.plugin.settings[key] = path;
					void this.plugin.saveSettings();
				});
			});
		return dependent;
	}
}
