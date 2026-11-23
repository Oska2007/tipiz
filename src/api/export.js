import { zipSync } from 'fflate';
import { requireAdmin } from '../middleware/auth.js';
import { fail } from '../lib/response.js';

const TABLE_PAGE_SIZE = 500;
const SUBTITLE_PREFIX = 'subtitles/';

function quoteIdentifier(identifier) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function sqlLiteral(value) {
  if (value === null) return 'NULL';
  if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof ArrayBuffer) {
    return `X'${Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, '0')).join('')}'`;
  }
  if (ArrayBuffer.isView(value)) {
    return `X'${Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength), (byte) => byte.toString(16).padStart(2, '0')).join('')}'`;
  }
  throw new Error(`Unsupported database value type: ${typeof value}`);
}

function orderTablesByForeignKeys(tableNames, dependencies) {
  const ordered = [];
  const visiting = new Set();
  const visited = new Set();

  function visit(tableName) {
    if (visited.has(tableName)) return;
    if (visiting.has(tableName)) {
      throw new Error(`Circular foreign-key dependency involving "${tableName}"`);
    }

    visiting.add(tableName);
    for (const dependency of dependencies.get(tableName) || []) {
      visit(dependency);
    }
    visiting.delete(tableName);
    visited.add(tableName);
    ordered.push(tableName);
  }

  for (const tableName of tableNames) visit(tableName);
  return ordered;
}

function downloadResponse(body, contentType, filename) {
  return new Response(body, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

// GET /api/admin/export/database
export async function databaseBackup(request, env) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  let operation = 'reading database schema';
  try {
    const schemaResult = await env.DB.prepare(
      `SELECT type, name, tbl_name, sql FROM sqlite_master
       WHERE sql IS NOT NULL
         AND name NOT LIKE 'sqlite_%'
         AND substr(name, 1, 4) != '_cf_'
       ORDER BY name`
    ).all();
    const schema = (schemaResult.results || []).filter(
      (entry) => !entry.name.startsWith('_cf_') && !entry.name.startsWith('sqlite_')
    );
    const tableEntries = schema.filter((entry) => entry.type === 'table');
    const tableNames = tableEntries.map((table) => table.name);
    const tableNameSet = new Set(tableNames);
    const dependencies = new Map();

    for (const tableName of tableNames) {
      operation = `reading foreign keys for table "${tableName}"`;
      const result = await env.DB.prepare(
        `PRAGMA foreign_key_list(${quoteIdentifier(tableName)})`
      ).all();
      dependencies.set(
        tableName,
        new Set(
          (result.results || [])
            .map((foreignKey) => foreignKey.table)
            .filter((name) => tableNameSet.has(name))
        )
      );
    }

    const orderedTableNames = orderTablesByForeignKeys(tableNames, dependencies);
    const lines = [
      '-- TIPIZ D1 database backup',
      `-- Exported at ${new Date().toISOString()}`,
      '-- Restore into an empty D1 database using: wrangler d1 execute <database-name> --remote --file=tipiz-database-backup.sql',
      '',
    ];

    for (const table of tableEntries) {
      lines.push(table.sql.trim().replace(/;?$/, ';'), '');
    }

    let hasAutoincrement = false;
    for (const table of tableEntries) {
      if (/\bAUTOINCREMENT\b/i.test(table.sql)) {
        hasAutoincrement = true;
        break;
      }
    }
    let sequences = [];
    if (hasAutoincrement) {
      operation = 'exporting AUTOINCREMENT counters';
      const result = await env.DB.prepare('SELECT name, seq FROM sqlite_sequence').all();
      sequences = (result.results || []).filter((sequence) =>
        tableNameSet.has(sequence.name)
      );
    }

    for (const tableName of orderedTableNames) {
      operation = `exporting table "${tableName}"`;
      const quotedName = quoteIdentifier(tableName);
      let offset = 0;

      while (true) {
        const result = await env.DB.prepare(
          `SELECT * FROM ${quotedName} LIMIT ? OFFSET ?`
        ).bind(TABLE_PAGE_SIZE, offset).all();
        const page = result.results || [];
        for (const row of page) {
          const columns = Object.keys(row);
          lines.push(
            `INSERT INTO ${quotedName} (${columns.map(quoteIdentifier).join(', ')}) VALUES (${columns
              .map((column) => sqlLiteral(row[column]))
              .join(', ')});`
          );
        }
        if (page.length < TABLE_PAGE_SIZE) break;
        offset += page.length;
      }
    }

    for (const sequence of sequences) {
      lines.push(
        `DELETE FROM sqlite_sequence WHERE name = ${sqlLiteral(sequence.name)};`,
        `INSERT INTO sqlite_sequence (name, seq) VALUES (${sqlLiteral(sequence.name)}, ${sqlLiteral(sequence.seq)});`
      );
    }

    const objectTypeOrder = { index: 0, view: 1, trigger: 2 };
    const schemaObjects = schema
      .filter((entry) => entry.type !== 'table')
      .sort((a, b) => (objectTypeOrder[a.type] ?? 3) - (objectTypeOrder[b.type] ?? 3));
    for (const entry of schemaObjects) {
      lines.push(entry.sql.trim().replace(/;?$/, ';'), '');
    }

    operation = 'serializing the SQL backup';
    return downloadResponse(
      `${lines.join('\n')}\n`,
      'application/sql; charset=utf-8',
      'tipiz-database-backup.sql'
    );
  } catch (error) {
    console.error(`Database backup failed while ${operation}:`, error);
    return fail(`Database backup failed while ${operation}: ${error.message}`, 500);
  }
}

// GET /api/admin/export/subtitles
export async function subtitleArchive(request, env) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  const files = Object.create(null);
  let cursor;

  do {
    const listed = await env.R2.list({
      prefix: SUBTITLE_PREFIX,
      limit: 1000,
      ...(cursor ? { cursor } : {}),
    });

    for (const listedObject of listed.objects) {
      if (!/\.vtt$/i.test(listedObject.key)) continue;

      const relativePath = listedObject.key
        .slice(SUBTITLE_PREFIX.length)
        .replace(/\\/g, '/');
      const pathParts = relativePath.split('/');
      if (
        !relativePath ||
        relativePath.startsWith('/') ||
        pathParts.some((part) => part === '.' || part === '..' || part.includes(':'))
      ) {
        continue;
      }

      const object = await env.R2.get(listedObject.key);
      if (!object) throw new Error(`Subtitle object disappeared during export: ${listedObject.key}`);
      files[relativePath] = new Uint8Array(await object.arrayBuffer());
    }

    cursor = listed.truncated ? listed.cursor : null;
  } while (cursor);

  const archive = zipSync(files, { level: 6 });
  return downloadResponse(
    archive,
    'application/zip',
    'tipiz-subtitles.zip'
  );
}
