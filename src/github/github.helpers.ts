/**
 * GitHub "get repository content" single-file shape (subset).
 */
export type GithubContentsFilePayload = {
  type?: string;
  encoding?: string;
  content?: string;
};

/**
 * When the contents API returns one file, GitHub sends base64 `content` with newlines.
 * Directory listings return an array and are returned unchanged.
 */
export function decodeGithubRepositoryFileContentIfApplicable(
  payload: unknown,
): unknown {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload;
  }

  const obj = payload as GithubContentsFilePayload;
  if (
    obj.type !== 'file' ||
    obj.encoding !== 'base64' ||
    typeof obj.content !== 'string'
  ) {
    return payload;
  }

  const normalized = obj.content.replace(/\n/g, '');
  const decoded = Buffer.from(normalized, 'base64').toString('utf8');
  return { ...obj, content: decoded, encoding: 'utf-8' };
}
