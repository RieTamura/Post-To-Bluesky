// main.ts
import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, ButtonComponent, requestUrl, setIcon } from 'obsidian';
import { locale, getLocaleByObsidianLanguage, LocaleStrings } from './locales';
import { HotkeyConflictDetector, HotkeyConflict } from './hotkeyConflictDetector';

// ... (interfaceや定数定義は変更なし) ...
// ObsidianのAppインターフェースを拡張して、settingsプロパティを含むインターフェースを定義
// より厳密な型定義で型安全性を向上
interface ObsidianAppWithSettings extends App {
	settings: {
		language: string;
	};
}

// 型ガード関数：ObsidianAppWithSettingsの型チェック
function isObsidianAppWithSettings(app: App): app is ObsidianAppWithSettings {
	return Boolean(app && 
		   'settings' in app && 
		   app.settings && 
		   typeof app.settings === 'object' &&
		   'language' in app.settings &&
		   typeof app.settings.language === 'string');
}

interface BlueskyPluginSettings {
	handle: string;
	password: string;
	defaultHashtags: string;
	networkTimeoutMs?: number;
	// ホットキー設定を追加
	hotkeys: {
		cancel: string;
		post: string;
		addImage: string;
		emoji: string;
	}
	// 言語設定を追加
	language?: string;
}

const DEFAULT_SETTINGS: BlueskyPluginSettings = {
	handle: '',
	password: '',
	defaultHashtags: '',
	networkTimeoutMs: 15000,
	hotkeys: {
		cancel: 'Escape',
		post: 'Mod+Enter',
		addImage: 'Mod+I',
		emoji: 'Mod+E'
	}
}

interface LinkPreviewData { url: string; title?: string; description?: string; image?: string; domain: string; }
interface ExternalEmbed { $type: 'app.bsky.embed.external'; external: { uri: string; title: string; description: string; thumb?: { $type: 'blob'; ref: { $link: string }; mimeType: string; size: number; }; }; }
interface Image { image: { $type: 'blob'; ref: { $link: string }; mimeType: string; size: number; }; alt: string; aspectRatio?: { width: number; height: number }; }
interface ImageEmbed { $type: 'app.bsky.embed.images'; images: Image[]; }
type Embed = ExternalEmbed | ImageEmbed;

function countGraphemes(text: string): number {
	// Prefer Intl.Segmenter if available; fallback to code points
	try {
		// @ts-ignore
		if (typeof Intl !== 'undefined' && (Intl as any).Segmenter) {
			// @ts-ignore
			if (!(countGraphemes as any)._seg) {
				// @ts-ignore
				const locale = (typeof navigator !== 'undefined' && (navigator as any).language) ? (navigator as any).language : undefined;
				// @ts-ignore
				(countGraphemes as any)._seg = new (Intl as any).Segmenter(locale, { granularity: 'grapheme' });
			}
			const seg = (countGraphemes as any)._seg;
			let count = 0;
			for (const _ of seg.segment(text)) count++;
			return count;
		}
	} catch {}
	return Array.from(text).length;
}

export default class BlueskyPlugin extends Plugin {
	settings: BlueskyPluginSettings;
	accessJwt: string = '';
	refreshJwt: string = '';
	userAvatar: string = '';
	did: string = '';
	private currentLocale: LocaleStrings | undefined;

	async onload() {
		await this.loadSettings();
		// Obsidianの言語設定を取得してローカライゼーションを適用
		this.updateLanguageSettings();
		
		// Obsidianの設定変更を監視してローカライゼーションを更新
		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				// レイアウト変更時に言語設定を再確認（設定変更の可能性がある場合）
				this.updateLanguageSettings();
			})
		);
		this.addCommand({ id: 'post-selection-to-bluesky', name: this.getLocale().commandPostSelection, editorCallback: (editor: Editor, view: MarkdownView) => { const selection = editor.getSelection(); if (selection?.trim()) new PostModal(this.app, this, selection).open(); else new Notice(this.getLocale().pleaseSelectText); } });
		this.addCommand({ id: 'post-note-to-bluesky', name: this.getLocale().commandPostNote, editorCallback: (editor: Editor, view: MarkdownView) => { const content = editor.getValue(); if (content?.trim()) new PostModal(this.app, this, content).open(); else new Notice(this.getLocale().noteIsEmpty); } });
		this.addCommand({ id: 'create-new-post', name: this.getLocale().commandCreatePost, callback: () => new PostModal(this.app, this, '').open() });

		// 新しいコマンドを追加
		this.addCommand({
			id: 'toggle-bluesky-emoji-picker',
			name: this.getLocale().commandToggleEmojiPicker,
			checkCallback: (checking: boolean) => {
				// activeModalプロパティは公式APIではないため 'any' にキャスト
				const modal = (this.app.workspace as any).activeModal;
				if (modal && modal instanceof PostModal) {
					if (!checking) {
						// 実際にコマンドが実行されたら、絵文字ピッカーをトグルする
						modal.toggleEmojiPicker();
					}
					// このコマンドは実行可能であることを伝える
					return true;
				}
				// 実行不可能であることを伝える
				return false;
			}
		});

		this.addRibbonIcon('send', this.getLocale().ribbonIconTooltip, () => new PostModal(this.app, this, '').open());
		this.addSettingTab(new BlueskySettingTab(this.app, this));
	}

	onunload() { }
	async loadSettings() { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }
	async saveSettings() { await this.saveData(this.settings); }

	// 言語設定を更新するメソッド
	public updateLanguageSettings() {
		try {
			// 型ガードを使用して安全にObsidianの言語設定を取得
			if (isObsidianAppWithSettings(this.app)) {
				const obsidianLanguage = this.app.settings.language;
				if (obsidianLanguage && obsidianLanguage !== this.settings.language) {
					this.settings.language = obsidianLanguage;
					this.currentLocale = getLocaleByObsidianLanguage(obsidianLanguage);
					this.saveSettings();
				} else {
					// 設定がない場合はデフォルトのロケールを使用
					this.currentLocale = locale;
				}
			} else {
				// ObsidianAppWithSettingsの型に適合しない場合はデフォルトのロケールを使用
				console.warn('Obsidianの設定に言語情報が含まれていません。デフォルトのロケールを使用します。');
				this.currentLocale = locale;
			}
		} catch (e) {
			console.error('言語設定の更新に失敗しました:', e);
			this.currentLocale = locale;
		}
	}

	// 現在のロケールを取得するメソッド
	getLocale(): LocaleStrings {
		return this.currentLocale || locale;
	}

	async login(): Promise<boolean> {
		if (!this.settings.handle || !this.settings.password) { new Notice(this.getLocale().loginRequired); return false; }
		try {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), this.settings.networkTimeoutMs ?? 15000);
			const resp = await fetch('https://bsky.social/xrpc/com.atproto.server.createSession', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: this.settings.handle, password: this.settings.password }), signal: controller.signal });
			if (!resp.ok) throw new Error(`${this.getLocale().loginFailed}: ${resp.status}`);
			const data = await resp.json();
			this.accessJwt = data.accessJwt; this.refreshJwt = data.refreshJwt; this.did = data.did;
			try {
				const pController = new AbortController();
				const pTimeout = setTimeout(() => pController.abort(), this.settings.networkTimeoutMs ?? 15000);
				const profileResp = await fetch(`https://bsky.social/xrpc/app.bsky.actor.getProfile?actor=${data.did}`, { headers: { 'Authorization': `Bearer ${this.accessJwt}` }, signal: pController.signal });
				if (profileResp.ok) { const profileData = await profileResp.json(); this.userAvatar = profileData.avatar || ''; }
				clearTimeout(pTimeout);
							} catch (e) { console.error(this.getLocale().avatarFetchFailed + ":", e); }
			clearTimeout(timeout);
			return true;
		} catch (error) { new Notice(`${this.getLocale().loginFailed}: ${error.message}`); return false; }
	}

	detectFacets(text: string) {
		const facets = [];
		const encoder = new TextEncoder();
		// プレビュー側と同じ判定に寄せる
		const linkRegex = /https?:\/\/[^\s<>()\[\]{}"']+/g;
		let match;
		while ((match = linkRegex.exec(text)) !== null) {
			const rawUri = match[0];
			// 末尾の句読点や閉じ括弧などはリンク外として扱う
			const uri = rawUri.replace(/[.,!?)\]\}]+$/, '');
			const byteStart = encoder.encode(text.slice(0, match.index)).length;
			const byteEnd = byteStart + encoder.encode(uri).length;
			facets.push({ index: { byteStart, byteEnd }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: uri }] });
		}
		const hashtagRegex = /#[\w\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]+/g;
		while ((match = hashtagRegex.exec(text)) !== null) {
			const tag = match[0];
			const tagWithoutHash = tag.slice(1);
			if (countGraphemes(tagWithoutHash) > 64) continue;
			const byteStart = encoder.encode(text.slice(0, match.index)).length;
			const byteEnd = byteStart + encoder.encode(tag).length;
			facets.push({ index: { byteStart, byteEnd }, features: [{ $type: 'app.bsky.richtext.facet#tag', tag: tagWithoutHash }] });
		}

		// ★★★★★ 変更点: ファセットをbyteStartでソートする処理を追加 ★★★★★
		facets.sort((a, b) => a.index.byteStart - b.index.byteStart);
		
		return facets.length > 0 ? facets : undefined;
	}

	async uploadBlob(blob: ArrayBuffer, mimeType: string, retried: boolean = false): Promise<any> {
		if (!this.accessJwt) { if (!(await this.login())) throw new Error("ログインに失敗しました"); }
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), this.settings.networkTimeoutMs ?? 15000);
		try {
			const response = await fetch('https://bsky.social/xrpc/com.atproto.repo.uploadBlob', { method: 'POST', headers: { 'Content-Type': mimeType, 'Accept': 'application/json', 'Authorization': `Bearer ${this.accessJwt}` }, body: blob, signal: controller.signal });
			if (!response.ok) {
				if (response.status === 401 && !retried && (await this.login())) return this.uploadBlob(blob, mimeType, true);
				if (response.status === 429 && !retried) {
					const retryAfter = Number(response.headers.get('retry-after'));
					const backoffMs = Number.isFinite(retryAfter) ? Math.max(500, retryAfter * 1000) : 1500;
					await new Promise(r => setTimeout(r, backoffMs));
					return this.uploadBlob(blob, mimeType, true);
				}
				const errorBody = await response.json().catch(() => ({}));
				const message = (errorBody && (errorBody.message || errorBody.error)) || `画像アップロードに失敗しました: ${response.status}`;
				throw new Error(message);
			}
			return await response.json();
		} catch (e: any) {
			if (e?.name === 'AbortError') throw new Error('画像アップロードがタイムアウトしました');
			throw e;
		} finally {
			clearTimeout(timeout);
		}
	}

	async postToBluesky(text: string, embed?: Embed, retried: boolean = false): Promise<boolean> {
		if (!text.trim() && (!embed || embed.$type !== 'app.bsky.embed.images')) { new Notice(this.getLocale().postContentEmpty); return false; }
		if (countGraphemes(text) > 300) { new Notice(this.getLocale().postTooLong); return false; }
		if (!this.accessJwt) { if (!(await this.login())) return false; }
		if (!this.did) { if (!(await this.login())) return false; }
		try {
			const record: any = { text: text, createdAt: new Date().toISOString(), $type: 'app.bsky.feed.post' };
			const facets = this.detectFacets(text);
			if (facets) record.facets = facets;
			if (embed) record.embed = embed;
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), this.settings.networkTimeoutMs ?? 15000);
			try {
				const response = await fetch('https://bsky.social/xrpc/com.atproto.repo.createRecord', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.accessJwt}` }, body: JSON.stringify({ repo: this.did, collection: 'app.bsky.feed.post', record: record }), signal: controller.signal });
				if (!response.ok) {
					if (response.status === 401 && !retried && (await this.login())) return this.postToBluesky(text, embed, true);
					const errorBody = await response.json().catch(() => ({}));
					console.error('Bluesky post failed:', errorBody);
					const message = (errorBody && (errorBody.message || errorBody.error)) || `${this.getLocale().postFailed}: ${response.status}`;
					throw new Error(message);
				}
			} catch (e: any) {
				if (e?.name === 'AbortError') throw new Error(this.getLocale().postTimeout);
				throw e;
			} finally {
				clearTimeout(timeout);
			}
			new Notice(this.getLocale().postSuccess);
			return true;
		} catch (error) { new Notice(`${this.getLocale().postFailed}: ${error.message}`); return false; }
	}
}

class PostModal extends Modal {
	plugin: BlueskyPlugin;
	initialText: string;
	textArea!: HTMLTextAreaElement;
	charCountEl!: HTMLElement;
	postButton!: ButtonComponent;
	linkPreviewContainer!: HTMLElement;
	imagePreviewContainer!: HTMLElement;
	linkPreviewData: LinkPreviewData | null = null;
	selectedImages: File[] = [];
	fileInput!: HTMLInputElement;
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private keyHandler: (e: KeyboardEvent) => void;
	emojiPickerContainer!: HTMLElement;
	private isEmojiPickerVisible: boolean = false;
	private pendingLinkPreviewUrl: string | null = null;

	constructor(app: App, plugin: BlueskyPlugin, initialText: string) {
		super(app);
		this.plugin = plugin;
		this.initialText = initialText;

		// キーボードイベントハンドラーを作成
		this.keyHandler = (e: KeyboardEvent) => this.handleKeyboard(e);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('bluesky-modal-container');

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

		let displayText = this.initialText;
		if (this.plugin.settings.defaultHashtags?.trim()) {
			displayText += (displayText ? '\n\n' : '') + this.plugin.settings.defaultHashtags.trim();
		}
		this.textArea.value = displayText;

		this.linkPreviewContainer = contentEl.createDiv({ cls: 'bluesky-preview-container' });
		this.imagePreviewContainer = contentEl.createDiv({ cls: 'bluesky-image-preview-container' });
		this.emojiPickerContainer = contentEl.createDiv({ cls: 'bluesky-emoji-picker-container' });

		const footerEl = contentEl.createDiv({ cls: 'bluesky-modal-footer' });

		// フッターの上部行：アクションボタンと文字カウンター
		const footerRowEl = footerEl.createDiv({ cls: 'bluesky-footer-row' });
		const actionsEl = footerRowEl.createDiv({ cls: 'bluesky-actions' });

		this.fileInput = contentEl.createEl('input', { attr: { type: 'file', accept: 'image/*', style: 'display: none;' } });
		this.fileInput.multiple = true;
		this.fileInput.onchange = (e) => this.handleFileSelect(e);

		// ホットキー表示付きの画像追加ボタン
		new ButtonComponent(actionsEl)
			.setIcon('image-file')
			.setTooltip(`${this.plugin.getLocale().addImage} (最大4枚) - ${this.plugin.settings.hotkeys.addImage}`)
			.onClick(() => this.fileInput.click());

		// 絵文字ボタン
		new ButtonComponent(actionsEl)
			.setIcon('smile')
			.setTooltip(`${this.plugin.getLocale().addEmoji} - ${this.plugin.settings.hotkeys.emoji}`)
			.onClick(() => this.toggleEmojiPicker());

		// 文字カウンターを右端に配置
		this.charCountEl = footerRowEl.createDiv({ cls: 'bluesky-char-count' });

		// ヘルプテキストを次の行に配置
		const helpEl = footerEl.createDiv({ cls: 'bluesky-hotkey-help' });
		helpEl.innerHTML = `
			<small>
				<strong>${this.plugin.getLocale().hotkeys}:</strong>
				${this.plugin.settings.hotkeys.cancel}: ${this.plugin.getLocale().cancel} |
				${this.plugin.settings.hotkeys.post}: ${this.plugin.getLocale().post} |
				${this.plugin.settings.hotkeys.addImage}: ${this.plugin.getLocale().addImage} |
				${this.plugin.settings.hotkeys.emoji}: ${this.plugin.getLocale().addEmoji}
			</small>
		`;

		this.createEmojiPicker();

		this.textArea.addEventListener('input', () => {
			this.updateCharCount();
			this.debounceUpdatePreviews();
		});

		this.updateCharCount();
		this.updateLinkPreview();

		setTimeout(() => {
			this.textArea.focus();
			const end = this.textArea.value.length;
			this.textArea.setSelectionRange(end, end);
		}, 100);
	}

	createEmojiPicker(): void {
		// 絵文字カテゴリとデータ
		const emojiCategories = [
			{
				name: this.plugin.getLocale().emotions,
				emojis: ['😀', '😃', '😄', '😁', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🥸', '🤩', '🥳']
			},
			{
				name: this.plugin.getLocale().hands,
				emojis: ['👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✍️', '👋', '🤚', '🖐️', '✋', '🖖', '👊', '✊', '🤛', '🤜']
			},
			{
				name: this.plugin.getLocale().hearts,
				emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🤎', '🖤', '🤍', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '♥️', '💯', '💢', '💥', '💦', '💨', '🕳️', '💣', '💬', '👁️‍🗨️', '🗨️', '🗯️', '💭']
			},
			{
				name: this.plugin.getLocale().nature,
				emojis: ['🌱', '🌿', '🍀', '🌾', '🌵', '🌲', '🌳', '🌴', '☀️', '🌞', '🌛', '🌜', '🌚', '🌕', '🌖', '🌗', '🌘', '🌑', '🌒', '🌓', '🌔', '🌙', '⭐', '🌟', '💫', '⚡', '☁️', '⛅', '⛈️', '🌤️', '🌦️', '🌧️']
			},
			{
				name: this.plugin.getLocale().food,
				emojis: ['🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍈', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🍆', '🥑', '🥦', '🥬', '🥒', '🌶️', '🫑', '🌽', '🥕', '🫒', '🧄', '🧅', '🥔', '🍠']
			},
			{
				name: this.plugin.getLocale().activities,
				emojis: ['⚽', '🏀', '🏈', '⚾', '🥎', '🎾', '🏐', '🏉', '🥏', '🎱', '🪀', '🏓', '🏸', '🏒', '🏑', '🥍', '🏏', '🪃', '🥅', '⛳', '🪁', '🏹', '🎣', '🤿', '🥊', '🥋', '🎽', '🛹', '🛼', '🛷', '⛸️']
			}
		];

		if (this.emojiPickerContainer) {
			this.emojiPickerContainer.empty();
			this.emojiPickerContainer.style.display = 'none';

					// ヘッダー
		const headerEl = this.emojiPickerContainer.createDiv({ cls: 'bluesky-emoji-header' });
		headerEl.createSpan({ text: this.plugin.getLocale().selectEmoji, cls: 'bluesky-emoji-title' });
		const closeBtn = headerEl.createDiv({ cls: 'bluesky-emoji-close' });
		setIcon(closeBtn, 'x');
		closeBtn.onclick = () => this.hideEmojiPicker();

			// カテゴリタブ
			const tabsEl = this.emojiPickerContainer.createDiv({ cls: 'bluesky-emoji-tabs' });
			const contentEl = this.emojiPickerContainer.createDiv({ cls: 'bluesky-emoji-content' });

			emojiCategories.forEach((category, index) => {
				// タブボタン
				const tabBtn = tabsEl.createDiv({
					cls: 'bluesky-emoji-tab' + (index === 0 ? ' active' : ''),
					text: category.name
				});

				// コンテンツ
				const categoryEl = contentEl.createDiv({
					cls: 'bluesky-emoji-category' + (index === 0 ? ' active' : '')
				});

				const gridEl = categoryEl.createDiv({ cls: 'bluesky-emoji-grid' });
				category.emojis.forEach(emoji => {
					const emojiBtn = gridEl.createDiv({
						cls: 'bluesky-emoji-item',
						text: emoji
					});
					emojiBtn.onclick = () => this.insertEmoji(emoji);
				});

				// タブクリックイベント
				tabBtn.onclick = () => {
					// アクティブタブを切り替え
					tabsEl.querySelectorAll('.bluesky-emoji-tab').forEach((tab: Element) =>
						tab.removeClass('active'));
					tabBtn.addClass('active');

					// アクティブコンテンツを切り替え
					contentEl.querySelectorAll('.bluesky-emoji-category').forEach((cat: Element) =>
						cat.removeClass('active'));
					categoryEl.addClass('active');
				};
			});
		}
	}

	toggleEmojiPicker(): void {
		if (this.isEmojiPickerVisible) {
			this.hideEmojiPicker();
		} else {
			this.showEmojiPicker();
		}
	}

	showEmojiPicker(): void {
		if (this.emojiPickerContainer) {
			this.emojiPickerContainer.style.display = 'block';
		}
		this.isEmojiPickerVisible = true;
	}

	hideEmojiPicker(): void {
		if (this.emojiPickerContainer) {
			this.emojiPickerContainer.style.display = 'none';
		}
		this.isEmojiPickerVisible = false;
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

		// 絵文字ピッカーを閉じる
		this.hideEmojiPicker();
	}

	// キーボードイベントハンドラー
	handleKeyboard(e: KeyboardEvent) {
		const settings = this.plugin.settings.hotkeys;
		// IME変換中はショートカットを無視
		if ((e as any).isComposing) return;

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
		const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);
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
					this.updateLinkPreview();
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
		this.debounceTimer = setTimeout(() => this.updateLinkPreview(), 500);
	}

	async updateLinkPreview() {
		if (this.selectedImages.length > 0) return;
		const match = this.textArea.value.match(/https?:\/\/[^\s<>()\[\]{}"']+/);
		const url = match ? match[0].replace(/[.,!?)\]\}]+$/, '') : null;
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
						$type: 'blob' as const,
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
		document.removeEventListener('keydown', this.keyHandler);

		if (this.debounceTimer) clearTimeout(this.debounceTimer);
		this.hideEmojiPicker();
		// 画像プレビューの blob URL を解放
		try {
			this.imagePreviewContainer?.querySelectorAll('img').forEach((el) => {
				const src = (el as HTMLImageElement).src;
				if (src?.startsWith('blob:')) URL.revokeObjectURL(src);
			});
		} catch {}
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

		containerEl.createEl('h2', { text: this.plugin.getLocale().settingsTitle });

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

		// ホットキー設定セクション
		containerEl.createEl('h3', { text: this.plugin.getLocale().hotkeysTitle });

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
		let normalized = hotkey.toLowerCase().trim();
		
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
		if (!this.conflictWarningEl) return;

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
		if (warningMessage) {
			this.conflictWarningEl.innerHTML = warningMessage.replace(/\n/g, '<br>');
			this.conflictWarningEl.className = `hotkey-conflict-warning ${warningClass}`;
			this.conflictWarningEl.style.display = 'block';
		} else {
			this.conflictWarningEl.style.display = 'none';
		}
	}
}