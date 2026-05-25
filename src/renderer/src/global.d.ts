export {};

declare global {
  interface Window {
    constellation?: {
      platform: string;
    };
  }
}
