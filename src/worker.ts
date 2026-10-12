const encoder = new TextEncoder();

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const SEED_DEFAULT = env.SEED_DEFAULT || 'Gakusyun';
    const SEED_MAX_LEN = parseInt(env.SEED_MAX_LEN) || 64;

    try {
      const url = new URL(request.url);
      let seed = url.searchParams.get('seed') || SEED_DEFAULT;
      seed = seed.substring(0, SEED_MAX_LEN).replace(/[^a-zA-Z0-9_-]/g, '');
      if (!seed) seed = SEED_DEFAULT;

      const format = url.searchParams.get('format') || '';
      const nowSec = Math.floor(Date.now() / 1000);
      const minuteTime = nowSec - (nowSec % 60);
      const remainingSec = 60 - (nowSec % 60);

      const rawStr = `${seed}-${minuteTime}`;
      const hashBuf = await crypto.subtle.digest('SHA-256', encoder.encode(rawStr));
      const arr = new Uint8Array(hashBuf);

      // convert Uint8Array → binary string → base64url
      const binary = String.fromCharCode(...arr);
      const hashStr = btoa(binary).replace(/[+/=]/g, c =>
        c === '+' ? '-' : c === '/' ? '_' : ''
      );

      if (format === 'json') {
        return new Response(JSON.stringify({
          seed, minuteTimestamp: minuteTime, id: hashStr
        }), {
          headers: {
            'Content-Type': 'application/json;charset=utf-8',
            'Cache-Control': `public, max-age=${remainingSec}`
          }
        });
      }

      return new Response(hashStr, {
        headers: {
          'Content-Type': 'text/plain;charset=utf-8',
          'Cache-Control': `public, max-age=${remainingSec}`
        }
      });
    } catch (err) {
      console.error('ID generation error:', err);
      return new Response(
        JSON.stringify({ error: 'Internal Server Error' }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
          }
        }
      );
    }
  }
} satisfies ExportedHandler<Env>;
