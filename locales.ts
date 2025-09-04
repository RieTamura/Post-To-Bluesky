// locales.ts - ローカライゼーション用の定数定義

export interface LocaleStrings {
  // 投稿関連
  posting: string;
  post: string;
  cancel: string;
  pleaseSelectText: string;
  noteIsEmpty: string;
  postContentEmpty: string;
  postTooLong: string;
  pleaseEnterContent: string;
  
  // 画像関連
  addImage: string;
  maxImagesReached: string;
  imageUploadError: string;
  
  // 絵文字関連
  addEmoji: string;
  selectEmoji: string;
  
  // カテゴリ名
  emotions: string;
  hands: string;
  hearts: string;
  nature: string;
  food: string;
  activities: string;
  
  // 通知メッセージ
  loginRequired: string;
  loginFailed: string;
  postSuccess: string;
  postFailed: string;
  avatarFetchFailed: string;
  imageUploadTimeout: string;
  postTimeout: string;
  
  // 設定画面
  settingsTitle: string;
  handleLabel: string;
  handleDesc: string;
  passwordLabel: string;
  passwordDesc: string;
  timeoutLabel: string;
  timeoutDesc: string;
  hashtagsLabel: string;
  hashtagsDesc: string;
  hotkeysTitle: string;
  cancelHotkeyLabel: string;
  cancelHotkeyDesc: string;
  postHotkeyLabel: string;
  postHotkeyDesc: string;
  imageHotkeyLabel: string;
  imageHotkeyDesc: string;
  emojiHotkeyLabel: string;
  emojiHotkeyDesc: string;
  
  // 注意事項
  appPasswordNote: string;
  hotkeyFormatNote: string;
  hotkeyConflictNote: string;
  
  // ホットキー衝突警告
  hotkeyConflictWarning: string;
  duplicateHotkeys: string;
  commonShortcuts: string;
  browserShortcuts: string;
  osShortcuts: string;
  
  // ホットキー衝突説明（generateConflictDescription用）
  browserShortcutsLabel: string;
  osShortcutsLabel: string;
  commonShortcutsLabel: string;
  
  // プレースホルダー
  placeholderText: string;
  handlePlaceholder: string;
  passwordPlaceholder: string;
  timeoutPlaceholder: string;
  hashtagsPlaceholder: string;
  
  // コマンド名
  commandPostSelection: string;
  commandPostNote: string;
  commandCreatePost: string;
  commandToggleEmojiPicker: string;
  
  // リボンアイコン
  ribbonIconTooltip: string;
  
  // ホットキー記法
  hotkeyFormat: string;
  hotkeyExamples: string;
  
  // ホットキーラベル
  hotkeys: string;
  
  // 言語設定
  languageSettingsTitle: string;
  languageLabel: string;
  languageDesc: string;
  languageAuto: string;
  languageEnglish: string;
  languageJapanese: string;
}

export const ja: LocaleStrings = {
  // 投稿関連
  posting: '投稿中…',
  post: '投稿',
  cancel: 'キャンセル',
  pleaseSelectText: 'テキストを選択してください',
  noteIsEmpty: 'ノートが空です',
  postContentEmpty: '投稿内容が空です',
  postTooLong: '投稿が300文字を超えています。テキストを短くしてください。',
  pleaseEnterContent: '投稿内容を入力してください',
  
  // 画像関連
  addImage: '画像を追加',
  maxImagesReached: '画像は最大4枚までです。',
  imageUploadError: '画像アップロードエラー',
  
  // 絵文字関連
  addEmoji: '絵文字を追加',
  selectEmoji: '絵文字を選択',
  
  // カテゴリ名
  emotions: '感情',
  hands: '手',
  hearts: 'ハート',
  nature: '自然',
  food: '食べ物',
  activities: '活動',
  
  // 通知メッセージ
  loginRequired: 'Blueskyのハンドルとパスワードを設定してください',
  loginFailed: 'ログインに失敗しました',
  postSuccess: 'Blueskyに投稿しました！',
  postFailed: '投稿エラー',
  avatarFetchFailed: 'アバターの取得に失敗しました',
  imageUploadTimeout: '画像アップロードがタイムアウトしました',
  postTimeout: '投稿がタイムアウトしました',
  
  // 設定画面
  settingsTitle: 'Obsidian to Bluesky 設定',
  handleLabel: 'Bluesky ハンドル',
  handleDesc: 'あなたのBlueskyハンドル（例: username.bsky.social）',
  passwordLabel: 'App パスワード',
  passwordDesc: 'BlueskyのApp Password（設定から作成してください）',
  timeoutLabel: 'ネットワークタイムアウト (ms)',
  timeoutDesc: 'Bluesky API呼び出しのタイムアウト（ミリ秒）',
  hashtagsLabel: 'デフォルトハッシュタグ',
  hashtagsDesc: '投稿に自動で追加するハッシュタグ（改行して追加されます）',
  hotkeysTitle: 'ホットキー設定',
  cancelHotkeyLabel: 'キャンセルのホットキー',
  cancelHotkeyDesc: 'モーダルを閉じるためのキー（デフォルト: Escape）',
  postHotkeyLabel: '投稿のホットキー',
  postHotkeyDesc: '投稿を送信するためのキー（デフォルト: Mod+Enter）',
  imageHotkeyLabel: '画像追加のホットキー',
  imageHotkeyDesc: '画像を追加するためのキー（デフォルト: Mod+I）',
  emojiHotkeyLabel: '絵文字追加のホットキー',
  emojiHotkeyDesc: '絵文字ピッカーを開くためのキー（デフォルト: Mod+E）',
  
  // 注意事項
  appPasswordNote: '注意: App Passwordを使用してください。メインパスワードは使用しないでください。',
  hotkeyFormatNote: 'ホットキーの記法: Mod(=Ctrl/⌘)+Key または Ctrl/Shift/Alt/Meta の組み合わせで指定してください。例: Mod+Shift+S',
  hotkeyConflictNote: '注意: OS/アプリ標準のショートカットと衝突する場合があります。動作しない場合は別の組み合わせに変更してください。',
  
  // ホットキー衝突警告
  hotkeyConflictWarning: '⚠️ ホットキー衝突の警告',
  duplicateHotkeys: '重複するホットキー',
  commonShortcuts: '一般的なショートカット',
  browserShortcuts: 'ブラウザショートカット',
  osShortcuts: 'OSショートカット',
  
  // ホットキー衝突説明（generateConflictDescription用）
  browserShortcutsLabel: 'ブラウザショートカット: ',
  osShortcutsLabel: 'OSショートカット: ',
  commonShortcutsLabel: '一般的なショートカット: ',
  
  // プレースホルダー
  placeholderText: '最近どう？',
  handlePlaceholder: 'username.bsky.social',
  passwordPlaceholder: 'xxxx-xxxx-xxxx-xxxx',
  timeoutPlaceholder: '15000',
  hashtagsPlaceholder: '#obsidian #note',
  
  // ホットキー記法
  hotkeyFormat: 'ホットキー記法',
  hotkeyExamples: '例: Mod+Enter, Ctrl+Shift+S, Alt+A',
  
  // ホットキーラベル
  hotkeys: 'ホットキー',
  
  // 言語設定
  languageSettingsTitle: '言語設定',
  languageLabel: 'インターフェース言語',
  languageDesc: 'プラグインのインターフェース言語を選択してください。自動設定ではObsidianの言語設定に従います。',
  languageAuto: '自動設定（Obsidianの言語設定に従う）',
  languageEnglish: 'English',
  languageJapanese: '日本語',
  
  // コマンド名
  commandPostSelection: '選択したテキストをBlueskyに投稿',
  commandPostNote: '現在のノートをBlueskyに投稿',
  commandCreatePost: '新しいBluesky投稿を作成',
  commandToggleEmojiPicker: 'Bluesky絵文字ピッカーを切り替え',
  
  // リボンアイコン
  ribbonIconTooltip: 'Blueskyに投稿'
};

export const en: LocaleStrings = {
  // 投稿関連
  posting: 'Posting...',
  post: 'Post',
  cancel: 'Cancel',
  pleaseSelectText: 'Please select text',
  noteIsEmpty: 'Note is empty',
  postContentEmpty: 'Post content is empty',
  postTooLong: 'Post exceeds 300 characters. Please shorten the text.',
  pleaseEnterContent: 'Please enter post content',
  
  // 画像関連
  addImage: 'Add Image',
  maxImagesReached: 'Maximum 4 images allowed.',
  imageUploadError: 'Image upload error',
  
  // 絵文字関連
  addEmoji: 'Add Emoji',
  selectEmoji: 'Select Emoji',
  
  // カテゴリ名
  emotions: 'Emotions',
  hands: 'Hands',
  hearts: 'Hearts',
  nature: 'Nature',
  food: 'Food',
  activities: 'Activities',
  
  // 通知メッセージ
  loginRequired: 'Please set your Bluesky handle and password',
  loginFailed: 'Login failed',
  postSuccess: 'Posted to Bluesky!',
  postFailed: 'Post error',
  avatarFetchFailed: 'Failed to fetch avatar',
  imageUploadTimeout: 'Image upload timed out',
  postTimeout: 'Post timed out',
  
  // 設定画面
  settingsTitle: 'Obsidian to Bluesky Settings',
  handleLabel: 'Bluesky Handle',
  handleDesc: 'Your Bluesky handle (e.g., username.bsky.social)',
  passwordLabel: 'App Password',
  passwordDesc: 'Bluesky App Password (create from settings)',
  timeoutLabel: 'Network Timeout (ms)',
  timeoutDesc: 'Bluesky API call timeout (milliseconds)',
  hashtagsLabel: 'Default Hashtags',
  hashtagsDesc: 'Hashtags to automatically add to posts (separated by newlines)',
  hotkeysTitle: 'Hotkey Settings',
  cancelHotkeyLabel: 'Cancel Hotkey',
  cancelHotkeyDesc: 'Key to close modal (default: Escape)',
  postHotkeyLabel: 'Post Hotkey',
  postHotkeyDesc: 'Key to send post (default: Mod+Enter)',
  imageHotkeyLabel: 'Add Image Hotkey',
  imageHotkeyDesc: 'Key to add image (default: Mod+I)',
  emojiHotkeyLabel: 'Add Emoji Hotkey',
  emojiHotkeyDesc: 'Key to open emoji picker (default: Mod+E)',
  
  // 注意事項
  appPasswordNote: 'Note: Use App Password. Do not use your main password.',
  hotkeyFormatNote: 'Hotkey format: Mod(=Ctrl/⌘)+Key or combinations of Ctrl/Shift/Alt/Meta. Example: Mod+Shift+S',
  hotkeyConflictNote: 'Note: May conflict with OS/app standard shortcuts. Change to different combination if not working.',
  
  // ホットキー衝突警告
  hotkeyConflictWarning: '⚠️ Hotkey Conflict Warning',
  duplicateHotkeys: 'Duplicate Hotkeys',
  commonShortcuts: 'Common Shortcuts',
  browserShortcuts: 'Browser Shortcuts',
  osShortcuts: 'OS Shortcuts',
  
  // ホットキー衝突説明（generateConflictDescription用）
  browserShortcutsLabel: 'Browser Shortcuts: ',
  osShortcutsLabel: 'OS Shortcuts: ',
  commonShortcutsLabel: 'Common Shortcuts: ',
  
  // プレースホルダー
  placeholderText: 'What\'s happening?',
  handlePlaceholder: 'username.bsky.social',
  passwordPlaceholder: 'xxxx-xxxx-xxxx-xxxx',
  timeoutPlaceholder: '15000',
  hashtagsPlaceholder: '#obsidian #note',
  
  // ホットキー記法
  hotkeyFormat: 'Hotkey Format',
  hotkeyExamples: 'Examples: Mod+Enter, Ctrl+Shift+S, Alt+A',
  
  // ホットキーラベル
  hotkeys: 'Hotkeys',
  
  // 言語設定
  languageSettingsTitle: 'Language Settings',
  languageLabel: 'Interface Language',
  languageDesc: 'Select the interface language for the plugin. Auto setting follows Obsidian\'s language configuration.',
  languageAuto: 'Auto (follow Obsidian language)',
  languageEnglish: 'English',
  languageJapanese: 'Japanese',
  
  // コマンド名
  commandPostSelection: 'Post selection to Bluesky',
  commandPostNote: 'Post current note to Bluesky',
  commandCreatePost: 'Create new Bluesky post',
  commandToggleEmojiPicker: 'Toggle Bluesky emoji picker',
  
  // リボンアイコン
  ribbonIconTooltip: 'Post to Bluesky'
};

// 現在の言語を取得する関数
export function getCurrentLocale(): LocaleStrings {
  // ブラウザの言語設定を確認（SSR/テスト環境での安全性を確保）
  let browserLang = 'en'; // デフォルトフォールバック
  
  if (typeof navigator !== 'undefined') {
    browserLang = navigator.language || (Array.isArray(navigator.languages) && navigator.languages.length > 0 ? navigator.languages[0] : undefined) || 'en';
  }
  
  // 日本語の場合は日本語版を返す
  if (browserLang.startsWith('ja')) {
    return ja;
  }
  
  // それ以外は英語版を返す
  return en;
}

// Obsidianの言語設定に基づいてロケールを取得する関数
export function getLocaleByObsidianLanguage(obsidianLanguage?: string): LocaleStrings {
  if (obsidianLanguage && obsidianLanguage.startsWith('ja')) {
    return ja;
  }
  return en;
}

// グローバルなロケールインスタンス
export const locale = getCurrentLocale();
