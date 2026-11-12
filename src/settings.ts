import { App, Setting, TextComponent, SecretComponent, PluginSettingTab, AbstractInputSuggest, requireApiVersion, TFile, TFolder } from 'obsidian';
import type { SettingDefinitionItem } from 'obsidian';
import type BlueskyPlugin from '../main';
import { findNoteByPath, hasTemplatePlaceholder } from './frontmatter';

// 追加: 設定用インターフェース & デフォルト値
export interface BlueskyPluginSettings {
	handle: string;
	/**
	 * アプリパスワードそのものではなく、Obsidian のキーチェーン(Secret Storage)上の
	 * シークレットID。パスワード本体は data.json には書かれない
	 */
	passwordSecretId: string;
	networkTimeoutMs: number;
	defaultHashtags: string;
	draftProperty: string;
	draftValue: string;
	postHistoryEnabled: boolean;
	postHistoryFolder: string;
	linkProperty: string;
	draftLinkTarget: string;
	historyLinkTarget: string;
	saveImagesToVault: boolean;
	convertMarkdown: boolean;
	confirmDraftOnCancel: boolean;
	draftNoteFolder: string;
}

/** v0.5.1 以前は data.json にアプリパスワードを平文で持っていた。移行のためだけに読む */
export type StoredSettings = Partial<BlueskyPluginSettings> & { password?: string };

/**
 * キーチェーンに作るシークレットIDの既定値。
 * IDは全プラグイン共有なので、他プラグインの同名シークレットは上書きしない
 */
export const DEFAULT_SECRET_ID = 'bluesky-app-password';

export const DEFAULT_SETTINGS: BlueskyPluginSettings = {
	handle: '',
	passwordSecretId: '',
	networkTimeoutMs: 15000,
	defaultHashtags: '',
	draftProperty: 'type',
	draftValue: 'bluesky-draft',
	postHistoryEnabled: false,
	postHistoryFolder: 'Bluesky Posts',
	linkProperty: 'related',
	// 空文字は「紐づけなし」。下書き・履歴で別々の紐づけ先を持てる
	draftLinkTarget: '',
	historyLinkTarget: '',
	// 端末から選んだ画像を vault に取り込むか。取り込まないとノートに埋め込めない
	saveImagesToVault: true,
	// 既定は無効。`*` を強調のつもりではなく記号として見せたい書き方（Bluesky には
	// 太字が無いため実際にある）を、更新だけで勝手に変えてしまわないため
	convertMarkdown: false,
	confirmDraftOnCancel: true,
	draftNoteFolder: 'Bluesky Drafts'
};

/**
 * vault 内フォルダのサジェスト付き入力。
 * Obsidian 1.13+ では宣言的設定の control type:'folder' が同等機能を持つため、
 * このクラスは display() フォールバック（1.13未満）専用。
 */
export class FolderSuggest extends AbstractInputSuggest<TFolder> {
	private onSelectFolder: (path: string) => void;

	constructor(app: App, inputEl: HTMLInputElement, onSelectFolder: (path: string) => void) {
		super(app, inputEl);
		this.onSelectFolder = onSelectFolder;
	}

	protected getSuggestions(query: string): TFolder[] {
		const q = query.toLowerCase();
		return this.app.vault.getAllFolders(true).filter((folder) => folder.path.toLowerCase().includes(q));
	}

	renderSuggestion(folder: TFolder, el: HTMLElement): void {
		el.setText(folder.path);
	}

	selectSuggestion(folder: TFolder): void {
		this.setValue(folder.path);
		this.onSelectFolder(folder.path);
		this.close();
	}
}

/**
 * vault 内 Markdown ノートのサジェスト付き入力。
 * FolderSuggest と同じく、宣言的設定の control type:'file' が使えない
 * display() フォールバック（1.13未満）専用。
 */
export class FileSuggest extends AbstractInputSuggest<TFile> {
	private onSelectFile: (path: string) => void;

	constructor(app: App, inputEl: HTMLInputElement, onSelectFile: (path: string) => void) {
		super(app, inputEl);
		this.onSelectFile = onSelectFile;
	}

	protected getSuggestions(query: string): TFile[] {
		const q = query.toLowerCase();
		return this.app.vault.getMarkdownFiles().filter((file) => file.path.toLowerCase().includes(q));
	}

	renderSuggestion(file: TFile, el: HTMLElement): void {
		el.setText(file.path);
	}

	selectSuggestion(file: TFile): void {
		this.setValue(file.path);
		this.onSelectFile(file.path);
		this.close();
	}
}

export class BlueskySettingTab extends PluginSettingTab {
	plugin: BlueskyPlugin;

	constructor(app: App, plugin: BlueskyPlugin) { super(app, plugin); this.plugin = plugin; }

	getSettingDefinitions(): SettingDefinitionItem[] {
		const locale = this.plugin.getLocale();
		return [
			{
				name: locale.handleLabel,
				desc: locale.handleDesc,
				control: { type: 'text', key: 'handle', placeholder: locale.handlePlaceholder }
			},
			{
				// パスワード本体はキーチェーンが預かる。設定に残るのはシークレットIDだけなので
				// 宣言的コントロールではなく SecretComponent を render で差し込む
				name: locale.passwordLabel,
				desc: locale.passwordDesc,
				render: (setting) => {
					setting.addComponent((el) => new SecretComponent(this.app, el)
						.setValue(this.plugin.settings.passwordSecretId)
						.onChange(async (value) => {
							this.plugin.settings.passwordSecretId = value;
							await this.plugin.saveSettings();
						}));
				}
			},
			{
				name: locale.timeoutLabel,
				desc: locale.timeoutDesc,
				control: { type: 'number', key: 'networkTimeoutMs', placeholder: locale.timeoutPlaceholder, defaultValue: 15000, min: 1000, max: 60000, step: 1 }
			},
			{
				name: locale.hashtagsLabel,
				desc: locale.hashtagsDesc,
				control: { type: 'text', key: 'defaultHashtags', placeholder: locale.hashtagsPlaceholder }
			},
			{
				name: locale.convertMarkdownLabel,
				desc: locale.convertMarkdownDesc,
				control: { type: 'toggle', key: 'convertMarkdown', defaultValue: DEFAULT_SETTINGS.convertMarkdown }
			},
			{
				name: locale.draftPropertyLabel,
				desc: locale.draftPropertyDesc,
				control: { type: 'text', key: 'draftProperty', placeholder: DEFAULT_SETTINGS.draftProperty, defaultValue: DEFAULT_SETTINGS.draftProperty }
			},
			{
				name: locale.draftValueLabel,
				desc: locale.draftValueDesc,
				control: { type: 'text', key: 'draftValue', placeholder: DEFAULT_SETTINGS.draftValue, defaultValue: DEFAULT_SETTINGS.draftValue }
			},
			{
				name: locale.confirmDraftOnCancelLabel,
				desc: locale.confirmDraftOnCancelDesc,
				control: { type: 'toggle', key: 'confirmDraftOnCancel', defaultValue: DEFAULT_SETTINGS.confirmDraftOnCancel }
			},
			{
				name: locale.draftNoteFolderLabel,
				desc: locale.draftNoteFolderDesc,
				control: {
					type: 'folder',
					key: 'draftNoteFolder',
					placeholder: DEFAULT_SETTINGS.draftNoteFolder,
					defaultValue: DEFAULT_SETTINGS.draftNoteFolder,
					includeRoot: true,
					disabled: () => !this.plugin.settings.confirmDraftOnCancel
				}
			},
			{
				name: locale.postHistoryLabel,
				desc: locale.postHistoryDesc,
				control: { type: 'toggle', key: 'postHistoryEnabled', defaultValue: false }
			},
			{
				name: locale.postHistoryFolderLabel,
				desc: locale.postHistoryFolderDesc,
				control: {
					type: 'folder',
					key: 'postHistoryFolder',
					placeholder: DEFAULT_SETTINGS.postHistoryFolder,
					defaultValue: DEFAULT_SETTINGS.postHistoryFolder,
					includeRoot: true,
					disabled: () => !this.plugin.settings.postHistoryEnabled
				}
			},
			{
				name: locale.linkPropertyLabel,
				desc: locale.linkPropertyDesc,
				control: { type: 'text', key: 'linkProperty', placeholder: DEFAULT_SETTINGS.linkProperty, defaultValue: DEFAULT_SETTINGS.linkProperty }
			},
			{
				name: locale.draftLinkTargetLabel,
				desc: locale.draftLinkTargetDesc,
				control: {
					type: 'file',
					key: 'draftLinkTarget',
					placeholder: locale.linkTargetPlaceholder,
					filter: (file) => file.extension === 'md',
					validate: (value) => this.validateLinkTarget(value)
				}
			},
			{
				name: locale.historyLinkTargetLabel,
				desc: locale.historyLinkTargetDesc,
				control: {
					type: 'file',
					key: 'historyLinkTarget',
					placeholder: locale.linkTargetPlaceholder,
					filter: (file) => file.extension === 'md',
					validate: (value) => this.validateLinkTarget(value),
					disabled: () => !this.plugin.settings.postHistoryEnabled
				}
			},
			{
				name: locale.saveImagesToVaultLabel,
				desc: locale.saveImagesToVaultDesc,
				control: { type: 'toggle', key: 'saveImagesToVault', defaultValue: DEFAULT_SETTINGS.saveImagesToVault }
			}
		];
	}

	/**
	 * 紐づけ先の入力値を検証する（1.13+ の宣言的コントロール専用）。
	 * 空欄は「紐づけなし」なので有効。存在しないパスはこの場でインラインエラーにして、
	 * 投稿時に初めて気づく事態を避ける。
	 * 変数入りの設定は未作成リンクを許す仕様なので、実在しなくてもエラーにしない。
	 */
	private validateLinkTarget(value: string): string | void {
		const template = value?.trim();
		if (!template || hasTemplatePlaceholder(template)) return;
		if (!findNoteByPath(this.app, template)) {
			return this.plugin.getLocale().linkTargetMissing;
		}
	}

	setControlValue(key: string, value: unknown): Promise<void> {
		if (key === 'networkTimeoutMs') {
			const n = Number(value);
			value = Number.isFinite(n) ? Math.min(Math.max(Math.round(n), 1000), 60000) : 15000;
		}
		(this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
		// トグルの状態は依存する欄（保存先フォルダ・紐づけ先）の disabled 判定に
		// 使われるため再評価させる
		// refreshDomState() は 1.13.0 で追加されたAPI。この経路自体が宣言的レンダラ
		// （1.13+）からしか呼ばれないが、minAppVersion が 1.8.7 なので明示的にガードする
		if (requireApiVersion('1.13.0') && (key === 'postHistoryEnabled' || key === 'confirmDraftOnCancel')) this.refreshDomState();
		return this.plugin.saveSettings();
	}

	// Obsidian 1.13 未満用フォールバック（1.13+ では getSettingDefinitions から宣言的に描画される）
	display(): void {
		const { containerEl } = this;
		containerEl.empty();

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
			.addComponent((el) => new SecretComponent(this.app, el)
				.setValue(this.plugin.settings.passwordSecretId)
				.onChange(async (value) => {
					this.plugin.settings.passwordSecretId = value;
					await this.plugin.saveSettings();
				}));

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

		const locale = this.plugin.getLocale();

		new Setting(containerEl)
			.setName(locale.convertMarkdownLabel)
			.setDesc(locale.convertMarkdownDesc)
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.convertMarkdown)
				.onChange(async (value) => {
					this.plugin.settings.convertMarkdown = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(locale.draftPropertyLabel)
			.setDesc(locale.draftPropertyDesc)
			.addText(text => text
				.setPlaceholder(DEFAULT_SETTINGS.draftProperty)
				.setValue(this.plugin.settings.draftProperty)
				.onChange(async (value) => {
					this.plugin.settings.draftProperty = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(locale.draftValueLabel)
			.setDesc(locale.draftValueDesc)
			.addText(text => text
				.setPlaceholder(DEFAULT_SETTINGS.draftValue)
				.setValue(this.plugin.settings.draftValue)
				.onChange(async (value) => {
					this.plugin.settings.draftValue = value;
					await this.plugin.saveSettings();
				}));

		// 下書き保存の確認に依存する欄も、履歴側と同じくトグルに追従させる
		const draftSaveDependent: { setting: Setting | null; text: TextComponent | null } = { setting: null, text: null };
		const applyDraftSaveDisabled = () => {
			const disabled = !this.plugin.settings.confirmDraftOnCancel;
			draftSaveDependent.setting?.setDisabled(disabled);
			draftSaveDependent.text?.setDisabled(disabled);
		};

		new Setting(containerEl)
			.setName(locale.confirmDraftOnCancelLabel)
			.setDesc(locale.confirmDraftOnCancelDesc)
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.confirmDraftOnCancel)
				.onChange(async (value) => {
					this.plugin.settings.confirmDraftOnCancel = value;
					await this.plugin.saveSettings();
					applyDraftSaveDisabled();
				}));

		draftSaveDependent.setting = new Setting(containerEl)
			.setName(locale.draftNoteFolderLabel)
			.setDesc(locale.draftNoteFolderDesc)
			.addText(text => {
				draftSaveDependent.text = text;
				text.setPlaceholder(DEFAULT_SETTINGS.draftNoteFolder)
					.setValue(this.plugin.settings.draftNoteFolder)
					.onChange(async (value) => {
						this.plugin.settings.draftNoteFolder = value;
						await this.plugin.saveSettings();
					});
				new FolderSuggest(this.app, text.inputEl, (path) => {
					text.setValue(path);
					this.plugin.settings.draftNoteFolder = path;
					void this.plugin.saveSettings();
				});
			});
		applyDraftSaveDisabled();

		// 履歴に依存する欄はトグルに追従してグレーアウトさせる。display() を呼び直すと
		// 設定画面ごと作り直しになり入力中のフォーカスも飛ぶので、該当欄だけを更新する
		const historyDependents: { setting: Setting | null; text: TextComponent | null }[] = [];
		const applyHistoryDisabled = () => {
			const disabled = !this.plugin.settings.postHistoryEnabled;
			for (const dependent of historyDependents) {
				dependent.setting?.setDisabled(disabled);
				dependent.text?.setDisabled(disabled);
			}
		};

		new Setting(containerEl)
			.setName(locale.postHistoryLabel)
			.setDesc(locale.postHistoryDesc)
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.postHistoryEnabled)
				.onChange(async (value) => {
					this.plugin.settings.postHistoryEnabled = value;
					await this.plugin.saveSettings();
					applyHistoryDisabled();
				}));

		const folderDependent: { setting: Setting | null; text: TextComponent | null } = { setting: null, text: null };
		historyDependents.push(folderDependent);
		folderDependent.setting = new Setting(containerEl)
			.setName(locale.postHistoryFolderLabel)
			.setDesc(locale.postHistoryFolderDesc)
			.addText(text => {
				folderDependent.text = text;
				text.setPlaceholder(DEFAULT_SETTINGS.postHistoryFolder)
					.setValue(this.plugin.settings.postHistoryFolder)
					.onChange(async (value) => {
						this.plugin.settings.postHistoryFolder = value;
						await this.plugin.saveSettings();
					});
				new FolderSuggest(this.app, text.inputEl, (path) => {
					text.setValue(path);
					this.plugin.settings.postHistoryFolder = path;
					void this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName(locale.linkPropertyLabel)
			.setDesc(locale.linkPropertyDesc)
			.addText(text => text
				.setPlaceholder(DEFAULT_SETTINGS.linkProperty)
				.setValue(this.plugin.settings.linkProperty)
				.onChange(async (value) => {
					this.plugin.settings.linkProperty = value;
					await this.plugin.saveSettings();
				}));

		this.addLinkTargetSetting(containerEl, locale.draftLinkTargetLabel, locale.draftLinkTargetDesc, 'draftLinkTarget');

		const historyLinkDependent = this.addLinkTargetSetting(
			containerEl, locale.historyLinkTargetLabel, locale.historyLinkTargetDesc, 'historyLinkTarget'
		);
		historyDependents.push(historyLinkDependent);

		new Setting(containerEl)
			.setName(locale.saveImagesToVaultLabel)
			.setDesc(locale.saveImagesToVaultDesc)
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.saveImagesToVault)
				.onChange(async (value) => {
					this.plugin.settings.saveImagesToVault = value;
					await this.plugin.saveSettings();
				}));

		applyHistoryDisabled();
	}

	/**
	 * 紐づけ先ノートの入力欄を1件描画する（display() フォールバック専用）。
	 * グレーアウト制御のために Setting と TextComponent の参照を返す。
	 */
	private addLinkTargetSetting(
		containerEl: HTMLElement,
		name: string,
		desc: string,
		key: 'draftLinkTarget' | 'historyLinkTarget'
	): { setting: Setting | null; text: TextComponent | null } {
		const dependent: { setting: Setting | null; text: TextComponent | null } = { setting: null, text: null };
		dependent.setting = new Setting(containerEl)
			.setName(name)
			.setDesc(desc)
			.addText(text => {
				dependent.text = text;
				text.setPlaceholder(this.plugin.getLocale().linkTargetPlaceholder)
					.setValue(this.plugin.settings[key])
					.onChange(async (value) => {
						this.plugin.settings[key] = value;
						await this.plugin.saveSettings();
					});
				new FileSuggest(this.app, text.inputEl, (path) => {
					text.setValue(path);
					this.plugin.settings[key] = path;
					void this.plugin.saveSettings();
				});
			});
		return dependent;
	}
}
