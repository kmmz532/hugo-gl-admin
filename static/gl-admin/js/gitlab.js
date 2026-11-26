// 他の JS は GitLab API をこのモジュール経由でのみ呼ぶ。
// ファイルの版（sha）には、そのファイルを最後に変更したコミットの ID（last_commit_id）を使う。
import { config, escapeRe } from './config.js';
import { getItem, setItem, removeItem } from './storage.js';
import { t } from './i18n.js';

// セルフホストのときは params.glAdmin.gitlabURL にインスタンスの URL を書く
export const GITLAB_URL = (config.gitlabURL || 'https://gitlab.com').replace(/\/+$/, '');
const API_BASE = `${GITLAB_URL}/api/v4`;
const TOKEN_KEY = 'blog_token';
const LOGIN_KEY = 'blog_login';
const SLUG_RE = /^[a-z0-9-]{1,80}$/;
// 画像は記事のリポジトリの static/images/<yyyy>/<8文字>.<ext> に置く
const IMAGE_PATH_RE = new RegExp(`^${escapeRe(config.imagesDir)}/\\d{4}/[a-z0-9]{8}\\.(webp|png|jpg|gif|svg)$`);
// リポジトリ内のパス（static/images/...）と記事に書く公開パス（/images/...）の相互変換
const toPublicPath = (path) => config.imagesURL + path.slice(config.imagesDir.length + 1);
const toRepoPath = (publicPath) => `${config.imagesDir}/${publicPath.slice(config.imagesURL.length)}`;
// 書き込み先と同じファイルが既にある・他で更新されたときに GitLab が返す 400 の文言
const CONFLICT_MESSAGE_RE = /already exists|has changed|have been changed|does not exist|doesn't exist/i;

// repo はプロジェクトのフルパス（group/subgroup/project）
export const repo = config.repo ?? '';
export const branch = config.branch ?? '';
const projectPath = `/projects/${encodeURIComponent(repo)}`;

export class ConflictError extends Error {}

// tokenProvider（サイトが用意する受け取り口）を設定したときは、そこから受け取ったトークンを優先する。タブを閉じると消える（sessionStorage）
const PROVIDER_PATH = config.tokenProvider ?? '';
const SESSION_KEY = 'gl_session_token';
export const getToken = () => (PROVIDER_PATH ? sessionStorage.getItem(SESSION_KEY) : null) || getItem(TOKEN_KEY);
export const getLogin = () => getItem(LOGIN_KEY);

export function saveSession(token, login) {
  if (!(setItem(TOKEN_KEY, token) && setItem(LOGIN_KEY, login))) {
    throw new Error(t('error.storage_write'));
  }
}

export function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
  removeItem(TOKEN_KEY);
  removeItem(LOGIN_KEY);
}

// npm run dev が BLOG_DEV_TOKEN を渡されているときだけ、localhost でトークンを受け取って保存する。
// 本番のドメインでは何もしない。取れなければ通常どおりログイン画面を使う。
const DEV_SESSION_URL = 'http://127.0.0.1:1314/session';
export const isLocalHost = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

async function ensureSessionToken() {
  if (sessionStorage.getItem(SESSION_KEY)) return;
  try {
    const provider = await import(PROVIDER_PATH);
    const token = await provider.getGitLabToken();
    if (token) sessionStorage.setItem(SESSION_KEY, token);
  } catch (e) {
    console.warn(t('error.token_provider'), e);
  }
}

export async function ensureDevSession() {
  if (PROVIDER_PATH) await ensureSessionToken();
  if (!isLocalHost || getToken()) return;
  try {
    const res = await fetch(DEV_SESSION_URL, { cache: 'no-store' });
    if (!res.ok) return;
    const { token } = await res.json();
    if (token) saveSession(token, await fetchLogin(token));
  } catch {
    // dev サーバーが無い・トークンが不正なときは、手動ログインに任せる
  }
}

export const isValidSlug = (slug) => SLUG_RE.test(slug);

function postPath(slug) {
  if (!isValidSlug(slug)) {
    throw new Error(t('error.invalid_slug'));
  }
  return `${config.postsDir}/${slug}.md`;
}

// btoa / atob 単体は日本語で壊れるので UTF-8 バイト列を経由する
function fromBase64(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

function redirectToLogin() {
  const ret = encodeURIComponent(location.pathname + location.search);
  location.href = `${config.loginURL}?return=${ret}`;
}

const errorMessage = (json) =>
  typeof json.message === 'string' ? json.message : JSON.stringify(json.message ?? json.error ?? '');

// token を省略すると保存済みトークンを使う（ログイン時だけ明示的に渡す）。
// GET の 404 は null を返す。withHeaders を付けると { json, headers } を返す
async function api(endpoint, { method = 'GET', body, token = getToken(), withHeaders = false } = {}) {
  const headers = { Authorization: `Bearer ${token}` };
  if (body) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${API_BASE}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });

  // 失効した保存済みトークンは捨ててログインし直してもらう。
  // ログイン画面で入力中のトークンが弾かれたときは呼び出し側にエラーを返す。
  if (res.status === 401 && token === getToken()) {
    clearSession();
    redirectToLogin();
    throw new Error(t('error.session_expired'));
  }
  if (res.status === 404 && method === 'GET') return null;

  const json = await res.json().catch(() => ({}));
  if (res.status === 409 || res.status === 422 || (res.status === 400 && CONFLICT_MESSAGE_RE.test(errorMessage(json)))) {
    throw new ConflictError(t('error.conflict', { status: res.status }));
  }
  if (!res.ok) {
    throw new Error(t('error.api', { status: res.status, message: errorMessage(json) }).trim());
  }
  return withHeaders ? { json, headers: res.headers } : json;
}

const fileUrl = (path) => `${projectPath}/repository/files/${encodeURIComponent(path)}`;

// 1 コミットで複数のファイルを変更する。新しいコミットの ID を返す
async function commit(message, actions) {
  const json = await api(`${projectPath}/repository/commits`, {
    method: 'POST',
    body: { branch, commit_message: message, actions },
  });
  return json.id;
}

// 存在しなければ null
export async function getPost(slug) {
  const json = await api(`${fileUrl(postPath(slug))}?ref=${encodeURIComponent(branch)}`);
  if (!json) return null;
  return { sha: json.last_commit_id, text: fromBase64(json.content) };
}

export const COMMITS_PER_PAGE = 30;

// 記事ファイルのコミット履歴を新しい順に返す。page は 1 始まり。
// 名前の変更（slug の変更）はたどらない。履歴が無ければ空の配列
export async function listPostCommits(slug, { page = 1 } = {}) {
  const path = encodeURIComponent(postPath(slug));
  const json = await api(`${projectPath}/repository/commits?path=${path}&ref_name=${encodeURIComponent(branch)}&per_page=${COMMITS_PER_PAGE}&page=${page}`);
  return (json ?? []).map((item) => ({
    sha: item.id,
    message: item.message,
    date: item.authored_date,
    author: item.author_name,
    url: item.web_url,
  }));
}

// sha を省略すると新規作成。既存ファイルがあれば ConflictError。新しい sha を返す
export async function savePost(slug, text, sha) {
  const action = sha
    ? { action: 'update', file_path: postPath(slug), content: text, last_commit_id: sha }
    : { action: 'create', file_path: postPath(slug), content: text };
  return commit(`post: ${slug}`, [action]);
}

export async function deletePost(slug, sha) {
  await commit(`delete: ${slug}`, [{ action: 'delete', file_path: postPath(slug), ...(sha ? { last_commit_id: sha } : {}) }]);
}

// 複数の記事を 1 コミットにまとめる。changes は { slug: text | null }（null は削除）。
// bases（{ slug: sha }）を渡すと、読み込んだ後に他で更新された記事があれば ConflictError。失敗時は何も変わらない
export async function commitChanges(changes, message, bases = {}) {
  const actions = Object.entries(changes).map(([slug, text]) => ({
    action: text === null ? 'delete' : 'update',
    file_path: postPath(slug),
    ...(text === null ? {} : { content: text }),
    ...(bases[slug] ? { last_commit_id: bases[slug] } : {}),
  }));
  return commit(message, actions);
}

// base64 は呼び出し側で作る（バイナリを扱うため）。既存パスは ConflictError
export async function saveImage(path, base64) {
  if (!IMAGE_PATH_RE.test(path)) throw new Error(t('error.image_path'));
  await commit(`image: ${path}`, [{ action: 'create', file_path: path, content: base64, encoding: 'base64' }]);
}

// ツリーを 100 件ずつたどって全件を返す
async function listTree(path) {
  const items = [];
  for (let page = 1; ; page += 1) {
    const result = await api(
      `${projectPath}/repository/tree?path=${encodeURIComponent(path)}&ref=${encodeURIComponent(branch)}&recursive=true&per_page=100&page=${page}`,
      { withHeaders: true },
    );
    if (!result) return items;
    items.push(...result.json);
    if (!result.headers.get('X-Next-Page')) return items;
  }
}

// 保存済みの画像を新しい年から順に返す。publicPath は記事に書く /images/<yyyy>/<name>。
// size は GitLab のツリーから取れないため null
export async function listImages() {
  const entries = await listTree(config.imagesDir);
  return entries
    .filter((entry) => entry.type === 'blob' && IMAGE_PATH_RE.test(entry.path))
    .map((entry) => ({
      path: entry.path,
      publicPath: toPublicPath(entry.path),
      sha: null,
      size: null,
    }))
    .sort((a, b) => (a.publicPath < b.publicPath ? 1 : -1));
}

export async function deleteImage(path) {
  if (!IMAGE_PATH_RE.test(path)) throw new Error(t('error.image_path'));
  await commit(`delete image: ${path}`, [{ action: 'delete', file_path: path }]);
}

// 公開前の画像を見るための URL（記事のリポジトリは public）。/images/... の記事内の書き方から作る
export const rawImageUrl = (publicPath) =>
  `${GITLAB_URL}/${repo}/-/raw/${encodeURIComponent(branch)}/${toRepoPath(publicPath)}`;

// ログイン時に使う。書き込み権限の確認はここで行う（保護ブランチの設定も含めて GitLab が判定した値）
export async function checkRepoPush(token) {
  const json = await api(`${projectPath}/repository/branches/${encodeURIComponent(branch)}`, { token });
  return json?.can_push === true;
}

export async function fetchLogin(token) {
  const json = await api('/user', { token });
  if (!json) throw new Error(t('error.user_info'));
  return json.username;
}
