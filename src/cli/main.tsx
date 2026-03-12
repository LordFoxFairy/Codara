import React from 'react';
import {render} from 'ink';
import {createCodaraRuntime, DEFAULT_CODARA_MODEL_ALIAS} from '@core';

const {CodaraCliApp} = await import('./app/shell-app');

const cwd = process.cwd();
const initialPrompt = process.argv.slice(2).join(' ').trim();
const modelAlias = DEFAULT_CODARA_MODEL_ALIAS;
const codara = createCodaraRuntime({cwd});

render(<CodaraCliApp codara={codara} cwd={cwd} modelAlias={modelAlias} initialPrompt={initialPrompt} />);
