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
    const resumePackagePath = stringParam(params, 'resumePackagePath', false);
    const resumedFromSessionId = stringParam(params, 'resumedFromSessionId', false);
    const resumeCheckpoint = stringParam(params, 'resumeCheckpoint', false);
    return service.startCapture({ ...(outputPath ? { outputPath } : {}), ...(visualPolicyPath ? { visualPolicyPath } : {}), ...(resumePackagePath ? { resumePackagePath } : {}), ...(resumedFromSessionId ? { resumedFromSessionId } : {}), ...(resumeCheckpoint ? { resumeCheckpoint } : {}), ...(typeof params.maxRecords === 'number' ? { maxRecords: params.maxRecords } : {}) });
  }
  if (method === 'capture.status') return service.status(stringParam(params, 'jobId')!);
  if (method === 'capture.stop') return service.stopCapture(stringParam(params, 'jobId')!);
  if (method === 'behavior.list') return service.listBehaviors(stringParam(params, 'packagePath')!, { ...(typeof params.kind === 'string' ? { kind: params.kind as never } : {}), ...(typeof params.limit === 'number' ? { limit: params.limit } : {}), ...(typeof params.offset === 'number' ? { offset: params.offset } : {}), ...(typeof params.revisionId === 'string' ? { revisionId: params.revisionId } : {}) });
  if (method === 'behavior.get') return service.getBehavior(stringParam(params, 'packagePath')!, stringParam(params, 'behaviorId')!, typeof params.revisionId === 'string' ? params.revisionId : undefined);
  if (method === 'evidence.get') return service.getEvidence(stringParam(params, 'packagePath')!, params as never);
  if (method === 'revision.list') return service.listRevisions(stringParam(params, 'packagePath')!);
  if (method === 'evidence.graph.get') return service.getEvidenceGraph(stringParam(params, 'packagePath')!, typeof params.revisionId === 'string' ? params.revisionId : undefined);
  if (method === 'probe.run') return service.runProbe(typeof params.packagePath === 'string' ? params.packagePath : 'artifacts/phase1/latest', {
    ...(typeof params.baseRevisionId === 'string' ? { baseRevisionId: params.baseRevisionId } : {}),
    ...(typeof params.resetRecipeId === 'string' ? { resetRecipeId: params.resetRecipeId } : {}),
    ...(typeof params.controlRun === 'boolean' ? { controlRun: params.controlRun } : {}),
    ...(Array.isArray(params.timingOffsetsMs) ? { timingOffsetsMs: params.timingOffsetsMs.filter((value): value is number => typeof value === 'number') } : {}),
    ...(Array.isArray(params.directions) ? { directions: params.directions.filter((value): value is 'forward' | 'reverse' => value === 'forward' || value === 'reverse') } : {}),
    ...(Array.isArray(params.interruptionAtMs) ? { interruptionAtMs: params.interruptionAtMs.filter((value): value is number => typeof value === 'number') } : {}),
    ...(Array.isArray(params.viewports) ? { viewports: params.viewports.filter((value): value is { width: number; height: number } => typeof value === 'object' && value !== null && typeof (value as { width?: unknown }).width === 'number' && typeof (value as { height?: unknown }).height === 'number') } : {}),
    ...(typeof params.maxRuns === 'number' ? { maxRuns: params.maxRuns } : {}),
    ...(typeof params.timeoutMs === 'number' ? { timeoutMs: params.timeoutMs } : {}),
    ...(Array.isArray(params.behaviorIds) ? { behaviorIds: params.behaviorIds.filter((value): value is string => typeof value === 'string') } : {}),
  });
  if (method === 'annotation.create') return service.createAnnotation(stringParam(params, 'packagePath')!, { note: stringParam(params, 'note')!, ...(typeof params.targetRef === 'string' ? { targetRef: params.targetRef } : {}), ...(Array.isArray(params.evidenceRefs) ? { evidenceRefs: params.evidenceRefs.filter((value): value is string => typeof value === 'string') } : {}), ...(typeof params.edgeCorrection === 'object' && params.edgeCorrection !== null ? { edgeCorrection: { edgeId: String((params.edgeCorrection as { edgeId?: unknown }).edgeId ?? ''), ...(['direct', 'experiment_supported', 'correlated', 'unknown'].includes(String((params.edgeCorrection as { class?: unknown }).class)) ? { class: (params.edgeCorrection as { class: 'direct' | 'experiment_supported' | 'correlated' | 'unknown' }).class } : {}), ...(typeof (params.edgeCorrection as { limitation?: unknown }).limitation === 'string' ? { limitation: (params.edgeCorrection as { limitation: string }).limitation } : {}) } } : {}) });
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
