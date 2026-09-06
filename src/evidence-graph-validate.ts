import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import type { ErrorObject } from 'ajv';
import type { EvidenceGraph } from './evidence-graph.js';
import { evidenceGraphSchemaPath } from './paths.js';

const require = createRequire(import.meta.url);
const Ajv2020 = require('ajv/dist/2020').default as new (options: object) => {
  compile(schema: object): ((value: unknown) => boolean) & { errors?: ErrorObject[] | null };
};
const addFormats = require('ajv-formats').default as (ajv: object) => void;

type GraphValidator = ((value: unknown) => boolean) & { errors?: ErrorObject[] | null };
let validatorPromise: Promise<GraphValidator> | undefined;

async function getValidator(): Promise<GraphValidator> {
  if (!validatorPromise) {
    validatorPromise = readFile(evidenceGraphSchemaPath, 'utf8').then((contents) => {
      const ajv = new Ajv2020({ allErrors: true, strict: true });
      addFormats(ajv);
      return ajv.compile(JSON.parse(contents) as object) as GraphValidator;
    });
  }
  return validatorPromise;
}

export async function validateEvidenceGraph(value: unknown): Promise<EvidenceGraph> {
  const validate = await getValidator();
  if (!validate(value)) {
    const message = validate.errors?.map((error: ErrorObject) => `${error.instancePath || '/'} ${error.message}`).join('; ');
    throw new Error(`Evidence graph schema validation failed: ${message}`);
  }
  const graph = value as EvidenceGraph;
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) throw new Error(`Evidence graph edge references a missing node: ${edge.id}`);
  }
  return graph;
}
