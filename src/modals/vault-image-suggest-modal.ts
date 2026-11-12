import { App, FuzzySuggestModal, TFile } from 'obsidian';
import type BlueskyPlugin from '../../main';

/**
 * vault 内の画像を選ばせるサジェスト。
 * 端末のファイルピッカーと違い PC・モバイルで挙動が変わらず、選んだ時点でパスが
 * 確定しているのでそのままノートに埋め込める。
 */
export class VaultImageSuggestModal extends FuzzySuggestModal<TFile> {
	private images: TFile[];
	private onChooseImage: (file: TFile) => void;

	constructor(app: App, plugin: BlueskyPlugin, images: TFile[], onChooseImage: (file: TFile) => void) {
		super(app);
		this.images = images;
		this.onChooseImage = onChooseImage;
		this.setPlaceholder(plugin.getLocale().imagePickerPlaceholder);
	}

	getItems(): TFile[] {
		return this.images;
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile): void {
		this.onChooseImage(file);
	}
}
