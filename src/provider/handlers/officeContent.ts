import { spawn } from 'child_process';
import { basename, dirname, extname, isAbsolute, relative } from 'path';
import { extensions, Uri, workspace, type Webview } from 'vscode';
import { Handler } from '@/common/handler';
import { isUriReadOnly } from '@/common/fileReadOnly';
import { isWebExtensionHost } from '@/common/extensionHost';

export function isVirtualUri(uri: Uri): boolean {
    return uri.scheme !== 'file';
}

function getPayloadPath(uri: Uri): string {
    return uri.toString();
}

/** Same as the markdown documentCacheId; used as the webview localStorage key prefix */
export function buildDocumentCacheId(uri: Uri): string {
    return `${uri.scheme}:${uri.toString()}`;
}

interface GitUriQuery {
    path: string;
    ref: string;
    submoduleOf?: string;
}

interface GitRepository {
    rootUri: Uri;
}

interface GitApi {
    repositories: ReadonlyArray<GitRepository>;
    getRepository(uri: Uri): GitRepository | null;
    getRepositoryRoot(uri: Uri): Promise<Uri | null>;
}

interface GitExtensionExports {
    getAPI(version: 1): GitApi;
}

async function getGitApi(): Promise<GitApi | null> {
    const extension = extensions.getExtension<GitExtensionExports>('vscode.git');
    if (!extension) {
        return null;
    }
    if (!extension.isActive) {
        try {
            await extension.activate();
        } catch {
            return null;
        }
    }
    return extension.exports?.getAPI(1) ?? null;
}

async function findRepoRoot(gitUri: Uri, gitPath: string, filePath: string): Promise<string> {
    const api = await getGitApi();
    if (api) {
        const repo = api.getRepository(gitUri);
        if (repo?.rootUri.scheme === 'file') {
            return repo.rootUri.fsPath;
        }
        const rootUri = await api.getRepositoryRoot(gitUri);
        if (rootUri?.scheme === 'file') {
            return rootUri.fsPath;
        }
        for (const candidate of api.repositories) {
            if (candidate.rootUri.scheme !== 'file') {
                continue;
            }
            const repoRelative = relative(candidate.rootUri.fsPath, filePath);
            if (repoRelative && !repoRelative.startsWith('..') && !isAbsolute(repoRelative)) {
                return candidate.rootUri.fsPath;
            }
        }
    }
    return findRepoRootFromDisk(gitPath, filePath);
}

async function findRepoRootFromDisk(gitPath: string, filePath: string): Promise<string> {
    const cwd = dirname(filePath);
    const root = await spawnGitBinary(gitPath, cwd, ['rev-parse', '--show-toplevel']);
    return new TextDecoder().decode(root).trim();
}

function spawnGitBinary(gitPath: string, cwd: string, args: string[]): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
        const child = spawn(gitPath, args, { cwd });
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
        child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));
        child.on('error', reject);
        child.on('close', (code) => {
            if (code !== 0) {
                const message = Buffer.concat(stderr).toString('utf8').trim();
                reject(new Error(message || `git exited with code ${code}`));
                return;
            }
            resolve(new Uint8Array(Buffer.concat(stdout)));
        });
    });
}

function resolveGitPath(): string {
    return workspace.getConfiguration('git').get<string>('path') ?? 'git.exe';
}

/** A lone trailing ^ in the ref followed by :path fails to parse in some environments; ^1 is equivalent to ^ */
function normalizeGitRef(ref: string): string {
    return ref.endsWith('^') ? `${ref}1` : ref;
}

function buildGitObjectSpec(ref: string, relativePath: string): string {
    // VS Code uses `~` for the staged version and `~N` for merge stage N
    if (!ref || ref === '~') {
        return `:${relativePath}`;
    }
    const stage = /^~(\d)$/.exec(ref);
    if (stage) {
        return `:${stage[1]}:${relativePath}`;
    }
    return `${normalizeGitRef(ref)}:${relativePath}`;
}

/** The git scheme goes through --textconv in the VS Code FS, so binaries are treated as text on Windows */
async function readGitUriBytes(uri: Uri): Promise<Uint8Array> {
    const { path: filePath, ref, submoduleOf } = JSON.parse(uri.query) as GitUriQuery;
    if (submoduleOf) {
        return workspace.fs.readFile(uri);
    }
    const gitPath = resolveGitPath();
    const repoRoot = await findRepoRoot(uri, gitPath, filePath);
    const relativePath = relative(repoRoot, filePath).replace(/\\/g, '/');
    return spawnGitBinary(gitPath, repoRoot, ['show', buildGitObjectSpec(ref, relativePath)]);
}

/** csv and tsv are text: their textconv output is fine */
const TEXT_EXTENSIONS = ['.csv', '.tsv'];

export async function readUriBytes(uri: Uri): Promise<Uint8Array> {
    if (uri.scheme === 'git' && !isWebExtensionHost() && process.platform === 'win32'
        && !TEXT_EXTENSIONS.includes(extname(uri.fsPath).toLowerCase())) {
        try {
            return await readGitUriBytes(uri);
        } catch {
            return workspace.fs.readFile(uri);
        }
    }
    return workspace.fs.readFile(uri);
}

/** Send the bytes of `source` (by default the document itself) to the webview. */
export async function emitVirtualOfficeOpen(handler: Handler, uri: Uri, source: Uri = uri): Promise<void> {
    const now = Date.now();
    const ext = extname(uri.fsPath);
    const readOnly = await isUriReadOnly(uri);
    try {
        const data = await readUriBytes(source);
        const payload: Record<string, unknown> = {
            ext,
            path: getPayloadPath(uri),
            fileName: basename(uri.fsPath),
            scheme: uri.scheme,
            documentCacheId: buildDocumentCacheId(uri),
            readOnly,
            nonce: now,
        };
        // a typed array is sent to the webview as binary; a number[] is JSON, many times the file size
        payload.buffer = data;
        handler.emit('open', payload);
    } catch (error) {
        handler.emit('open', {
            ext,
            path: getPayloadPath(uri),
            fileName: basename(uri.fsPath),
            scheme: uri.scheme,
            documentCacheId: buildDocumentCacheId(uri),
            readOnly,
            error: error instanceof Error ? error.message : 'Failed to read file',
            nonce: now,
        });
    }
}

export async function emitFileOfficeOpen(handler: Handler, uri: Uri, webview: Webview): Promise<void> {
    const now = Date.now();
    const readOnly = await isUriReadOnly(uri);
    handler.emit('open', {
        ext: extname(uri.fsPath),
        path: webview.asWebviewUri(uri).toString(),
        fileName: basename(uri.fsPath),
        documentCacheId: buildDocumentCacheId(uri),
        readOnly,
    });
}
