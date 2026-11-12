import type { Facet, FacetByteRange } from './bluesky';
import type { MarkdownLink } from './markdown';
import { findMentionCandidates } from './mentions';
import { MAX_TAG_LENGTH, countGraphemes, createHashtagRegex, createUrlRegex, trimTrailingPunctuation } from './text';

/**
 * 本文から facet を組み立てる。
 *
 * @param markdownLinks Markdown のリンク記法から得た範囲（文字単位）。
 *   表示テキストにURLやハッシュタグらしき文字列が含まれることがあるが、
 *   範囲の重なった facet を送ると Bluesky 側でリンクが壊れるため、
 *   ここで作った範囲と重なる URL・タグは facet にしない。
 * @param mentionDids 解決済みのハンドル（小文字）→ DID。ここに無いハンドルは平文のまま残す。
 *   通信はここでは行わず、呼び出し側が先に解決して渡す
 */
export function detectFacets(
	text: string,
	markdownLinks: MarkdownLink[] = [],
	mentionDids: ReadonlyMap<string, string> = new Map()
): Facet[] | undefined {
	const facets: Facet[] = [];
	const encoder = new TextEncoder();
	const byteOffsetOf = (charIndex: number) => encoder.encode(text.slice(0, charIndex)).length;
	const reserved: FacetByteRange[] = [];
	for (const link of markdownLinks) {
		const index = { byteStart: byteOffsetOf(link.start), byteEnd: byteOffsetOf(link.end) };
		if (index.byteEnd <= index.byteStart) continue;
		reserved.push(index);
		facets.push({ index, features: [{ $type: 'app.bsky.richtext.facet#link', uri: link.uri }] });
	}
	const overlapsReserved = (range: FacetByteRange) =>
		reserved.some((taken) => range.byteStart < taken.byteEnd && taken.byteStart < range.byteEnd);
	const linkRegex = createUrlRegex();
	let match: RegExpExecArray | null;
	while ((match = linkRegex.exec(text)) !== null) {
		const rawUri = match[0];
		const uri = trimTrailingPunctuation(rawUri);
		const byteStart = byteOffsetOf(match.index);
		const byteEnd = byteStart + encoder.encode(uri).length;
		if (overlapsReserved({ byteStart, byteEnd })) continue;
		// mention が URL の中（https://example.com/@user など）に重ならないよう、URL の範囲も押さえる
		reserved.push({ byteStart, byteEnd });
		const linkFacet: Facet = {
			index: { byteStart, byteEnd },
			features: [{ $type: 'app.bsky.richtext.facet#link', uri }]
		};
		facets.push(linkFacet);
	}
	const hashtagRegex = createHashtagRegex();
	while ((match = hashtagRegex.exec(text)) !== null) {
		const tag = match[0];
		const tagWithoutHash = tag.slice(1);
		if (countGraphemes(tagWithoutHash) > MAX_TAG_LENGTH) continue;
		const byteStart = byteOffsetOf(match.index);
		const byteEnd = byteStart + encoder.encode(tag).length;
		if (overlapsReserved({ byteStart, byteEnd })) continue;
		const tagFacet: Facet = {
			index: { byteStart, byteEnd },
			features: [{ $type: 'app.bsky.richtext.facet#tag', tag: tagWithoutHash }]
		};
		facets.push(tagFacet);
	}
	for (const candidate of findMentionCandidates(text)) {
		const did = mentionDids.get(candidate.handle);
		if (!did) continue;
		const index = { byteStart: byteOffsetOf(candidate.start), byteEnd: byteOffsetOf(candidate.end) };
		if (overlapsReserved(index)) continue;
		facets.push({ index, features: [{ $type: 'app.bsky.richtext.facet#mention', did }] });
	}
	facets.sort((a, b) => a.index.byteStart - b.index.byteStart);
	return facets.length > 0 ? facets : undefined;
}
