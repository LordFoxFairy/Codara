import type {Codara, CodaraRuntimeOptions} from '../types';
import {createCodaraRuntime} from '../facade';

export async function createDesktopCodaraRuntime(
  options: CodaraRuntimeOptions = {},
): Promise<Codara> {
  return createCodaraRuntime(options);
}
