import {StructuredTool} from '@langchain/core/tools';
import {z} from 'zod';
import {createCodaraMemory} from '@core/codara/memory';
import type {CreateCodaraAgentOptions} from '@core/codara/types';

const rememberMemoryInputSchema = z.object({
  content: z.string().min(1).describe('要沉淀到 MEMORY.md 的长期稳定内容。'),
  kind: z.enum(['preference', 'fact', 'lesson']).default('lesson').describe('记忆条目的类型。'),
  scope: z.enum(['project', 'global']).default('project').describe('写入项目级还是全局级 MEMORY.md。'),
});

type RememberMemoryInput = z.infer<typeof rememberMemoryInputSchema>;

/** 将长期稳定信息写入 MEMORY.md。 */
export class RememberMemoryTool extends StructuredTool<typeof rememberMemoryInputSchema> {
  name = 'remember_memory';
  description = `Writes a durable memory entry into MEMORY.md.
Use when: a fact, preference, or lesson should be reused in future sessions.
Don't use when: the information is temporary, task-local, or only relevant to the current run.
Returns: whether memory content changed and where it was written.`;
  schema = rememberMemoryInputSchema;

  constructor(private readonly options: Pick<CreateCodaraAgentOptions, 'cwd' | 'memory'> = {}) {
    super();
  }

  async _call(input: RememberMemoryInput): Promise<string> {
    const result = await createCodaraMemory(this.options).remember(input.scope, {
      kind: input.kind,
      content: input.content,
    });

    if (!result.changed) {
      return `Memory unchanged: ${result.path}`;
    }

    return `Memory updated: ${result.path}`;
  }
}

/** 创建 remember_memory 工具。 */
export function createRememberMemoryTool(
  options: Pick<CreateCodaraAgentOptions, 'cwd' | 'memory'> = {}
): RememberMemoryTool {
  return new RememberMemoryTool(options);
}
