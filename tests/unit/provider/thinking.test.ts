import {describe, expect, it} from 'bun:test';
import {resolveThinkingConfig} from '@models/factory';
import type {ThinkingConfig} from '@models/model';
import {ModelRegistry} from '@models/registry';
import type {ModelRoutingConfig} from '@models/model';

describe('resolveThinkingConfig', () => {
    it('returns undefined when no thinking and no effort level', () => {
        expect(resolveThinkingConfig(undefined, undefined)).toBeUndefined();
    });

    it('returns explicit thinking config when provided', () => {
        const thinking: ThinkingConfig = {type: 'enabled', budgetTokens: 5000};
        expect(resolveThinkingConfig(thinking, undefined)).toEqual(thinking);
    });

    it('explicit thinking takes priority over effort level', () => {
        const thinking: ThinkingConfig = {type: 'disabled'};
        expect(resolveThinkingConfig(thinking, 'high')).toEqual(thinking);
    });

    it('maps effort level "low" to budget 2000', () => {
        const result = resolveThinkingConfig(undefined, 'low');
        expect(result).toEqual({type: 'enabled', budgetTokens: 2_000});
    });

    it('maps effort level "medium" to budget 10000', () => {
        const result = resolveThinkingConfig(undefined, 'medium');
        expect(result).toEqual({type: 'enabled', budgetTokens: 10_000});
    });

    it('maps effort level "high" to budget 30000', () => {
        const result = resolveThinkingConfig(undefined, 'high');
        expect(result).toEqual({type: 'enabled', budgetTokens: 30_000});
    });
});

describe('ModelRegistry thinking passthrough', () => {
    function makeConfig(metadata: Record<string, unknown> = {}): ModelRoutingConfig {
        return {
            providers: [
                {
                    name: 'anthropic',
                    apiKey: '$ANTHROPIC_API_KEY',
                    models: ['claude-sonnet-4-20250514'],
                },
            ],
            routerRules: [
                {
                    alias: 'sonnet',
                    provider: 'anthropic',
                    model: 'claude-sonnet-4-20250514',
                    target: 'anthropic:claude-sonnet-4-20250514',
                },
            ],
            modelMetadata: {
                'claude-sonnet-4-20250514': metadata,
            },
        };
    }

    it('passes thinking config through to ModelInfo', () => {
        const thinking: ThinkingConfig = {type: 'enabled', budgetTokens: 8000};
        const registry = new ModelRegistry(makeConfig({thinking}));
        const info = registry.getByAlias('sonnet');
        expect(info.thinking).toEqual(thinking);
    });

    it('passes effortLevel through to ModelInfo', () => {
        const registry = new ModelRegistry(makeConfig({effortLevel: 'high'}));
        const info = registry.getByAlias('sonnet');
        expect(info.effortLevel).toBe('high');
    });

    it('omits thinking when not configured', () => {
        const registry = new ModelRegistry(makeConfig());
        const info = registry.getByAlias('sonnet');
        expect(info.thinking).toBeUndefined();
        expect(info.effortLevel).toBeUndefined();
    });
});
