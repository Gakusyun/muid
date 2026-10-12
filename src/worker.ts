import { generateId, ParamError, parseParams } from './muid';

function jsonResponse(body: unknown, status: number, headers: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			'Content-Type': 'application/json;charset=utf-8',
			'Access-Control-Allow-Origin': '*',
			...headers,
		},
	});
}

/** 读取请求体参数：JSON 对象或 urlencoded 表单；类型不支持时返回 undefined */
async function readBodyParams(request: Request): Promise<[string, string][] | undefined> {
	const contentType = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
	if (contentType === 'application/json') {
		let data: unknown;
		try {
			data = await request.json();
		} catch {
			throw new ParamError('Invalid JSON body: must be a JSON object');
		}
		if (typeof data !== 'object' || data === null || Array.isArray(data)) {
			throw new ParamError('Invalid JSON body: must be a JSON object');
		}
		return Object.entries(data).flatMap(([key, value]) => {
			if (typeof value === 'string') return [[key, value] as [string, string]];
			if (typeof value === 'number' || typeof value === 'boolean') return [[key, String(value)] as [string, string]];
			return [];
		});
	}
	if (contentType === 'application/x-www-form-urlencoded') {
		const form = await request.formData();
		return [...form.entries()].flatMap(([key, value]) => (typeof value === 'string' ? [[key, value] as [string, string]] : []));
	}
	return undefined;
}

async function handle(request: Request, env: Env, query: [string, string][], body?: [string, string][]): Promise<Response> {
	try {
		const params = parseParams(query, body, env);

		const explicitTimestamp = params.timestamp !== undefined;
		const nowSec = Math.floor(Date.now() / 1000);
		const sourceSec = explicitTimestamp ? params.timestamp! : nowSec;
		const minuteTime = sourceSec - (sourceSec % 60);
		const remainingSec = 60 - (nowSec % 60);

		const id = await generateId(params.seed, minuteTime, params.len);
		const cacheControl = explicitTimestamp ? 'public, max-age=31536000, immutable' : `public, max-age=${remainingSec}`;
		const corsAndCache = {
			'Access-Control-Allow-Origin': '*',
			'Cache-Control': cacheControl,
		};

		if (params.format === 'json') {
			return jsonResponse({ seed: params.seed, len: params.len, minuteTimestamp: minuteTime, id }, 200, corsAndCache);
		}
		return new Response(id, {
			headers: {
				'Content-Type': 'text/plain;charset=utf-8',
				...corsAndCache,
			},
		});
	} catch (err) {
		if (err instanceof ParamError) {
			return jsonResponse({ error: err.message }, 400);
		}
		console.error('ID generation error:', err);
		return jsonResponse({ error: 'Internal Server Error' }, 500, { 'Cache-Control': 'no-cache, no-store, must-revalidate' });
	}
}

async function dispatch(request: Request, env: Env): Promise<Response> {
	const method = request.method.toUpperCase();
	const url = new URL(request.url);
	if (method === 'GET') return handle(request, env, [...url.searchParams]);
	if (method === 'POST') {
		let body: [string, string][] | undefined;
		try {
			body = await readBodyParams(request);
		} catch (err) {
			if (err instanceof ParamError) return jsonResponse({ error: err.message }, 400);
			return jsonResponse({ error: 'Invalid request body' }, 400);
		}
		if (body === undefined) {
			return jsonResponse({ error: 'Unsupported Content-Type: use application/json or application/x-www-form-urlencoded' }, 400);
		}
		return handle(request, env, [...url.searchParams], body);
	}
	return jsonResponse({ error: `Method ${method} not allowed` }, 405, { Allow: 'GET, HEAD, POST' });
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		if (request.method.toUpperCase() === 'HEAD') {
			const response = await dispatch(new Request(request.url, { method: 'GET', headers: request.headers }), env);
			return new Response(null, { status: response.status, headers: response.headers });
		}
		return dispatch(request, env);
	},
} satisfies ExportedHandler<Env>;
