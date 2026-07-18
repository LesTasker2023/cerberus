/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase project URL (clan sync). Empty → sync disabled. */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase anon key — public by design; security is enforced by RLS. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
