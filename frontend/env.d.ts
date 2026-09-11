// env.d.ts
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      EXPO_PUBLIC_SERVER_URL: string;
    }
  }
}
export {};