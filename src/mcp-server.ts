import { createInterface } from 'node:readline';
import { SessionService } from './session-service.js';

interface RpcRequest {
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

function stringParam(params: Record<string, unknown>, key: string, required = true): string | undefined {
  const value = params[key];
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${key} must be a non-empty string`);
  return value;
}

async function dispatch(service: SessionService, method: string, params: Record<string, unknown>): Promise<unknown> {
  if (method === 'capture.start') {
    const outputPath = stringParam(params, 'outputPath', false);
    const visualPolicyPath = stringParam(params, 'visualPolicyPath', false);
    return service.startCapture({ ...(outputPath ? { outputPath } : {}), ...(visualPolicyPath ? { visualPolicyPath } : {}), ...(typeof params.maxRecords === 'number' ? { maxRecords: params.maxRecords } : {}) });
  }
  if (method === 'capture.status') return service.status(stringParam(params, 'jobId')!);
  if (method === 'capture.stop') return service.stopCapture(stringParam(params, 'jobId')!);
  if (method === 'behavior.list') return service.listBehaviors(stringParam(params, 'packagePath')!, { ...(typeof params.kind === 'string' ? { kind: params.kind as never } : {}), ...(typeof params.limit === 'number' ? { limit: params.limit } : {}), ...(typeof params.offset === 'number' ? { offset: params.offset } : {}) });
  if (method === 'behavior.get') return service.getBehavior(stringParam(params, 'packagePath')!, stringParam(params, 'behaviorId')!);
  if (method === 'evidence.get') return service.getEvidence(stringParam(params, 'packagePath')!, params as never);
  if (method === 'probe.run') return service.runProbe(typeof params.packagePath === 'string' ? params.packagePath : 'artifacts/phase1/latest');
  if (method === 'replica.verify') return service.verifyReplica(stringParam(params, 'packagePath')!);
  if (method === 'capture.export') return service.exportCapture(stringParam(params, 'sourcePath')!, stringParam(params, 'destinationPath')!);
  throw new Error(`Unknown MCP method: ${method}`);
}

const service = new SessionService();
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  if (!line.trim()) continue;
  let request: RpcRequest;
  try { request = JSON.parse(line) as RpcRequest; }
  catch (error) { process.stdout.write(`${JSON.stringify({ id: null, error: { message: `invalid_json: ${(error as Error).message}` } })}\n`); continue; }
  try {
    if (typeof request.method !== 'string') throw new Error('method is required');
    const result = await dispatch(service, request.method, request.params ?? {});
    process.stdout.write(`${JSON.stringify({ id: request.id ?? null, result })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ id: request.id ?? null, error: { message: error instanceof Error ? error.message : String(error) } })}\n`);
  }
}
