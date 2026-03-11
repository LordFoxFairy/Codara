import {describe, expect, it} from 'bun:test';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {AIMessage, type BaseMessage} from '@langchain/core/messages';
import {
  createCodaraRuntimePlan,
  resolveCodaraRuntime,
} from '@core/codara';

class StaticModel {
  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    void messages;
    return new AIMessage('ok');
  }

  bindTools(): this {
    return this;
  }
}

describe('Codara runtime assembly', () => {
  it('should keep resolved runtime sources aligned with the runtime plan', async () => {
    const plan = createCodaraRuntimePlan({
      model: new StaticModel() as unknown as BaseChatModel,
    });
    const runtime = await resolveCodaraRuntime({
      model: new StaticModel() as unknown as BaseChatModel,
    });

    expect(runtime.alias).toBe(plan.alias);
    expect(runtime.agentsSource).toBeDefined();
    expect(runtime.skills).toBeDefined();
    expect(runtime.skillsSource).toBeDefined();
    expect(runtime.middleware.map((middleware) => middleware.name)).toEqual(
      plan.middleware.map((middleware) => middleware.name)
    );
    expect(runtime.tools.map((tool) => tool.name)).toEqual(
      plan.tools.map((tool) => tool.name)
    );
  });

  it('should omit skills source and skills middleware when skills are disabled', async () => {
    const runtime = await resolveCodaraRuntime({
      model: new StaticModel() as unknown as BaseChatModel,
      skills: false,
    });

    expect(runtime.skills).toBeUndefined();
    expect(runtime.skillsSource).toBeUndefined();
    expect(runtime.middleware.map((middleware) => middleware.name)).not.toContain('SkillsMiddleware');
  });

  it('should derive input budget from the catalog only when model resolution stays on alias/catalog path', async () => {
    const aliasRuntime = await resolveCodaraRuntime({
      alias: 'default',
    });
    const explicitModelRuntime = await resolveCodaraRuntime({
      model: new StaticModel() as unknown as BaseChatModel,
    });

    expect(aliasRuntime.inputBudget).toBeDefined();
    expect(explicitModelRuntime.inputBudget).toBeUndefined();
  });
});
