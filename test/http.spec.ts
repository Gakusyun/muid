import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const BASE = 'https://muid.example.com';

function get(pathAndQuery: string, init?: RequestInit): Promise<Response> {
	return exports.default.fetch(`${BASE}${pathAndQuery}`, init);
}

describe('HTTP: GET', () => {
	it('默认返回 32 位纯文本 ID，带 CORS 和分钟级缓存', async () => {
		const res = await get('/');
		expect(res.status).toBe(200);
		expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
		expect(res.headers.get('Cache-Control')).toMatch(/^public, max-age=\d{1,2}$/);
		const id = await res.text();
		expect(id).toMatch(/^[A-Za-z0-9_-]{32}$/);
	});

	it('format=json 返回 {seed, len, minuteTimestamp, id}', async () => {
		const res = await get('/?format=json&seed=abc&len=8');
		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Type')).toMatch(/application\/json/);
		const data = await res.json();
		expect(Object.keys(data).sort()).toEqual(['id', 'len', 'minuteTimestamp', 'seed']);
		expect(data.seed).toBe('abc');
		expect(data.len).toBe(8);
		expect(data.id).toHaveLength(8);
		expect(data.minuteTimestamp % 60).toBe(0);
	});

	it('显式 timestamp 可复现同分钟 ID，且 immutable 缓存', async () => {
		const res1 = await get('/?seed=abc&timestamp=1712345640&format=json');
		const res2 = await get('/?seed=abc&timestamp=1712345640&format=json');
		const [a, b] = await Promise.all([res1.json(), res2.json()]);
		expect(a.id).toBe(b.id);
		expect(a.minuteTimestamp).toBe(1712345640);
		expect(res1.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
	});

	it('不同 timestamp（跨分钟）得到不同 ID', async () => {
		const res1 = await get('/?seed=abc&timestamp=1712345640&format=json');
		const res2 = await get('/?seed=abc&timestamp=1712345700&format=json');
		const [a, b] = await Promise.all([res1.json(), res2.json()]);
		expect(a.id).not.toBe(b.id);
	});

	it('短长度是长长度的前缀', async () => {
		const res1 = await get('/?seed=abc&timestamp=1712345640&len=4');
		const res2 = await get('/?seed=abc&timestamp=1712345640&len=16');
		const [short, long] = await Promise.all([res1.text(), res2.text()]);
		expect(long.startsWith(short)).toBe(true);
	});

	it('别名生效且全名优先', async () => {
		const res = await get('/?s=abc&seed=full&l=8&format=json');
		const data = await res.json();
		expect(data.seed).toBe('full');
		expect(data.len).toBe(8);
	});

	it('参数非法返回 400 + JSON 错误', async () => {
		for (const query of ['?len=abc', '?len=257', '?len=0', '?t=1712345678901', '?timestamp=-5']) {
			const res = await get(query);
			expect(res.status, query).toBe(400);
			expect(res.headers.get('Content-Type')).toMatch(/application\/json/);
			expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
			const data = await res.json();
			expect(data.error).toBeTruthy();
		}
	});

	it('不支持的方法返回 405 + Allow 头', async () => {
		const res = await exports.default.fetch(`${BASE}/`, { method: 'PUT' });
		expect(res.status).toBe(405);
		expect(res.headers.get('Allow')).toBe('GET, HEAD, POST');
		const data = await res.json();
		expect(data.error).toBeTruthy();
	});

	it('HEAD 返回空 body + GET 的响应头', async () => {
		const res = await exports.default.fetch(`${BASE}/?len=8`, { method: 'HEAD' });
		expect(res.status).toBe(200);
		expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
		expect(await res.text()).toBe('');
	});
});

describe('HTTP: POST', () => {
	it('JSON 请求体生效', async () => {
		const res = await exports.default.fetch(`${BASE}/?format=json`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ seed: 'post', len: 12, timestamp: 1712345640 }),
		});
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.seed).toBe('post');
		expect(data.len).toBe(12);
		expect(data.id).toHaveLength(12);
		expect(data.minuteTimestamp).toBe(1712345640);
	});

	it('urlencoded 表单生效', async () => {
		const res = await exports.default.fetch(`${BASE}/?format=json`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: 'seed=form&len=10&timestamp=1712345640',
		});
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.seed).toBe('form');
		expect(data.len).toBe(10);
	});

	it('body 覆盖同名 query 参数', async () => {
		const res = await exports.default.fetch(`${BASE}/?seed=query&format=json`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ seed: 'body' }),
		});
		const data = await res.json();
		expect(data.seed).toBe('body');
	});

	it('不支持的 Content-Type 返回 400', async () => {
		const res = await exports.default.fetch(`${BASE}/`, {
			method: 'POST',
			headers: { 'Content-Type': 'text/plain' },
			body: 'hello',
		});
		expect(res.status).toBe(400);
		const data = await res.json();
		expect(data.error).toMatch(/Content-Type/);
	});

	it('非法 JSON 请求体返回 400', async () => {
		const res = await exports.default.fetch(`${BASE}/`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: '{not json',
		});
		expect(res.status).toBe(400);
	});

	it('POST 参数非法返回 400', async () => {
		const res = await exports.default.fetch(`${BASE}/`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ len: '999' }),
		});
		expect(res.status).toBe(400);
	});

	it('POST 与 GET 对相同参数生成相同 ID', async () => {
		const getRes = await get('/?seed=same&timestamp=1712345640&len=20');
		const postRes = await exports.default.fetch(`${BASE}/`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ seed: 'same', timestamp: 1712345640, len: 20 }),
		});
		expect(await postRes.text()).toBe(await getRes.text());
	});
});
