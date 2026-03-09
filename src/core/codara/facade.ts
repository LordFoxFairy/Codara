import {createCodaraSessionHost} from '@core/codara/session';
import type {Codara, CodaraOptions} from '@core/codara/types';

/** 创建面向 CLI 和产品层的 Codara 入口。 */
export function createCodara(options: CodaraOptions = {}): Codara {
  const sessionHost = createCodaraSessionHost(options);

  return {
    session: sessionHost.session,
    reloadSources: sessionHost.reloadSources,
    invoke: sessionHost.invoke,
    stream: sessionHost.stream,
    resume: sessionHost.resume,
    resumeStream: sessionHost.resumeStream,
    getState: sessionHost.getState,
    reset: sessionHost.reset,
    dispose: sessionHost.dispose,
  };
}
