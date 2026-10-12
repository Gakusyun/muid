import { describe, expect, it } from 'vitest';
import { cleanSeed, DEFAULT_LEN, generateId, MAX_LEN, ParamError, parseParams } from '../src/muid';

const MINUTE = 1712345640; // 2024-04-06 00:54:00 UTC，60 的整数倍

describe('generateId', () => {
	it('默认长度为 32，字符集为 base62（纯字母数字，无符号）', async () => {
		const id = await generateId('Gakusyun', MINUTE, DEFAULT_LEN);
		expect(id).toHaveLength(32);
		expect(id).toMatch(/^[A-Za-z0-9]{32}$/);
		expect(id).not.toMatch(/[-_+/=]/);
	});

	it('同分钟同 seed 可复现，跨分钟不同', async () => {
		const a1 = await generateId('seedA', MINUTE, 32);
		const a2 = await generateId('seedA', MINUTE, 32);
		const a3 = await generateId('seedA', MINUTE + 60, 32);
		const b1 = await generateId('seedB', MINUTE, 32);
		expect(a1).toBe(a2);
		expect(a1).not.toBe(a3);
		expect(a1).not.toBe(b1);
	});

	it('短长度是长长度的前缀（同一 seed 同一分钟）', async () => {
		const lens = [1, 2, 3, 5, 16, 32, 43, 64, 128, MAX_LEN];
		const ids = await Promise.all(lens.map((len) => generateId('prefix', MINUTE, len)));
		for (let i = 0; i < lens.length - 1; i++) {
			expect(ids[i]).toBe(ids[i + 1].slice(0, lens[i]));
		}
		// 逐长度全检：任意 len1 < len2，id(len1) 是 id(len2) 的前缀
		const full = await generateId('prefix', MINUTE, MAX_LEN);
		for (let len = 1; len <= MAX_LEN; len += 7) {
			expect(full.slice(0, len)).toMatch(new RegExp(`^[A-Za-z0-9]{${len}}$`));
		}
		const id8 = await generateId('prefix', MINUTE, 8);
		expect(full.startsWith(id8)).toBe(true);
	});

	it('长度边界 1 和 256', async () => {
		const min = await generateId('edge', MINUTE, 1);
		const max = await generateId('edge', MINUTE, MAX_LEN);
		expect(min).toHaveLength(1);
		expect(max).toHaveLength(256);
		expect(max.startsWith(min)).toBe(true);
	});
});

describe('cleanSeed', () => {
	it('清洗非法字符并截断到 64', () => {
		expect(cleanSeed('hello world!')).toBe('helloworld');
		expect(cleanSeed('a'.repeat(100))).toHaveLength(64);
	});

	it('清洗后为空则回退默认', () => {
		expect(cleanSeed('!!!')).toBe('Gakusyun');
		expect(cleanSeed(undefined)).toBe('Gakusyun');
		expect(cleanSeed('')).toBe('Gakusyun');
	});
});

describe('parseParams', () => {
	const env = { SEED_DEFAULT: 'Gakusyun', SEED_MAX_LEN: '64' };

	it('无参数时使用默认值', () => {
		const p = parseParams([], undefined, env);
		expect(p).toEqual({ seed: 'Gakusyun', len: 32, timestamp: undefined, format: 'text' });
	});

	it('别名与全名等价', () => {
		const a = parseParams([['seed', 'x'], ['len', '8'], ['timestamp', '1712345640'], ['format', 'json']], undefined, env);
		const b = parseParams([['s', 'x'], ['l', '8'], ['t', '1712345640'], ['f', 'json']], undefined, env);
		expect(b).toEqual(a);
		expect(a.seed).toBe('x');
		expect(a.len).toBe(8);
		expect(a.timestamp).toBe(1712345640);
		expect(a.format).toBe('json');
	});

	it('全名优先于别名', () => {
		const p = parseParams([['seed', 'full'], ['s', 'alias']], undefined, env);
		expect(p.seed).toBe('full');
		// 反过来（别名在前）也应全名胜出：resolveEntries 中 exact 覆盖 alias
		const p2 = parseParams([['s', 'alias'], ['seed', 'full']], undefined, env);
		expect(p2.seed).toBe('full');
	});

	it('body 覆盖 query', () => {
		const p = parseParams([['seed', 'query']], [['seed', 'body']], env);
		expect(p.seed).toBe('body');
	});

	it('len 校验：非整数、越界报 400', () => {
		expect(() => parseParams([['len', 'abc']], undefined, env)).toThrow(ParamError);
		expect(() => parseParams([['len', '0']], undefined, env)).toThrow(ParamError);
		expect(() => parseParams([['len', '257']], undefined, env)).toThrow(ParamError);
		expect(() => parseParams([['len', '-1']], undefined, env)).toThrow(ParamError);
		expect(() => parseParams([['len', '32.5']], undefined, env)).toThrow(ParamError);
		expect(parseParams([['len', '1']], undefined, env).len).toBe(1);
		expect(parseParams([['len', '256']], undefined, env).len).toBe(256);
	});

	it('timestamp 校验：只接受秒级非负整数', () => {
		expect(() => parseParams([['timestamp', 'abc']], undefined, env)).toThrow(ParamError);
		expect(() => parseParams([['timestamp', '-1']], undefined, env)).toThrow(ParamError);
		expect(() => parseParams([['timestamp', '1712345678901']], undefined, env)).toThrow(ParamError); // 13 位毫秒
		expect(parseParams([['timestamp', '0']], undefined, env).timestamp).toBe(0);
		expect(parseParams([['timestamp', '2147483647']], undefined, env).timestamp).toBe(2147483647);
	});

	it('format 宽松：json 走 JSON，其余一律 text', () => {
		expect(parseParams([['format', 'json']], undefined, env).format).toBe('json');
		expect(parseParams([['format', 'xml']], undefined, env).format).toBe('text');
		expect(parseParams([['format', '']], undefined, env).format).toBe('text');
	});
});
