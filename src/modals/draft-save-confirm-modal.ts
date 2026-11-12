import { App, Modal, ButtonComponent } from 'obsidian';
import type BlueskyPlugin from '../../main';
import { PendingDraft } from '../images';

/**
 * 投稿せずに作成画面を閉じたときに、書きかけを下書きノートへ残すか尋ねるモーダル。
 *
 * Esc や外側クリックで閉じた場合は「編集に戻る」と同じ扱いにする。書きかけを
 * 黙って捨てないための既定で、破棄するときは明示的にボタンを押させる。
 */
export class DraftSaveConfirmModal extends Modal {
	private plugin: BlueskyPlugin;
	private pending: PendingDraft;
	private handlers: { onSave: () => void; onResume: () => void };
	private choice: 'save' | 'discard' | 'resume' = 'resume';

	constructor(
		app: App,
		plugin: BlueskyPlugin,
		pending: PendingDraft,
		handlers: { onSave: () => void; onResume: () => void }
	) {
		super(app);
		this.plugin = plugin;
		this.pending = pending;
		this.handlers = handlers;
	}

	onOpen(): void {
		const locale = this.plugin.getLocale();
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('bluesky-confirm-modal');
		this.setTitle(locale.draftSaveConfirmTitle);

		const isUpdate = this.pending.sourceFile !== null;
		contentEl.createEl('p', { text: locale.draftSaveConfirmBody });
		if (isUpdate) {
			contentEl.createEl('p', {
				cls: 'bluesky-confirm-note',
				text: `${locale.draftSaveConfirmUpdateBody}: ${this.pending.sourceFile?.basename}`
			});
		}
		if (this.pending.images.length > 0) {
			contentEl.createEl('p', {
				cls: 'bluesky-confirm-note',
				text: `${locale.draftSaveConfirmImages}: ${this.pending.images.length}`
			});
		}

		const buttonsEl = contentEl.createDiv({ cls: 'bluesky-confirm-buttons' });
		const saveButton = new ButtonComponent(buttonsEl)
			.setButtonText(isUpdate ? locale.draftSaveConfirmUpdate : locale.draftSaveConfirmSave)
			.setCta()
			.onClick(() => this.chooseAndClose('save'));
		// 破棄だけ色を変えて区別する。setWarning() は非推奨で、代わりの setDestructive() は
		// minAppVersion(1.8.7) には無いため、同じ見た目になるクラスを直接付ける
		const discardButton = new ButtonComponent(buttonsEl)
			.setButtonText(locale.draftSaveConfirmDiscard)
			.onClick(() => this.chooseAndClose('discard'));
		discardButton.buttonEl.addClass('mod-warning');
		new ButtonComponent(buttonsEl)
			.setButtonText(locale.draftSaveConfirmResume)
			.onClick(() => this.chooseAndClose('resume'));
		// Enter で保存できるようにしておく（Esc は編集に戻る）
		window.setTimeout(() => saveButton.buttonEl.focus(), 0);
	}

	private chooseAndClose(choice: 'save' | 'discard' | 'resume'): void {
		this.choice = choice;
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
		// 作成画面を開き直す場合があるため、こちらが閉じ切ってから実行する
		const choice = this.choice;
		if (choice === 'discard') return;
		window.setTimeout(() => {
			if (choice === 'save') this.handlers.onSave();
			else this.handlers.onResume();
		}, 0);
	}
}
