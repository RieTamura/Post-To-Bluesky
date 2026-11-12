

// 入力途中のURL（例: "https://"）は new URL() が例外を投げるため安全に解析する
export function parseUrlSafe(url: string): URL | null {
	try {
		return new URL(url);
	} catch {
		return null;
	}
}

/**
 * 投稿本文の Markdown を平文に変換した結果。
 *
 * Bluesky の投稿はプレーンテキストと facet の組み合わせで、facet の種類は
 * link / mention / tag しかない（太字・斜体・見出しに相当するものは存在しない）。
 * そのため「リンク記法だけ facet に変換し、他の記法はマーカーを外す」のが
 * 表現できる限界になる。links には変換後テキスト上の位置を**文字単位**で持たせ、
 * facet が要求するバイト位置への変換は detectFacets 側で行う。
 */
export type MarkdownLink = { start: number; end: number; uri: string };
export type ConvertedMarkdown = { text: string; links: MarkdownLink[] };

/** バックスラッシュでエスケープできる記号。エスケープされていれば記法として解釈しない */
export const MARKDOWN_ESCAPABLE = new Set(['\\', '`', '*', '_', '{', '}', '[', ']', '(', ')', '#', '+', '-', '.', '!', '>', '~', '=', '|']);
/** マーカーを外して中身だけ残す強調記法の記号 */
export const EMPHASIS_MARKERS = new Set(['*', '_', '~', '=']);

export const FENCE_LINE_REGEX = /^[ \t]{0,3}(`{3,}|~{3,})/;
export const HEADING_PREFIX_REGEX = /^[ \t]{0,3}#{1,6}[ \t]+/;
// 見出しの閉じ記号（例: "## タイトル ##"）
export const HEADING_SUFFIX_REGEX = /[ \t]+#+[ \t]*$/;
export const BLOCKQUOTE_PREFIX_REGEX = /^[ \t]{0,3}(?:>[ \t]?)+/;
export const BULLET_PREFIX_REGEX = /^([ \t]*)[-*+][ \t]+/;
export const THEMATIC_BREAK_REGEX = /^[ \t]{0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*$/;
/** 箇条書きのマーカーの置き換え先。記号を消すだけだと階層が読めなくなる */
export const BULLET_REPLACEMENT = '・';

/**
 * 行がコードブロックの囲みなら、その記号列を返す。
 *
 * バッククォートの囲みは、記号列より後ろにバッククォートを置けない（CommonMark）。
 * この条件を見ないと `` ```コード``` `` と1行で書いたときに囲みの開始と誤判定し、
 * その行が丸ごと消えたうえ、閉じる行が来ないので以降の行まで
 * コードブロックの中身として扱われてしまう。
 */
export function readFenceMarker(line: string): string | null {
	const match = FENCE_LINE_REGEX.exec(line);
	if (!match) return null;
	const marker = match[1];
	if (marker[0] === '`' && line.slice(match[0].length).includes('`')) return null;
	return marker;
}

/**
 * 行単位の記法（見出し・引用・箇条書き・水平線・コードブロック）を平文に落とす。
 *
 * 行頭だけを見る処理なので、文字単位の位置を記録するインライン変換より**先に**通す。
 * 箇条書きの `*` を強調記法と読み違えずに済むのもこの順序による。
 * 番号付きリストは平文のままでも読めるので手を入れない。
 */
export function stripBlockMarkdown(source: string): string {
	const lines: string[] = [];
	let fence: string | null = null;
	for (const line of source.split('\n')) {
		const fenceMarker = readFenceMarker(line);
		if (fence) {
			// コードブロックの中身は記法として解釈せず、囲みの行だけ落とす
			if (fenceMarker && fenceMarker[0] === fence[0] && fenceMarker.length >= fence.length) {
				fence = null;
				continue;
			}
			lines.push(line.trimEnd());
			continue;
		}
		if (fenceMarker) {
			fence = fenceMarker;
			continue;
		}
		if (THEMATIC_BREAK_REGEX.test(line)) continue;
		let stripped = line.replace(BLOCKQUOTE_PREFIX_REGEX, '');
		if (HEADING_PREFIX_REGEX.test(stripped)) {
			stripped = stripped.replace(HEADING_PREFIX_REGEX, '').replace(HEADING_SUFFIX_REGEX, '');
		} else {
			stripped = stripped.replace(BULLET_PREFIX_REGEX, `$1${BULLET_REPLACEMENT}`);
		}
		lines.push(stripped.trimEnd());
	}
	// 落とした行の分だけ空行が増えるので詰める（位置を記録する前なのでここで行う）
	return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

/**
 * `` `code` `` を読む。開始と同じ長さのバッククォート列で閉じている場合だけ記法として扱う。
 */
export function readCodeSpan(source: string, start: number): { content: string; end: number } | null {
	let run = 0;
	while (source[start + run] === '`') run += 1;
	const fence = '`'.repeat(run);
	const contentStart = start + run;
	let searchFrom = contentStart;
	while (searchFrom < source.length) {
		const closeIndex = source.indexOf(fence, searchFrom);
		if (closeIndex === -1) return null;
		let closeRun = 0;
		while (source[closeIndex + closeRun] === '`') closeRun += 1;
		// 長さが違う列は区切りにならないので読み飛ばす
		if (closeRun !== run) {
			searchFrom = closeIndex + closeRun;
			continue;
		}
		return { content: source.slice(contentStart, closeIndex), end: closeIndex + run };
	}
	return null;
}

/** リンク先として facet に載せられるか。Bluesky でリンクとして扱われるのは http(s) だけ */
export function isHttpUri(uri: string): boolean {
	return /^https?:\/\/\S+$/.test(uri);
}

/**
 * `[表示テキスト](URL)` を読む。`[` の位置を渡す。
 * URL に丸括弧を含むページ（Wikipedia 等）があるので、閉じ括弧は入れ子を数えて探す。
 * 入力途中の壊れた記法を巻き込まないよう、行をまたぐ記法は成立させない。
 */
export function readMarkdownLink(source: string, start: number): { label: string; uri: string; end: number } | null {
	if (source[start] !== '[') return null;
	let depth = 0;
	let labelEnd = -1;
	for (let i = start; i < source.length; i++) {
		const char = source[i];
		if (char === '\\') {
			i += 1;
			continue;
		}
		if (char === '\n') return null;
		if (char === '[') depth += 1;
		else if (char === ']') {
			depth -= 1;
			if (depth === 0) {
				labelEnd = i;
				break;
			}
		}
	}
	if (labelEnd === -1 || source[labelEnd + 1] !== '(') return null;
	let parenDepth = 0;
	let destEnd = -1;
	for (let i = labelEnd + 1; i < source.length; i++) {
		const char = source[i];
		if (char === '\\') {
			i += 1;
			continue;
		}
		if (char === '\n') return null;
		if (char === '(') parenDepth += 1;
		else if (char === ')') {
			parenDepth -= 1;
			if (parenDepth === 0) {
				destEnd = i;
				break;
			}
		}
	}
	if (destEnd === -1) return null;
	const dest = source.slice(labelEnd + 2, destEnd).trim();
	// `<URL>` 形式と、投稿には出せない `"タイトル"` 部分を取り除く
	const uri = dest.startsWith('<')
		? dest.slice(1, dest.indexOf('>') === -1 ? dest.length : dest.indexOf('>'))
		: dest.split(/\s/)[0];
	return { label: source.slice(start + 1, labelEnd), uri, end: destEnd + 1 };
}

/**
 * `[[ノート|表示名]]` を読む。vault 内のリンクは Bluesky では解決できないので、
 * 表示名だけを平文として残す（記法のまま投稿すると文字数だけ消費する）。
 */
export function readWikiLink(source: string, start: number): { display: string; end: number } | null {
	if (source[start] !== '[' || source[start + 1] !== '[') return null;
	const close = source.indexOf(']]', start + 2);
	if (close === -1) return null;
	const inner = source.slice(start + 2, close);
	if (inner.includes('\n') || inner.includes('[')) return null;
	// 別名があれば別名、なければ見出し・ブロック参照を除いたノート名を出す
	const target = inner.includes('|') ? inner.slice(inner.lastIndexOf('|') + 1) : (inner.split('#')[0] || inner);
	return { display: target.trim().replace(/^#+/, '').trim(), end: close + 2 };
}

/** `<https://example.com>` を読む。URL をそのまま出せば detectFacets がリンクにする */
export function readAutolink(source: string, start: number): { uri: string; end: number } | null {
	const close = source.indexOf('>', start + 1);
	if (close === -1) return null;
	const inner = source.slice(start + 1, close);
	if (!isHttpUri(inner)) return null;
	return { uri: inner, end: close + 1 };
}

/**
 * `**強調**` `*強調*` `~~取り消し~~` `==ハイライト==` を読む。
 *
 * Bluesky には太字も斜体も無いのでマーカーを外して中身だけ残す。
 * CommonMark と同じく「開始マーカーの直後・終了マーカーの直前が空白でない」ことを
 * 条件にしたうえで、CommonMark より狭く**単語の内側では成立させない**。
 * `snake_case` や `2*3*4` の記号を投稿から消してしまうほうが害が大きいため
 * （和文は `\w` に当たらないので「話**重要**です」のような書き方は成立する）。
 */
export function readEmphasis(source: string, start: number): { content: string; end: number } | null {
	const marker = source[start];
	let run = 0;
	while (source[start + run] === marker) run += 1;
	// `~` と `=` は2つ並びだけが記法。`*` と `_` は1つでも成立する
	const width = marker === '*' || marker === '_' ? Math.min(run, 2) : 2;
	if (run < width) return null;
	if (/\w/.test(source[start - 1] ?? '')) return null;
	const contentStart = start + width;
	const first = source[contentStart];
	if (first === undefined || /\s/.test(first)) return null;
	const closing = marker.repeat(width);
	let searchFrom = contentStart;
	while (searchFrom < source.length) {
		const found = source.indexOf(closing, searchFrom);
		if (found === -1 || found === contentStart) return null;
		const content = source.slice(contentStart, found);
		// 行をまたぐ強調は扱わない（これより後ろの候補も同じ改行を含む）
		if (content.includes('\n')) return null;
		const before = source[found - 1];
		const after = source[found + width];
		const closes = before !== undefined && !/\s/.test(before);
		const outsideWord = after === undefined || !/\w/.test(after);
		if (closes && outsideWord) return { content, end: found + width };
		searchFrom = found + width;
	}
	return null;
}

/**
 * 行内の記法を平文に変換し、リンク記法の位置を記録する。
 * 強調やリンクの中にさらに記法が書けるので、中身は同じ処理を再帰させる。
 */
export function convertInlineMarkdown(source: string): ConvertedMarkdown {
	let text = '';
	const links: MarkdownLink[] = [];
	let index = 0;
	while (index < source.length) {
		const char = source[index];
		if (char === '\\' && MARKDOWN_ESCAPABLE.has(source[index + 1] ?? '')) {
			text += source[index + 1];
			index += 2;
			continue;
		}
		if (char === '`') {
			const code = readCodeSpan(source, index);
			if (code) {
				text += code.content;
				index = code.end;
				continue;
			}
		}
		if (char === '!' && source[index + 1] === '[') {
			// 画像は添付として送る経路があるので、本文には alt だけを残す。
			// `![[...]]` は表示名を出しても意味がないため丸ごと落とす
			const embed = readWikiLink(source, index + 1);
			if (embed) {
				index = embed.end;
				continue;
			}
			const image = readMarkdownLink(source, index + 1);
			if (image) {
				text += convertInlineMarkdown(image.label).text;
				index = image.end;
				continue;
			}
		}
		if (char === '[' && source[index + 1] === '[') {
			const wiki = readWikiLink(source, index);
			if (wiki) {
				text += wiki.display;
				index = wiki.end;
				continue;
			}
		}
		if (char === '[') {
			const link = readMarkdownLink(source, index);
			if (link) {
				// リンクの入れ子は Markdown でも許されないので、ラベル側のリンクは持ち上げない
				const start = text.length;
				text += convertInlineMarkdown(link.label).text;
				if (isHttpUri(link.uri) && text.length > start) {
					links.push({ start, end: text.length, uri: link.uri });
				}
				index = link.end;
				continue;
			}
		}
		if (char === '<') {
			const autolink = readAutolink(source, index);
			if (autolink) {
				text += autolink.uri;
				index = autolink.end;
				continue;
			}
		}
		if (EMPHASIS_MARKERS.has(char)) {
			const emphasis = readEmphasis(source, index);
			if (emphasis) {
				const inner = convertInlineMarkdown(emphasis.content);
				const offset = text.length;
				text += inner.text;
				for (const link of inner.links) {
					links.push({ start: link.start + offset, end: link.end + offset, uri: link.uri });
				}
				index = emphasis.end;
				continue;
			}
		}
		text += char;
		index += 1;
	}
	return { text, links };
}

/**
 * 投稿本文に書かれた Markdown を、Bluesky に送れる平文とリンク範囲に変換する。
 * 記法を落とした跡に残る前後の空白は詰める。先頭を削るとリンクの位置がずれるので、
 * 削った分だけ記録済みの位置もずらす。
 */
export function convertMarkdownForPost(source: string): ConvertedMarkdown {
	const converted = convertInlineMarkdown(stripBlockMarkdown(source));
	const shift = converted.text.length - converted.text.trimStart().length;
	const links = shift === 0
		? converted.links
		: converted.links
			.map((link) => ({ ...link, start: link.start - shift, end: link.end - shift }))
			.filter((link) => link.start >= 0 && link.end > link.start);
	return { text: converted.text.trim(), links };
}
