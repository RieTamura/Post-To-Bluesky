import { Notice, App, Modal, ButtonComponent, Setting, PluginSettingTab, requestUrl, setIcon, Plugin, getLanguage, Platform, AbstractInputSuggest, normalizePath, TFile, TFolder, Modifier } from 'obsidian';
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
}

const DEFAULT_SETTINGS: BlueskyPluginSettings = {
	handle: '',
	password: '',
	networkTimeoutMs: 15000,
	defaultHashtags: '',
	draftProperty: 'type',
	draftValue: 'bluesky-draft',
	postHistoryEnabled: false,
	postHistoryFolder: 'Bluesky Posts'
};

// 履歴ノート(B)の種別を示す frontmatter 値
const POSTED_FRONTMATTER_VALUE = 'bluesky-posted';
// 投稿済みを示す真偽値プロパティ。Obsidian の Properties UI ではチェックボックスとして表示される。
// 下書きノートは draftProperty の値を保ったままこれが true になり、下書き一覧から外れる
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
			maxImagesReached: '画像は最大4枚までです。',
			addImage: '画像追加',
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
			postHistorySaveFailed: '投稿履歴の保存に失敗しました'
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
		maxImagesReached: 'Maximum 4 images allowed.',
		addImage: 'Add image',
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
		postHistorySaveFailed: 'Failed to save post history'
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

		// 画像添付はデスクトップのみ対応
		if (!Platform.isMobile) {
			this.addCommand({
				id: 'add-image',
				name: 'Add image',
				callback: () => {
					if (this.activeModal && !this.activeModal.isPosting) {
						this.activeModal.fileInput?.click();
					}
				}
			});
		}

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
		const loaded = await this.loadData();
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
		openPostModal(initialText = '', sourceFile: TFile | null = null) {
			if (this.activeModal) return;
			// 予備ログイン（失敗しても無視）
			if (!this.accessJwt) {
				void this.login().catch(() => {});
			}
			const modal = new PostModal(this.app, this, initialText, sourceFile);
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
		async recordPostResult(text: string, postUrl: string | undefined, sourceFile: TFile | null): Promise<void> {
			try {
				if (sourceFile) {
					await this.markDraftAsPosted(sourceFile, postUrl);
					return;
				}
				if (!this.settings.postHistoryEnabled) return;
				await this.createPostHistoryNote(text, postUrl);
			} catch (error) {
				console.error('[Post-To-Bluesky] Failed to record post:', error);
				new Notice(this.getLocale().postHistorySaveFailed);
			}
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

		/** 投稿履歴ノートを作成する（B） */
		private async createPostHistoryNote(text: string, postUrl: string | undefined): Promise<void> {
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
			const frontmatter = [
				'---',
				`${this.settings.draftProperty || DEFAULT_SETTINGS.draftProperty}: ${POSTED_FRONTMATTER_VALUE}`,
				`${POSTED_CHECKBOX_PROPERTY}: true`,
				`posted_at: ${this.formatLocalTimestamp(now)}`,
				...(postUrl ? [`url: ${postUrl}`] : []),
				...(tags.length > 0 ? ['tags:', ...tags.map((tag) => `  - ${toYamlTag(tag)}`)] : []),
				'---'
			].join('\n');
			await this.app.vault.create(path, `${frontmatter}\n${body}\n`);
		}

		/**
		 * 下書きノートの frontmatter を投稿済みに更新する（C）。
		 * draftProperty から下書き値を取り除き、投稿済みかどうかはチェックボックス用の
		 * 真偽値プロパティで表す。下書き値以外の要素（利用者独自のタグ等）は残す。
		 */
		private async markDraftAsPosted(file: TFile, postUrl: string | undefined): Promise<void> {
			const key = this.settings.draftProperty || DEFAULT_SETTINGS.draftProperty;
			const draftValue = this.settings.draftValue;
			const postedAt = this.formatLocalTimestamp(new Date());
			await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
				const current: unknown = frontmatter[key];
				if (Array.isArray(current)) {
					const rest = current.filter((v) => String(v) !== draftValue);
					// 下書き値しか入っていなかった場合はキーごと削除する
					if (rest.length > 0) frontmatter[key] = rest;
					else delete frontmatter[key];
				} else if (current !== undefined && String(current) === draftValue) {
					delete frontmatter[key];
				}
				frontmatter[POSTED_CHECKBOX_PROPERTY] = true;
				frontmatter.posted_at = postedAt;
				if (postUrl) frontmatter.url = postUrl;
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
	fileInput: HTMLInputElement | null = null; // モバイルでは画像添付非対応のため null
	sourceFile: TFile | null = null; // 下書きノート由来の投稿のみ設定される
	selectedImages: File[] = [];
	linkPreviewData: LinkPreviewData | null = null;
	pendingLinkPreviewUrl: string | null = null;
	debounceTimer: number | null = null;
	isEmojiPickerVisible = false;
	isPosting = false;
	outsideClickHandler?: (e: MouseEvent) => void;
	private repositionEmojiPickerBound?: () => void;

	constructor(app: App, plugin: BlueskyPlugin, initialText = '', sourceFile: TFile | null = null) {
		super(app);
		this.plugin = plugin;
		this.initialText = initialText;
		this.sourceFile = sourceFile;
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

		// 画像添付はデスクトップのみ。モバイルでは入力要素とボタンを作らない
		if (!Platform.isMobile) {
			const fileInput = contentEl.createEl('input', { cls: 'bluesky-hidden', attr: { type: 'file', accept: 'image/*' } });
			fileInput.multiple = true;
			fileInput.onchange = (e) => this.handleFileSelect(e);
			this.fileInput = fileInput;

			// 画像追加ボタン
			new ButtonComponent(actionsEl)
				.setIcon('image-file')
				.setTooltip(`${this.plugin.getLocale().addImage} (最大4枚)`)
				.onClick(() => fileInput.click());
		}

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
			'add-image': () => { if (!this.isPosting) this.fileInput?.click(); },
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

	// キーボードイベントハンドラー
	handleFileSelect(event: Event) {
		const files = (event.target as HTMLInputElement).files;
		if (!files) return;
		const remainingSlots = Math.max(0, 4 - this.selectedImages.length);
		if (remainingSlots === 0) { new Notice(this.plugin.getLocale().maxImagesReached); (event.target as HTMLInputElement).value = ''; return; }
		if (files.length > 0) {
			this.linkPreviewData = null;
			this.linkPreviewContainer.empty();
			this.pendingLinkPreviewUrl = null;
		}
		const existing = new Set(this.selectedImages.map(f => `${f.name}|${f.size}|${f.lastModified}`));
		const uniques: File[] = [];
		for (const file of Array.from(files)) {
			const key = `${file.name}|${file.size}|${file.lastModified}`;
			if (existing.has(key)) continue;
			uniques.push(file);
			if (uniques.length >= remainingSlots) break;
		}
		this.selectedImages.push(...uniques);
		this.updateImagePreviews();
		// 同一ファイル再選択のためにクリア
		if (this.fileInput) this.fileInput.value = '';
	}

	updateImagePreviews() {
		// Revoke existing object URLs before clearing to avoid memory leaks
		this.imagePreviewContainer.querySelectorAll('img').forEach((el) => {
			if (el.src && el.src.startsWith('blob:')) {
				URL.revokeObjectURL(el.src);
			}
		});
		this.imagePreviewContainer.empty();
		this.selectedImages.forEach((file) => {
			const previewEl = this.imagePreviewContainer.createDiv({ cls: 'bluesky-image-preview' });
			const img = previewEl.createEl('img', { attr: { alt: file.name || 'image' } });
			const objectUrl = URL.createObjectURL(file);
			img.src = objectUrl;
			const removeBtn = previewEl.createDiv({ cls: 'bluesky-remove-image-btn' });
			setIcon(removeBtn, 'x');
			removeBtn.onclick = () => {
				const currentIndex = this.selectedImages.indexOf(file);
				if (currentIndex !== -1) this.selectedImages.splice(currentIndex, 1);
				if (img.src && img.src.startsWith('blob:')) {
					URL.revokeObjectURL(img.src);
				}
				this.updateImagePreviews();
				if (this.selectedImages.length === 0) {
					// 画像が空ならリンクプレビューを再評価
					void this.updateLinkPreview();
				}
			};
		});
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
				const uploadedImages: Image[] = await Promise.all(this.selectedImages.map(async (file) => {
					const imageBitmap = await createImageBitmap(file);
					const { width, height } = imageBitmap;
					const canvas = createEl('canvas');
					const MAX_EDGE = 2048;
					const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
					canvas.width = Math.max(1, Math.round(width * scale));
					canvas.height = Math.max(1, Math.round(height * scale));
					const ctx = canvas.getContext('2d');
					if (!ctx) throw new Error('Failed to get canvas context');
					ctx.drawImage(imageBitmap, 0, 0, canvas.width, canvas.height);
					imageBitmap.close();
					const processedBlob = await new Promise<Blob>((resolve, reject) => {
						const fallbackType = file.type || 'image/jpeg';
						const quality: number | undefined = fallbackType === 'image/jpeg' ? 0.92 : undefined;
						canvas.toBlob(
							(blob) => blob ? resolve(blob) : reject(new Error('Canvas to Blob conversion failed')),
							fallbackType,
							quality
						);
					});
					const buffer = await processedBlob.arrayBuffer();
					const uploaded = await this.plugin.uploadBlob(buffer, processedBlob.type);
					return {
						image: uploaded.blob,
						alt: '',
						aspectRatio: { width: canvas.width, height: canvas.height }
					};
				}));
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
				await this.plugin.recordPostResult(text, result.postUrl, this.sourceFile);
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
		// 画像プレビューの blob URL を解放
		try {
			this.imagePreviewContainer?.querySelectorAll('img').forEach((el) => {
				const src = el.src;
				if (src?.startsWith('blob:')) URL.revokeObjectURL(src);
			});
		} catch (error) {
			console.debug('[Post-To-Bluesky] Failed to release preview blobs', error);
		}
		this.contentEl.empty();
	}
}

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
		const target = this.plugin.settings.draftValue;
		if (!target || value === undefined || value === null) return false;
		if (Array.isArray(value)) return value.some((v) => String(v) === target);
		return String(value) === target;
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

	/** 投稿本文として使うため frontmatter ブロックを除去する */
	stripFrontmatter(content: string, file: TFile): string {
		const end = this.app.metadataCache.getFileCache(file)?.frontmatterPosition?.end.offset;
		if (typeof end === 'number' && end <= content.length) {
			return content.slice(end).trim();
		}
		return content.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/, '').trim();
	}

	renderDraftItem(listEl: HTMLElement, file: TFile, body: string): void {
		const count = countGraphemes(body);
		const itemEl = listEl.createDiv({ cls: 'bluesky-draft-item', attr: { role: 'button', tabindex: '0' } });
		setIcon(itemEl.createSpan({ cls: 'bluesky-draft-icon' }), 'file-text');
		itemEl.createSpan({ cls: 'bluesky-draft-name', text: file.basename });
		const countEl = itemEl.createSpan({ cls: 'bluesky-draft-count', text: `${count}/${MAX_POST_LENGTH}` });
		countEl.toggleClass('bluesky-over-limit', count > MAX_POST_LENGTH);

		const select = () => this.selectDraft(file, body, count);
		itemEl.addEventListener('click', select);
		itemEl.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				select();
			}
		});
	}

	private selectDraft(file: TFile, body: string, count: number): void {
		if (count > MAX_POST_LENGTH) {
			new Notice(`${this.plugin.getLocale().draftTooLong} (${count}/${MAX_POST_LENGTH})`);
		}
		this.close();
		this.plugin.openPostModal(body, file);
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
				this.renderDraftItem(listEl, file, this.stripFrontmatter(content, file));
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
			}
		];
	}

	setControlValue(key: string, value: unknown): Promise<void> {
		if (key === 'networkTimeoutMs') {
			const n = Number(value);
			value = Number.isFinite(n) ? Math.min(Math.max(Math.round(n), 1000), 60000) : 15000;
		}
		(this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
		// 履歴トグルの状態は保存先フォルダ欄の disabled 判定に使われるため再評価させる
		if (key === 'postHistoryEnabled') this.refreshDomState();
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

		new Setting(containerEl)
			.setName(locale.postHistoryLabel)
			.setDesc(locale.postHistoryDesc)
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.postHistoryEnabled)
				.onChange(async (value) => {
					this.plugin.settings.postHistoryEnabled = value;
					await this.plugin.saveSettings();
					// 保存先フォルダ欄の有効/無効を切り替えるため再描画する
					this.display();
				}));

		const historyEnabled = this.plugin.settings.postHistoryEnabled;
		new Setting(containerEl)
			.setName(locale.postHistoryFolderLabel)
			.setDesc(locale.postHistoryFolderDesc)
			.setDisabled(!historyEnabled)
			.addText(text => {
				text.setPlaceholder(DEFAULT_SETTINGS.postHistoryFolder)
					.setValue(this.plugin.settings.postHistoryFolder)
					.setDisabled(!historyEnabled)
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
	}
}
