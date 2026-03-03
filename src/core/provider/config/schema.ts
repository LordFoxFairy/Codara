import {z} from "zod";

export const ProviderSchema = z.object({
    name: z.string().min(1),
    baseUrl: z.string().optional(),
    apiKey: z.string().optional(),
    models: z.array(z.string().min(1)).min(1),
});

export const RouterSchema = z.record(z.string(), z.string());

export const ConfigSchema = z.object({
    providers: z.array(ProviderSchema).min(1),
    router: RouterSchema,
});
