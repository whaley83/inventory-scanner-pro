/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SCRIPTS_URL: string;
  readonly VITE_SHEETS_API_KEY: string;
  readonly VITE_GOOGLE_SHEET_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
