import { supabase } from '../core/supabase';
import type { AuthUser } from './auth';

const BACKUP_BUCKET = 'admin-backups';
const PAGE_SIZE = 1000;
const CLEANUP_RETENTION_DAYS = 15;

const BACKUP_TABLES = [
  { name: 'actividades', orderBy: 'id' },
  { name: 'areas', orderBy: 'id' },
  { name: 'auditoria', orderBy: 'id' },
  { name: 'cierres_diarios', orderBy: 'id' },
  { name: 'cierres_mensuales', orderBy: 'id' },
  { name: 'cierres_quincenales', orderBy: 'id' },
  { name: 'pedidos_danados', orderBy: 'id' },
  { name: 'profiles', orderBy: 'id' },
  { name: 'reportes_generados', orderBy: 'id' },
  { name: 'system_settings', orderBy: 'key' },
  { name: 'trello_area_config', orderBy: 'id' },
  { name: 'ultimo_cierre_quincenal', orderBy: 'id' },
  { name: 'user_favorite_trello_lists', orderBy: 'id' },
] as const;

type BackupRow = Record<string, unknown>;
type BackupTables = Record<string, BackupRow[]>;

export type AdminBackupResult = {
  objectPath: string;
  fileName: string;
  totalRecords: number;
  counts: Record<string, number>;
  sha256: string;
  sizeBytes: number;
  downloadedToDevice: boolean;
};

export type AdminCleanupResult = {
  success?: boolean;
  error?: string;
  retention_days?: number;
  cutoff_date?: string;
  deleted?: Record<string, number>;
  total_deleted?: number;
};

export type AdminBackupOptions = {
  downloadToDevice?: boolean;
  reason?: 'admin-login' | 'mandatory-15-days';
};

async function assertSupabaseAdmin(user: AuthUser): Promise<void> {
  if (user.role !== 'admin') {
    throw new Error('Solo administraciÃ³n puede crear respaldos completos.');
  }

  const { data: authData, error: authError } = await supabase.auth.getUser();
  const authenticatedUser = authData.user;
  if (authError || !authenticatedUser || authenticatedUser.id !== user.id) {
    throw new Error('Debes iniciar sesiÃ³n en Supabase antes de crear el respaldo.');
  }
  if (authenticatedUser.app_metadata?.role !== 'admin') {
    throw new Error('Supabase no confirmÃ³ el permiso de administrador.');
  }
}

async function readAllRows(table: string, orderBy: string): Promise<BackupRow[]> {
  const rows: BackupRow[] = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .order(orderBy, { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`No se pudo respaldar ${table}: ${error.message}`);
    }

    const page = (data ?? []) as BackupRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  return rows;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await window.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function sourceOrigin(): string {
  try {
    return new URL(String(import.meta.env.VITE_SUPABASE_URL ?? '')).origin;
  } catch {
    return 'supabase-configurado';
  }
}

function timestampForPath(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

function downloadJsonBackup(fileName: string, contents: string): void {
  const url = window.URL.createObjectURL(
    new Blob([contents], { type: 'application/json' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
}

export async function createAdminBackup(
  user: AuthUser,
  options: AdminBackupOptions = {},
): Promise<AdminBackupResult> {
  if (user.role !== 'admin') {
    throw new Error('Solo administración puede crear respaldos completos.');
  }

  const { data: authData, error: authError } = await supabase.auth.getUser();
  const authenticatedUser = authData.user;
  if (authError || !authenticatedUser || authenticatedUser.id !== user.id) {
    throw new Error('Debes iniciar sesión en Supabase antes de crear el respaldo.');
  }
  if (authenticatedUser.app_metadata?.role !== 'admin') {
    throw new Error('Supabase no confirmó el permiso de administrador.');
  }

  const tableEntries = await Promise.all(
    BACKUP_TABLES.map(async ({ name, orderBy }) => {
      const rows = await readAllRows(name, orderBy);
      return [name, rows] as const;
    }),
  );

  const tables: BackupTables = Object.fromEntries(tableEntries);
  const counts = Object.fromEntries(
    tableEntries.map(([name, rows]) => [name, rows.length]),
  );
  const totalRecords = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const dataSha256 = await sha256Hex(JSON.stringify(tables));
  const generatedAt = new Date();
  const backup = {
    format: 'esmark-admin-backup',
    version: 1,
    generatedAt: generatedAt.toISOString(),
    generatedBy: {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
    },
    source: sourceOrigin(),
    reason: options.reason ?? 'admin-login',
    totalRecords,
    counts,
    dataSha256,
    tables,
  };
  const contents = JSON.stringify(backup);
  const fileName = `respaldo-esmark-completo-${timestampForPath(generatedAt)}.json`;
  const objectPath = [
    String(generatedAt.getUTCFullYear()),
    String(generatedAt.getUTCMonth() + 1).padStart(2, '0'),
    `respaldo-esmark-${timestampForPath(generatedAt)}.json`,
  ].join('/');

  const { error } = await supabase.storage
    .from(BACKUP_BUCKET)
    .upload(objectPath, new Blob([contents], { type: 'application/json' }), {
      contentType: 'application/json',
      cacheControl: 'no-cache',
      upsert: false,
    });

  if (error) {
    throw new Error(`No se pudo guardar el respaldo en Supabase: ${error.message}`);
  }

  const downloadedToDevice = options.downloadToDevice === true;
  if (downloadedToDevice) {
    downloadJsonBackup(fileName, contents);
  }

  return {
    objectPath,
    fileName,
    totalRecords,
    counts,
    sha256: dataSha256,
    sizeBytes: new TextEncoder().encode(contents).byteLength,
    downloadedToDevice,
  };
}

export async function cleanupBackedUpRecords(
  user: AuthUser,
): Promise<AdminCleanupResult> {
  await assertSupabaseAdmin(user);

  const { data, error } = await supabase.rpc('limpiar_registros_respaldados', {
    p_retention_days: CLEANUP_RETENTION_DAYS,
  });

  if (error) {
    throw new Error(`No se pudo limpiar Supabase: ${error.message}`);
  }

  const result = data as AdminCleanupResult | null;
  if (!result?.success) {
    throw new Error(result?.error ?? 'Supabase no confirmÃ³ la limpieza.');
  }

  return result;
}
