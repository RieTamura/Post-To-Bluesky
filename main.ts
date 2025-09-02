// main.ts
import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, ButtonComponent, requestUrl, setIcon } from 'obsidian';

// ... (interfaceや定数定義は変更なし) ...
interface BlueskyPluginSettings {
	handle: string;
	password: string;
	defaultHashtags: string;
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
	hotkeys: {
		cancel: 'Escape',
		post: 'Ctrl+Enter',
		addImage: 'Ctrl+I',
		emoji: 'Ctrl+E'
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
			const segmenter = new (Intl as any).Segmenter(undefined, { granularity: 'grapheme' });
			let count = 0;
			for (const _ of segmenter.segment(text)) count++;
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
		this.addCommand({ id: 'post-selection-to-bluesky', name: 'Post selection to Bluesky', editorCallback: (editor: Editor, view: MarkdownView) => { const selection = editor.getSelection(); if (selection?.trim()) new PostModal(this.app, this, selection).open(); else new Notice('テキストを選択してください'); } });
		this.addCommand({ id: 'post-note-to-bluesky', name: 'Post current note to Bluesky', editorCallback: (editor: Editor, view: MarkdownView) => { const content = editor.getValue(); if (content?.trim()) new PostModal(this.app, this, content).open(); else new Notice('ノートが空です'); } });
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
		if (!this.settings.handle || !this.settings.password) { new Notice('Blueskyのハンドルとパスワードを設定してください'); return false; }
		try {
			const resp = await fetch('https://bsky.social/xrpc/com.atproto.server.createSession', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: this.settings.handle, password: this.settings.password }), });
			if (!resp.ok) throw new Error(`ログインに失敗しました: ${resp.status}`);
			const data = await resp.json();
			this.accessJwt = data.accessJwt; this.refreshJwt = data.refreshJwt; this.did = data.did;
			try {
				const profileResp = await fetch(`https://bsky.social/xrpc/app.bsky.actor.getProfile?actor=${data.did}`, { headers: { 'Authorization': `Bearer ${this.accessJwt}` } });
				if (profileResp.ok) { const profileData = await profileResp.json(); this.userAvatar = profileData.avatar || ''; }
			} catch (e) { console.error("アバターの取得に失敗しました:", e); }
			return true;
		} catch (error) { new Notice(`ログインエラー: ${error.message}`); return false; }
	}

	detectFacets(text: string) {
		const facets = [];
		const encoder = new TextEncoder();
		const linkRegex = /https?:\/\/[^\s]+/g;
		let match;
		while ((match = linkRegex.exec(text)) !== null) {
			const uri = match[0];
			const byteStart = encoder.encode(text.slice(0, match.index)).length;
			const byteEnd = byteStart + encoder.encode(uri).length;
			facets.push({ index: { byteStart, byteEnd }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: uri }] });
		}
		const hashtagRegex = /#[\w\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]+/g;
		while ((match = hashtagRegex.exec(text)) !== null) {
			const tag = match[0];
			const tagWithoutHash = tag.slice(1);
			if (tagWithoutHash.length > 64) continue;
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
		const timeout = setTimeout(() => controller.abort(), 15000);
		const response = await fetch('https://bsky.social/xrpc/com.atproto.repo.uploadBlob', { method: 'POST', headers: { 'Content-Type': mimeType, 'Authorization': `Bearer ${this.accessJwt}` }, body: blob, signal: controller.signal });
		clearTimeout(timeout);
		if (!response.ok) {
			if (response.status === 401 && !retried && (await this.login())) return this.uploadBlob(blob, mimeType, true);
			throw new Error(`画像アップロードに失敗しました: ${response.status}`);
		}
		return await response.json();
	}

	async postToBluesky(text: string, embed?: Embed, retried: boolean = false): Promise<boolean> {
		if (!text.trim() && (!embed || embed.$type !== 'app.bsky.embed.images')) { new Notice('投稿内容が空です'); return false; }
		if (countGraphemes(text) > 300) { new Notice(`投稿が300文字を超えています。テキストを短くしてください。`); return false; }
		if (!this.accessJwt) { if (!(await this.login())) return false; }
		try {
			const record: any = { text: text, createdAt: new Date().toISOString(), $type: 'app.bsky.feed.post' };
			const facets = this.detectFacets(text);
			if (facets) record.facets = facets;
			if (embed) record.embed = embed;
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 15000);
			const response = await fetch('https://bsky.social/xrpc/com.atproto.repo.createRecord', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.accessJwt}` }, body: JSON.stringify({ repo: this.did || this.settings.handle, collection: 'app.bsky.feed.post', record: record }), signal: controller.signal });
			clearTimeout(timeout);
			if (!response.ok) {
				if (response.status === 401 && !retried && (await this.login())) return this.postToBluesky(text, embed, true);
				const errorBody = await response.json().catch(() => ({}));
				console.error('Bluesky post failed:', errorBody);
				throw new Error(`投稿に失敗しました: ${response.status}`);
			}
			new Notice('Blueskyに投稿しました！');
			return true;
		} catch (error) { new Notice(`投稿エラー: ${error.message}`); return false; }
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
			.setButtonText('キャンセル')
			.onClick(() => this.close());

		// 投稿ボタン
		this.postButton = new ButtonComponent(headerEl)
			.setButtonText('投稿')
			.setCta()
			.onClick(() => this.handlePost());

		const mainEl = contentEl.createDiv({ cls: 'bluesky-modal-main' });
		if (this.plugin.userAvatar) {
			mainEl.createEl('img', { cls: 'bluesky-avatar', attr: { src: this.plugin.userAvatar, alt: 'User avatar' } });
		}
		this.textArea = mainEl.createEl('textarea', { cls: 'bluesky-textarea', attr: { placeholder: "最近どう？" } });

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

		this.fileInput = contentEl.createEl('input', { attr: { type: 'file', multiple: 'true', accept: 'image/*', style: 'display: none;' } });
		this.fileInput.onchange = (e) => this.handleFileSelect(e);

		// ホットキー表示付きの画像追加ボタン
		new ButtonComponent(actionsEl)
			.setIcon('image-file')
			.setTooltip(`画像を追加 (最大4枚) - ${this.plugin.settings.hotkeys.addImage}`)
			.onClick(() => this.fileInput.click());

		// 絵文字ボタン
		new ButtonComponent(actionsEl)
			.setIcon('smile')
			.setTooltip(`絵文字を追加 - ${this.plugin.settings.hotkeys.emoji}`)
			.onClick(() => this.toggleEmojiPicker());

		// 文字カウンターを右端に配置
		this.charCountEl = footerRowEl.createDiv({ cls: 'bluesky-char-count' });

		// ヘルプテキストを次の行に配置
		const helpEl = footerEl.createDiv({ cls: 'bluesky-hotkey-help' });
		helpEl.innerHTML = `
			<small>
				<strong>ホットキー:</strong>
				${this.plugin.settings.hotkeys.cancel}: キャンセル |
				${this.plugin.settings.hotkeys.post}: 投稿 |
				${this.plugin.settings.hotkeys.addImage}: 画像追加 |
				${this.plugin.settings.hotkeys.emoji}: 絵文字
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
				name: '感情',
				emojis: ['😀', '😃', '😄', '😁', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🥸', '🤩', '🥳']
			},
			{
				name: '手',
				emojis: ['👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✍️', '👋', '🤚', '🖐️', '✋', '🖖', '👊', '✊', '🤛', '🤜']
			},
			{
				name: 'ハート',
				emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🤎', '🖤', '🤍', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '♥️', '💯', '💢', '💥', '💦', '💨', '🕳️', '💣', '💬', '👁️‍🗨️', '🗨️', '🗯️', '💭']
			},
			{
				name: '自然',
				emojis: ['🌱', '🌿', '🍀', '🌾', '🌵', '🌲', '🌳', '🌴', '☀️', '🌞', '🌛', '🌜', '🌚', '🌕', '🌖', '🌗', '🌘', '🌑', '🌒', '🌓', '🌔', '🌙', '⭐', '🌟', '💫', '⚡', '☁️', '⛅', '⛈️', '🌤️', '🌦️', '🌧️']
			},
			{
				name: '食べ物',
				emojis: ['🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍈', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🍆', '🥑', '🥦', '🥬', '🥒', '🌶️', '🫑', '🌽', '🥕', '🫒', '🧄', '🧅', '🥔', '🍠']
			},
			{
				name: '活動',
				emojis: ['⚽', '🏀', '🏈', '⚾', '🥎', '🎾', '🏐', '🏉', '🥏', '🎱', '🪀', '🏓', '🏸', '🏒', '🏑', '🥍', '🏏', '🪃', '🥅', '⛳', '🪁', '🏹', '🎣', '🤿', '🥊', '🥋', '🎽', '🛹', '🛼', '🛷', '⛸️']
			}
		];

		if (this.emojiPickerContainer) {
			this.emojiPickerContainer.empty();
			this.emojiPickerContainer.style.display = 'none';

			// ヘッダー
			const headerEl = this.emojiPickerContainer.createDiv({ cls: 'bluesky-emoji-header' });
			headerEl.createSpan({ text: '絵文字を選択', cls: 'bluesky-emoji-title' });
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
		const modifiers = parts.slice(0, -1);

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
		if (remainingSlots === 0) { new Notice('画像は最大4枚までです。'); (event.target as HTMLInputElement).value = ''; return; }
		if (files.length > 0) {
			this.linkPreviewData = null;
			this.linkPreviewContainer.empty();
		}
		Array.from(files).slice(0, remainingSlots).forEach(file => this.selectedImages.push(file));
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
			const img = previewEl.createEl('img');
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
			};
		});
	}

	updateCharCount() {
		const byteLength = new TextEncoder().encode(this.textArea.value).length;
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
		const match = this.textArea.value.match(/https?:\/\/[^\s]+/);
		const url = match ? match[0] : null;
		if (url && url === this.linkPreviewData?.url) return;
		this.linkPreviewContainer.empty();
		this.linkPreviewData = null;
		if (url) {
			this.pendingLinkPreviewUrl = url;
			const data = await this.fetchLinkPreview(url);
			if (this.pendingLinkPreviewUrl !== url) return;
			this.linkPreviewData = data;
			if (this.linkPreviewData) this.displayLinkPreview(this.linkPreviewData);
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
			const base = new URL(url);
			const resolve = (u?: string) => u ? new URL(u, base).toString() : undefined;
			const ogImageSecure = getOg('og:image:secure_url');
			const ogImage = getOg('og:image');
			const imageUrl = resolve(ogImageSecure || ogImage);
			return {
				url,
				title: getOg('og:title') || titleText || url,
				description: getOg('og:description') || getName('description') || '',
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
			new Notice('投稿内容を入力してください');
			return;
		}
		this.postButton.setButtonText('Posting...').setDisabled(true);
		let embed: Embed | undefined;

		if (this.selectedImages.length > 0) {
			try {
				const uploadedImages: Image[] = await Promise.all(this.selectedImages.map(async (file) => {
					const imageBitmap = await createImageBitmap(file);
					const { width, height } = imageBitmap;
					const canvas = document.createElement('canvas');
					canvas.width = width;
					canvas.height = height;
					const ctx = canvas.getContext('2d');
					if (!ctx) throw new Error('Failed to get canvas context');
					ctx.drawImage(imageBitmap, 0, 0);
					imageBitmap.close();
					const processedBlob = await new Promise<Blob>((resolve, reject) => {
						const fallbackType = file.type || 'image/jpeg';
						const quality = fallbackType === 'image/jpeg' ? 0.92 : undefined;
						canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Canvas to Blob conversion failed')), fallbackType, quality as any);
					});
					const buffer = await processedBlob.arrayBuffer();
					const uploaded = await this.plugin.uploadBlob(buffer, processedBlob.type);
					return {
						image: uploaded.blob,
						alt: '',
						aspectRatio: { width, height }
					};
				}));
				embed = { $type: 'app.bsky.embed.images', images: uploadedImages };
			} catch (error) {
				new Notice(`画像アップロードエラー: ${error.message}`);
				this.postButton.setButtonText('投稿').setDisabled(false);
				return;
			}
		} else if (this.linkPreviewData?.title) {
			let thumb;
			if (this.linkPreviewData.image) {
				try {
					const imgResponse = await requestUrl({ url: this.linkPreviewData.image });
					const blob = imgResponse.arrayBuffer;
					const mimeType = imgResponse.headers['content-type'] || 'image/jpeg';
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
			this.postButton.setButtonText('投稿').setDisabled(false);
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
	constructor(app: App, plugin: BlueskyPlugin) { super(app, plugin); this.plugin = plugin; }

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'Obsidian to Bluesky Settings' });

		new Setting(containerEl)
			.setName('Bluesky Handle')
			.setDesc('あなたのBlueskyハンドル（例: username.bsky.social）')
			.addText(text => text
				.setPlaceholder('username.bsky.social')
				.setValue(this.plugin.settings.handle)
				.onChange(async (value) => {
					this.plugin.settings.handle = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('App Password')
			.setDesc('BlueskyのApp Password（設定から作成してください）')
			.addText(text => text
				.setPlaceholder('xxxx-xxxx-xxxx-xxxx')
				.setValue(this.plugin.settings.password)
				.onChange(async (value) => {
					this.plugin.settings.password = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Default Hashtags')
			.setDesc('投稿に自動で追加するハッシュタグ（改行して追加されます）')
			.addText(text => text
				.setPlaceholder('#obsidian #note')
				.setValue(this.plugin.settings.defaultHashtags)
				.onChange(async (value) => {
					this.plugin.settings.defaultHashtags = value;
					await this.plugin.saveSettings();
				}));

		// ホットキー設定セクション
		containerEl.createEl('h3', { text: 'ホットキー設定' });

		new Setting(containerEl)
			.setName('キャンセルのホットキー')
			.setDesc('モーダルを閉じるためのキー（デフォルト: Escape）')
			.addText(text => text
				.setPlaceholder('Escape')
				.setValue(this.plugin.settings.hotkeys.cancel)
				.onChange(async (value) => {
					this.plugin.settings.hotkeys.cancel = value || 'Escape';
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('投稿のホットキー')
			.setDesc('投稿を送信するためのキー（デフォルト: Ctrl+Enter）')
			.addText(text => text
				.setPlaceholder('Ctrl+Enter')
				.setValue(this.plugin.settings.hotkeys.post)
				.onChange(async (value) => {
					this.plugin.settings.hotkeys.post = value || 'Ctrl+Enter';
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('画像追加のホットキー')
			.setDesc('画像を追加するためのキー（デフォルト: Ctrl+I）')
			.addText(text => text
				.setPlaceholder('Ctrl+I')
				.setValue(this.plugin.settings.hotkeys.addImage)
				.onChange(async (value) => {
					this.plugin.settings.hotkeys.addImage = value || 'Ctrl+I';
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('絵文字追加のホットキー')
			.setDesc('絵文字ピッカーを開くためのキー（デフォルト: Ctrl+E）')
			.addText(text => text
				.setPlaceholder('Ctrl+E')
				.setValue(this.plugin.settings.hotkeys.emoji)
				.onChange(async (value) => {
					this.plugin.settings.hotkeys.emoji = value || 'Ctrl+E';
					await this.plugin.saveSettings();
				}));

		containerEl.createEl('p', {
			text: '注意: App Passwordを使用してください。メインパスワードは使用しないでください。',
			cls: 'setting-item-description'
		});

		containerEl.createEl('p', {
			text: 'ホットキーの記法: Ctrl+Key, Shift+Key, Alt+Key, Meta+Key の組み合わせで指定してください。例: Ctrl+Shift+S',
			cls: 'setting-item-description'
		});
	}
}