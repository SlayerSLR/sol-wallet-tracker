import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';

const BACKEND_SCRIPT = path.join(__dirname, '..', 'server', 'index.js');

export interface BackendHandle {
  port: number;
  process: ChildProcess;
  healthUrl: string;
}

export function spawnBackend(dbPath: string): Promise<BackendHandle> {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [BACKEND_SCRIPT, `--db-path=${dbPath}`], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });

    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error('Backend startup timed out (15s)'));
    }, 15000);

    let stdoutBuf = '';
    proc.stdout!.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
      const lines = stdoutBuf.split('\n');
      stdoutBuf = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.ready && typeof parsed.port === 'number') {
            clearTimeout(timeout);
            resolve({
              port: parsed.port,
              process: proc,
              healthUrl: `http://127.0.0.1:${parsed.port}/health`,
            });
          }
        } catch { /* not JSON, ignore */ }
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to spawn backend: ${err.message}`));
    });

    proc.on('exit', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`Backend exited with code ${code} before ready signal`));
      }
    });
  });
}
