import type { RequestUrlResponse } from 'obsidian';

export type ErrorResponse = { message?: string; error?: string };

export type PostResult = { success: boolean; postUrl?: string };

export interface CreateRecordResponse {
	uri: string;
	cid: string;
}

// Bluesky API embed 関連型（復元）
export interface BlueskyBlobRef {
	// AT Protocol の blob ref は $type が必須。uploadBlob のレスポンスもこの形で返る
	$type: 'blob';
	ref: { $link: string };
	mimeType: string;
	size: number;
}

export interface BlueskyImage {
	image: BlueskyBlobRef;
	alt: string;
	aspectRatio?: { width: number; height: number };
}

export interface ImagesEmbed {
	$type: 'app.bsky.embed.images';
	images: BlueskyImage[];
}
export interface ExternalEmbed {
	$type: 'app.bsky.embed.external';
	external: {
		uri: string;
		title: string;
		description: string;
		thumb?: BlueskyBlobRef;
	};
}

export type Embed = ImagesEmbed | ExternalEmbed;
export type Image = BlueskyImage;

export interface LinkPreviewData {
	url: string;
	title?: string;
	description?: string;
	image?: string;
	domain?: string;
}

export type FacetByteRange = { byteStart: number; byteEnd: number };
export type LinkFacetFeature = { $type: 'app.bsky.richtext.facet#link'; uri: string };
export type TagFacetFeature = { $type: 'app.bsky.richtext.facet#tag'; tag: string };
export type Facet = { index: FacetByteRange; features: (LinkFacetFeature | TagFacetFeature)[] };

export interface UploadBlobResponse {
	blob: BlueskyBlobRef;
}

export interface BlueskyPostRecord {
	text: string;
	createdAt: string;
	$type: 'app.bsky.feed.post';
	facets?: Facet[];
	embed?: Embed;
}

export interface CreateSessionResponse {
	accessJwt: string;
	refreshJwt: string;
	did: string;
}

export type HttpError = Error & { status?: number; response?: RequestUrlResponse };
