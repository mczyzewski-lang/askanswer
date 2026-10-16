import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const PORT = 3100;
const fixtures = path.resolve("tests/fixtures/generated");
const testEnv = {
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://askby:askby@localhost:5432/askby_test?schema=public",
  APP_URL: `http://localhost:${PORT}`,
  APP_SECRET: "e2e-test-secret-0123456789-0123456789-abcdef",
  ADMIN_EMAIL: "admin@askby.local",
  ADMIN_PASSWORD: "askby-admin",
  STORAGE_DRIVER: "local",
  STORAGE_LOCAL_DIR: "./storage-test",
  // tests talk to the local ElevenLabs mock (tests/mock/elevenlabs-mock.ts), never the real API
  ELEVENLABS_API_KEY: "mock-key",
  ELEVENLABS_BASE_URL: "http://127.0.0.1:4010",
  ELEVENLABS_VOICE_ID: "mock-voice-pl",
  // Higgsfield text-to-video is mocked by the same server (tests/mock/elevenlabs-mock.ts → /hf/*)
  HIGGSFIELD_CREDENTIALS: "mock-key-id:mock-key-secret",
  HIGGSFIELD_BASE_URL: "http://127.0.0.1:4010/hf",
  ANTHROPIC_API_KEY: "",
  OPENAI_API_KEY: "sk-mock-openai-key-0123456789",
  OPENAI_BASE_URL: "http://127.0.0.1:4010/oai/v1",
  NEXT_TELEMETRY_DISABLED: "1",
};
Object.assign(process.env, testEnv);

const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? (process.env.PLAYWRIGHT_BROWSERS_PATH ? "/opt/pw-browsers/chromium" : undefined);
const mediaArgs = [
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
  `--use-file-for-fake-video-capture=${fixtures}/fake-camera.y4m`,
  `--use-file-for-fake-audio-capture=${fixtures}/fake-mic.wav`,
  "--autoplay-policy=user-gesture-required",
];

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 240_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    launchOptions: { executablePath: chromiumPath, args: mediaArgs },
    permissions: ["camera", "microphone"],
  },
  projects: [
    { name: "mobile", testMatch: /record.*\.spec\.ts/, use: { ...devices["Pixel 7"], launchOptions: { executablePath: chromiumPath, args: mediaArgs } } },
    { name: "desktop", testMatch: /^(?!.*record).*\.spec\.ts$/, use: { viewport: { width: 1440, height: 900 } } },
  ],
  webServer: [
    { command: "npx tsx tests/mock/elevenlabs-mock.ts", port: 4010, reuseExistingServer: false, env: testEnv },
    { command: `npx next dev -p ${PORT}`, port: PORT, reuseExistingServer: false, timeout: 180_000, env: testEnv },
    { command: "npx tsx src/worker/index.ts", reuseExistingServer: false, env: testEnv, wait: { stdout: /started/ } },
  ],
});
