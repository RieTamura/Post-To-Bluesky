

// 統一された絵文字リスト（複数箇所の重複定義を解消）
export const EMOJI_LIST: string[] = [
	'😀','😄','😁','😂','🤣','😅','😊','🙂','😉','😍','🥰','😘','😙','😚','😋','😜','😝','😎','🤓','🤔','🤨','😐','😑','😶','🙄','😮','😲','🥱','😴','🤤','😭','😤','😡','🤯','😳','🥶','🥳','🤩','😇','😷','🤒','🤕','🤢','🤮','🤧',
	'👍','👎','👌','✌️','🤞','🤟','🤘','🤙','👏','🙌','👐','✋','🤚','👋','🤏','💪','🫶','🫰',
	'😺','😸','😹','😻','😼','😽','🙀','😿','😾',
	'❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','❣️','💕','💞','💓','💗','💖','💘','💝','💤','💢','✨','⚡','🔥','⭐','🌟','💫','🎊','🎈',
	'📝','🖊️','📎','📌','📚','💡','🖥️','📱','⌚','🕹️','🎮','🎵','🎶','🎧','🎤','🎬','📷','🗓️','⏰','📦',
	'🌞','🌙','☁️','🌧️','🌈','❄️','🌸','🌻','🍀','🍎','🍊','🍋','🍇','🍓','🥝','🥑','🍙','🍣','🍜','☕','🍺','🍻','🥂'
];

export const URL_DETECTION_REGEX = /https?:\/\/[^\s<>()\]{}"']+/g;
export const TRAILING_PUNCT_REGEX = /[\])}.,!?]+$/;
export const HASHTAG_DETECTION_REGEX = /#[\w\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]+/g;
// Bluesky のタグ長上限
export const MAX_TAG_LENGTH = 64;

export function createUrlRegex(): RegExp {
	return new RegExp(URL_DETECTION_REGEX.source, 'g');
}

export function createHashtagRegex(): RegExp {
	return new RegExp(HASHTAG_DETECTION_REGEX.source, 'g');
}

// 本文からタグを取り除く用。前後の空白ごと消せるよう、タグ本体を捕捉グループにする
export function createHashtagStripRegex(): RegExp {
	return new RegExp(`[ \\t]*(${HASHTAG_DETECTION_REGEX.source})[ \\t]*`, 'g');
}

export function trimTrailingPunctuation(url: string): string {
	return url.replace(TRAILING_PUNCT_REGEX, '');
}

/**
 * 本文に最初に現れる URL を位置つきで返す。
 * 位置を返すのは、Markdown のリンク記法から取れた URL とどちらが先かを比べて
 * リンクカードの対象を決めるため。
 */
export function findFirstUrl(text: string): { url: string; index: number } | null {
	const regex = new RegExp(URL_DETECTION_REGEX.source);
	const match = regex.exec(text);
	return match ? { url: trimTrailingPunctuation(match[0]), index: match.index } : null;
}

/**
 * 本文からハッシュタグを抽出する（先頭の # は除去）。
 * Bluesky に facet として送るタグと同じ条件で抽出するため、履歴ノートの tags と
 * 実際の投稿タグが一致する。大文字小文字違いの重複は最初の表記を残して除去する。
 */
export function extractHashtags(text: string): string[] {
	const regex = createHashtagRegex();
	const seen = new Set<string>();
	const tags: string[] = [];
	let match: RegExpExecArray | null;
	while ((match = regex.exec(text)) !== null) {
		const tag = match[0].slice(1);
		if (countGraphemes(tag) > MAX_TAG_LENGTH) continue;
		const key = tag.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		tags.push(tag);
	}
	return tags;
}

/**
 * 履歴ノートの本文からハッシュタグを取り除く。frontmatter の tags に昇格したタグだけを
 * 対象にするため、tags に入らなかったタグ（長すぎる等）は本文に残る。
 * タグだけで構成されていた行は行ごと削除し、元から空だった行は段落区切りとして残す。
 */
export function stripHashtags(text: string, tags: string[]): string {
	const promoted = new Set(tags.map((tag) => tag.toLowerCase()));
	// 単語同士がくっつくのを避けたい欧文だけ空白を1つ残す（和文は詰める）
	const needsSpace = (char: string | undefined) => char !== undefined && /[\x21-\x7E]/.test(char);
	const kept: string[] = [];
	for (const line of text.split('\n')) {
		const stripped = line
			.replace(createHashtagStripRegex(), (match: string, tagToken: string, offset: number, whole: string) => {
				if (!promoted.has(tagToken.slice(1).toLowerCase())) return match;
				return needsSpace(whole[offset - 1]) && needsSpace(whole[offset + match.length]) ? ' ' : '';
			})
			.trimEnd();
		// タグ除去の結果だけで空になった行は落とす
		if (stripped.trim() === '' && line.trim() !== '') continue;
		kept.push(stripped);
	}
	return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * frontmatter に書き出すタグをYAMLとして安全な形にする。
 * 数字始まりのタグ（例: 2026、1_000）は引用符で囲まないと数値として解釈される。
 * タグに使える文字は HASHTAG_DETECTION_REGEX で制限されているため引用符の
 * エスケープは不要。
 */
export function toYamlTag(tag: string): string {
	return /^[A-Za-z_\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(tag) ? tag : `"${tag}"`;
}

export const MAX_POST_LENGTH = 300;

export type SegmenterCtor = new (
	locales?: string | string[],
	options?: { granularity?: 'grapheme' | 'word' | 'sentence' }
) => { segment(input: string): IterableIterator<{ segment: string }> };

export type IntlWithOptionalApis = typeof Intl & {
	Segmenter?: SegmenterCtor;
	getCanonicalLocales?: (locales?: string | string[]) => string[];
};

// Grapheme counting utility (simple fallback for most languages)
export function countGraphemes(str: string): number {
	// For most cases, [...str] will split by Unicode code points
	// For more accurate grapheme splitting, use Intl.Segmenter if available
	const intlApi = Intl as IntlWithOptionalApis;
	const segmenterCtor = intlApi.Segmenter;
	if (typeof segmenterCtor === 'function') {
		const segmenter = new segmenterCtor(undefined, { granularity: 'grapheme' });
		return Array.from(segmenter.segment(str)).length;
	}
	return [...str].length;
}
