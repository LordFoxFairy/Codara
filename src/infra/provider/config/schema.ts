import {z} from "zod";

const ModelIdSchema = z.string().min(1);

const ModelMetadataSchema = z.object({
    contextWindow: z.number().int().positive().optional(),
    maxOutputTokens: z.number().int().positive().optional(),
});

export const ProviderSchema = z.object({
    name: z.string().min(1),
    baseUrl: z.string().optional(),
    apiKey: z.string().optional(),
    models: z.array(ModelIdSchema).min(1),
});

export const RouterSchema = z.record(z.string(), z.string());

export const ConfigSchema = z.object({
    providers: z.array(ProviderSchema).min(1),
    router: RouterSchema,
});

export const ModelMetadataConfigSchema = z.record(ModelIdSchema, ModelMetadataSchema);
