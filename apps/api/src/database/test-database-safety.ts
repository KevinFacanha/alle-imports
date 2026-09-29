const PROTECTED_DATABASE_MODE = 'test';
const TEST_DATABASE_OPT_IN = 'true';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const TEST_DATABASE_NAME_PATTERN = /(^|[-_])test($|[-_])/i;

type DatabaseEnvironment = Record<string, string | undefined>;

export function assertSafeTestDatabaseEnvironment(
  environment: DatabaseEnvironment = process.env,
): void {
  if (!isProtectedDatabaseMode(environment)) {
    return;
  }

  if (environment.ALLOW_DISPOSABLE_TEST_DATABASE !== TEST_DATABASE_OPT_IN) {
    throw new Error(
      'Database access in test mode requires ALLOW_DISPOSABLE_TEST_DATABASE=true.',
    );
  }

  assertDisposableDatabaseUrl('DATABASE_URL', environment.DATABASE_URL);
  assertDisposableDatabaseUrl('DIRECT_URL', environment.DIRECT_URL);
}

function isProtectedDatabaseMode(environment: DatabaseEnvironment): boolean {
  return (
    environment.NODE_ENV === PROTECTED_DATABASE_MODE ||
    environment.DATABASE_SAFETY_MODE === PROTECTED_DATABASE_MODE
  );
}

function assertDisposableDatabaseUrl(
  variableName: 'DATABASE_URL' | 'DIRECT_URL',
  value: string | undefined,
): void {
  if (!value) {
    throw new Error(`${variableName} is required in test database mode.`);
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${variableName} must be a valid PostgreSQL URL.`);
  }

  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw new Error(`${variableName} must use the PostgreSQL protocol.`);
  }

  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error(
      `${variableName} must target a loopback host in test database mode.`,
    );
  }

  if (!url.port) {
    throw new Error(
      `${variableName} must declare an explicit isolated port in test database mode.`,
    );
  }

  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (!TEST_DATABASE_NAME_PATTERN.test(databaseName)) {
    throw new Error(
      `${variableName} must target a database whose name is explicitly marked as test.`,
    );
  }
}
