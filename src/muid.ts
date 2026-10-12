export const DEFAULT_LEN = 32;
export const MAX_LEN = 256;
export const SEED_DEFAULT = 'Gakusyun';
export const SEED_MAX_LEN = 64;

/** 参数校验错误，HTTP 层统一转为 400 + JSON */
export class ParamError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ParamError';
	}
}

const ALIASES: Record<string, string> = {
	s: 'seed',
	l: 'len',
	t: 'timestamp',
	f: 'format',
};

type Entries = Iterable<[string, string]>;

interface PickedValue {
	value: string;
	exact: boolean;
}

/**
 * 解析一组参数条目，应用别名映射。
 * 同一参数的全名和别名同时出现时，全名优先（仅当别名先出现时覆盖）。
 */
function resolveEntries(entries: Entries): Map<string, string> {
	const picked = new Map<string, PickedValue>();
	for (const [rawKey, value] of entries) {
		const key = Object.prototype.hasOwnProperty.call(ALIASES, rawKey) ? ALIASES[rawKey] : rawKey;
		const exact = rawKey === key;
		const prev = picked.get(key);
		if (!prev || (exact && !prev.exact)) picked.set(key, { value, exact });
	}
	const out = new Map<string, string>();
	for (const [key, entry] of picked) out.set(key, entry.value);
	return out;
}

/** seed 清洗：截断 → 去除非 [a-zA-Z0-9_-] 字符 → 为空回退默认（宽松，不报错） */
export function cleanSeed(raw: string | undefined, seedDefault = SEED_DEFAULT, maxLen = SEED_MAX_LEN): string {
	let seed = raw || seedDefault;
	seed = seed.substring(0, maxLen).replace(/[^a-zA-Z0-9_-]/g, '');
	return seed || seedDefault;
}

function parseLen(raw: string | undefined): number {
	if (raw === undefined) return DEFAULT_LEN;
	if (!/^\d+$/.test(raw)) throw new ParamError(`Invalid len: "${raw}" must be an integer between 1 and ${MAX_LEN}`);
	const len = Number(raw);
	if (len < 1 || len > MAX_LEN) throw new ParamError(`Invalid len: ${raw} must be between 1 and ${MAX_LEN}`);
	return len;
}

function parseTimestamp(raw: string | undefined): number | undefined {
	if (raw === undefined) return undefined;
	if (/^\d+$/.test(raw) && raw.length <= 10) return Number(raw);
	if (/^\d+$/.test(raw)) throw new ParamError('Invalid timestamp: only second-level Unix timestamps are supported (max 10 digits)');
	throw new ParamError('Invalid timestamp: must be a non-negative Unix timestamp in seconds');
}

export interface ParsedParams {
	seed: string;
	len: number;
	/** 仅当调用方显式传入时存在 */
	timestamp?: number;
	format: 'json' | 'text';
}

/**
 * 解析并校验请求参数。
 * query 为 URL 查询参数，body 为请求体参数（可选，同名时 body 覆盖 query）。
 */
export function parseParams(query: Entries, body: Entries | undefined, env: { SEED_DEFAULT?: string; SEED_MAX_LEN?: string }): ParsedParams {
	const merged = resolveEntries(query);
	if (body) {
		for (const [key, value] of resolveEntries(body)) merged.set(key, value);
	}
	const seedDefault = env.SEED_DEFAULT || SEED_DEFAULT;
	const seedMaxLen = parseInt(env.SEED_MAX_LEN ?? '') || SEED_MAX_LEN;
	return {
		seed: cleanSeed(merged.get('seed'), seedDefault, seedMaxLen),
		len: parseLen(merged.get('len')),
		timestamp: parseTimestamp(merged.get('timestamp')),
		format: merged.get('format') === 'json' ? 'json' : 'text',
	};
}

const textEncoder = new TextEncoder();
const B62_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

async function sha256(data: Uint8Array): Promise<Uint8Array> {
	return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
}

/**
 * 生成确定性 ID，字符集 base62（A-Z a-z 0-9），不含任何符号。
 *
 * 字节流由哈希链构成：h0 = SHA-256(seed-分钟时间戳)，hi = SHA-256(hi-1)，
 * 只依赖 seed 和分钟，同一分钟内同 seed 恒可复现。
 *
 * 编码：从字节流按位顺序每 6 bit 取一个值（0–63），≥62 的丢弃取下一组，
 * 其余映射到 62 个字符（拒绝采样，字符在字母数字上均匀分布）。
 * 字符序列只由字节流决定、与请求长度无关：生成到所需长度即停，
 * 因此任意 len1 < len2，id(len1) 恒为 id(len2) 的前缀。
 */
export async function generateId(seed: string, minuteTimestamp: number, len: number): Promise<string> {
	let block = await sha256(textEncoder.encode(`${seed}-${minuteTimestamp}`));
	let byteIndex = 0;
	let bitBuffer = 0;
	let bitCount = 0;
	let out = '';
	while (out.length < len) {
		if (bitCount < 6) {
			if (byteIndex >= block.length) {
				block = await sha256(block);
				byteIndex = 0;
			}
			bitBuffer |= block[byteIndex] << bitCount;
			bitCount += 8;
			byteIndex++;
		}
		const value = bitBuffer & 63;
		bitBuffer >>>= 6;
		bitCount -= 6;
		if (value < 62) out += B62_ALPHABET[value];
	}
	return out;
}
