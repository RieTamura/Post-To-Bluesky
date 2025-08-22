// main.ts
import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, ButtonComponent, requestUrl, setIcon } from 'obsidian';

// ... (interfaceや定数定義は変更なし) ...
interface BlueskyPluginSettings { handle: string; password: string; defaultHashtags: string; }
const DEFAULT_SETTINGS: BlueskyPluginSettings = { handle: '', password: '', defaultHashtags: '' }
interface LinkPreviewData { url: string; title?: string; description?: string; image?: string; domain: string; }
interface ExternalEmbed { $type: 'app.bsky.embed.external'; external: { uri: string; title: string; description: string; thumb?: { $type: 'blob'; ref: { $link: string }; mimeType: string; size: number; }; }; }
interface Image { image: { $type: 'blob'; ref: { $link: string }; mimeType: string; size: number; }; alt: string; aspectRatio?: { width: number; height: number }; }
interface ImageEmbed { $type: 'app.bsky.embed.images'; images: Image[]; }
type Embed = ExternalEmbed | ImageEmbed;


export default class BlueskyPlugin extends Plugin {
	settings: BlueskyPluginSettings;
	accessJwt: string = '';
	refreshJwt: string = '';
	userAvatar: string = '';

	async onload() {
		await this.loadSettings();
		this.addCommand({ id: 'post-selection-to-bluesky', name: 'Post selection to Bluesky', editorCallback: (editor: Editor, view: MarkdownView) => { const selection = editor.getSelection(); if (selection?.trim()) new PostModal(this.app, this, selection).open(); else new Notice('テキストを選択してください'); } });
		this.addCommand({ id: 'post-note-to-bluesky', name: 'Post current note to Bluesky', editorCallback: (editor: Editor, view: MarkdownView) => { const content = editor.getValue(); if (content?.trim()) new PostModal(this.app, this, content).open(); else new Notice('ノートが空です'); } });
		this.addCommand({ id: 'create-new-post', name: 'Create new Bluesky post', callback: () => new PostModal(this.app, this, '').open() });
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
			this.accessJwt = data.accessJwt; this.refreshJwt = data.refreshJwt;
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
			if (tag.length > 66) continue;
			const byteStart = encoder.encode(text.slice(0, match.index)).length;
			const byteEnd = byteStart + encoder.encode(tag).length;
			const tagWithoutHash = tag.slice(1);
			facets.push({ index: { byteStart, byteEnd }, features: [{ $type: 'app.bsky.richtext.facet#tag', tag: tagWithoutHash }] });
		}
		return facets.length > 0 ? facets : undefined;
	}

	async uploadBlob(blob: ArrayBuffer, mimeType: string): Promise<any> {
		if (!this.accessJwt) { if (!(await this.login())) throw new Error("ログインに失敗しました"); }
		const response = await fetch('https://bsky.social/xrpc/com.atproto.repo.uploadBlob', { method: 'POST', headers: { 'Content-Type': mimeType, 'Authorization': `Bearer ${this.accessJwt}` }, body: blob });
		if (!response.ok) { if (response.status === 401 && (await this.login())) return this.uploadBlob(blob, mimeType); throw new Error(`画像アップロードに失敗しました: ${response.status}`); }
		return await response.json();
	}

	async postToBluesky(text: string, embed?: Embed): Promise<boolean> {
		if (!text.trim() && (!embed || embed.$type !== 'app.bsky.embed.images')) { new Notice('投稿内容が空です'); return false; }
		if (new TextEncoder().encode(text).length > 300) { new Notice(`投稿が300バイトを超えています。テキストを短くしてください。`); return false; }
		if (!this.accessJwt) { if (!(await this.login())) return false; }
		try {
			const record: any = { text: text, createdAt: new Date().toISOString(), $type: 'app.bsky.feed.post' };
			const facets = this.detectFacets(text);
			if (facets) record.facets = facets;
			if (embed) record.embed = embed;
			const response = await fetch('https://bsky.social/xrpc/com.atproto.repo.createRecord', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.accessJwt}` }, body: JSON.stringify({ repo: this.settings.handle, collection: 'app.bsky.feed.post', record: record }) });
			if (!response.ok) { if (response.status === 401 && (await this.login())) return this.postToBluesky(text, embed); const errorBody = await response.json(); console.error('Bluesky post failed:', errorBody); throw new Error(`投稿に失敗しました: ${response.status}`); }
			new Notice('Blueskyに投稿しました！');
			return true;
		} catch (error) { new Notice(`投稿エラー: ${error.message}`); return false; }
	}
}

class PostModal extends Modal {
	plugin: BlueskyPlugin; initialText: string; textArea: HTMLTextAreaElement; charCountEl: HTMLElement; postButton: ButtonComponent; linkPreviewContainer: HTMLElement; imagePreviewContainer: HTMLElement; linkPreviewData: LinkPreviewData | null = null; selectedImages: File[] = []; fileInput: HTMLInputElement; private debounceTimer: number | null = null;
	constructor(app: App, plugin: BlueskyPlugin, initialText: string) { super(app); this.plugin = plugin; this.initialText = initialText; }

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('bluesky-modal-container');

		const headerEl = contentEl.createDiv({ cls: 'bluesky-modal-header' });
		new ButtonComponent(headerEl).setButtonText('キャンセル').onClick(() => this.close());
		this.postButton = new ButtonComponent(headerEl).setButtonText('投稿').setCta().onClick(() => this.handlePost());

		const mainEl = contentEl.createDiv({ cls: 'bluesky-modal-main' });
		if (this.plugin.userAvatar) { mainEl.createEl('img', { cls: 'bluesky-avatar', attr: { src: this.plugin.userAvatar } }); }
		this.textArea = mainEl.createEl('textarea', { cls: 'bluesky-textarea', attr: { placeholder: "最近どう？" } });

		let displayText = this.initialText;
		if (this.plugin.settings.defaultHashtags?.trim()) { displayText += (displayText ? '\n\n' : '') + this.plugin.settings.defaultHashtags.trim(); }
		this.textArea.value = displayText;

		this.linkPreviewContainer = contentEl.createDiv({ cls: 'bluesky-preview-container' });
		this.imagePreviewContainer = contentEl.createDiv({ cls: 'bluesky-image-preview-container' });

		const footerEl = contentEl.createDiv({ cls: 'bluesky-modal-footer' });
		const actionsEl = footerEl.createDiv({ cls: 'bluesky-actions' });
		this.fileInput = contentEl.createEl('input', { type: 'file', attr: { multiple: true, accept: 'image/*', style: 'display: none;' } });
		this.fileInput.onchange = (e) => this.handleFileSelect(e);
		new ButtonComponent(actionsEl).setIcon('image-file').setTooltip('画像を追加 (最大4枚)').onClick(() => this.fileInput.click());
		this.charCountEl = footerEl.createDiv({ cls: 'bluesky-char-count' });

		this.textArea.addEventListener('input', () => { this.updateCharCount(); this.debounceUpdatePreviews(); });
		this.updateCharCount(); this.updateLinkPreview();
		setTimeout(() => { this.textArea.focus(); this.textArea.setSelectionRange(this.initialText.length, this.initialText.length); }, 100);
	}

	handleFileSelect(event: Event) {
		const files = (event.target as HTMLInputElement).files; if (!files) return;
		if (this.selectedImages.length + files.length > 4) { new Notice('画像は最大4枚までです。'); return; }
		if (files.length > 0) { this.linkPreviewData = null; this.linkPreviewContainer.empty(); }
		Array.from(files).forEach(file => this.selectedImages.push(file));
		this.updateImagePreviews();
	}

	updateImagePreviews() {
		this.imagePreviewContainer.empty();
		this.selectedImages.forEach((file, index) => {
			const previewEl = this.imagePreviewContainer.createDiv({ cls: 'bluesky-image-preview' });
			const img = previewEl.createEl('img'); img.src = URL.createObjectURL(file);
			const removeBtn = previewEl.createDiv({ cls: 'bluesky-remove-image-btn' }); setIcon(removeBtn, 'x');
			removeBtn.onclick = () => { this.selectedImages.splice(index, 1); this.updateImagePreviews(); };
		});
	}

	updateCharCount() {
		const byteLength = new TextEncoder().encode(this.textArea.value).length;
		this.charCountEl.textContent = `${byteLength}/300`;
		const isOverLimit = byteLength > 300;
		this.charCountEl.toggleClass('bluesky-over-limit', isOverLimit);
		this.postButton.setDisabled(isOverLimit);
	}

	debounceUpdatePreviews() { if (this.debounceTimer) clearTimeout(this.debounceTimer); this.debounceTimer = setTimeout(() => this.updateLinkPreview(), 500); }

	async updateLinkPreview() {
		if (this.selectedImages.length > 0) return;
		const match = this.textArea.value.match(/https?:\/\/[^\s]+/); const url = match ? match[0] : null;
		if (url && url === this.linkPreviewData?.url) return;
		this.linkPreviewContainer.empty(); this.linkPreviewData = null;
		if (url) { this.linkPreviewData = await this.fetchLinkPreview(url); if (this.linkPreviewData) this.displayLinkPreview(this.linkPreviewData); }
	}

	async fetchLinkPreview(url: string): Promise<LinkPreviewData | null> {
		try {
			const response = await requestUrl({ url }); const doc = new DOMParser().parseFromString(response.text, 'text/html'); const getMeta = (prop: string) => doc.querySelector(`meta[property="${prop}"]`)?.getAttribute('content') || undefined;
			const titleElement = doc.querySelector('title');
			const titleText = titleElement?.textContent?.trim() || undefined;
			return { url, title: getMeta('og:title') || titleText || url, description: getMeta('og:description') || getMeta('description') || '', image: getMeta('og:image'), domain: new URL(url).hostname };
		} catch (error) { console.error('Failed to fetch link preview:', error); return { url, title: url, domain: new URL(url).hostname }; }
	}

	displayLinkPreview(preview: LinkPreviewData) {
		this.linkPreviewContainer.empty(); const cardEl = this.linkPreviewContainer.createDiv({ cls: 'bluesky-link-card' });
		if (preview.image) cardEl.createEl('img', { cls: 'bluesky-link-image' }).src = preview.image;
		const contentEl = cardEl.createDiv({ cls: 'bluesky-link-content' });
		if (preview.title) contentEl.createDiv({ cls: 'bluesky-link-title', text: preview.title });
		if (preview.description) contentEl.createDiv({ cls: 'bluesky-link-description', text: preview.description });
		if (preview.domain) contentEl.createDiv({ cls: 'bluesky-link-domain', text: preview.domain });
		cardEl.addEventListener('click', () => window.open(preview.url, '_blank'));
	}

	async handlePost() {
		const text = this.textArea.value.trim(); if (!text && this.selectedImages.length === 0) { new Notice('投稿内容を入力してください'); return; }
		this.postButton.setButtonText('Posting...').setDisabled(true); let embed: Embed | undefined;
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
					const processedBlob = await new Promise<Blob>((resolve, reject) => {
						canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Canvas to Blob conversion failed')), file.type);
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
				this.postButton.setButtonText('Post').setDisabled(false); return;
			}
		} else if (this.linkPreviewData?.title) {
			let thumb; if (this.linkPreviewData.image) { try { const imgResponse = await requestUrl({ url: this.linkPreviewData.image }); const blob = imgResponse.arrayBuffer; const mimeType = imgResponse.headers['content-type'] || 'image/jpeg'; const uploadedImage = await this.plugin.uploadBlob(blob, mimeType); thumb = { $type: 'blob' as const, ref: uploadedImage.blob.ref, mimeType: uploadedImage.blob.mimeType, size: uploadedImage.blob.size }; } catch (error) { console.error('Image upload failed:', error); } }
			embed = { $type: 'app.bsky.embed.external', external: { uri: this.linkPreviewData.url, title: this.linkPreviewData.title, description: this.linkPreviewData.description || '', thumb: thumb } };
		}
		if (await this.plugin.postToBluesky(text, embed)) this.close(); else this.postButton.setButtonText('Post').setDisabled(false);
	}

	onClose() { if (this.debounceTimer) clearTimeout(this.debounceTimer); this.contentEl.empty(); }
}

class BlueskySettingTab extends PluginSettingTab {
	plugin: BlueskyPlugin; constructor(app: App, plugin: BlueskyPlugin) { super(app, plugin); this.plugin = plugin; }
	display(): void {
		const { containerEl } = this; containerEl.empty();
		// ★★★ ここを変更 ★★★
		containerEl.createEl('h2', { text: 'Obsidian to Bluesky Settings' });
		new Setting(containerEl).setName('Bluesky Handle').setDesc('あなたのBlueskyハンドル（例: username.bsky.social）').addText(text => text.setPlaceholder('username.bsky.social').setValue(this.plugin.settings.handle).onChange(async (value) => { this.plugin.settings.handle = value; await this.plugin.saveSettings(); }));
		new Setting(containerEl).setName('App Password').setDesc('BlueskyのApp Password（設定から作成してください）').addText(text => text.setPlaceholder('xxxx-xxxx-xxxx-xxxx').setValue(this.plugin.settings.password).onChange(async (value) => { this.plugin.settings.password = value; await this.plugin.saveSettings(); }));
		new Setting(containerEl).setName('Default Hashtags').setDesc('投稿に自動で追加するハッシュタグ（改行して追加されます）').addText(text => text.setPlaceholder('#obsidian #note').setValue(this.plugin.settings.defaultHashtags).onChange(async (value) => { this.plugin.settings.defaultHashtags = value; await this.plugin.saveSettings(); }));
		containerEl.createEl('p', { text: '注意: App Passwordを使用してください。メインパスワードは使用しないでください。', cls: 'setting-item-description' });
	}
}