import { Notice, requestUrl, Plugin, getLanguage, normalizePath, TFile } from 'obsidian';
import type { RequestUrlParam, RequestUrlResponse } from 'obsidian';
import { BlueskyPostRecord, CreateRecordResponse, CreateSessionResponse, Embed, ErrorResponse, Facet, FacetByteRange, HttpError, PostResult, UploadBlobResponse } from './src/bluesky';
import { FRONTMATTER_BLOCK_REGEX, POSTED_CHECKBOX_PROPERTY, POSTED_FRONTMATTER_VALUE, addFrontmatterLink, buildFrontmatterWikiLink, expandDateTemplate, findNoteByPath, frontmatterMatchesValue, hasTemplatePlaceholder, stripMarkdownExtension, toYamlLink } from './src/frontmatter';
import { LocaleStrings, getLocaleByObsidianLanguage } from './src/i18n';
import { PendingDraft, SelectedImage, buildEmbedWikiLink, importImageToVault } from './src/images';
import { ConvertedMarkdown, MarkdownLink, convertMarkdownForPost } from './src/markdown';
import { DraftSaveConfirmModal } from './src/modals/draft-save-confirm-modal';
import { DraftSelectModal } from './src/modals/draft-select-modal';
import { PostModal } from './src/modals/post-modal';
import { BlueskyPluginSettings, BlueskySettingTab, DEFAULT_SECRET_ID, DEFAULT_SETTINGS, StoredSettings } from './src/settings';
import { MAX_POST_LENGTH, MAX_TAG_LENGTH, countGraphemes, createHashtagRegex, createUrlRegex, extractHashtags, stripHashtags, toYamlTag, trimTrailingPunctuation } from './src/text';

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

	onunload(): void { }

	async loadSettings() {
		const loaded = await this.loadData() as StoredSettings | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
		await this.migrateLegacyPassword(loaded?.password);
	}

	/**
	 * v0.5.1 以前の data.json に平文で残っているアプリパスワードをキーチェーンへ移す。
	 * 移したあとは data.json から確実に消す（消さないと平文が残り続ける）。
	 */
	private async migrateLegacyPassword(legacyPassword: string | undefined): Promise<void> {
		// Object.assign で settings 側にも旧キーが載っているので、まず落とす。
		// 空文字だけが残っている場合もここで消える
		delete (this.settings as StoredSettings).password;
		if (!legacyPassword) {
			// 空文字の旧キーが残っているだけなら、掃除した設定を書き戻して終わり
			if (legacyPassword === '') await this.saveSettings();
			return;
		}
		try {
			const id = this.settings.passwordSecretId || this.findFreeSecretId(legacyPassword);
			this.app.secretStorage.setSecret(id, legacyPassword);
			this.settings.passwordSecretId = id;
			await this.saveSettings();
			new Notice(this.getLocale().passwordMigrated);
		} catch (e) {
			console.error('Failed to move the app password into secret storage:', e);
			new Notice(this.getLocale().passwordMigrationFailed);
		}
	}

	/**
	 * まだ使われていないシークレットIDを選ぶ。
	 * 同じIDが既にあり中身も同じなら、それは前回の移行結果なので再利用する。
	 */
	private findFreeSecretId(value: string): string {
		const existing = new Set(this.app.secretStorage.listSecrets());
		const isFree = (id: string) =>
			!existing.has(id) || this.app.secretStorage.getSecret(id) === value;
		if (isFree(DEFAULT_SECRET_ID)) return DEFAULT_SECRET_ID;
		for (let i = 2; i <= 20; i++) {
			const id = `${DEFAULT_SECRET_ID}-${i}`;
			if (isFree(id)) return id;
		}
		return `${DEFAULT_SECRET_ID}-${Date.now()}`;
	}

	/** キーチェーンからアプリパスワードを取り出す。未設定・削除済みなら空文字 */
	private getAppPassword(): string {
		const id = this.settings.passwordSecretId?.trim();
		if (!id) return '';
		try {
			return this.app.secretStorage.getSecret(id) ?? '';
		} catch (e) {
			console.error('Failed to read the app password from secret storage:', e);
			return '';
		}
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
		const password = this.getAppPassword();
		if (!this.settings.handle || !password) {
			// IDだけあって中身が無いのは、別の端末で設定した data.json が同期されてきた場合。
			// キーチェーンは端末間で同期されないので、原因が分かる文言にする
			const secretMissing = !password && !!this.settings.passwordSecretId?.trim();
			new Notice(secretMissing ? this.getLocale().passwordSecretMissing : this.getLocale().loginRequired);
			return false;
		}
		try {
			const response = await this.requestWithTimeout({
				url: 'https://bsky.social/xrpc/com.atproto.server.createSession',
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ identifier: this.settings.handle, password })
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

	/**
	 * 本文から facet を組み立てる。
	 *
	 * @param markdownLinks Markdown のリンク記法から得た範囲（文字単位）。
	 *   表示テキストにURLやハッシュタグらしき文字列が含まれることがあるが、
	 *   範囲の重なった facet を送ると Bluesky 側でリンクが壊れるため、
	 *   ここで作った範囲と重なる URL・タグは facet にしない。
	 */
	detectFacets(text: string, markdownLinks: MarkdownLink[] = []): Facet[] | undefined {
		const facets: Facet[] = [];
		const encoder = new TextEncoder();
		const byteOffsetOf = (charIndex: number) => encoder.encode(text.slice(0, charIndex)).length;
		const reserved: FacetByteRange[] = [];
		for (const link of markdownLinks) {
			const index = { byteStart: byteOffsetOf(link.start), byteEnd: byteOffsetOf(link.end) };
			if (index.byteEnd <= index.byteStart) continue;
			reserved.push(index);
			facets.push({ index, features: [{ $type: 'app.bsky.richtext.facet#link', uri: link.uri }] });
		}
		const overlapsReserved = (range: FacetByteRange) =>
			reserved.some((taken) => range.byteStart < taken.byteEnd && taken.byteStart < range.byteEnd);
		const linkRegex = createUrlRegex();
		let match: RegExpExecArray | null;
		while ((match = linkRegex.exec(text)) !== null) {
			const rawUri = match[0];
			const uri = trimTrailingPunctuation(rawUri);
			const byteStart = byteOffsetOf(match.index);
			const byteEnd = byteStart + encoder.encode(uri).length;
			if (overlapsReserved({ byteStart, byteEnd })) continue;
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
			const byteStart = byteOffsetOf(match.index);
			const byteEnd = byteStart + encoder.encode(tag).length;
			if (overlapsReserved({ byteStart, byteEnd })) continue;
			const tagFacet: Facet = {
				index: { byteStart, byteEnd },
				features: [{ $type: 'app.bsky.richtext.facet#tag', tag: tagWithoutHash }]
			};
			facets.push(tagFacet);
		}
		facets.sort((a, b) => a.index.byteStart - b.index.byteStart);
		return facets.length > 0 ? facets : undefined;
	}

	/**
	 * 入力された本文を、実際に投稿するテキストと Markdown 由来のリンク範囲に分ける。
	 * 変換が無効なら入力をそのまま返すので、呼び出し側は設定を見ずに済む。
	 * 文字数カウント・リンクプレビュー・投稿のすべてがここを通ることで、
	 * 「カウンターの数字と実際に投稿される文字数が食い違う」事故を防いでいる。
	 */
	buildPostText(raw: string): ConvertedMarkdown {
		if (!this.settings.convertMarkdown) return { text: raw, links: [] };
		return convertMarkdownForPost(raw);
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

	async postToBluesky(text: string, embed?: Embed, markdownLinks: MarkdownLink[] = []): Promise<PostResult> {
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
		const facets = this.detectFacets(text, markdownLinks);
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
	openPostModal(initialText = '', sourceFile: TFile | null = null, initialImages: TFile[] = [], resumeImages?: SelectedImage[]) {
		if (this.activeModal) return;
		// 予備ログイン（失敗しても無視）
		if (!this.accessJwt) {
			void this.login().catch(() => { });
		}
		const modal = new PostModal(this.app, this, initialText, sourceFile, initialImages, resumeImages);
		this.activeModal = modal;
		modal.open();
	}

	/**
	 * 投稿せずに閉じたときに、書きかけを下書きノートへ残すか尋ねる。
	 *
	 * Obsidian の Modal.close() は同期で取り消せないため、確認は作成画面を
	 * 閉じ切ったあとに出す。そのぶん「編集に戻る」は本文と添付を引き継いで
	 * 作成画面を開き直す形で実現している。
	 */
	promptDraftSave(pending: PendingDraft): void {
		// 別の作成画面が開いていれば邪魔しない（開き直しもできないため確認を出さない）
		if (this.activeModal) return;
		new DraftSaveConfirmModal(this.app, this, pending, {
			onSave: () => { void this.saveDraftNote(pending); },
			onResume: () => this.openPostModal(pending.text, pending.sourceFile, [], pending.images)
		}).open();
	}

	/**
	 * 書きかけの投稿を下書きノートとして残す。
	 * 下書きノートから開いた投稿は元ノートを更新する（同じ内容のノートが2つ並ばないように）。
	 * 元ノートが消えていた場合は新規作成に切り替える。
	 */
	private async saveDraftNote(pending: PendingDraft): Promise<void> {
		const locale = this.getLocale();
		try {
			const existing = pending.sourceFile ? this.app.vault.getFileByPath(pending.sourceFile.path) : null;
			const file = existing ? await this.updateDraftNote(existing, pending) : await this.createDraftNote(pending);
			new Notice(`${existing ? locale.draftNoteUpdated : locale.draftNoteCreated}: ${file.basename}`);
		} catch (error) {
			console.error('[Post-To-Bluesky] Failed to save the draft note:', error);
			new Notice(locale.draftNoteSaveFailed);
		}
	}

	/** 書きかけを新しい下書きノートにする。下書き一覧に出るよう下書きプロパティを付ける */
	private async createDraftNote(pending: PendingDraft): Promise<TFile> {
		const now = new Date();
		const rawFolder = this.settings.draftNoteFolder?.trim() || DEFAULT_SETTINGS.draftNoteFolder;
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

		// 履歴ノートと違い、ハッシュタグは frontmatter の tags に移さない。
		// この本文はあとで実際に投稿されるので、タグを本文から抜くと投稿に付かなくなる
		const frontmatter = [
			'---',
			`${this.settings.draftProperty || DEFAULT_SETTINGS.draftProperty}: ${this.settings.draftValue || DEFAULT_SETTINGS.draftValue}`,
			'---'
		].join('\n');
		const noteFile = await this.app.vault.create(path, `${frontmatter}\n${pending.text}\n`);
		// 画像の取り込みはノートを作ってから行う（履歴ノートと同じ理由。
		// getAvailablePathForAttachment() は起点ノートの場所から保存先を決める）
		const embeds = await this.collectImageEmbeds(pending.images, noteFile.path);
		if (embeds.length > 0) {
			await this.app.vault.append(noteFile, `${pending.text ? '\n' : ''}${embeds.join('\n')}\n`);
		}
		return noteFile;
	}

	/**
	 * 下書きノートの本文を作成画面の内容に置き換える。
	 * frontmatter は利用者のものなので手を付けない。添付画像は本文末尾に埋め込み直す
	 * （作成画面は埋め込みを本文から外して画像として扱うので、元の位置には戻せない）。
	 */
	private async updateDraftNote(file: TFile, pending: PendingDraft): Promise<TFile> {
		// ノートは既にあるので取り込み先も確定している。作成画面に残っている画像は
		// 下書き由来のものも含めて書き直す（プレビューで外した画像はここで消える）
		const embeds = await this.collectImageEmbeds(pending.images, file.path);
		const body = [pending.text, embeds.join('\n')].filter((part) => part).join('\n\n');
		await this.app.vault.process(file, (data) => {
			const frontmatter = FRONTMATTER_BLOCK_REGEX.exec(data);
			return `${frontmatter ? frontmatter[0] : ''}${body}\n`;
		});
		return file;
	}

	/**
	 * 下書き一覧モーダルを開く
	 */
	openDraftSelectModal() {
		if (this.activeModal) return;
		if (!this.accessJwt) {
			void this.login().catch(() => { });
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
