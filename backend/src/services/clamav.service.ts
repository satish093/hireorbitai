import net from 'node:net';
import { env } from '../config/env';

/**
 * ClamAV virus scanning via clamd's INSTREAM command.
 *
 * Dependency-free on purpose — clamd's wire protocol is tiny and adding an npm
 * client during a security pass would only widen the supply-chain surface.
 *
 * INSTREAM protocol (clamd):
 *   1. send  "zINSTREAM\0"
 *   2. send  N chunks, each = <uint32 big-endian length><bytes>
 *   3. send  <uint32 0>           (terminator)
 *   4. read  "stream: OK"  |  "stream: <Signature> FOUND"  |  "... ERROR"
 *      (clamd appends a trailing NUL byte to the reply)
 *
 * scanBuffer() resolves with the verdict, or REJECTS on any transport problem
 * (connection refused, timeout, malformed reply). The caller decides whether an
 * unreachable scanner should fail-closed (reject the upload) or fail-open.
 */

export interface ScanResult {
  clean: boolean;
  /** Signature name when infected (e.g. "Eicar-Test-Signature"). */
  virus?: string;
}

/** Whether upload scanning is switched on (CLAMAV_ENABLED). */
export function isClamavEnabled(): boolean {
  return env.clamav.enabled;
}

/** Reject the upload when the scanner is enabled but unreachable. */
export function clamavFailClosed(): boolean {
  return env.clamav.failClosed;
}

const CHUNK_SIZE = 64 * 1024;

export function scanBuffer(buffer: Buffer): Promise<ScanResult> {
  const { host, port, timeoutMs } = env.clamav;

  return new Promise<ScanResult>((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let response = '';
    let settled = false;

    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      fn();
    };

    socket.setTimeout(timeoutMs);
    socket.on('timeout', () => finish(() => reject(new Error('clamav scan timed out'))));
    socket.on('error', (err: Error) => finish(() => reject(err)));
    socket.on('data', (chunk: Buffer) => {
      response += chunk.toString('utf8');
    });
    socket.on('end', () =>
      finish(() => {
        // Match OK / FOUND as whole words so the trailing NUL byte that clamd
        // appends to its reply doesn't need stripping (NUL forms a word boundary).
        const r = response.trim();
        if (/\bFOUND\b/.test(r)) {
          const m = /:\s*(.+?)\s+FOUND\b/.exec(r);
          return resolve({ clean: false, virus: m ? m[1] : 'unknown' });
        }
        if (/\bOK\b/.test(r)) return resolve({ clean: true });
        return reject(new Error(`unexpected clamav response: ${r || '(empty)'}`));
      }),
    );

    socket.on('connect', () => {
      socket.write('zINSTREAM\0');
      for (let i = 0; i < buffer.length; i += CHUNK_SIZE) {
        const slice = buffer.subarray(i, i + CHUNK_SIZE);
        const size = Buffer.alloc(4);
        size.writeUInt32BE(slice.length, 0);
        socket.write(size);
        socket.write(slice);
      }
      // Zero-length chunk tells clamd the stream is complete.
      socket.write(Buffer.from([0, 0, 0, 0]));
    });
  });
}
