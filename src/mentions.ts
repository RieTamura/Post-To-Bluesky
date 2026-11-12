import { createUrlRegex } from './text';

/**
 * 本文中の `@handle` を扱う。投稿の mention facet と、履歴ノートのプロフィールリンクの両方で使う。
 *
 * `@` の直前は行頭・空白・`(` に限る。メールアドレス（foo@example.com）や
 * URL 中の @（https://example.com/@user）を拾わないため。Bluesky 本体と同じく、
 * 全角の `＠` と、日本語の直後に続く `@`（こんにちは@alice...）は対象外。
 * 末尾は英数字に限るので、文末の `.` はハンドルに含まれない。
 */
const MENTION_DETECTION_REGEX = /(^|[\s(])@([a-zA-Z0-9][a-zA-Z0-9.-]*[a-zA-Z0-9])/g;
/** AT Protocol のハンドル長の上限 */
const MAX_HANDLE_LENGTH = 253;

/**
 * メンションの候補。位置は文字単位で、start は `@` の位置、end は handle の直後。
 * handle は `@` を含まず、小文字にそろえてある（ハンドルは大文字小文字を区別しないため）
 */
export type MentionCandidate = { handle: string; start: number; end: number };

/** 本文からメンションの候補を拾う。ハンドルとして成り立たないもの（ドットなし・長すぎ）は除く */
export function findMentionCandidates(text: string): MentionCandidate[] {
	const candidates: MentionCandidate[] = [];
	const regex = new RegExp(MENTION_DETECTION_REGEX.source, MENTION_DETECTION_REGEX.flags);
	let match: RegExpExecArray | null;
	while ((match = regex.exec(text)) !== null) {
		const handle = match[2];
		if (!handle.includes('.') || handle.length > MAX_HANDLE_LENGTH) continue;
		// match.index は直前の空白・`(` の位置を指すので、その分を足して `@` の位置にする
		const start = match.index + match[1].length;
		candidates.push({ handle: handle.toLowerCase(), start, end: start + 1 + handle.length });
	}
	return candidates;
}

/**
 * 履歴ノートの本文で、リンクにしてはいけない範囲（文字単位）を拾う。
 * 本文は変換前の Markdown のままなので convertMarkdownForPost() は通せず、軽量なスキャンで済ませる。
 * 範囲を多めに取りすぎても「リンクにならない」だけで本文は壊れないので、厳密さより安全側に倒す。
 */
function findProtectedRanges(markdown: string): Array<[number, number]> {
	const patterns = [
		// コードフェンス。閉じ忘れは末尾まで。``` の行に ` を含むもの（```一行```）は開始とみなさない
		/^[ \t]{0,3}(`{3,})[^`\n]*\n[\s\S]*?(?:^[ \t]{0,3}\1`*[ \t]*$|(?![\s\S]))/gm,
		/^[ \t]{0,3}(~{3,})[^\n]*\n[\s\S]*?(?:^[ \t]{0,3}\1~*[ \t]*$|(?![\s\S]))/gm,
		/`[^`\n]*`/g,                     // インラインコード
		/!?\[\[[^\]\n]*\]\]/g,            // [[wikilink]] / ![[埋め込み]]
		/!?\[[^\]\n]*\]\([^)\n]*\)/g,     // [表示](URL) / ![画像](URL)
		/<[^>\s]+>/g,                     // <https://...>
		createUrlRegex()                  // 裸のURL
	];
	const ranges: Array<[number, number]> = [];
	for (const pattern of patterns) {
		let match: RegExpExecArray | null;
		while ((match = pattern.exec(markdown)) !== null) {
			if (match[0].length === 0) {
				pattern.lastIndex++;
				continue;
			}
			ranges.push([match.index, match.index + match[0].length]);
		}
	}
	return ranges;
}

/**
 * 履歴ノート用に、本文の `@handle` を bsky.app のプロフィールへの Markdown リンクにする。
 * プロフィールURLは handle のままで開けるので、DID の解決結果は使わない
 * （存在しないハンドルでも、開くと「見つかりません」になるだけで害はない）。
 * 表示は書いたままの大文字小文字を残し、URL だけ小文字にそろえる。
 */
export function linkifyMentions(markdown: string): string {
	if (!markdown.includes('@')) return markdown;
	const ranges = findProtectedRanges(markdown);
	const isProtected = (start: number, end: number) => ranges.some(([s, e]) => start < e && s < end);
	let result = markdown;
	// 後ろから置換する。前から置換すると、それ以降の候補の位置がずれる
	for (const candidate of findMentionCandidates(markdown).reverse()) {
		if (isProtected(candidate.start, candidate.end)) continue;
		const display = markdown.slice(candidate.start, candidate.end);
		const link = `[${display}](https://bsky.app/profile/${candidate.handle})`;
		result = result.slice(0, candidate.start) + link + result.slice(candidate.end);
	}
	return result;
}
