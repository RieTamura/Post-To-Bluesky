// main.ts
import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, ButtonComponent, requestUrl, setIcon } from 'obsidian';
import { locale } from './locales';
import { HotkeyConflictDetector, HotkeyConflict } from './hotkeyConflictDetector';

// ... (interfaceや定数定義は変更なし) ...
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

	async onload() {
		await this.loadSettings();
		this.addCommand({ id: 'post-selection-to-bluesky', name: 'Post selection to Bluesky', editorCallback: (editor: Editor, view: MarkdownView) => { const selection = editor.getSelection(); if (selection?.trim()) new PostModal(this.app, this, selection).open(); else new Notice(locale.pleaseSelectText); } });
		this.addCommand({ id: 'post-note-to-bluesky', name: 'Post current note to Bluesky', editorCallback: (editor: Editor, view: MarkdownView) => { const content = editor.getValue(); if (content?.trim()) new PostModal(this.app, this, content).open(); else new Notice(locale.noteIsEmpty); } });
		this.addCommand({ id: 'create-new-post', name: 'Create new Bluesky post', callback: () => new PostModal(this.app, this, '').open() });

		// 新しいコマンドを追加
		this.addCommand({
			id: 'toggle-bluesky-emoji-picker',
			name: 'Toggle Bluesky emoji picker',
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

		this.addRibbonIcon('send', 'Post to Bluesky', () => new PostModal(this.app, this, '').open());
		this.addSettingTab(new BlueskySettingTab(this.app, this));
	}

	onunload() { }
	async loadSettings() { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }
	async saveSettings() { await this.saveData(this.settings); }

	async login(): Promise<boolean> {
		if (!this.settings.handle || !this.settings.password) { new Notice(locale.loginRequired); return false; }
		try {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), this.settings.networkTimeoutMs ?? 15000);
			const resp = await fetch('https://bsky.social/xrpc/com.atproto.server.createSession', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: this.settings.handle, password: this.settings.password }), signal: controller.signal });
			if (!resp.ok) throw new Error(`${locale.loginFailed}: ${resp.status}`);
			const data = await resp.json();
			this.accessJwt = data.accessJwt; this.refreshJwt = data.refreshJwt; this.did = data.did;
			try {
				const pController = new AbortController();
				const pTimeout = setTimeout(() => pController.abort(), this.settings.networkTimeoutMs ?? 15000);
				const profileResp = await fetch(`https://bsky.social/xrpc/app.bsky.actor.getProfile?actor=${data.did}`, { headers: { 'Authorization': `Bearer ${this.accessJwt}` }, signal: pController.signal });
				if (profileResp.ok) { const profileData = await profileResp.json(); this.userAvatar = profileData.avatar || ''; }
				clearTimeout(pTimeout);
			} catch (e) { console.error(locale.avatarFetchFailed + ":", e); }
			clearTimeout(timeout);
			return true;
		} catch (error) { new Notice(`${locale.loginFailed}: ${error.message}`); return false; }
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
		if (!text.trim() && (!embed || embed.$type !== 'app.bsky.embed.images')) { new Notice(locale.postContentEmpty); return false; }
		if (countGraphemes(text) > 300) { new Notice(locale.postTooLong); return false; }
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
					const message = (errorBody && (errorBody.message || errorBody.error)) || `${locale.postFailed}: ${response.status}`;
					throw new Error(message);
				}
			} catch (e: any) {
				if (e?.name === 'AbortError') throw new Error(locale.postTimeout);
				throw e;
			} finally {
				clearTimeout(timeout);
			}
			new Notice(locale.postSuccess);
			return true;
		} catch (error) { new Notice(`${locale.postFailed}: ${error.message}`); return false; }
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
			.setButtonText(locale.cancel)
			.onClick(() => this.close());

		// 投稿ボタン
		this.postButton = new ButtonComponent(headerEl)
			.setButtonText(locale.post)
			.setCta()
			.onClick(() => this.handlePost());

		const mainEl = contentEl.createDiv({ cls: 'bluesky-modal-main' });
		if (this.plugin.userAvatar) {
			mainEl.createEl('img', { cls: 'bluesky-avatar', attr: { src: this.plugin.userAvatar, alt: 'User avatar' } });
		}
		this.textArea = mainEl.createEl('textarea', { cls: 'bluesky-textarea', attr: { placeholder: locale.placeholderText } });

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
			.setTooltip(`${locale.addImage} (最大4枚) - ${this.plugin.settings.hotkeys.addImage}`)
			.onClick(() => this.fileInput.click());

		// 絵文字ボタン
		new ButtonComponent(actionsEl)
			.setIcon('smile')
			.setTooltip(`${locale.addEmoji} - ${this.plugin.settings.hotkeys.emoji}`)
			.onClick(() => this.toggleEmojiPicker());

		// 文字カウンターを右端に配置
		this.charCountEl = footerRowEl.createDiv({ cls: 'bluesky-char-count' });

		// ヘルプテキストを次の行に配置
		const helpEl = footerEl.createDiv({ cls: 'bluesky-hotkey-help' });
		helpEl.innerHTML = `
			<small>
				<strong>ホットキー:</strong>
				${this.plugin.settings.hotkeys.cancel}: ${locale.cancel} |
				${this.plugin.settings.hotkeys.post}: ${locale.post} |
				${this.plugin.settings.hotkeys.addImage}: ${locale.addImage} |
				${this.plugin.settings.hotkeys.emoji}: ${locale.addEmoji}
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
				name: locale.emotions,
				emojis: ['😀', '😃', '😄', '😁', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🥸', '🤩', '🥳']
			},
			{
				name: locale.hands,
				emojis: ['👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✍️', '👋', '🤚', '🖐️', '✋', '🖖', '👊', '✊', '🤛', '🤜']
			},
			{
				name: locale.hearts,
				emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🤎', '🖤', '🤍', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '♥️', '💯', '💢', '💥', '💦', '💨', '🕳️', '💣', '💬', '👁️‍🗨️', '🗨️', '🗯️', '💭']
			},
			{
				name: locale.nature,
				emojis: ['🌱', '🌿', '🍀', '🌾', '🌵', '🌲', '🌳', '🌴', '☀️', '🌞', '🌛', '🌜', '🌚', '🌕', '🌖', '🌗', '🌘', '🌑', '🌒', '🌓', '🌔', '🌙', '⭐', '🌟', '💫', '⚡', '☁️', '⛅', '⛈️', '🌤️', '🌦️', '🌧️']
			},
			{
				name: locale.food,
				emojis: ['🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍈', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🍆', '🥑', '🥦', '🥬', '🥒', '🌶️', '🫑', '🌽', '🥕', '🫒', '🧄', '🧅', '🥔', '🍠']
			},
			{
				name: locale.activities,
				emojis: ['⚽', '🏀', '🏈', '⚾', '🥎', '🎾', '🏐', '🏉', '🥏', '🎱', '🪀', '🏓', '🏸', '🏒', '🏑', '🥍', '🏏', '🪃', '🥅', '⛳', '🪁', '🏹', '🎣', '🤿', '🥊', '🥋', '🎽', '🛹', '🛼', '🛷', '⛸️']
			}
		];

		if (this.emojiPickerContainer) {
			this.emojiPickerContainer.empty();
			this.emojiPickerContainer.style.display = 'none';

					// ヘッダー
		const headerEl = this.emojiPickerContainer.createDiv({ cls: 'bluesky-emoji-header' });
		headerEl.createSpan({ text: locale.selectEmoji, cls: 'bluesky-emoji-title' });
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
		if (remainingSlots === 0) { new Notice(locale.maxImagesReached); (event.target as HTMLInputElement).value = ''; return; }
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
			new Notice(locale.pleaseEnterContent);
			return;
		}
		this.postButton.setButtonText(locale.posting).setDisabled(true);
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
				new Notice(`${locale.imageUploadError}: ${error.message}`);
				this.postButton.setButtonText(locale.post).setDisabled(false);
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
			this.postButton.setButtonText(locale.post).setDisabled(false);
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

		containerEl.createEl('h2', { text: locale.settingsTitle });

		new Setting(containerEl)
			.setName(locale.handleLabel)
			.setDesc(locale.handleDesc)
			.addText(text => text
				.setPlaceholder(locale.handlePlaceholder)
				.setValue(this.plugin.settings.handle)
				.onChange(async (value) => {
					this.plugin.settings.handle = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(locale.passwordLabel)
			.setDesc(locale.passwordDesc)
			.addText(text => {
				text.setPlaceholder(locale.passwordPlaceholder)
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
			.setName(locale.timeoutLabel)
			.setDesc(locale.timeoutDesc)
			.addText(text => text
				.setPlaceholder(locale.timeoutPlaceholder)
				.setValue(String(this.plugin.settings.networkTimeoutMs ?? 15000))
				.onChange(async (value) => {
					const n = Number(value);
					const clamped = Number.isFinite(n) ? Math.min(Math.max(Math.round(n), 1000), 60000) : 15000;
					this.plugin.settings.networkTimeoutMs = clamped;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(locale.hashtagsLabel)
			.setDesc(locale.hashtagsDesc)
			.addText(text => text
				.setPlaceholder(locale.hashtagsPlaceholder)
				.setValue(this.plugin.settings.defaultHashtags)
				.onChange(async (value) => {
					this.plugin.settings.defaultHashtags = value;
					await this.plugin.saveSettings();
				}));

		// ホットキー設定セクション
		containerEl.createEl('h3', { text: locale.hotkeysTitle });

		new Setting(containerEl)
			.setName(locale.cancelHotkeyLabel)
			.setDesc(locale.cancelHotkeyDesc)
			.addText(text => text
				.setPlaceholder('Escape')
				.setValue(this.plugin.settings.hotkeys.cancel)
				.onChange(async (value) => {
					this.plugin.settings.hotkeys.cancel = value || 'Escape';
					await this.plugin.saveSettings();
					this.checkHotkeyConflicts();
				}));

		new Setting(containerEl)
			.setName(locale.postHotkeyLabel)
			.setDesc(locale.postHotkeyDesc)
			.addText(text => text
				.setPlaceholder('Mod+Enter')
				.setValue(this.plugin.settings.hotkeys.post)
				.onChange(async (value) => {
					this.plugin.settings.hotkeys.post = value || 'Mod+Enter';
					await this.plugin.saveSettings();
					this.checkHotkeyConflicts();
				}));

		new Setting(containerEl)
			.setName(locale.imageHotkeyLabel)
			.setDesc(locale.imageHotkeyDesc)
			.addText(text => text
				.setPlaceholder('Mod+I')
				.setValue(this.plugin.settings.hotkeys.addImage)
				.onChange(async (value) => {
					this.plugin.settings.hotkeys.addImage = value || 'Mod+I';
					await this.plugin.saveSettings();
					this.checkHotkeyConflicts();
				}));

		new Setting(containerEl)
			.setName(locale.emojiHotkeyLabel)
			.setDesc(locale.emojiHotkeyDesc)
			.addText(text => text
				.setPlaceholder('Mod+E')
				.setValue(this.plugin.settings.hotkeys.emoji)
				.onChange(async (value) => {
					this.plugin.settings.hotkeys.emoji = value || 'Mod+E';
					await this.plugin.saveSettings();
					this.checkHotkeyConflicts();
				}));

		containerEl.createEl('p', {
			text: locale.appPasswordNote,
			cls: 'setting-item-description'
		});

		containerEl.createEl('p', {
			text: locale.hotkeyFormatNote,
			cls: 'setting-item-description'
		});

		containerEl.createEl('p', {
			text: locale.hotkeyConflictNote,
			cls: 'setting-item-description'
		});

		// ホットキー衝突警告を表示する要素を作成
		this.conflictWarningEl = containerEl.createDiv({ cls: 'hotkey-conflict-warning' });
		
		// 初期状態でホットキー衝突をチェック
		this.checkHotkeyConflicts();
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
			warningMessage += `${locale.hotkeyConflictWarning}\n\n`;
			warningMessage += `${locale.duplicateHotkeys}: ${duplicates.join(', ')}\n\n`;
			warningClass = 'hotkey-conflict-error';
		}

		if (conflicts.length > 0) {
			if (!warningMessage) {
				warningMessage += `${locale.hotkeyConflictWarning}\n\n`;
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

	/**
	 * 重複するホットキーを見つける
	 */
	private findDuplicateHotkeys(hotkeys: string[]): string[] {
		const duplicatesSet = new Set<string>();
		const seen = new Set<string>();

		hotkeys.forEach(hotkey => {
			// ホットキーを正規化（空白を除去）
			const normalizedHotkey = hotkey.trim();
			
			// 空文字列の場合はスキップ
			if (!normalizedHotkey) return;
			
			// 既に見たホットキーで、まだ重複セットに追加されていない場合
			if (seen.has(normalizedHotkey) && !duplicatesSet.has(normalizedHotkey)) {
				duplicatesSet.add(normalizedHotkey);
			}
			seen.add(normalizedHotkey);
		});

		// Setを配列に変換して返す（各重複は1回だけ報告される）
		return Array.from(duplicatesSet);
	}
}