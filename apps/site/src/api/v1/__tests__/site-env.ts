/**
 * Import this FIRST in a site-ops test: it points the SQLite singleton and
 * the uploads directory at a throwaway temp dir, and sets the secrets the
 * auth code reads, before any module that reads them is evaluated.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const TEST_DIR = mkdtempSync(join(tmpdir(), "site-ops-test-"));
process.env.SMILE_NOLA_DB_DIR = TEST_DIR;
process.env.ADMIN_PASSWORD = "correct horse battery";
process.env.ADMIN_SESSION_SECRET = "test-secret-at-least-16-chars";
process.env.GOOGLE_PLACES_API_KEY = "TEST_KEY";
process.env.SITE_PUBLIC_URL = "https://test.smilenola.example";
delete process.env.RESEND_API_KEY;
