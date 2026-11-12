import { requestUrl } from 'obsidian';
import type { RequestUrlParam, RequestUrlResponse } from 'obsidian';
import type { BlueskyPostRecord, CreateRecordResponse, CreateSessionResponse, ErrorResponse, HttpError, UploadBlobResponse } from './bluesky';
import type { LocaleStrings } from './i18n';

const XRPC_BASE = 'https://bsky.social/xrpc';
const TIMEOUT_MESSAGE = 'Request timed out';
/** 1回目＋再試行2回。401 の再ログインと 429 の待機はこの回数の内側で行う */
const MAX_ATTEMPTS = 3;
/** 再試行のたびに「この値 × 試行回数」だけ待つ */
const RETRY_BASE_DELAY_MS = 600;
/**
 * ハンドル解決のタイムアウト。打ち間違い1件で投稿が設定値（既定15秒）まで
 * 止まらないよう、短く固定する
 */
const RESOLVE_HANDLE_TIMEOUT_MS = 5000;

/** requestWithTimeout が時間切れで投げたエラーかどうか */
export function isTimeoutError(error: unknown): boolean {
	return error instanceof Error && error.message === TIMEOUT_MESSAGE;
}

/**
 * ログインできなかったことを表すエラー。理由はログイン処理の中で通知済みなので、
 * 呼び出し側は重ねて通知しなくてよい
 */
export class LoginFailedError extends Error {}

/** クライアントが必要とするプラグイン側の情報。設定変更がすぐ反映されるよう関数で受け取る */
export interface BlueskyClientHost {
	getHandle(): string;
	getAppPassword(): string;
	/** キーチェーンのIDだけが設定されているか（＝別端末の設定が同期されてきて、パスワード本体が無い） */
	hasSecretId(): boolean;
	getTimeoutMs(): number;
	getLocale(): LocaleStrings;
	notify(message: string): void;
}

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

/**
 * Bluesky (bsky.social) との通信とセッションを受け持つ。
 * 認証の要る呼び出しはすべて authedRequest を通し、401 の再ログインと
 * 429 の待機を1か所で扱う。
 */
export class BlueskyClient {
	private accessJwt: string | undefined;
	private refreshJwt: string | undefined;
	private did: string | undefined;
	/** ログイン時に取得したアバター画像のURL。取れなければ空文字 */
	avatar: string | undefined;
	/**
	 * ハンドル（小文字）→ DID。null は「存在しない」と確定したハンドル。
	 * ハンドルは付け替えられることがあるので永続化せず、Obsidian の再起動で捨てる
	 */
	private readonly handleDidCache = new Map<string, string | null>();

	constructor(private readonly host: BlueskyClientHost) {}

	get isLoggedIn(): boolean {
		return !!this.accessJwt && !!this.did;
	}

	private clearSession(): void {
		this.accessJwt = undefined;
		this.refreshJwt = undefined;
		this.did = undefined;
	}

	private async requestWithTimeout(params: RequestUrlParam, timeoutMs?: number): Promise<RequestUrlResponse> {
		const duration = timeoutMs ?? Math.max(1000, this.host.getTimeoutMs());
		let timer: number | null = null;
		const timeoutPromise = new Promise<never>((_, reject) => {
			timer = window.setTimeout(() => reject(new Error(TIMEOUT_MESSAGE)), duration);
		});
		try {
			// throw: false にしないと 400+ で requestUrl が汎用エラーを投げてしまい、
			// 呼び出し側のステータス判定（401 再ログイン・429 バックオフ）とAPIの
			// エラーメッセージ抽出が働かなくなる
			return await Promise.race([requestUrl({ ...params, throw: false }), timeoutPromise]);
		} finally {
			if (timer !== null) {
				window.clearTimeout(timer);
			}
		}
	}

	/**
	 * APIが返したエラー文言を優先して例外にする。文言が無いときは `HTTP 500` のように
	 * ステータスだけにする。「投稿に失敗しました: 」などの前置きは通知する側が付ける
	 */
	private createHttpError(response: RequestUrlResponse): HttpError {
		const errorBody = (response.json as ErrorResponse | undefined) ?? {};
		const message = errorBody.message || errorBody.error || `HTTP ${response.status}`;
		const err = new Error(message) as HttpError;
		err.status = response.status;
		err.response = response;
		return err;
	}

	async login(): Promise<boolean> {
		const locale = this.host.getLocale();
		const handle = this.host.getHandle();
		const password = this.host.getAppPassword();
		if (!handle || !password) {
			// IDだけあって中身が無いのは、別の端末で設定した data.json が同期されてきた場合。
			// キーチェーンは端末間で同期されないので、原因が分かる文言にする
			const secretMissing = !password && this.host.hasSecretId();
			this.host.notify(secretMissing ? locale.passwordSecretMissing : locale.loginRequired);
			return false;
		}
		try {
			const response = await this.requestWithTimeout({
				url: `${XRPC_BASE}/com.atproto.server.createSession`,
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ identifier: handle, password })
			});
			if (response.status < 200 || response.status >= 300) {
				throw this.createHttpError(response);
			}
			const data = response.json as CreateSessionResponse;
			this.accessJwt = data.accessJwt;
			this.refreshJwt = data.refreshJwt;
			this.did = data.did;
			await this.fetchProfileAvatar(data.did);
			return true;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.host.notify(`${locale.loginFailed}: ${message}`);
			return false;
		}
	}

	private async fetchProfileAvatar(actorDid: string): Promise<void> {
		if (!this.accessJwt) return;
		try {
			const response = await this.requestWithTimeout({
				url: `${XRPC_BASE}/app.bsky.actor.getProfile?actor=${actorDid}`,
				headers: { Authorization: `Bearer ${this.accessJwt}` }
			});
			if (response.status < 200 || response.status >= 300) return;
			const profileData = response.json as { avatar?: string };
			this.avatar = profileData.avatar || '';
		} catch (error) {
			console.error(this.host.getLocale().avatarFetchFailed + ':', error);
		}
	}

	/**
	 * 認証付きのリクエストを送る。未ログインなら先にログインする。
	 * - 401: セッションを捨てて1回だけ再ログインし、送り直す
	 * - 429: retry-after があればその秒数だけ待ってから送り直す
	 * どちらも MAX_ATTEMPTS 回までで、送り直す前に RETRY_BASE_DELAY_MS × 試行回数だけ待つ。
	 *
	 * @param build セッション（did・トークン）からリクエストを組み立てる。再ログイン後の
	 *   新しいトークンで組み直せるよう、送るたびに呼び出す
	 * @throws LoginFailedError 最初のログインができなかった（理由は通知済み）
	 */
	private async authedRequest(build: (session: { did: string; accessJwt: string }) => RequestUrlParam): Promise<RequestUrlResponse> {
		if (!this.isLoggedIn && !(await this.login())) {
			throw new LoginFailedError(this.host.getLocale().loginFailed);
		}
		let reauthenticated = false;
		for (let attempt = 1; ; attempt++) {
			const response = await this.requestWithTimeout(build({ did: this.did ?? '', accessJwt: this.accessJwt ?? '' }));
			if (response.status >= 200 && response.status < 300) return response;
			const error = this.createHttpError(response);
			if (attempt >= MAX_ATTEMPTS) throw error;
			if (response.status === 401 && !reauthenticated) {
				reauthenticated = true;
				this.clearSession();
				// 再ログインできなければ、元の 401 をそのまま返す
				if (!(await this.login())) throw error;
			} else if (response.status === 429) {
				const retryAfter = Number(response.headers['retry-after']);
				if (Number.isFinite(retryAfter)) await sleep(Math.max(500, retryAfter * 1000));
			} else {
				throw error;
			}
			await sleep(RETRY_BASE_DELAY_MS * attempt);
		}
	}

	/**
	 * メンション用にハンドルを DID に解決し、解決できたものだけを表で返す。例外は投げない。
	 *
	 * resolveHandle は認証不要の公開エンドポイントなので authedRequest を通さない
	 * （通すと未ログイン時のログインや 401 での再ログインが走る）。
	 * 解決できなかったハンドルは平文のまま投稿されるだけなので、通知は出さない。
	 * 「存在しない」（429 以外の 4xx）はキャッシュするが、通信の失敗（例外・タイムアウト・429・5xx）は
	 * キャッシュしない。通信が戻った次の投稿で解決し直せるようにするため。
	 */
	async resolveHandles(handles: string[]): Promise<Map<string, string>> {
		const unique = [...new Set(handles.map((h) => h.toLowerCase()))];
		await Promise.all(unique.filter((h) => !this.handleDidCache.has(h)).map(async (handle) => {
			try {
				const response = await this.requestWithTimeout({
					url: `${XRPC_BASE}/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`
				}, RESOLVE_HANDLE_TIMEOUT_MS);
				if (response.status >= 200 && response.status < 300) {
					const did = (response.json as { did?: unknown } | undefined)?.did;
					if (typeof did === 'string' && did.startsWith('did:')) {
						this.handleDidCache.set(handle, did);
						return;
					}
				}
				// 429（レート制限）は一時的なものなのでキャッシュしない
				if (response.status >= 400 && response.status < 500 && response.status !== 429) {
					this.handleDidCache.set(handle, null);
				}
				console.warn(`Could not resolve @${handle} (HTTP ${response.status}); posting it as plain text`);
			} catch (error) {
				console.warn(`Could not resolve @${handle}; posting it as plain text:`, error);
			}
		}));
		const resolved = new Map<string, string>();
		for (const handle of unique) {
			const did = this.handleDidCache.get(handle);
			if (did) resolved.set(handle, did);
		}
		return resolved;
	}

	/**
	 * 画像などのバイナリをアップロードする。返り値の blob は $type を含むので、
	 * そのまま embed に入れる（落とすと createRecord が 400 になる）
	 */
	async uploadBlob(blob: ArrayBuffer, mimeType: string): Promise<UploadBlobResponse> {
		try {
			const response = await this.authedRequest(({ accessJwt }) => ({
				url: `${XRPC_BASE}/com.atproto.repo.uploadBlob`,
				method: 'POST',
				headers: {
					'Content-Type': mimeType,
					Accept: 'application/json',
					Authorization: `Bearer ${accessJwt}`
				},
				body: blob
			}));
			return response.json as UploadBlobResponse;
		} catch (error) {
			if (isTimeoutError(error)) {
				throw new Error(this.host.getLocale().imageUploadTimeout, { cause: error });
			}
			throw error;
		}
	}

	/** 投稿レコードを作り、作成された投稿の at:// URI を返す */
	async createPost(record: BlueskyPostRecord): Promise<string | undefined> {
		const response = await this.authedRequest(({ did, accessJwt }) => ({
			url: `${XRPC_BASE}/com.atproto.repo.createRecord`,
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${accessJwt}`
			},
			body: JSON.stringify({
				repo: did,
				collection: 'app.bsky.feed.post',
				record
			})
		}));
		return (response.json as CreateRecordResponse | undefined)?.uri;
	}
}
