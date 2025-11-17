// hotkeyConflictDetector.ts - ホットキー衝突検出機能
import { ja, en } from './locales';
import type { LocaleStrings } from './locales';

export interface HotkeyConflict {
  type: 'browser' | 'os' | 'common';
  description: string;
  severity: 'warning' | 'error';
}

export interface HotkeyInfo {
  key: string;
  modifiers: string[];
  displayName: string;
}

export class HotkeyConflictDetector {
  // 標準的なモディファイアの順序（一貫性のあるホットキー文字列生成のため）
  private static readonly CANONICAL_MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift', 'Meta'];
  
  // 有効なモディファイア名のマッピング（異なる表記を統一）
  private static readonly MODIFIER_MAPPING: Record<string, string> = {
    'ctrl': 'Ctrl',
    'control': 'Ctrl',
    'alt': 'Alt',
    'shift': 'Shift',
    'meta': 'Meta',
    'cmd': 'Meta',
    'command': 'Meta',
    'windows': 'Meta',
    'win': 'Meta',
    'mod': 'Meta' // modエイリアスをMetaにマッピング（main.tsと一貫性を保つ）
  };

  // 一般的なブラウザショートカット
  private static readonly BROWSER_SHORTCUTS: HotkeyInfo[] = [
    { key: 's', modifiers: ['ctrl'], displayName: 'Ctrl+S (保存)' },
    { key: 'c', modifiers: ['ctrl'], displayName: 'Ctrl+C (コピー)' },
    { key: 'v', modifiers: ['ctrl'], displayName: 'Ctrl+V (貼り付け)' },
    { key: 'x', modifiers: ['ctrl'], displayName: 'Ctrl+X (切り取り)' },
    { key: 'z', modifiers: ['ctrl'], displayName: 'Ctrl+Z (元に戻す)' },
    { key: 'y', modifiers: ['ctrl'], displayName: 'Ctrl+Y (やり直し)' },
    { key: 'a', modifiers: ['ctrl'], displayName: 'Ctrl+A (全選択)' },
    { key: 'f', modifiers: ['ctrl'], displayName: 'Ctrl+F (検索)' },
    { key: 'n', modifiers: ['ctrl'], displayName: 'Ctrl+N (新規)' },
    { key: 'o', modifiers: ['ctrl'], displayName: 'Ctrl+O (開く)' },
    { key: 'p', modifiers: ['ctrl'], displayName: 'Ctrl+P (印刷)' },
    { key: 'w', modifiers: ['ctrl'], displayName: 'Ctrl+W (閉じる)' },
    { key: 't', modifiers: ['ctrl'], displayName: 'Ctrl+T (新規タブ)' },
    { key: 'tab', modifiers: ['ctrl'], displayName: 'Ctrl+Tab (タブ切り替え)' },
    { key: 'r', modifiers: ['ctrl'], displayName: 'Ctrl+R (更新)' },
    { key: 'f5', modifiers: [], displayName: 'F5 (更新)' },
    { key: 'escape', modifiers: [], displayName: 'Escape (キャンセル)' },
    { key: 'enter', modifiers: [], displayName: 'Enter (確定)' },
    { key: 'space', modifiers: [], displayName: 'Space (スペース)' },
    { key: 'tab', modifiers: [], displayName: 'Tab (タブ)' },
    { key: 'backspace', modifiers: [], displayName: 'Backspace (削除)' },
    { key: 'delete', modifiers: [], displayName: 'Delete (削除)' },
    { key: 'home', modifiers: [], displayName: 'Home (先頭)' },
    { key: 'end', modifiers: [], displayName: 'End (末尾)' },
    { key: 'pageup', modifiers: [], displayName: 'PageUp (上へ)' },
    { key: 'pagedown', modifiers: [], displayName: 'PageDown (下へ)' },
    { key: 'arrowup', modifiers: [], displayName: '↑ (上)' },
    { key: 'arrowdown', modifiers: [], displayName: '↓ (下)' },
    { key: 'arrowleft', modifiers: [], displayName: '← (左)' },
    { key: 'arrowright', modifiers: [], displayName: '→ (右)' }
  ];

  // OS固有のショートカット
  private static readonly OS_SHORTCUTS: HotkeyInfo[] = [
    // Windows
    { key: 'l', modifiers: ['ctrl'], displayName: 'Ctrl+L (ロック)' },
    { key: 'd', modifiers: ['windows'], displayName: 'Win+D (デスクトップ表示)' },
    { key: 'e', modifiers: ['windows'], displayName: 'Win+E (エクスプローラー)' },
    { key: 'r', modifiers: ['windows'], displayName: 'Win+R (ファイル名を指定して実行)' },
    { key: 'tab', modifiers: ['windows'], displayName: 'Win+Tab (タスクビュー)' },
    { key: 'i', modifiers: ['windows'], displayName: 'Win+I (設定)' },
    { key: 'x', modifiers: ['windows'], displayName: 'Win+X (クイックリンクメニュー)' },
    
    // macOS
    { key: 'space', modifiers: ['cmd'], displayName: '⌘+Space (Spotlight)' },
    { key: 'tab', modifiers: ['cmd'], displayName: '⌘+Tab (アプリ切り替え)' },
    { key: 'h', modifiers: ['cmd'], displayName: '⌘+H (アプリを隠す)' },
    { key: 'm', modifiers: ['cmd'], displayName: '⌘+M (最小化)' },
    { key: 'q', modifiers: ['cmd'], displayName: '⌘+Q (アプリ終了)' },
    { key: 'w', modifiers: ['cmd'], displayName: '⌘+W (ウィンドウを閉じる)' },
    { key: 'n', modifiers: ['cmd'], displayName: '⌘+N (新規ウィンドウ)' },
    { key: 'o', modifiers: ['cmd'], displayName: '⌘+O (開く)' },
    { key: 's', modifiers: ['cmd'], displayName: '⌘+S (保存)' },
    { key: 'p', modifiers: ['cmd'], displayName: '⌘+P (印刷)' },
    { key: 'z', modifiers: ['cmd'], displayName: '⌘+Z (元に戻す)' },
    { key: 'z', modifiers: ['cmd', 'shift'], displayName: '⌘+Shift+Z (やり直し)' },
    { key: 'a', modifiers: ['cmd'], displayName: '⌘+A (全選択)' },
    { key: 'c', modifiers: ['cmd'], displayName: '⌘+C (コピー)' },
    { key: 'v', modifiers: ['cmd'], displayName: '⌘+V (貼り付け)' },
    { key: 'x', modifiers: ['cmd'], displayName: '⌘+X (切り取り)' },
    { key: 'f', modifiers: ['cmd'], displayName: '⌘+F (検索)' },
    { key: 't', modifiers: ['cmd'], displayName: '⌘+T (新規タブ)' },
    { key: 'r', modifiers: ['cmd'], displayName: '⌘+R (更新)' }
  ];

  // 一般的なアプリケーションショートカット
  private static readonly COMMON_SHORTCUTS: HotkeyInfo[] = [
    { key: 's', modifiers: ['ctrl', 'shift'], displayName: 'Ctrl+Shift+S (名前を付けて保存)' },
    { key: 'n', modifiers: ['ctrl', 'shift'], displayName: 'Ctrl+Shift+N (新規フォルダ)' },
    { key: 't', modifiers: ['ctrl', 'shift'], displayName: 'Ctrl+Shift+T (閉じたタブを復元)' },
    { key: 'i', modifiers: ['ctrl', 'shift'], displayName: 'Ctrl+Shift+I (開発者ツール)' },
    { key: 'j', modifiers: ['ctrl', 'shift'], displayName: 'Ctrl+Shift+J (コンソール)' },
    { key: 'c', modifiers: ['ctrl', 'shift'], displayName: 'Ctrl+Shift+C (要素の検証)' },
    { key: 'r', modifiers: ['ctrl', 'shift'], displayName: 'Ctrl+Shift+R (ハード更新)' },
    { key: 'delete', modifiers: ['shift'], displayName: 'Shift+Delete (完全削除)' },
    { key: 'insert', modifiers: ['ctrl'], displayName: 'Ctrl+Insert (コピー)' },
    { key: 'insert', modifiers: ['shift'], displayName: 'Shift+Insert (貼り付け)' },
    { key: 'home', modifiers: ['ctrl'], displayName: 'Ctrl+Home (文書先頭)' },
    { key: 'end', modifiers: ['ctrl'], displayName: 'Ctrl+End (文書末尾)' },
    { key: 'home', modifiers: ['shift'], displayName: 'Shift+Home (行先頭まで選択)' },
    { key: 'end', modifiers: ['shift'], displayName: 'Shift+End (行末尾まで選択)' },
    { key: 'arrowup', modifiers: ['ctrl'], displayName: 'Ctrl+↑ (段落上へ)' },
    { key: 'arrowdown', modifiers: ['ctrl'], displayName: 'Ctrl+↓ (段落下へ)' },
    { key: 'arrowleft', modifiers: ['ctrl'], displayName: 'Ctrl+← (単語左へ)' },
    { key: 'arrowright', modifiers: ['ctrl'], displayName: 'Ctrl+→ (単語右へ)' }
  ];

  /**
   * ホットキー文字列を解析してキーと修飾子に分解する
   * main.tsと一貫性を保つため、modトークンをmetaに正規化
   */
  static parseHotkey(hotkey: string): { key: string; modifiers: string[] } {
    const parts = hotkey.toLowerCase().split('+');
    const key = parts[parts.length - 1];
    const modifiers = parts.slice(0, -1).map(m => {
      // modトークンをmetaに正規化（main.tsと一貫性を保つ）
      if (m === 'mod') {
        return 'meta';
      }
      return m;
    });
    
    return { key, modifiers };
  }

  /**
   * 2つのホットキーが衝突するかチェック
   * CtrlとCmdを同等に扱い、プラットフォーム間での一貫性を確保
   */
  static checkConflict(hotkey1: string, hotkey2: string): boolean {
    const parsed1 = this.parseHotkey(hotkey1);
    const parsed2 = this.parseHotkey(hotkey2);
    
    // キーが同じで修飾子も同じ場合は衝突
    if (parsed1.key === parsed2.key) {
      const mods1 = new Set(parsed1.modifiers);
      const mods2 = new Set(parsed2.modifiers);
      
      // CtrlとCmdを同等に扱うための正規化
      const normalizeModifiers = (mods: Set<string>) => {
        const normalized = new Set<string>();
        for (const mod of mods) {
          if (mod === 'ctrl' || mod === 'cmd') {
            // CtrlとCmdを単一の正規化されたトークン'meta'にマッピング（main.tsと一貫性を保つ）
            normalized.add('meta');
          } else {
            normalized.add(mod);
          }
        }
        return normalized;
      };
      
      const normalizedMods1 = normalizeModifiers(mods1);
      const normalizedMods2 = normalizeModifiers(mods2);
      
      if (normalizedMods1.size === normalizedMods2.size) {
        for (const mod of normalizedMods1) {
          if (!normalizedMods2.has(mod)) return false;
        }
        return true;
      }
    }
    
    return false;
  }

  /**
   * 指定されたホットキーと既知のショートカットとの衝突をチェック
   */
  static detectConflicts(hotkey: string): HotkeyConflict[] {
    const conflicts: HotkeyConflict[] = [];
    
    // ブラウザショートカットとの衝突チェック
    for (const shortcut of this.BROWSER_SHORTCUTS) {
      if (this.checkConflict(hotkey, this.formatHotkey(shortcut))) {
        conflicts.push({
          type: 'browser',
          description: shortcut.displayName,
          severity: 'warning'
        });
      }
    }
    
    // OSショートカットとの衝突チェック
    for (const shortcut of this.OS_SHORTCUTS) {
      if (this.checkConflict(hotkey, this.formatHotkey(shortcut))) {
        conflicts.push({
          type: 'os',
          description: shortcut.displayName,
          severity: 'warning'
        });
      }
    }
    
    // 一般的なショートカットとの衝突チェック
    for (const shortcut of this.COMMON_SHORTCUTS) {
      if (this.checkConflict(hotkey, this.formatHotkey(shortcut))) {
        conflicts.push({
          type: 'common',
          description: shortcut.displayName,
          severity: 'warning'
        });
      }
    }
    
    // 特に重要なショートカットとの衝突はエラーとして扱う
    // プラットフォームに依存しない重要なショートカット（mod+*）
    const criticalShortcuts = [
      'mod+s', 'mod+c', 'mod+v', 'mod+z', 'mod+a'
    ];
    
    if (criticalShortcuts.some(critical => this.checkConflict(hotkey, critical))) {
      // 既存の衝突エントリの重要度を更新
      conflicts.forEach(conflict => {
        // 大文字小文字を区別しない比較で、重要なショートカットとの衝突をチェック
        const conflictDescLower = conflict.description.toLowerCase();
        const hasCriticalConflict = criticalShortcuts.some(crit => {
          const critLower = crit.toLowerCase();
          
          // modトークンが含まれる場合、Ctrl/Cmdの両方のバリエーションを作成してチェック
          if (critLower.includes('mod')) {
            // modトークンを境界を考慮して置換（部分文字列ではなく、トークンレベルで置換）
            const ctrlVariant = critLower.replace(/\bmod\b/g, 'ctrl');
            const cmdVariant = critLower.replace(/\bmod\b/g, 'cmd');
            
            // 各バリエーションに対して衝突をチェック
            return conflictDescLower.includes(critLower) ||
                   conflictDescLower.includes(ctrlVariant) ||
                   conflictDescLower.includes(cmdVariant);
          } else {
            // modトークンが含まれない場合は、そのまま比較
            return conflictDescLower.includes(critLower);
          }
        });
        
        // browser、os、commonのいずれのタイプでも重要なショートカットと衝突する場合はエラーに昇格
        if (hasCriticalConflict) {
          conflict.severity = 'error';
        }
      });
    }    
    return conflicts;
  }

  /**
   * HotkeyInfoをホットキー文字列に変換
   * モディファイアの順序を標準化し、一貫性のある文字列を生成
   */
  private static formatHotkey(info: HotkeyInfo): string {
    // モディファイアを標準的な名前に変換し、重複を除去
    const normalizedModifiers = [...new Set(
      info.modifiers
        .map(mod => this.MODIFIER_MAPPING[mod.toLowerCase()])
        .filter(Boolean) // 無効なモディファイアを除外
    )];
    
    // 標準的な順序でソート
    const sortedModifiers = normalizedModifiers.sort((a, b) => {
      const aIndex = this.CANONICAL_MODIFIER_ORDER.indexOf(a);
      const bIndex = this.CANONICAL_MODIFIER_ORDER.indexOf(b);
      return aIndex - bIndex;
    });
    
    // モディファイアとキーを結合（キーは小文字に正規化）
    return [...sortedModifiers, info.key?.toLowerCase() || ''].join('+');
  }

  /**
   * 衝突の説明を生成
   */
  static generateConflictDescription(conflicts: HotkeyConflict[], locale?: string): string {
    if (conflicts.length === 0) return '';
    
    // ロケールを取得（指定されていない場合はブラウザ設定を使用）
    const browserLocale = typeof navigator !== 'undefined' ? navigator.language : 'en';
    const localeTag = (locale ?? browserLocale ?? 'en').toLowerCase();
    const currentLocale = localeTag.startsWith('ja') ? 'ja' : 'en';
    const localeStrings: LocaleStrings = currentLocale === 'ja' ? ja : en;
    
    const browserConflicts = conflicts.filter(c => c.type === 'browser');
    const osConflicts = conflicts.filter(c => c.type === 'os');
    const commonConflicts = conflicts.filter(c => c.type === 'common');
    
    let description = '';
    
    if (browserConflicts.length > 0) {
      description += `${localeStrings.browserShortcutsLabel}${browserConflicts.map(c => c.description).join(', ')}\n`;
    }
    
    if (osConflicts.length > 0) {
      description += `${localeStrings.osShortcutsLabel}${osConflicts.map(c => c.description).join(', ')}\n`;
    }
    
    if (commonConflicts.length > 0) {
      description += `${localeStrings.commonShortcutsLabel}${commonConflicts.map(c => c.description).join(', ')}\n`;
    }
    
    return description.trim();
  }

  /**
   * 衝突の重要度を判定
   */
  static getConflictSeverity(conflicts: HotkeyConflict[]): 'none' | 'warning' | 'error' {
    if (conflicts.length === 0) return 'none';
    
    const hasError = conflicts.some(c => c.severity === 'error');
    return hasError ? 'error' : 'warning';
  }
}
