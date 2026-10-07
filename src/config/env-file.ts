// Like Python's load_dotenv(): a missing file is fine, and variables already
// set in the environment win over the file.
export function loadEnvFileIfPresent(path: URL): void {
  try {
    process.loadEnvFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
