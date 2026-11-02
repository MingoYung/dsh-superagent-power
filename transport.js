import { createHash, timingSafeEqual } from 'node:crypto';
import { createConnection } from 'node:net';
import { resolve, join } from 'node:path';

export function pipeName(home, profile, suffix = 'worker') {
  const canonical = process.platform === 'win32' ? resolve(home).toLowerCase() : resolve(home);
  const id = createHash('sha256').update(`${canonical}|${profile}`).digest('hex').slice(0, 24);
  return process.platform === 'win32' ? `\\\\.\\pipe\\dsh-sa-${id}-${suffix}` : join(home, `sa-${id}-${suffix}.sock`);
}
export function sameToken(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && a.length >= 32 && timingSafeEqual(a, b);
}
export function request(pipe, token, command = 'status', extra = {}, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(pipe);
    let text = '', settled = false;
    const done = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); socket.destroy();
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => done(new Error('Super-agent 控制连接超时')), timeoutMs);
    socket.once('connect', () => socket.write(JSON.stringify({ token, command, ...extra }) + '\n'));
    socket.on('data', data => {
      text += data;
      if (text.length > 32768) return done(new Error('Super-agent 控制响应过大'));
      const end = text.indexOf('\n');
      if (end < 0) return;
      try {
        const response = JSON.parse(text.slice(0, end));
        if (!response.ok) return done(Object.assign(new Error(response.error || '控制请求失败'), { code: response.code }));
        done(null, response.value);
      } catch (error) { done(error); }
    });
    socket.once('error', error => done(error));
    socket.once('end', () => done(new Error('Super-agent 控制连接已断开')));
  });
}
export const absent = error => ['ENOENT', 'ECONNREFUSED'].includes(error?.code);
