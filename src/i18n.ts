import { MAX_IMAGES } from './images';

// Locale表示文字列型
export type LocaleStrings = {
	post: string;
	cancel: string;
	postTooLong: string;
	postContentEmpty: string;
	loginRequired: string;
	loginFailed: string;
	avatarFetchFailed: string;
	postFailed: string;
	postTimeout: string;
	postSuccess: string;
	imageUploadError: string;
	maxImagesReached: string;
	addImage: string;
	imageLimitHint: string;
	addImageFromVault: string;
	addImageFromDevice: string;
	imagePickerPlaceholder: string;
	noImagesInVault: string;
	imageSaveFailed: string;
	addEmoji: string;
	dismissKeyboard: string;
	hotkeys: string;
	placeholderText: string;
	handleLabel: string;
	handleDesc: string;
	handlePlaceholder: string;
	passwordLabel: string;
	passwordDesc: string;
	passwordMigrated: string;
	passwordMigrationFailed: string;
	passwordSecretMissing: string;
	timeoutLabel: string;
	timeoutDesc: string;
	timeoutPlaceholder: string;
	hashtagsLabel: string;
	hashtagsDesc: string;
	hashtagsPlaceholder: string;
	languageSettingsTitle: string;
	languageLabel: string;
	languageDesc: string;
	languageEnglish: string;
	languageJapanese: string;
	hotkeysTitle: string;
	cancelHotkeyLabel: string;
	cancelHotkeyDesc: string;
	postHotkeyLabel: string;
	postHotkeyDesc: string;
	imageHotkeyLabel: string;
	imageHotkeyDesc: string;
	emojiHotkeyLabel: string;
	emojiHotkeyDesc: string;
	appPasswordNote: string;
	hotkeyFormatNote: string;
	hotkeyConflictNote: string;
	hotkeyConflictWarning: string;
	duplicateHotkeys: string;
	posting: string;
	draftSelectTitle: string;
	noDraftsFound: string;
	draftFilterNote: string;
	draftFilterUnposted: string;
	draftTooLong: string;
	draftLoadFailed: string;
	draftPropertyLabel: string;
	draftPropertyDesc: string;
	draftValueLabel: string;
	draftValueDesc: string;
	postHistoryLabel: string;
	postHistoryDesc: string;
	postHistoryFolderLabel: string;
	postHistoryFolderDesc: string;
	postHistorySaveFailed: string;
	linkPropertyLabel: string;
	linkPropertyDesc: string;
	linkTargetPlaceholder: string;
	draftLinkTargetLabel: string;
	draftLinkTargetDesc: string;
	historyLinkTargetLabel: string;
	historyLinkTargetDesc: string;
	linkTargetMissing: string;
	saveImagesToVaultLabel: string;
	saveImagesToVaultDesc: string;
	convertMarkdownLabel: string;
	convertMarkdownDesc: string;
	confirmDraftOnCancelLabel: string;
	confirmDraftOnCancelDesc: string;
	draftNoteFolderLabel: string;
	draftNoteFolderDesc: string;
	draftSaveConfirmTitle: string;
	draftSaveConfirmBody: string;
	draftSaveConfirmUpdateBody: string;
	draftSaveConfirmImages: string;
	draftSaveConfirmSave: string;
	draftSaveConfirmUpdate: string;
	draftSaveConfirmDiscard: string;
	draftSaveConfirmResume: string;
	draftNoteCreated: string;
	draftNoteUpdated: string;
	draftNoteSaveFailed: string;
};

export function getLocaleByObsidianLanguage(lang: string): LocaleStrings {
	// Example implementation, adjust as needed
	if (lang === 'ja' || lang.startsWith('ja')) {
		return {
			post: '投稿',
			cancel: 'キャンセル',
			postTooLong: '投稿が長すぎます。',
			postContentEmpty: '投稿内容を入力してください。',
			loginRequired: 'ログインが必要です。',
			loginFailed: 'ログインに失敗しました',
			avatarFetchFailed: 'アバター取得に失敗しました',
			postFailed: '投稿に失敗しました',
			postTimeout: '投稿がタイムアウトしました',
			postSuccess: '投稿が完了しました',
			imageUploadError: '画像アップロードエラー',
			maxImagesReached: `画像は最大${MAX_IMAGES}枚までです。`,
			addImage: '画像追加',
			imageLimitHint: `最大${MAX_IMAGES}枚`,
			addImageFromVault: 'vault内の画像から選ぶ',
			addImageFromDevice: '端末から選ぶ',
			imagePickerPlaceholder: '添付する画像を検索',
			noImagesInVault: 'vault内に画像が見つかりませんでした',
			imageSaveFailed: '画像のvaultへの保存に失敗しました',
			addEmoji: '絵文字追加',
			dismissKeyboard: 'キーボードを閉じる',
			hotkeys: 'ホットキー',
			placeholderText: '投稿内容を入力...',
			handleLabel: 'ハンドル',
			handleDesc: 'Bluesky のハンドル名を入力してください。',
			handlePlaceholder: 'your-handle.bsky.social',
			passwordLabel: 'アプリパスワード',
			passwordDesc: 'Bluesky のアプリパスワードを Obsidian のキーチェーンに保存します。パスワード本体はプラグインの設定ファイルには保存されません。',
			passwordMigrated: '保存されていたアプリパスワードを Obsidian のキーチェーンに移しました。',
			passwordMigrationFailed: 'アプリパスワードをキーチェーンに移せませんでした。設定画面から入力し直してください。',
			passwordSecretMissing: 'この端末のキーチェーンにアプリパスワードがありません。キーチェーンは端末間で同期されないため、設定画面で入力し直してください。',
			timeoutLabel: 'タイムアウト',
			timeoutDesc: 'ネットワークタイムアウト (ミリ秒)',
			timeoutPlaceholder: '15000',
			hashtagsLabel: 'デフォルトハッシュタグ',
			hashtagsDesc: '投稿時に自動追加するハッシュタグ',
			hashtagsPlaceholder: '#obsidian',
			languageSettingsTitle: '言語設定',
			languageLabel: '言語',
			languageDesc: 'UI の言語を選択してください。',
			languageEnglish: '英語',
			languageJapanese: '日本語',
			hotkeysTitle: 'ホットキー設定',
			cancelHotkeyLabel: 'キャンセルホットキー',
			cancelHotkeyDesc: '投稿をキャンセルするホットキー',
			postHotkeyLabel: '投稿ホットキー',
			postHotkeyDesc: '投稿するホットキー',
			imageHotkeyLabel: '画像追加ホットキー',
			imageHotkeyDesc: '画像追加のホットキー',
			emojiHotkeyLabel: '絵文字追加ホットキー',
			emojiHotkeyDesc: '絵文字追加のホットキー',
			appPasswordNote: 'Bluesky のアプリパスワードを使用してください。',
			hotkeyFormatNote: 'ホットキーは "Mod+Enter" などの形式で指定します。',
			hotkeyConflictNote: 'ホットキーが重複している場合は警告が表示されます。',
			hotkeyConflictWarning: 'ホットキーが重複しています。',
			duplicateHotkeys: '重複ホットキー',
			posting: '投稿中...',
			draftSelectTitle: '下書き一覧',
			noDraftsFound: '下書きが見つかりません',
			draftFilterNote: '※ 表示条件',
			draftFilterUnposted: '未チェック',
			draftTooLong: '投稿内容が300字を超えています。編集してください。',
			draftLoadFailed: '下書きの読み込みに失敗しました',
			draftPropertyLabel: '下書きプロパティ名',
			draftPropertyDesc: '下書きノートを識別するfrontmatterのキー名',
			draftValueLabel: '下書き判定値',
			draftValueDesc: '上記キーに対応する値。この値を持つノートが下書き一覧に表示されます',
			postHistoryLabel: '投稿履歴を保存',
			postHistoryDesc: '投稿成功時に本文・日時・URL入りのノートを自動作成します',
			postHistoryFolderLabel: '履歴ノートの保存先',
			postHistoryFolderDesc: '履歴ノートを作成するフォルダ（存在しなければ自動作成）',
			postHistorySaveFailed: '投稿履歴の保存に失敗しました',
			linkPropertyLabel: '紐づけプロパティ名',
			linkPropertyDesc: '紐づけ先へのリンクを書き込むfrontmatterのキー名',
			linkTargetPlaceholder: '紐づけなし',
			draftLinkTargetLabel: '下書きノートの紐づけ先',
			draftLinkTargetDesc: '下書きから投稿したとき、そのノートに紐づけるノート（空欄なら紐づけません）。'
				+ '{{date:YYYY-MM-DD}} や {{time:HHmm}} で投稿日時を埋め込めます',
			historyLinkTargetLabel: '履歴ノートの紐づけ先',
			historyLinkTargetDesc: '作成した履歴ノートに紐づけるノート（空欄なら紐づけません）。'
				+ '{{date:YYYY-MM-DD}} や {{time:HHmm}} で投稿日時を埋め込めます',
			linkTargetMissing: '紐づけ先のノートが見つからないため、リンクを追加しませんでした',
			saveImagesToVaultLabel: '端末から選んだ画像をvaultに保存',
			saveImagesToVaultDesc: '端末から添付した画像をvaultに取り込み、下書きノート・履歴ノートに埋め込みます。'
				+ '保存先はObsidian本体の「添付ファイルの保存先」設定に従います。'
				+ 'オフにすると投稿はできますが、ノートには画像が残りません（vault内の画像を選んだ場合は設定に関わらず記録されます）',
			convertMarkdownLabel: 'Markdown記法を変換して投稿',
			convertMarkdownDesc: '[表示テキスト](URL) をリンクとして投稿し、太字・見出し・箇条書き・コードなどの記号を取り除きます。'
				+ 'Blueskyの投稿はプレーンテキストのため太字や斜体そのものは表現できません。'
				+ 'オフにすると入力した記号がそのまま投稿されます（文字数も消費します）',
			confirmDraftOnCancelLabel: '投稿せずに閉じたとき下書き保存を確認',
			confirmDraftOnCancelDesc: '書きかけの投稿があるまま作成画面を閉じたとき、下書きノートに残すか尋ねます。'
				+ '下書きノートから開いた場合は、そのノートを更新するか尋ねます',
			draftNoteFolderLabel: '下書きノートの保存先',
			draftNoteFolderDesc: '書きかけを保存する下書きノートを作成するフォルダ（存在しなければ自動作成）',
			draftSaveConfirmTitle: '下書きノートを作成しますか？',
			draftSaveConfirmBody: '書きかけの投稿内容があります。',
			draftSaveConfirmUpdateBody: '編集内容を元の下書きノートに保存します',
			draftSaveConfirmImages: '添付画像',
			draftSaveConfirmSave: '下書きを作成',
			draftSaveConfirmUpdate: '下書きを更新',
			draftSaveConfirmDiscard: '破棄',
			draftSaveConfirmResume: '編集に戻る',
			draftNoteCreated: '下書きノートを作成しました',
			draftNoteUpdated: '下書きノートを更新しました',
			draftNoteSaveFailed: '下書きノートの保存に失敗しました'
		};
	}
	// Default to English
	return {
		post: 'Post',
		cancel: 'Cancel',
		postTooLong: 'Post is too long.',
		postContentEmpty: 'Please enter post content.',
		loginRequired: 'Login required.',
		loginFailed: 'Login failed',
		avatarFetchFailed: 'Failed to fetch avatar',
		postFailed: 'Post failed',
		postTimeout: 'Post timed out',
		postSuccess: 'Post successful',
		imageUploadError: 'Image upload error',
		maxImagesReached: `Maximum ${MAX_IMAGES} images allowed.`,
		addImage: 'Add image',
		imageLimitHint: `up to ${MAX_IMAGES}`,
		addImageFromVault: 'Choose from vault',
		addImageFromDevice: 'Choose from device',
		imagePickerPlaceholder: 'Search images to attach',
		noImagesInVault: 'No images found in the vault',
		imageSaveFailed: 'Failed to save the image to the vault',
		addEmoji: 'Add emoji',
		dismissKeyboard: 'Dismiss keyboard',
		hotkeys: 'Hotkeys',
		placeholderText: 'Enter post content...',
		handleLabel: 'Handle',
		handleDesc: 'Enter your Bluesky handle.',
		handlePlaceholder: 'your-handle.bsky.social',
		passwordLabel: 'App password',
		passwordDesc: 'Stores your Bluesky app password in the Obsidian keychain. The password itself is never written to the plugin settings file.',
		passwordMigrated: 'Moved your saved app password into the Obsidian keychain.',
		passwordMigrationFailed: 'Could not move the app password into the keychain. Please enter it again in settings.',
		passwordSecretMissing: 'No app password in this device\'s keychain. The keychain does not sync between devices, so enter it again in settings.',
		timeoutLabel: 'Timeout',
		timeoutDesc: 'Network timeout (ms)',
		timeoutPlaceholder: '15000',
		hashtagsLabel: 'Default hashtags',
		hashtagsDesc: 'Hashtags to add automatically when posting',
		hashtagsPlaceholder: '#obsidian',
		languageSettingsTitle: 'Language Settings',
		languageLabel: 'Language',
		languageDesc: 'Select UI language.',
		languageEnglish: 'English',
		languageJapanese: 'Japanese',
		hotkeysTitle: 'Hotkey Settings',
		cancelHotkeyLabel: 'Cancel Hotkey',
		cancelHotkeyDesc: 'Hotkey to cancel posting',
		postHotkeyLabel: 'Post hotkey',
		postHotkeyDesc: 'Hotkey to post (e.g., Ctrl+Enter)',
		imageHotkeyLabel: 'Add image hotkey',
		imageHotkeyDesc: 'Hotkey to add image (e.g., Ctrl+I)',
		emojiHotkeyLabel: 'Add emoji hotkey',
		emojiHotkeyDesc: 'Hotkey to add emoji (e.g., Ctrl+E)',
		appPasswordNote: 'Use your Bluesky app password.',
		hotkeyFormatNote: 'Specify hotkeys like "Mod+Enter".',
		hotkeyConflictNote: 'A warning will be shown if hotkeys conflict.',
		hotkeyConflictWarning: 'Hotkey conflict detected.',
		duplicateHotkeys: 'Duplicate hotkeys',
		posting: 'Posting...',
		draftSelectTitle: 'Draft notes',
		noDraftsFound: 'No drafts found',
		draftFilterNote: 'Filter',
		draftFilterUnposted: 'unchecked',
		draftTooLong: 'Post content exceeds 300 characters. Please edit it before posting.',
		draftLoadFailed: 'Failed to load drafts',
		draftPropertyLabel: 'Draft property name',
		draftPropertyDesc: 'Frontmatter key used to identify draft notes',
		draftValueLabel: 'Draft property value',
		draftValueDesc: 'Value for the key above. Notes with this value appear in the draft list',
		postHistoryLabel: 'Save post history',
		postHistoryDesc: 'Automatically create a note with the text, timestamp and URL after a successful post',
		postHistoryFolderLabel: 'History note folder',
		postHistoryFolderDesc: 'Folder to create history notes in (created automatically if missing)',
		postHistorySaveFailed: 'Failed to save post history',
		linkPropertyLabel: 'Link property name',
		linkPropertyDesc: 'Frontmatter key the link to the target note is written to',
		linkTargetPlaceholder: 'No link',
		draftLinkTargetLabel: 'Draft note link target',
		draftLinkTargetDesc: 'Note to link a draft to when it is posted (leave empty to disable). '
			+ 'Use {{date:YYYY-MM-DD}} or {{time:HHmm}} to embed the posting time',
		historyLinkTargetLabel: 'History note link target',
		historyLinkTargetDesc: 'Note to link newly created history notes to (leave empty to disable). '
			+ 'Use {{date:YYYY-MM-DD}} or {{time:HHmm}} to embed the posting time',
		linkTargetMissing: 'The link target note was not found, so no link was added',
		saveImagesToVaultLabel: 'Save device images to the vault',
		saveImagesToVaultDesc: 'Import images attached from the device into the vault and embed them in draft and history notes. '
			+ "The location follows Obsidian's own attachment folder setting. "
			+ 'When off, posting still works but no image is kept in the note (images chosen from the vault are recorded regardless)',
		convertMarkdownLabel: 'Convert Markdown before posting',
		convertMarkdownDesc: 'Post [display text](URL) as a link and strip the markers of bold, headings, bullet lists, code and so on. '
			+ 'Bluesky posts are plain text, so bold and italic themselves cannot be represented. '
			+ 'When off, the markers are posted as typed and count towards the character limit',
		confirmDraftOnCancelLabel: 'Ask to save a draft when closing',
		confirmDraftOnCancelDesc: 'When the composer is closed with unsent content, ask whether to keep it in a draft note. '
			+ 'When the composer was opened from a draft note, it asks whether to update that note instead',
		draftNoteFolderLabel: 'Draft note folder',
		draftNoteFolderDesc: 'Folder to create draft notes in when saving unsent content (created automatically if missing)',
		draftSaveConfirmTitle: 'Save as a draft note?',
		draftSaveConfirmBody: 'The composer still has unsent content.',
		draftSaveConfirmUpdateBody: 'The edits will be saved back to the original draft note',
		draftSaveConfirmImages: 'Attached images',
		draftSaveConfirmSave: 'Save draft',
		draftSaveConfirmUpdate: 'Update draft',
		draftSaveConfirmDiscard: 'Discard',
		draftSaveConfirmResume: 'Keep editing',
		draftNoteCreated: 'Draft note created',
		draftNoteUpdated: 'Draft note updated',
		draftNoteSaveFailed: 'Failed to save the draft note'
	};
}
