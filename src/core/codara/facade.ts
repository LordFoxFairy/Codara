import {createCodaraMemory} from '@core/codara/memory';
import {createCodaraSessionHost} from '@core/codara/session';
import type {Codara, CreateCodaraOptions} from '@core/codara/types';

/** 创建面向 CLI 和产品层的 Codara 入口。 */
export function createCodara(options: CreateCodaraOptions = {}): Codara {
  const sessionHost = createCodaraSessionHost(options);
  const memory = createCodaraMemory(options);

  return {
    session: sessionHost.session,
    memory() {
      return memory;
    },
    invoke: sessionHost.invoke,
    stream: sessionHost.stream,
    resume: sessionHost.resume,
    resumeStream: sessionHost.resumeStream,
    getState: sessionHost.getState,
    reset: sessionHost.reset,
    dispose: sessionHost.dispose,
  };
}
