import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL jest wymagany.'),

  SPOTIFY_CLIENT_ID: z.string().min(1, 'SPOTIFY_CLIENT_ID jest wymagany.'),
  SPOTIFY_CLIENT_SECRET: z.string().min(1, 'SPOTIFY_CLIENT_SECRET jest wymagany.'),
  SPOTIFY_REDIRECT_URI: z.string().url('SPOTIFY_REDIRECT_URI musi być adresem URL.'),
  SPOTIFY_PLAYLIST_ID: z.string().min(1, 'SPOTIFY_PLAYLIST_ID jest wymagany.'),
  SPOTIFY_MARKET: z.string().length(2).default('PL'),

  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET musi mieć co najmniej 16 znaków.'),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(14),

  /** Lista ID Spotify (account_id lub id) uprawnionych do logowania. Pusta = każdy konto Spotify. */
  ADMIN_SPOTIFY_IDS: z.string().default(''),

  PUBLIC_BASE_URL: z.string().url().optional(),
  ALLOWED_ORIGINS: z.string().default(''),
  TRUST_PROXY: bool,
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  console.error(`\n[config] Nieprawidłowe zmienne środowiskowe:\n${details}\n`);
  console.error('Skopiuj .env.example do .env i uzupełnij wartości.\n');
  process.exit(1);
}

const raw = parsed.data;

export const config = {
  env: raw.NODE_ENV,
  isProduction: raw.NODE_ENV === 'production',
  port: raw.PORT,
  host: raw.HOST,
  logLevel: raw.LOG_LEVEL,

  databaseUrl: raw.DATABASE_URL,

  spotify: {
    clientId: raw.SPOTIFY_CLIENT_ID,
    clientSecret: raw.SPOTIFY_CLIENT_SECRET,
    redirectUri: raw.SPOTIFY_REDIRECT_URI,
    playlistId: raw.SPOTIFY_PLAYLIST_ID,
    market: raw.SPOTIFY_MARKET,
    adminAllowlist: raw.ADMIN_SPOTIFY_IDS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },

  session: {
    secret: raw.SESSION_SECRET,
    ttlDays: raw.SESSION_TTL_DAYS,
    cookieName: 'radio_sesja',
  },

  publicBaseUrl: raw.PUBLIC_BASE_URL ?? new URL(raw.SPOTIFY_REDIRECT_URI).origin,
  allowedOrigins: raw.ALLOWED_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  trustProxy: raw.TRUST_PROXY,
} as const;

export type AppConfig = typeof config;
