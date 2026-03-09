import {z} from "zod";

const ProviderModelSchema = z.union([
    z.string().min(1).transform((id) => ({id})),
    z.object({
        id: z.string().min(1),
        contextWindow: z.number().int().positive().optional(),
        maxOutputTokens: z.number().int().positive().optional(),
    }),
]);

export const ProviderSchema = z.object({
    name: z.string().min(1),
    baseUrl: z.string().optional(),
    apiKey: z.string().optional(),
    models: z.array(ProviderModelSchema).min(1),
});

export const RouterSchema = z.record(z.string(), z.string());

export const ConfigSchema = z.object({
    providers: z.array(ProviderSchema).min(1),
    router: RouterSchema,
});
