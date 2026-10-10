/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_TITLE: string;
  readonly VITE_APP_ENV: string;
  readonly VITE_APP_BASE_API: string;
  readonly VITE_APP_HTTP_SERVICE_URL: string;
  readonly VITE_APP_WS_SERVICE_URL: string;
  readonly VITE_APP_MAP_SERVICE_URL: string;
  readonly VITE_BUILD_COMPRESS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
