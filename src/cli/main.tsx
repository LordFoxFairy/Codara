import React from 'react';
import {render} from 'ink';
import {ensureCliCodaraPath} from './adapters/bootstrap-config';

ensureCliCodaraPath();

const {CodaraCliApp} = await import('./app/shell-app');

render(<CodaraCliApp />);

