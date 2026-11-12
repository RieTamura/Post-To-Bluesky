import { App, normalizePath, TFile } from 'obsidian';

/** Bluesky に添付できる枚数の上限 */
export const MAX_IMAGES = 4;

/**
 * 添付候補として扱う画像の拡張子。
 * createImageBitmap() でデコードできる形式に限っている（svg はデコードに失敗するため除く）。
 */
export const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp']);

export const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	avif: 'image/avif',
	bmp: 'image/bmp'
};

export function isImageFile(file: TFile): boolean {
	return IMAGE_EXTENSIONS.has(file.extension.toLowerCase());
}

/** vault 内の画像を新しい順に返す。直前に保存した画像を添付することが多いため */
export function getVaultImages(app: App): TFile[] {
	return app.vault.getFiles()
		.filter(isImageFile)
		.sort((a, b) => b.stat.mtime - a.stat.mtime);
}

/** vault 内の画像は File と違い type を持たないので拡張子から MIME を決める */
export function mimeTypeForExtension(extension: string): string {
	return IMAGE_MIME_BY_EXTENSION[extension.toLowerCase()] || 'image/jpeg';
}

/**
 * 投稿に添付する画像1枚分。
 * 添付元が vault 内か端末かで読み出し・プレビュー・ノートへの記録が変わるため、
 * 分岐をこの型に集約して呼び出し側では区別しなくて済むようにしている。
 */
export interface SelectedImage {
	/** プレビューの alt と重複判定に使う表示名 */
	name: string;
	/** vault 内の画像。端末から選んだ場合は vault へ取り込むまで null */
	vaultFile: TFile | null;
	/** 端末から選んだ元ファイル。vault 内の画像を選んだ場合は null */
	deviceFile: File | null;
	/**
	 * 下書きノートに元から埋め込まれていた画像か。
	 * 投稿後に下書きノートへ書き戻す対象から外すために持つ（既に本文にあるため）。
	 */
	fromDraft: boolean;
}

/**
 * 投稿せずに作成画面を閉じたときに下書きノートへ残す内容。
 * 端末から選んだ画像は vault に無く TFile では表せないため SelectedImage のまま持つ。
 */
export type PendingDraft = { text: string; images: SelectedImage[]; sourceFile: TFile | null };

/** 同じ画像を二重に添付しないための識別子 */
export function selectedImageKey(image: SelectedImage): string {
	if (image.vaultFile) return `vault:${image.vaultFile.path}`;
	const file = image.deviceFile;
	return `device:${file?.name}|${file?.size}|${file?.lastModified}`;
}

/**
 * ノート本文に埋め込む画像の wikilink。
 * 紐づけ先ノートと違い添付ファイルは拡張子込みのフルパスで書く（同名画像の取り違え防止）。
 */
export function buildEmbedWikiLink(path: string): string {
	return `![[${path}]]`;
}

/**
 * 端末から選んだ画像を vault に取り込む。vault 内の画像はそのまま返す。
 * 保存先は Obsidian 本体の添付ファイル設定に従わせたいので
 * getAvailablePathForAttachment() に決めさせる（同名衝突の回避も行われる）。
 * 取り込まない設定・取り込み失敗時は null を返し、投稿の記録処理自体は続行させる。
 */
export async function importImageToVault(app: App, image: SelectedImage, sourcePath: string): Promise<TFile | null> {
	if (image.vaultFile) return image.vaultFile;
	if (!image.deviceFile) return null;
	const buffer = await image.deviceFile.arrayBuffer();
	const path = normalizePath(await app.fileManager.getAvailablePathForAttachment(image.name, sourcePath));
	// 添付フォルダが未作成のことがある。createBinary は親フォルダを作らないので先に用意する
	const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
	if (folder && !app.vault.getFolderByPath(folder)) {
		await app.vault.createFolder(folder);
	}
	const created = await app.vault.createBinary(path, buffer);
	image.vaultFile = created;
	return created;
}

/**
 * Bluesky の画像 blob 上限は 1,000,000 バイト。超えると uploadBlob が失敗するので
 * 少し余裕を持たせた値を目標にする。
 */
export const MAX_UPLOAD_BYTES = 950_000;
/** 長辺の初期上限。Bluesky 側の表示解像度に対して十分大きい */
export const MAX_IMAGE_EDGE = 2048;

export type PreparedImage = { buffer: ArrayBuffer; mimeType: string; width: number; height: number };

export function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality?: number): Promise<Blob> {
	return new Promise<Blob>((resolve, reject) => {
		canvas.toBlob(
			(blob) => blob ? resolve(blob) : reject(new Error('Canvas to Blob conversion failed')),
			mimeType,
			quality
		);
	});
}

/**
 * 添付画像を Bluesky に送れる形（長辺と容量の上限内）に変換する。
 *
 * vault 内の画像を直接添付できるようになったことで、端末から選ぶ場合より
 * 大きな PNG がそのまま来るようになった。上限を超えたときは
 * 「品質を下げる → JPEG に変換する → 縮小する」の順で段階的に落とす。
 * JPEG は透過を表現できないため、変換する場合は白で下地を塗ってから描画する
 * （何もしないと透過部分が黒く潰れる）。
 */
export async function prepareImageForUpload(source: Blob, fallbackType: string): Promise<PreparedImage> {
	const bitmap = await createImageBitmap(source);
	try {
		const sourceType = source.type || fallbackType || 'image/jpeg';
		// canvas が確実に書き出せるのは png / jpeg / webp。それ以外は jpeg に寄せる
		const encodable = ['image/png', 'image/jpeg', 'image/webp'].includes(sourceType);
		let edge = MAX_IMAGE_EDGE;
		let mimeType = encodable ? sourceType : 'image/jpeg';
		let quality = mimeType === 'image/png' ? undefined : 0.92;
		let last: PreparedImage | null = null;

		// 「品質を下げる」→「JPEGへ変換」→「縮小」を最大8回まで試す
		for (let attempt = 0; attempt < 8; attempt++) {
			const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
			const canvas = createEl('canvas');
			canvas.width = Math.max(1, Math.round(bitmap.width * scale));
			canvas.height = Math.max(1, Math.round(bitmap.height * scale));
			const ctx = canvas.getContext('2d');
			if (!ctx) throw new Error('Failed to get canvas context');
			if (mimeType === 'image/jpeg') {
				ctx.fillStyle = '#ffffff';
				ctx.fillRect(0, 0, canvas.width, canvas.height);
			}
			ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

			const blob = await canvasToBlob(canvas, mimeType, quality);
			last = { buffer: await blob.arrayBuffer(), mimeType: blob.type || mimeType, width: canvas.width, height: canvas.height };
			if (last.buffer.byteLength <= MAX_UPLOAD_BYTES) return last;

			if (mimeType !== 'image/jpeg') {
				// 可逆形式のままでは容量が落ちないので JPEG に切り替える
				mimeType = 'image/jpeg';
				quality = 0.85;
			} else if ((quality ?? 0.92) > 0.5) {
				quality = Math.max(0.5, (quality ?? 0.92) - 0.15);
			} else {
				edge = Math.max(640, Math.round(edge * 0.75));
			}
		}
		// 上限まで試しても収まらなかった場合は最後の結果を返し、失敗は uploadBlob 側に委ねる
		if (!last) throw new Error('Failed to encode image');
		return last;
	} finally {
		bitmap.close();
	}
}
