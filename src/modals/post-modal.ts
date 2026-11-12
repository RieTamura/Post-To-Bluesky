import { Notice, App, Modal, ButtonComponent, requestUrl, setIcon, Menu, Platform, TFile } from 'obsidian';
import type { Modifier } from 'obsidian';
import type BlueskyPlugin from '../../main';
import { Embed, Image, LinkPreviewData } from '../bluesky';
import { MAX_IMAGES, PendingDraft, SelectedImage, getVaultImages, mimeTypeForExtension, prepareImageForUpload, selectedImageKey } from '../images';
import { parseUrlSafe } from '../markdown';
import { VaultImageSuggestModal } from './vault-image-suggest-modal';
import { EMOJI_LIST, MAX_POST_LENGTH, countGraphemes, findFirstUrl } from '../text';

export class PostModal extends Modal {
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
	keyboardDismissEl: HTMLElement | null = null; // モバイルのみ。入力中だけ表示する
	sourceFile: TFile | null = null; // 下書きノート由来の投稿のみ設定される
	selectedImages: SelectedImage[] = [];
	linkPreviewData: LinkPreviewData | null = null;
	pendingLinkPreviewUrl: string | null = null;
	debounceTimer: number | null = null;
	isEmojiPickerVisible = false;
	isPosting = false;
	outsideClickHandler?: (e: MouseEvent) => void;
	private repositionEmojiPickerBound?: () => void;
	/** 投稿を終えて閉じる場合は下書き保存を尋ねない */
	private isPosted = false;
	/**
	 * 下書き保存の確認から「編集に戻る」で開き直した作成画面か。
	 * この内容はまだどこにも保存されていないので、閉じるときは必ず確認を出す。
	 */
	private isUnsaved = false;

	constructor(
		app: App,
		plugin: BlueskyPlugin,
		initialText = '',
		sourceFile: TFile | null = null,
		initialImages: TFile[] = [],
		resumeImages?: SelectedImage[]
	) {
		super(app);
		this.plugin = plugin;
		this.initialText = initialText;
		this.sourceFile = sourceFile;
		if (resumeImages) {
			// 「編集に戻る」で開き直した場合は添付をそのまま引き継ぐ。端末から選んだ画像は
			// まだ vault に無く TFile で渡せないため SelectedImage のまま受け取る
			this.selectedImages = resumeImages.slice(0, MAX_IMAGES);
			this.isUnsaved = true;
		} else {
			// 下書きノートに埋め込まれていた画像は最初から添付済みにしておく。
			// fromDraft を立てておくことで、投稿後に同じ画像を下書きへ書き戻さずに済む
			this.selectedImages = initialImages.slice(0, MAX_IMAGES).map((file) => ({
				name: file.name,
				vaultFile: file,
				deviceFile: null,
				fromDraft: true
			}));
		}
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

		// キーボードを閉じるボタン（モバイルのみ）。
		// textarea には改行キーしかなくソフトキーボードを閉じる手段が無い。iOS では
		// キーボードが出ても layout viewport が縮まないため、閉じられないままだと
		// フッターの画像ボタンや文字数カウンタがキーボードの裏に隠れて操作できない。
		if (Platform.isMobile) {
			const dismissBtn = new ButtonComponent(headerEl)
				.setIcon('keyboard-off')
				.setTooltip(this.plugin.getLocale().dismissKeyboard)
				.onClick(() => this.textArea.blur());
			const dismissEl = dismissBtn.buttonEl;
			dismissEl.addClass('bluesky-keyboard-dismiss');
			// click を待つと、先にフォーカスが外れてボタンが隠れた場合に取りこぼす。
			// preventDefault でフォーカス移動も止めて、押した時点で確実に閉じる
			dismissEl.addEventListener('mousedown', (e) => {
				e.preventDefault();
				this.textArea.blur();
			});
			this.keyboardDismissEl = dismissEl;
		}

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
		// モバイルでは自動フォーカスしない。開いた直後にキーボードが出ると、その裏に
		// フッター（画像ボタン・文字数カウンタ）が隠れて画像を添付できなくなるため、
		// 本文をタップして初めてキーボードを出す
		if (!Platform.isMobile) {
			const caretPos = this.initialText ? this.textArea.value.length : 0;
			window.setTimeout(() => {
				this.textArea.focus();
				this.textArea.setSelectionRange(caretPos, caretPos);
			}, 0);
		}

		// 閉じるボタンは本文入力中だけ出す（キーボードが無いときは押しても意味がない）
		if (this.keyboardDismissEl) {
			const dismissEl = this.keyboardDismissEl;
			this.textArea.addEventListener('focus', () => dismissEl.addClass('is-visible'));
			this.textArea.addEventListener('blur', () => dismissEl.removeClass('is-visible'));
		}

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
		// Markdown変換が有効なときは記号が落ちて短くなるので、実際に投稿する側で数える
		const charCount = countGraphemes(this.plugin.buildPostText(this.textArea.value).text);
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
		const detected = this.detectPreviewUrl();
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

	/**
	 * リンクカードの対象URLを決める。
	 * Markdown変換が有効なら `[表示テキスト](URL)` の URL は本文から消えるので、
	 * 記法から取れた URL もカードの候補に入れる。素のURLと両方ある場合は先に
	 * 書かれているほうを使う（変換なしのときと同じ「最初のURL」という基準を保つ）。
	 */
	private detectPreviewUrl(): string | null {
		const prepared = this.plugin.buildPostText(this.textArea.value);
		const bare = findFirstUrl(prepared.text);
		const markdownLink = prepared.links[0];
		if (bare && markdownLink) return bare.index < markdownLink.start ? bare.url : markdownLink.uri;
		return bare?.url ?? markdownLink?.uri ?? null;
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
		const raw = this.textArea.value.trim();
		if (!raw && this.selectedImages.length === 0) {
			new Notice(this.plugin.getLocale().postContentEmpty);
			return;
		}
		// ノートには入力したままの Markdown を残す。投稿には変換後のテキストを送る
		const prepared = this.plugin.buildPostText(raw);
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

			const result = await this.plugin.postToBluesky(prepared.text, embed, prepared.links);
			if (result.success) {
				await this.plugin.recordPostResult(raw, result.postUrl, this.sourceFile, this.selectedImages);
				this.isPosted = true;
				this.close();
			} else if (this.plugin.activeModal === this) {
				this.postButton.setButtonText(this.plugin.getLocale().post).setDisabled(false);
			}
		} finally {
			this.isPosting = false;
		}
	}

		onClose() {
		// contentEl を空にする前に、下書きへ残す内容を取り出しておく
		const pending = this.collectPendingDraft();
		if (this.plugin.activeModal === this) this.plugin.activeModal = null;
		if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
		this.hideEmojiPicker();
		this.releasePreviewObjectUrls();
		this.keyboardDismissEl = null;
		this.contentEl.empty();
		// Modal.close() は同期で取り消せないので、閉じ切ってから確認を出す
		if (pending) window.setTimeout(() => this.plugin.promptDraftSave(pending), 0);
	}

	/**
	 * 投稿せずに閉じたときに下書きへ残す内容を取り出す。残すものが無ければ null を返す。
	 *
	 * 開いた時点から何も変わっていない場合に確認を出さないのは、Esc で閉じるたびに
	 * 聞かれるのを避けるため。下書きノートから開いた場合の「変わっていない」は
	 * 元ノートに同じ内容があるという意味なので、閉じても失われるものはない。
	 */
	private collectPendingDraft(): PendingDraft | null {
		if (this.isPosted || this.isPosting) return null;
		if (!this.plugin.settings.confirmDraftOnCancel) return null;
		if (!this.textArea) return null;
		const text = this.textArea.value.trim();
		if (!text && this.selectedImages.length === 0) return null;
		if (!this.isUnsaved) {
			const addedImages = this.selectedImages.some((image) => !image.fromDraft);
			if (text === this.baselineText() && !addedImages) return null;
		}
		return { text, images: [...this.selectedImages], sourceFile: this.sourceFile };
	}

	/** 開いた直後の本文。通常起動では自動挿入したデフォルトハッシュタグが入っている */
	private baselineText(): string {
		if (this.initialText) return this.initialText.trim();
		return this.plugin.settings.defaultHashtags?.trim() ?? '';
	}
}
