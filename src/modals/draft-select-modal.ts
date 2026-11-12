import { Notice, App, Modal, setIcon, getLinkpath, TFile } from 'obsidian';
import type BlueskyPlugin from '../../main';
import { FRONTMATTER_BLOCK_REGEX, POSTED_CHECKBOX_PROPERTY, frontmatterMatchesValue } from '../frontmatter';
import { MAX_IMAGES, isImageFile } from '../images';
import { DEFAULT_SETTINGS } from '../settings';
import { MAX_POST_LENGTH, countGraphemes } from '../text';

/** 下書きノートを投稿本文と添付画像に分けた結果 */
export type DraftContent = { body: string; images: TFile[] };

/**
 * frontmatter で下書きと判定されたノートの一覧を表示し、選択したノートの本文で
 * PostModal を開くモーダル。
 */
export class DraftSelectModal extends Modal {
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
		return content.replace(FRONTMATTER_BLOCK_REGEX, '').trim();
	}

	renderDraftItem(listEl: HTMLElement, file: TFile, draft: DraftContent): void {
		// 作成画面のカウンターと同じ基準で数える（Markdown変換が有効なら記号は落ちる）
		const count = countGraphemes(this.plugin.buildPostText(draft.body).text);
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
