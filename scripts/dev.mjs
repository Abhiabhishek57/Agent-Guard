import { createServer } from 'node:http';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
const built = spawnSync(process.execPath, [new URL('build.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')], { stdio: 'inherit' });
if (built.status !== 0) process.exit(1);
await mkdir(new URL('.local/', root), { recursive: true });
const sqlite = new DatabaseSync(new URL('.local/agentguard.sqlite', root));
sqlite.exec('PRAGMA foreign_keys = ON');
if (!sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'requests'").get()) {
  sqlite.exec(await readFile(new URL('drizzle/0000_agentguard.sql', root), 'utf8'));
}
function statement(sql, values = []) {
  return {
    bind(...args) { return statement(sql, args); },
    async all() { return { results: sqlite.prepare(sql).all(...values) }; },
    async first() { return sqlite.prepare(sql).get(...values) || null; },
    async run() { return sqlite.prepare(sql).run(...values); },
  };
}
const DB = {
  prepare: sql => statement(sql),
  async batch(statements) {
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      const results = [];
      for (const item of statements) results.push(await item.all());
      sqlite.exec('COMMIT');
      return results;
    } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  },
};
const port = Number(process.env.PORT || 8787);
const server = createServer(async (incoming, outgoing) => {
  try {
    const file = new URL('dist/server/index.js', root);
    const { default: worker } = await import(file.href + '?v=' + (await stat(file)).mtimeMs);
    const url = 'http://127.0.0.1:' + port + incoming.url;
    const options = { method: incoming.method, headers: incoming.headers };
    if (!['GET', 'HEAD'].includes(incoming.method)) Object.assign(options, { body: incoming, duplex: 'half' });
    const response = await worker.fetch(new Request(url, options), { DB, LOCAL_DEV: 'true' });
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    outgoing.writeHead(500, { 'content-type': 'application/json' });
    outgoing.end(JSON.stringify({ error: 'Local preview could not handle this request.' }));
  }
});
server.listen(port, '127.0.0.1', () => console.log('Local: http://127.0.0.1:' + port));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { sqlite.close(); process.exit(0); }));
