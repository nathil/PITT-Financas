import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().default('file:./dev.db'),
  WHATSAPP_PROVIDER: z.enum(['baileys', 'evolution']).default('baileys'),
  STRICT_TESTER_ONLY: z
    .string()
    .default('true')
    .transform((val) => val.toLowerCase() !== 'false' && val !== '0'),
  TESTER_PHONES: z.string().default(''),
  ADMIN_API_KEY: z.string().default('pitt-admin-secret'),
  EVOLUTION_API_URL: z.string().default('http://localhost:8080'),
  EVOLUTION_API_KEY: z.string().default(''),
  EVOLUTION_INSTANCE: z.string().default('pitt-ai'),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function getEnv(): EnvConfig {
  return envSchema.parse(process.env);
}
