import { z } from 'zod';
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info';
const state = z.object({ enabled: z.boolean(), phase: z.enum(['off', 'starting', 'on', 'stopping', 'error']), revision: z.number().int(),
  pid: z.number().int().nullable(), memoryMB: z.number(), active: z.number(), configured: z.boolean(), error: z.string(), port: z.number().int() });
const codec = (schema, name) => ({ mode: 'strict', typeSymbol: `@local/superagent-power#${name}`, create: () => schema, jsonSchema: z.toJSONSchema(schema) });
const definition = (schema, name) => ({ service: 'superagentPower', invocation: { kind: 'direct' },
  parameters: [{ name: 'request', source: 'json', codec: codec(schema, name), strictCodec: codec(schema.strict(), name) }], result: codec(state, 'State') });
export const TYPERT_REMOTE = createTypertRemoteInfo({ package: '@local/superagent-power', methods: {
  'superagentPower/get': definition(z.object({}), 'Get'),
  'superagentPower/set': definition(z.object({ enabled: z.boolean(), revision: z.number().int(), allowBusy: z.boolean().optional() }), 'Set'),
} }, z);
