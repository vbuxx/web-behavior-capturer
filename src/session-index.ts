import { createHash } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { BehaviorKind, ContractPackage, EvidenceRecord, SessionIndexManifest } from './types.js';
import { validateContract, validateSessionIndexManifest } from './validate.js';
import { validateEvidenceGraph } from './evidence-graph-validate.js';

export interface SessionInspection {
  sessionId: string;
  contractSchemaVersion: string;
  productVersion: string;
  integrity: 'verified';
  counts: SessionIndexManifest['counts'];
  behaviors: Array<{ behaviorId: string; kind: string; targetRef: string }>;
  targets: Array<{
    targetId: string;
    navigationId: string;
    kind: string;
    lifecycleStatus: string;
    completeness: string;
  }>;
}

export interface SessionRecordQuery {
  sourceTargetId?: string;
  type?: string;
  targetRef?: string;
  fromSourceTime?: number;
  toSourceTime?: number;
  limit?: number;
  byteBudget?: number;
  cursor?: string;
}

export interface SessionRecordPage {
  revision: string;
  records: Array<{
    recordId: string;
    source: string;
    type: string;
    targetRef: string | null;
    sourceTargetId: string | null;
    sourceTime: number;
    receiveTime: number;
    payload: Record<string, unknown>;
  }>;
  returnedBytes: number;
  nextCursor: string | null;
  truncatedBy: 'records' | 'bytes' | null;
}

async function sha256(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

function resolveInside(packageDirectory: string, candidate: string): string {
  if (isAbsolute(candidate)) throw new Error(`Index path must be relative: ${candidate}`);
  const packageRoot = resolve(packageDirectory);
  const resolved = resolve(packageRoot, candidate);
  if (resolved !== packageRoot && !resolved.startsWith(`${packageRoot}${sep}`)) {
    throw new Error(`Index path escapes package: ${candidate}`);
  }
  return resolved;
}

function readCount(database: DatabaseSync, table: string): number {
  const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
  return Number(row.count);
}

export async function buildSessionIndex(
  packageDirectory: string,
  contractPath: string,
  contract: ContractPackage,
  records: EvidenceRecord[],
  evidenceGraphPath?: string,
): Promise<{ databasePath: string; manifestPath: string; manifest: SessionIndexManifest }> {
  const databasePath = resolve(packageDirectory, 'session.sqlite');
  const manifestPath = resolve(packageDirectory, 'session-index.json');
  await rm(databasePath, { force: true });
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE targets (
        target_id TEXT PRIMARY KEY,
        navigation_id TEXT NOT NULL UNIQUE,
        parent_target_id TEXT,
        kind TEXT NOT NULL,
        lifecycle_status TEXT NOT NULL,
        completeness TEXT NOT NULL,
        url TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE TABLE behaviors (
        behavior_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        target_ref TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE TABLE elements (
        element_id TEXT PRIMARY KEY,
        target_id TEXT NOT NULL,
        navigation_id TEXT NOT NULL,
        data_wbc_id TEXT NOT NULL,
        ambiguity_status TEXT NOT NULL,
        preferred_strategy TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        FOREIGN KEY (target_id) REFERENCES targets(target_id)
      );
      CREATE TABLE evidence (
        evidence_id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        media_type TEXT NOT NULL,
        sha256 TEXT NOT NULL
      );
      CREATE TABLE records (
        record_id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        type TEXT NOT NULL,
        target_ref TEXT,
        source_target_id TEXT,
        source_time REAL NOT NULL,
        receive_time REAL NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX records_type_idx ON records(type);
      CREATE INDEX records_target_idx ON records(target_ref);
      CREATE INDEX behaviors_kind_idx ON behaviors(kind);
      CREATE INDEX elements_target_idx ON elements(target_id);
      CREATE INDEX targets_navigation_idx ON targets(navigation_id);
    `);

    const insertMeta = database.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
    const insertTarget = database.prepare(`
      INSERT INTO targets (target_id, navigation_id, parent_target_id, kind, lifecycle_status, completeness, url, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertBehavior = database.prepare('INSERT INTO behaviors (behavior_id, kind, target_ref, payload_json) VALUES (?, ?, ?, ?)');
    const insertElement = database.prepare(`
      INSERT INTO elements (element_id, target_id, navigation_id, data_wbc_id, ambiguity_status, preferred_strategy, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertEvidence = database.prepare('INSERT INTO evidence (evidence_id, path, media_type, sha256) VALUES (?, ?, ?, ?)');
    const insertRecord = database.prepare(`
      INSERT INTO records (record_id, source, type, target_ref, source_target_id, source_time, receive_time, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    database.exec('BEGIN IMMEDIATE');
    try {
      insertMeta.run('sessionId', contract.manifest.sessionId);
      insertMeta.run('contractSchemaVersion', contract.schemaVersion);
      insertMeta.run('productVersion', contract.manifest.productVersion);
      for (const target of contract.manifest.targetCoverage) {
        insertTarget.run(
          target.targetId,
          target.navigationId,
          target.parentTargetId,
          target.kind,
          target.lifecycleStatus,
          target.completeness,
          target.url,
          JSON.stringify(target),
        );
      }
      for (const behavior of contract.behaviors) {
        insertBehavior.run(behavior.behaviorId, behavior.kind, behavior.targetRef, JSON.stringify(behavior));
      }
      for (const element of contract.elements) {
        insertElement.run(
          element.id,
          element.targetId,
          element.navigationId,
          element.dataWbcId,
          element.ambiguity.status,
          element.ambiguity.preferredStrategy,
          JSON.stringify(element),
        );
      }
      for (const evidence of contract.evidenceIndex) {
        insertEvidence.run(evidence.id, evidence.path, evidence.mediaType, evidence.sha256);
      }
      for (const record of records) {
        const sourceTargetId = typeof record.payload.sourceTargetId === 'string' ? record.payload.sourceTargetId : null;
        insertRecord.run(
          record.id,
          record.source,
          record.type,
          record.targetRef ?? null,
          sourceTargetId,
          record.sourceTime,
          record.receiveTime,
          JSON.stringify(record.payload),
        );
      }
      database.exec('COMMIT');
    } catch (error) {
      try {
        database.exec('ROLLBACK');
      } catch {
        // A quota or I/O failure can terminate the transaction before rollback.
      }
      throw error;
    }
  } finally {
    database.close();
  }

  const manifest: SessionIndexManifest = {
    schemaVersion: '1.1.0',
    generatedAt: new Date().toISOString(),
    database: { path: relative(packageDirectory, databasePath), sha256: await sha256(databasePath) },
    contract: { path: relative(packageDirectory, contractPath), sha256: await sha256(contractPath) },
    ...(evidenceGraphPath ? { evidenceGraph: { path: relative(packageDirectory, evidenceGraphPath), sha256: await sha256(evidenceGraphPath) } } : {}),
    counts: {
      targets: contract.manifest.targetCoverage.length,
      elements: contract.elements.length,
      behaviors: contract.behaviors.length,
      evidence: contract.evidenceIndex.length,
      records: records.length,
    },
  };
  await validateSessionIndexManifest(manifest);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { databasePath, manifestPath, manifest };
}

export async function inspectSessionPackage(packageDirectory: string): Promise<SessionInspection> {
  const packageRoot = resolve(packageDirectory);
  const manifest = await validateSessionIndexManifest(JSON.parse(await readFile(resolve(packageRoot, 'session-index.json'), 'utf8')));
  const databasePath = resolveInside(packageRoot, manifest.database.path);
  const contractPath = resolveInside(packageRoot, manifest.contract.path);
  if (await sha256(databasePath) !== manifest.database.sha256) throw new Error('Session index checksum mismatch');
  if (await sha256(contractPath) !== manifest.contract.sha256) throw new Error('Behavior Contract checksum mismatch');
  const contract = await validateContract(JSON.parse(await readFile(contractPath, 'utf8')));
  if (manifest.evidenceGraph) {
    const graphPath = resolveInside(packageRoot, manifest.evidenceGraph.path);
    if (await sha256(graphPath) !== manifest.evidenceGraph.sha256) throw new Error('Evidence graph checksum mismatch');
    const graph = await validateEvidenceGraph(JSON.parse(await readFile(graphPath, 'utf8')));
    if (graph.sessionId !== contract.manifest.sessionId || graph.revision !== contract.manifest.evidenceGraph?.revision) {
      throw new Error('Evidence graph identity does not match Behavior Contract');
    }
    const evidenceIds = new Set(contract.evidenceIndex.map((entry) => entry.id));
    for (const node of graph.nodes) {
      if (node.evidenceRefs.some((ref) => !evidenceIds.has(ref))) throw new Error(`Evidence graph node references missing evidence: ${node.id}`);
    }
    for (const edge of graph.edges) {
      if (edge.evidenceRefs.some((ref) => !evidenceIds.has(ref))) throw new Error(`Evidence graph edge references missing evidence: ${edge.id}`);
    }
  }
  const checkedPaths = new Map<string, string>();
  for (const evidence of contract.evidenceIndex) {
    const existingHash = checkedPaths.get(evidence.path);
    if (existingHash && existingHash !== evidence.sha256) throw new Error(`Conflicting checksum for ${evidence.path}`);
    if (!existingHash) {
      const evidencePath = resolveInside(packageRoot, evidence.path);
      if (await sha256(evidencePath) !== evidence.sha256) throw new Error(`Evidence checksum mismatch for ${evidence.path}`);
      checkedPaths.set(evidence.path, evidence.sha256);
    }
  }

  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const counts = {
      targets: readCount(database, 'targets'),
      elements: readCount(database, 'elements'),
      behaviors: readCount(database, 'behaviors'),
      evidence: readCount(database, 'evidence'),
      records: readCount(database, 'records'),
    };
    if (JSON.stringify(counts) !== JSON.stringify(manifest.counts)) throw new Error('Session index counts do not match manifest');
    if (counts.targets !== contract.manifest.targetCoverage.length
      || counts.elements !== contract.elements.length
      || counts.behaviors !== contract.behaviors.length
      || counts.evidence !== contract.evidenceIndex.length
      || counts.records !== contract.manifest.quality.recordCount) {
      throw new Error('Session index counts do not match Behavior Contract');
    }
    const metaRows = database.prepare('SELECT key, value FROM meta').all() as Array<{ key: string; value: string }>;
    const meta = Object.fromEntries(metaRows.map((row) => [row.key, row.value]));
    if (meta.sessionId !== contract.manifest.sessionId || meta.contractSchemaVersion !== contract.schemaVersion) {
      throw new Error('Session index metadata does not match Behavior Contract');
    }
    const behaviors = database.prepare(
      'SELECT behavior_id AS behaviorId, kind, target_ref AS targetRef FROM behaviors ORDER BY behavior_id',
    ).all() as SessionInspection['behaviors'];
    const targets = database.prepare(`
      SELECT target_id AS targetId, navigation_id AS navigationId, kind,
             lifecycle_status AS lifecycleStatus, completeness
      FROM targets ORDER BY rowid
    `).all() as SessionInspection['targets'];
    return {
      sessionId: contract.manifest.sessionId,
      contractSchemaVersion: contract.schemaVersion,
      productVersion: contract.manifest.productVersion,
      integrity: 'verified',
      counts,
      behaviors,
      targets,
    };
  } finally {
    database.close();
  }
}

export async function querySessionBehaviors(
  packageDirectory: string,
  options: { kind?: BehaviorKind; limit?: number; offset?: number } = {},
): Promise<SessionInspection['behaviors']> {
  await inspectSessionPackage(packageDirectory);
  const manifest = await validateSessionIndexManifest(JSON.parse(await readFile(resolve(packageDirectory, 'session-index.json'), 'utf8')));
  const databasePath = resolveInside(packageDirectory, manifest.database.path);
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const requestedLimit = options.limit ?? 20;
    const requestedOffset = options.offset ?? 0;
    if (!Number.isFinite(requestedLimit) || !Number.isFinite(requestedOffset)) throw new Error('Query limit and offset must be finite numbers');
    const limit = Math.min(100, Math.max(1, Math.floor(requestedLimit)));
    const offset = Math.max(0, Math.floor(requestedOffset));
    if (options.kind) {
      return database.prepare(`
        SELECT behavior_id AS behaviorId, kind, target_ref AS targetRef
        FROM behaviors WHERE kind = ? ORDER BY behavior_id LIMIT ? OFFSET ?
      `).all(options.kind, limit, offset) as SessionInspection['behaviors'];
    }
    return database.prepare(`
      SELECT behavior_id AS behaviorId, kind, target_ref AS targetRef
      FROM behaviors ORDER BY behavior_id LIMIT ? OFFSET ?
    `).all(limit, offset) as SessionInspection['behaviors'];
  } finally {
    database.close();
  }
}

function querySignature(options: SessionRecordQuery): string {
  return JSON.stringify({
    sourceTargetId: options.sourceTargetId ?? null,
    type: options.type ?? null,
    targetRef: options.targetRef ?? null,
    fromSourceTime: options.fromSourceTime ?? null,
    toSourceTime: options.toSourceTime ?? null,
  });
}

function encodeCursor(value: { revision: string; signature: string; offset: number }): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeCursor(value: string): { revision: string; signature: string; offset: number } {
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (typeof decoded.revision !== 'string' || typeof decoded.signature !== 'string'
      || typeof decoded.offset !== 'number' || !Number.isInteger(decoded.offset) || decoded.offset < 0) {
      throw new Error('invalid shape');
    }
    return { revision: decoded.revision, signature: decoded.signature, offset: decoded.offset };
  } catch {
    throw new Error('Invalid evidence query cursor');
  }
}

export async function querySessionRecords(
  packageDirectory: string,
  options: SessionRecordQuery = {},
): Promise<SessionRecordPage> {
  if ((options.fromSourceTime !== undefined && !Number.isFinite(options.fromSourceTime))
    || (options.toSourceTime !== undefined && !Number.isFinite(options.toSourceTime))) {
    throw new Error('Source-time filters must be finite numbers');
  }
  if (options.fromSourceTime !== undefined && options.toSourceTime !== undefined
    && options.fromSourceTime > options.toSourceTime) {
    throw new Error('Source-time range is inverted');
  }
  await inspectSessionPackage(packageDirectory);
  const manifest = await validateSessionIndexManifest(JSON.parse(await readFile(resolve(packageDirectory, 'session-index.json'), 'utf8')));
  const signature = querySignature(options);
  const decodedCursor = options.cursor ? decodeCursor(options.cursor) : undefined;
  if (decodedCursor && decodedCursor.revision !== manifest.database.sha256) throw new Error('Evidence query cursor revision is stale');
  if (decodedCursor && decodedCursor.signature !== signature) throw new Error('Evidence query cursor does not match filters');

  const requestedLimit = options.limit ?? 50;
  const requestedBudget = options.byteBudget ?? 64 * 1024;
  if (!Number.isFinite(requestedLimit) || !Number.isFinite(requestedBudget)) throw new Error('Query limits must be finite numbers');
  const limit = Math.min(100, Math.max(1, Math.floor(requestedLimit)));
  const byteBudget = Math.min(1024 * 1024, Math.max(1, Math.floor(requestedBudget)));
  const offset = decodedCursor?.offset ?? 0;

  const clauses: string[] = [];
  const parameters: Array<string | number> = [];
  if (options.sourceTargetId) { clauses.push('source_target_id = ?'); parameters.push(options.sourceTargetId); }
  if (options.type) { clauses.push('type = ?'); parameters.push(options.type); }
  if (options.targetRef) { clauses.push('target_ref = ?'); parameters.push(options.targetRef); }
  if (options.fromSourceTime !== undefined) { clauses.push('source_time >= ?'); parameters.push(options.fromSourceTime); }
  if (options.toSourceTime !== undefined) { clauses.push('source_time <= ?'); parameters.push(options.toSourceTime); }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  const databasePath = resolveInside(packageDirectory, manifest.database.path);
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const rows = database.prepare(`
      SELECT record_id AS recordId, source, type, target_ref AS targetRef,
             source_target_id AS sourceTargetId, source_time AS sourceTime,
             receive_time AS receiveTime, payload_json AS payloadJson
      FROM records ${where}
      ORDER BY receive_time, record_id
      LIMIT ? OFFSET ?
    `).all(...parameters, limit + 1, offset) as Array<{
      recordId: string;
      source: string;
      type: string;
      targetRef: string | null;
      sourceTargetId: string | null;
      sourceTime: number;
      receiveTime: number;
      payloadJson: string;
    }>;

    const records: SessionRecordPage['records'] = [];
    let returnedBytes = 0;
    let truncatedBy: SessionRecordPage['truncatedBy'] = null;
    for (const row of rows.slice(0, limit)) {
      const record = {
        recordId: row.recordId,
        source: row.source,
        type: row.type,
        targetRef: row.targetRef,
        sourceTargetId: row.sourceTargetId,
        sourceTime: row.sourceTime,
        receiveTime: row.receiveTime,
        payload: JSON.parse(row.payloadJson) as Record<string, unknown>,
      };
      const bytes = Buffer.byteLength(JSON.stringify(record), 'utf8');
      if (returnedBytes + bytes > byteBudget) {
        if (records.length === 0) throw new Error(`First evidence record exceeds byte budget (${bytes} > ${byteBudget})`);
        truncatedBy = 'bytes';
        break;
      }
      records.push(record);
      returnedBytes += bytes;
    }
    if (!truncatedBy && rows.length > records.length) truncatedBy = 'records';
    const nextOffset = offset + records.length;
    return {
      revision: manifest.database.sha256,
      records,
      returnedBytes,
      nextCursor: truncatedBy ? encodeCursor({ revision: manifest.database.sha256, signature, offset: nextOffset }) : null,
      truncatedBy,
    };
  } finally {
    database.close();
  }
}
