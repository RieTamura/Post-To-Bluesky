import { Notice, App, Modal, ButtonComponent, Setting, PluginSettingTab, requestUrl, setIcon, Plugin, Platform } from 'obsidian';
import type { RequestUrlParam, RequestUrlResponse } from 'obsidian';

// 統一された絵文字リスト（複数箇所の重複定義を解消）
const EMOJI_LIST: string[] = [
	'😀','😄','😁','😂','🤣','😅','😊','🙂','😉','😍','🥰','😘','😙','😚','😋','😜','😝','😎','🤓','🤔','🤨','😐','😑','😶','🙄','😮','😲','🥱','😴','🤤','😭','😤','😡','🤯','😳','🥶','🥳','🤩','😇','😷','🤒','🤕','🤢','🤮','🤧',
	'👍','👎','👌','✌️','🤞','🤟','🤘','🤙','👏','🙌','👐','✋','🤚','👋','🤏','💪','🫶','🫰',
	'😺','😸','😹','😻','😼','😽','🙀','😿','😾',
	'❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','❣️','💕','💞','💓','💗','💖','💘','💝','💤','💢','✨','⚡','🔥','⭐','🌟','💫','🎊','🎈',
	'📝','🖊️','📎','📌','📚','💡','🖥️','📱','⌚','🕹️','🎮','🎵','🎶','🎧','🎤','🎬','📷','🗓️','⏰','📦',
	'🌞','🌙','☁️','🌧️','🌈','❄️','🌸','🌻','🍀','🍎','🍊','🍋','🍇','🍓','🥝','🥑','🍙','🍣','🍜','☕','🍺','🍻','🥂'
];

type SegmenterCtor = new (
	locales?: string | string[],
	options?: { granularity?: 'grapheme' | 'word' | 'sentence' }
) => { segment(input: string): IterableIterator<{ segment: string }> };

type IntlWithOptionalApis = typeof Intl & {
	Segmenter?: SegmenterCtor;
	getCanonicalLocales?: (locales?: string | string[]) => string[];
};

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
	settingsTitle: string;
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
};

// 追加: 設定用インターフェース & デフォルト値
interface BlueskyPluginSettings {
	handle: string;
	password: string;
	networkTimeoutMs: number;
	defaultHashtags: string;
	forceLanguage?: 'en' | 'ja';
	detectedLanguage?: string; // 後方互換
	hotkeys: {
		cancel: string;
		post: string;
		addImage: string;
		emoji: string;
	};
	language?: string; // 旧フィールド後方互換
}

const DEFAULT_SETTINGS: BlueskyPluginSettings = {
	handle: '',
	password: '',
	networkTimeoutMs: 15000,
	defaultHashtags: '',
	forceLanguage: 'en',
	hotkeys: {
		cancel: 'Escape',
		post: 'Mod+Enter',
		addImage: 'Mod+I',
		emoji: 'Mod+E'
	},
	language: 'en'
};

// Bluesky API embed 関連型（復元）
interface BlueskyBlobRef {
	_type: 'blob';
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
type LinkFacet = { index: FacetByteRange; features: [LinkFacetFeature] };
type TagFacet = { index: FacetByteRange; features: [TagFacetFeature] };
type Facet = LinkFacet | TagFacet;

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

type ObsidianLanguageConfig = {
	language?: string;
	app?: { language?: string };
	settings?: { language?: string };
};
// ---- End added types ----

// ---- Added hotkey conflict detection types (fix for missing HotkeyConflict) ----
interface HotkeyConflict {
	hotkey: string;
	description: string;
	severity: 'warning' | 'error';
}

class HotkeyConflictDetector {
	private static reserved: { pattern: RegExp; description: string; severity: 'warning' | 'error' }[] = [
		{ pattern: /^ctrl\+w$/i, description: 'Browser tab close', severity: 'warning' },
		{ pattern: /^ctrl\+r$/i, description: 'Browser reload', severity: 'warning' },
		{ pattern: /^ctrl\+shift\+i$/i, description: 'Browser developer tools', severity: 'warning' },
		{ pattern: /^meta\+w$/i, description: 'Close window/tab (macOS)', severity: 'warning' },
		{ pattern: /^meta\+q$/i, description: 'Quit application (macOS)', severity: 'error' }
	];

	private static normalize(h: string): string {
		return h.toLowerCase().replace(/\s+/g, '');
	}

	static detectConflicts(hotkey: string): HotkeyConflict[] {
		if (!hotkey) return [];
		const norm = this.normalize(hotkey);
		const matches = this.reserved.filter(r => r.pattern.test(norm));
		return matches.map(m => ({ hotkey, description: m.description, severity: m.severity }));
	}

	static generateConflictDescription(conflicts: HotkeyConflict[]): string {
		if (!conflicts.length) return '';
		const lines = conflicts.map(c => `${c.hotkey}: ${c.description}`);
		return lines.join('<br>');
	}
}
// ---- End added hotkey conflict detection types ----

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
			settingsTitle: 'Bluesky 設定',
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
			posting: '投稿中...'
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
		addImage: 'Add Image',
		addEmoji: 'Add Emoji',
		hotkeys: 'Hotkeys',
		placeholderText: 'Enter post content...',
		settingsTitle: 'Bluesky Settings',
		handleLabel: 'Handle',
		handleDesc: 'Enter your Bluesky handle.',
		handlePlaceholder: 'your-handle.bsky.social',
		passwordLabel: 'Password',
		passwordDesc: 'Enter your Bluesky app password.',
		passwordPlaceholder: 'App password',
		timeoutLabel: 'Timeout',
		timeoutDesc: 'Network timeout (ms)',
		timeoutPlaceholder: '15000',
		hashtagsLabel: 'Default Hashtags',
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
		postHotkeyLabel: 'Post Hotkey',
		postHotkeyDesc: 'Hotkey to post',
		imageHotkeyLabel: 'Add Image Hotkey',
		imageHotkeyDesc: 'Hotkey to add image',
		emojiHotkeyLabel: 'Add Emoji Hotkey',
		emojiHotkeyDesc: 'Hotkey to add emoji',
		appPasswordNote: 'Use your Bluesky app password.',
		hotkeyFormatNote: 'Specify hotkeys like "Mod+Enter".',
		hotkeyConflictNote: 'A warning will be shown if hotkeys conflict.',
		hotkeyConflictWarning: 'Hotkey conflict detected.',
		duplicateHotkeys: 'Duplicate hotkeys',
		posting: 'Posting...'
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
		languageIntervalId: number | null = null;
	
		async onload() {
			await this.loadSettings();
			await this.updateLanguageSettings();
			this.addSettingTab(new BlueskySettingTab(this.app, this));

			// 投稿用コマンド登録（コマンドパレット表示 & デフォルトホットキー）
			this.addCommand({
				id: 'open-bluesky-composer',
				name: 'Open post composer',
				callback: () => this.openPostModal()
			});

			// リボンアイコン（左サイドバー）
			this.addRibbonIcon('send', 'Open post composer', () => this.openPostModal());
		}
	
		onunload() { }
	
		async loadSettings() {
			const loaded = await this.loadData();
			if (loaded && typeof loaded.language === 'string') {
				const originalLang = loaded.language.trim();
				try {
					const intlApi = Intl as IntlWithOptionalApis;
					const canonical = typeof intlApi.getCanonicalLocales === 'function'
						? intlApi.getCanonicalLocales(originalLang)
						: [];
					if (Array.isArray(canonical) && canonical.length > 0) {
						const primary = String(canonical[0]).split('-')[0];
						if (primary) {
							loaded.language = primary;
						}
					}
				} catch {
					loaded.language = originalLang;
				}
			}
			if (loaded && typeof loaded.detectedLanguage === 'undefined' && typeof loaded.language === 'string') {
				loaded.detectedLanguage = loaded.language;
			}
			this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
		}

		async saveSettings() {
			try {
				await this.saveData(this.settings);
			} catch (e) {
				console.error('Failed to save settings:', e);
			}
		}
	
		private setupLanguagePolling() {
			// 自動検出機能は削除したため、既存のポーリングは必ず停止する
			if (this.languageIntervalId !== null) {
				window.clearInterval(this.languageIntervalId);
				this.languageIntervalId = null;
			}
		}
	
		private async readObsidianConfig(): Promise<string | null> {
			const adapter = this.app.vault?.adapter;
			if (!adapter) return null;
			const configDir = this.app.vault.configDir ?? '.obsidian';
			const candidates = ['app.json', 'config.json', 'settings.json'].map((name) => `${configDir}/${name}`);
			for (const configPath of candidates) {
				try {
					const configContent = await adapter.read(configPath);
					const parsed = JSON.parse(configContent) as ObsidianLanguageConfig;
					const detected = parsed.language ?? parsed.app?.language ?? parsed.settings?.language;
					if (typeof detected === 'string') {
						return detected;
					}
				} catch (error) {
					console.debug('[Post-To-Bluesky] Unable to read config file', configPath, error);
				}
			}
			return null;
		}
	
		public async updateLanguageSettings() {
			// 直接 forceLanguage を使用（'en' または 'ja' のみ）
			this.setupLanguagePolling();
			try {
				const finalLanguage = this.settings.forceLanguage || 'en';
				this.currentLocale = getLocaleByObsidianLanguage(finalLanguage);
				await this.saveSettings();
			} catch {
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
				return await Promise.race([requestUrl(params), timeoutPromise]);
			} finally {
				if (timer !== null) {
					window.clearTimeout(timer);
				}
			}
		}

		private async fetchProfileAvatar(actorDid: string): Promise<void> {
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
			const linkRegex = /https?:\/\/[^\s<>()\]{}"']+/g;
			const trailingChars = /[\])}.,!?]+$/;
			let match: RegExpExecArray | null;
			while ((match = linkRegex.exec(text)) !== null) {
				const rawUri = match[0];
				const uri = rawUri.replace(trailingChars, '');
				const byteStart = encoder.encode(text.slice(0, match.index)).length;
				const byteEnd = byteStart + encoder.encode(uri).length;
				const linkFacet: LinkFacet = {
					index: { byteStart, byteEnd },
					features: [{ $type: 'app.bsky.richtext.facet#link', uri }]
				};
				facets.push(linkFacet);
			}
			const hashtagRegex = /#[\w\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]+/g;
			while ((match = hashtagRegex.exec(text)) !== null) {
				const tag = match[0];
				const tagWithoutHash = tag.slice(1);
				if (countGraphemes(tagWithoutHash) > 64) continue;
				const byteStart = encoder.encode(text.slice(0, match.index)).length;
				const byteEnd = byteStart + encoder.encode(tag).length;
				const tagFacet: TagFacet = {
					index: { byteStart, byteEnd },
					features: [{ $type: 'app.bsky.richtext.facet#tag', tag: tagWithoutHash }]
				};
				facets.push(tagFacet);
			}
			facets.sort((a, b) => a.index.byteStart - b.index.byteStart);
			return facets.length > 0 ? facets : undefined;
		}
	
		async uploadBlob(blob: ArrayBuffer, mimeType: string, retried = false): Promise<UploadBlobResponse> {
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
				if (!this.isSuccessStatus(response.status)) {
					if (response.status === 401 && !retried && (await this.login())) {
						return this.uploadBlob(blob, mimeType, true);
					}
					if (response.status === 429 && !retried) {
						const retryAfter = Number(response.headers['retry-after']);
						const backoffMs = Number.isFinite(retryAfter) ? Math.max(500, retryAfter * 1000) : 1500;
						await new Promise((resolve) => setTimeout(resolve, backoffMs));
						return this.uploadBlob(blob, mimeType, true);
					}
					const errorBody = (response.json as { message?: string; error?: string }) ?? {};
					const message = errorBody.message || errorBody.error || `画像アップロードに失敗しました: ${response.status}`;
					throw new Error(message);
				}
				return response.json as UploadBlobResponse;
			} catch (error) {
				if (error instanceof Error && error.message === 'Request timed out') {
					throw new Error('画像アップロードがタイムアウトしました');
				}
				throw error;
			}
		}

		async postToBluesky(text: string, embed?: Embed, retried = false): Promise<boolean> {
			if (!text.trim() && (!embed || embed.$type !== 'app.bsky.embed.images')) {
				new Notice(this.getLocale().postContentEmpty);
				return false;
			}
			if (countGraphemes(text) > 300) {
				new Notice(this.getLocale().postTooLong);
				return false;
			}
			if (!this.accessJwt || !this.did) {
				if (!(await this.login())) return false;
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
					if (response.status === 401 && !retried && (await this.login())) {
						return this.postToBluesky(text, embed, true);
					}
					const errorBody = (response.json as { message?: string; error?: string }) ?? {};
					const message = errorBody.message || errorBody.error || `${this.getLocale().postFailed}: ${response.status}`;
					throw new Error(message);
				}
				new Notice(this.getLocale().postSuccess);
				return true;
			} catch (error) {
				const isTimeout = error instanceof Error && error.message === 'Request timed out';
				if (isTimeout) {
					new Notice(this.getLocale().postTimeout);
				} else {
					const message = error instanceof Error ? error.message : String(error);
					new Notice(`${this.getLocale().postFailed}: ${message}`);
				}
				return false;
			}
		}

		/**
		 * エディタの選択文字列（なければ先頭500文字）を初期値として投稿モーダルを開く
		 */
		openPostModal() {
			// 投稿欄デフォルトは常に空欄にする要求のため、エディタ内容からの初期値取得を廃止
			const initial = '';
			// 予備ログイン（失敗しても無視）
			if (!this.accessJwt) {
				void this.login().catch(() => {});
			}
			new PostModal(this.app, this, initial).open();
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
	fileInput!: HTMLInputElement;
	selectedImages: File[] = [];
	linkPreviewData: LinkPreviewData | null = null;
	pendingLinkPreviewUrl: string | null = null;
	debounceTimer: number | null = null;
	isEmojiPickerVisible = false;
	outsideClickHandler?: (e: MouseEvent) => void;
	private repositionEmojiPickerBound?: () => void;
	private keyHandler: ((e: KeyboardEvent) => void) | null = null;

	constructor(app: App, plugin: BlueskyPlugin, initialText = '') {
		super(app);
		this.plugin = plugin;
		this.initialText = initialText;
	}

	private createEmojiPicker(): void {
		if (!this.emojiPickerContainer) return;
		this.emojiPickerContainer.empty();
		const grid = this.emojiPickerContainer.createDiv({ cls: 'bluesky-emoji-grid' });
		EMOJI_LIST.forEach(em => {
			const span = grid.createSpan({ text: em, cls: 'bluesky-emoji-item' });
			span.addEventListener('click', () => this.insertEmoji(em));
		});
		this.hideEmojiPicker();
	}

	private toggleEmojiPicker(): void {
		if (this.isEmojiPickerVisible) this.hideEmojiPicker();
		else this.showEmojiPicker();
	}

	// モーダル外（body直下）にピッカーを生成（EMOJI_LIST を利用）
	private initExternalEmojiPicker(): void {
		if (!this.emojiPickerContainer) {
			this.emojiPickerContainer = document.createElement('div');
			this.emojiPickerContainer.className = 'bluesky-emoji-picker-container bluesky-emoji-floating bluesky-hidden';
			document.body.appendChild(this.emojiPickerContainer);
		}
		this.emojiPickerContainer.replaceChildren();
		const grid = document.createElement('div');
		grid.className = 'bluesky-emoji-grid';
		EMOJI_LIST.forEach(em => {
			const span = document.createElement('span');
			span.textContent = em;
			span.className = 'bluesky-emoji-item';
			span.addEventListener('click', () => this.insertEmoji(em));
			grid.appendChild(span);
		});
		this.emojiPickerContainer.appendChild(grid);
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

		// キーボードイベントハンドラーを生成
		this.keyHandler = (e: KeyboardEvent): void => this.handleKeyboard(e);
		// キーボードイベントリスナーを追加
		document.addEventListener('keydown', this.keyHandler);

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

		// 要求により初期テキストは常に空欄。ハッシュタグ自動挿入もしない。
		this.textArea.value = '';
		// デフォルトハッシュタグは空欄に続けて自動挿入（復活要求）
		if (this.plugin.settings.defaultHashtags?.trim()) {
			this.textArea.value = this.plugin.settings.defaultHashtags.trim();
		}

		// モーダル表示時にカーソルをテキストエリア先頭（左端）へ移動
		// （ハッシュタグ挿入済みでも先頭に配置する要求仕様）
		setTimeout(() => {
			this.textArea.focus();
			this.textArea.setSelectionRange(0, 0);
		}, 0);

		this.linkPreviewContainer = contentEl.createDiv({ cls: 'bluesky-preview-container' });
		this.imagePreviewContainer = contentEl.createDiv({ cls: 'bluesky-image-preview-container' });
		// 絵文字ピッカーはボタンの右隣に出すため、後で actions 内ラッパに配置する

		const footerEl = contentEl.createDiv({ cls: 'bluesky-modal-footer' });

		// フッターの上部行：アクションボタンと文字カウンター
		const footerRowEl = footerEl.createDiv({ cls: 'bluesky-footer-row' });
		const actionsEl = footerRowEl.createDiv({ cls: 'bluesky-actions' });

		this.fileInput = contentEl.createEl('input', { cls: 'bluesky-hidden', attr: { type: 'file', accept: 'image/*' } });
		this.fileInput.multiple = true;
		this.fileInput.onchange = (e) => this.handleFileSelect(e);

		// ホットキー表示付きの画像追加ボタン
		new ButtonComponent(actionsEl)
			.setIcon('image-file')
			.setTooltip(`${this.plugin.getLocale().addImage} (最大4枚) - ${this.plugin.settings.hotkeys.addImage}`)
			.onClick(() => this.fileInput.click());

		// 絵文字ボタンのみ（ピッカー本体は body 直下に生成）
		const emojiWrapper = actionsEl.createDiv({ cls: 'bluesky-emoji-wrapper' });
		const emojiBtn = new ButtonComponent(emojiWrapper)
			.setIcon('smile')
			.setTooltip(`${this.plugin.getLocale().addEmoji} - ${this.plugin.settings.hotkeys.emoji}`)
			.onClick(() => this.toggleEmojiPicker());
		this.emojiButtonEl = emojiBtn.buttonEl;

		// 文字カウンターを右端に配置
		this.charCountEl = footerRowEl.createDiv({ cls: 'bluesky-char-count' });

		// ヘルプテキストを次の行に配置
		const helpEl = footerEl.createDiv({ cls: 'bluesky-hotkey-help' });
		const helpSmall = helpEl.createEl('small');
		helpSmall.createEl('strong', { text: `${this.plugin.getLocale().hotkeys}:` });
		const hotkeyText = ` ${this.plugin.settings.hotkeys.cancel}: ${this.plugin.getLocale().cancel} | ` +
			`${this.plugin.settings.hotkeys.post}: ${this.plugin.getLocale().post} | ` +
			`${this.plugin.settings.hotkeys.addImage}: ${this.plugin.getLocale().addImage} | ` +
			`${this.plugin.settings.hotkeys.emoji}: ${this.plugin.getLocale().addEmoji}`;
		helpSmall.appendText(hotkeyText);

		this.initExternalEmojiPicker();
		this.textArea.addEventListener('input', () => { this.updateCharCount(); });
		this.updateCharCount();
		// 初期表示では絵文字ピッカーは閉じたまま
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
		document.addEventListener('mousedown', this.outsideClickHandler);
		this.repositionEmojiPickerBound = () => this.repositionEmojiPicker();
		window.addEventListener('resize', this.repositionEmojiPickerBound);
		window.addEventListener('scroll', this.repositionEmojiPickerBound, true);
	}

	hideEmojiPicker(): void {
		if (!this.emojiPickerContainer) return;
		this.emojiPickerContainer.classList.add('bluesky-hidden');
		this.isEmojiPickerVisible = false;
		if (this.outsideClickHandler) document.removeEventListener('mousedown', this.outsideClickHandler);
		if (this.repositionEmojiPickerBound) {
			window.removeEventListener('resize', this.repositionEmojiPickerBound);
			window.removeEventListener('scroll', this.repositionEmojiPickerBound, true);
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
	handleKeyboard(e: KeyboardEvent) {
		const settings = this.plugin.settings.hotkeys;
		// IME変換中はショートカットを無視
		if (e.isComposing) return;

		// キャンセル（Escape）
		if (this.matchesHotkey(e, settings.cancel)) {
			e.preventDefault();
			this.close();
			return;
		}

		// 投稿（Ctrl+Enter）
		if (this.matchesHotkey(e, settings.post)) {
			e.preventDefault();
			if (!this.postButton.disabled) {
				this.handlePost();
			}
			return;
		}

		// 絵文字追加（Ctrl+E）
		if (this.matchesHotkey(e, settings.emoji)) {
			e.preventDefault();
			this.toggleEmojiPicker();
			return;
		}

		// 画像追加（Ctrl+I）
		if (this.matchesHotkey(e, settings.addImage)) {
			e.preventDefault();
			e.stopPropagation();
			this.fileInput?.click();
			return;
		}
	}

	// ホットキーのマッチング関数
	matchesHotkey(e: KeyboardEvent, hotkey: string): boolean {
		const parts = hotkey.toLowerCase().split('+');
		const key = parts[parts.length - 1];
		const rawMods = parts.slice(0, -1);
		const isMac = Platform.isMacOS;
		const modifiers = rawMods.map(m => (m === 'mod' ? (isMac ? 'meta' : 'ctrl') : m));

		// キーの一致確認
		let keyMatches = false;
		if (key === 'escape' && e.key === 'Escape') keyMatches = true;
		else if (key === 'enter' && e.key === 'Enter') keyMatches = true;
		else if (key === e.key.toLowerCase()) keyMatches = true;

		if (!keyMatches) return false;

		// 修飾キーの確認
		for (const modifier of modifiers) {
			switch (modifier) {
				case 'ctrl':
					if (!e.ctrlKey) return false;
					break;
				case 'shift':
					if (!e.shiftKey) return false;
					break;
				case 'alt':
					if (!e.altKey) return false;
					break;
				case 'meta':
					if (!e.metaKey) return false;
					break;
			}
		}

		// 不要な修飾キーがないかチェック
		const expectedCtrl = modifiers.includes('ctrl');
		const expectedShift = modifiers.includes('shift');
		const expectedAlt = modifiers.includes('alt');
		const expectedMeta = modifiers.includes('meta');

		return e.ctrlKey === expectedCtrl &&
			e.shiftKey === expectedShift &&
			e.altKey === expectedAlt &&
			e.metaKey === expectedMeta;
	}

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
		this.fileInput.value = '';
	}

	updateImagePreviews() {
		// Revoke existing object URLs before clearing to avoid memory leaks
		this.imagePreviewContainer.querySelectorAll('img').forEach((el) => {
			const imgEl = el as HTMLImageElement;
			if (imgEl.src && imgEl.src.startsWith('blob:')) {
				URL.revokeObjectURL(imgEl.src);
			}
		});
		this.imagePreviewContainer.empty();
		this.selectedImages.forEach((file, index) => {
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
		this.charCountEl.textContent = `${charCount}/300`;
		const isOverLimit = charCount > 300;
		this.charCountEl.toggleClass('bluesky-over-limit', isOverLimit);
		this.postButton.setDisabled(isOverLimit);
	}

	debounceUpdatePreviews() {
		if (this.debounceTimer) clearTimeout(this.debounceTimer);
		this.debounceTimer = window.setTimeout(() => {
			void this.updateLinkPreview();
		}, 500);
	}

	async updateLinkPreview() {
		if (this.selectedImages.length > 0) return;
		const match = this.textArea.value.match(/https?:\/\/[^\s<>()\]{}"']+/);
		const url = match ? match[0].replace(/[\])}.,!?]+$/, '') : null;
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
			return { url, title: url, domain: new URL(url).hostname };
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
		const text = this.textArea.value.trim();
		if (!text && this.selectedImages.length === 0) {
			new Notice(this.plugin.getLocale().pleaseEnterContent);
			return;
		}
		this.postButton.setButtonText(this.plugin.getLocale().posting).setDisabled(true);
		let embed: Embed | undefined;

		if (this.selectedImages.length > 0) {
			try {
				const uploadedImages: Image[] = await Promise.all(this.selectedImages.map(async (file) => {
					const imageBitmap = await createImageBitmap(file);
					const { width, height } = imageBitmap;
					const canvas = document.createElement('canvas');
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
							new Notice(`${this.plugin.getLocale().imageUploadError}: ${error.message}`);
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
					thumb = {
						// フィールド名を $type から _type に統一
						_type: 'blob' as const,
						ref: uploadedImage.blob.ref,
						mimeType: uploadedImage.blob.mimeType,
						size: uploadedImage.blob.size
					};
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

		if (await this.plugin.postToBluesky(text, embed)) {
			this.close();
		} else {
			this.postButton.setButtonText(this.plugin.getLocale().post).setDisabled(false);
		}
	}

		onClose() {
			// キーボードイベントリスナーを削除
			if (this.keyHandler) {
				document.removeEventListener('keydown', this.keyHandler);
				this.keyHandler = null;
			}

		if (this.debounceTimer) clearTimeout(this.debounceTimer);
		this.hideEmojiPicker();
		// 画像プレビューの blob URL を解放
		try {
			this.imagePreviewContainer?.querySelectorAll('img').forEach((el) => {
				const src = (el as HTMLImageElement).src;
				if (src?.startsWith('blob:')) URL.revokeObjectURL(src);
			});
		} catch (error) {
			console.debug('[Post-To-Bluesky] Failed to release preview blobs', error);
		}
		this.contentEl.empty();
	}
}

class BlueskySettingTab extends PluginSettingTab {
	plugin: BlueskyPlugin;
	private conflictWarningEl: HTMLElement | null = null;
	
	constructor(app: App, plugin: BlueskyPlugin) { super(app, plugin); this.plugin = plugin; }

		display(): void {
			const { containerEl } = this;
			containerEl.empty();

			new Setting(containerEl)
				.setHeading()
				.setName(this.plugin.getLocale().settingsTitle);

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

			// 言語設定セクション
			new Setting(containerEl)
				.setHeading()
				.setName(this.plugin.getLocale().languageSettingsTitle);
		
		new Setting(containerEl)
			.setName(this.plugin.getLocale().languageLabel)
			.setDesc(this.plugin.getLocale().languageDesc)
			.addDropdown(dropdown => dropdown
				.addOption('en', this.plugin.getLocale().languageEnglish)
				.addOption('ja', this.plugin.getLocale().languageJapanese)
				.setValue(this.plugin.settings.forceLanguage || 'en')
				.onChange(async (value) => {
					this.plugin.settings.forceLanguage = value as 'en' | 'ja';
					await this.plugin.saveSettings();
					// 言語設定を即座に更新
					await this.plugin.updateLanguageSettings();
					// 設定画面を再描画して言語を反映
					this.display();
				}));

			// ホットキー設定セクション
			new Setting(containerEl)
				.setHeading()
				.setName(this.plugin.getLocale().hotkeysTitle);

		new Setting(containerEl)
			.setName(this.plugin.getLocale().cancelHotkeyLabel)
			.setDesc(this.plugin.getLocale().cancelHotkeyDesc)
			.addText(text => text
				.setPlaceholder('Escape')
				.setValue(this.plugin.settings.hotkeys.cancel)
				.onChange(async (value) => {
					this.plugin.settings.hotkeys.cancel = value || 'Escape';
					await this.plugin.saveSettings();
					this.checkHotkeyConflicts();
				}));

		new Setting(containerEl)
			.setName(this.plugin.getLocale().postHotkeyLabel)
			.setDesc(this.plugin.getLocale().postHotkeyDesc)
			.addText(text => text
				.setPlaceholder('Mod+Enter')
				.setValue(this.plugin.settings.hotkeys.post)
				.onChange(async (value) => {
					this.plugin.settings.hotkeys.post = value || 'Mod+Enter';
					await this.plugin.saveSettings();
					this.checkHotkeyConflicts();
				}));

		new Setting(containerEl)
			.setName(this.plugin.getLocale().imageHotkeyLabel)
			.setDesc(this.plugin.getLocale().imageHotkeyDesc)
			.addText(text => text
				.setPlaceholder('Mod+I')
				.setValue(this.plugin.settings.hotkeys.addImage)
				.onChange(async (value) => {
					this.plugin.settings.hotkeys.addImage = value || 'Mod+I';
					await this.plugin.saveSettings();
					this.checkHotkeyConflicts();
				}));

		new Setting(containerEl)
			.setName(this.plugin.getLocale().emojiHotkeyLabel)
			.setDesc(this.plugin.getLocale().emojiHotkeyDesc)
			.addText(text => text
				.setPlaceholder('Mod+E')
				.setValue(this.plugin.settings.hotkeys.emoji)
				.onChange(async (value) => {
					this.plugin.settings.hotkeys.emoji = value || 'Mod+E';
					await this.plugin.saveSettings();
					this.checkHotkeyConflicts();
				}));

		containerEl.createEl('p', {
			text: this.plugin.getLocale().appPasswordNote,
			cls: 'setting-item-description'
		});

		containerEl.createEl('p', {
			text: this.plugin.getLocale().hotkeyFormatNote,
			cls: 'setting-item-description'
		});

		containerEl.createEl('p', {
			text: this.plugin.getLocale().hotkeyConflictNote,
			cls: 'setting-item-description'
		});

		// ホットキー衝突警告を表示する要素を作成
		this.conflictWarningEl = containerEl.createDiv({ cls: 'hotkey-conflict-warning' });
		
		// 初期状態でホットキー衝突をチェック
		this.checkHotkeyConflicts();
	}

	/**
	 * ホットキーを正規化する
	 * - 小文字に変換
	 * - 修飾子の別名を標準名にマッピング
	 * - 修飾子を標準順序でソート
	 * - 等価なホットキーを同じ文字列に正規化
	 */
	private normalizeHotkey(hotkey: string): string {
		if (!hotkey || !hotkey.trim()) return '';
		
		// 小文字に変換して空白を除去
		const normalized = hotkey.toLowerCase().trim();
		
		// 修飾子の別名を標準名にマッピング
		const modifierAliases: Record<string, string> = {
			'cmd': 'meta',
			'command': 'meta',
			'control': 'ctrl',
			'option': 'alt',
			'windows': 'meta',
			'win': 'meta',
			'mod': (typeof process !== 'undefined' && process.platform === 'darwin') ? 'meta' : 'ctrl' // プラットフォームに応じてmodを動的にマッピング（macOS: meta、Windows/Linux: ctrl）
		};
		
		// 修飾子の標準順序
		const modifierOrder = ['ctrl', 'alt', 'shift', 'meta'];
		
		// 修飾子とメインキーを分離
		const parts = normalized.split(/[+\s]+/).filter(part => part.length > 0);
		const modifiersSet = new Set<string>(); // 配列ではなくSetを使用して重複を効率的に除去
		let mainKey = '';
		
		parts.forEach(part => {
			// 修飾子の別名を標準名に変換
			const standardModifier = modifierAliases[part] || part;
			
			// 修飾子かどうかを判定（標準順序に含まれるか、または別名から変換されたもの）
			if (modifierOrder.includes(standardModifier)) {
				modifiersSet.add(standardModifier); // Setに追加（自動的に重複除去）
			} else {
				// メインキー（修飾子でない場合）
				mainKey = part;
			}
		});
		
		// 修飾子を標準順序でソート（Setから標準順序に従って選択）
		const sortedModifiers = modifierOrder
			.filter(modifier => modifiersSet.has(modifier)); // modifierOrderを反復して、Setに存在する修飾子を標準順序で選択
		
		// 正規化されたホットキーを構築
		if (sortedModifiers.length > 0) {
			return sortedModifiers.join('+') + '+' + mainKey;
		} else {
			return mainKey;
		}
	}

	/**
	 * 重複するホットキーを見つける
	 */
	private findDuplicateHotkeys(hotkeys: string[]): string[] {
		const duplicatesSet = new Set<string>();
		const seen = new Set<string>();

		hotkeys.forEach(hotkey => {
			// ホットキーを高度に正規化
			const normalizedHotkey = this.normalizeHotkey(hotkey);
			
			// 空文字列の場合はスキップ
			if (!normalizedHotkey) return;
			
			// 既に見た正規化ホットキーの場合、現在の元のホットキーを重複として追加
			if (seen.has(normalizedHotkey)) {
				duplicatesSet.add(hotkey);
			}
			
			// 毎回正規化されたホットキーをseenセットに追加
			seen.add(normalizedHotkey);
		});

		// Setを配列に変換して返す（各重複は1回だけ報告される）
		return Array.from(duplicatesSet);
	}

	/**
	 * ホットキー衝突をチェックして警告を表示
	 */
	private checkHotkeyConflicts(): void {
		const warningContainer = this.conflictWarningEl;
		if (!warningContainer) return;

		const allHotkeys = [
			this.plugin.settings.hotkeys.cancel,
			this.plugin.settings.hotkeys.post,
			this.plugin.settings.hotkeys.addImage,
			this.plugin.settings.hotkeys.emoji
		];

		// 重複チェック
		const duplicates = this.findDuplicateHotkeys(allHotkeys);
		
		// 既知のショートカットとの衝突チェック
		const conflicts: HotkeyConflict[] = [];
		allHotkeys.forEach(hotkey => {
			conflicts.push(...HotkeyConflictDetector.detectConflicts(hotkey));
		});

		// 警告メッセージを生成
		let warningMessage = '';
		let warningClass = '';

		if (duplicates.length > 0) {
			warningMessage += `${this.plugin.getLocale().hotkeyConflictWarning}\n`;
			warningMessage += `${this.plugin.getLocale().duplicateHotkeys}: ${duplicates.join(', ')}\n`;
			warningClass = 'hotkey-conflict-error';
		}

		if (conflicts.length > 0) {
			if (!warningMessage) {
				warningMessage += `${this.plugin.getLocale().hotkeyConflictWarning}\n`;
			}
			warningMessage += HotkeyConflictDetector.generateConflictDescription(conflicts);
			warningClass = warningClass || 'hotkey-conflict-warning';
		}

		// 警告を表示または非表示
		const isError = warningClass === 'hotkey-conflict-error';
		const lines = warningMessage.split('\n').filter(Boolean);
		warningContainer.replaceChildren();
		if (lines.length > 0) {
			lines.forEach((line) => {
				const paragraph = document.createElement('div');
				paragraph.textContent = line;
				warningContainer.appendChild(paragraph);
			});
		}
		warningContainer.classList.toggle('hotkey-conflict-error', isError);
		warningContainer.classList.toggle('is-visible', lines.length > 0);
	}
}