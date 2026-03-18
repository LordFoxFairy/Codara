import type {Codara, CodaraRuntimeOptions} from '../types';
import {createCodaraRuntime} from '../facade';

export async function createCliCodaraRuntime(
  options: CodaraRuntimeOptions = {},
): Promise<Codara> {
  return createCodaraRuntime(options);
}
