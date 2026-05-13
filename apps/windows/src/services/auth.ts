import { supabase } from '../core/supabase';

export const AREAS = ['IMPRESION', 'DISENO', 'SUBLIMACION'] as const;
export type UserArea = (typeof AREAS)[number];

function normalizeUsernameForEmail(username: string): string {
  return username
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9._-]/g, '');
}

function toInternalEmail(username: string): string {
  const normalized = normalizeUsernameForEmail(username);
  if (!normalized) {
    throw new Error('Nombre de usuario invalido. Usa letras o numeros.');
  }
  return `${normalized}@esmark.internal`;
}

function isValidArea(value: string): value is UserArea {
  return (AREAS as readonly string[]).includes(value);
}

function parseArea(value: string | undefined): UserArea | undefined {
  if (!value) return undefined;
  if (isValidArea(value)) return value;

  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  if (normalized.startsWith('disen') || normalized.startsWith('dise')) return 'DISENO';
  if (normalized.startsWith('impre')) return 'IMPRESION';
  if (normalized.startsWith('subli')) return 'SUBLIMACION';
  return undefined;
}

function isPinCredential(secret: string): boolean {
  return /^\d{4}$/.test(secret.trim());
}

function isValidCredential(secret: string): boolean {
  return secret.length >= 6 || isPinCredential(secret);
}

function toSupabaseSecret(secret: string): string {
  const trimmed = secret.trim();
  if (!isPinCredential(trimmed)) return secret;
  return `PIN-${trimmed}-ESM`;
}

export interface AuthUser {
  id: string;
  username: string;
  fullName: string;
  role: 'admin' | 'area';
  area?: UserArea;
}

export function canViewArea(user: AuthUser, targetArea: string): boolean {
  if (user.role === 'admin') return true;
  return !!user.area && user.area === targetArea;
}

export function getAreaScope(user: AuthUser): UserArea | 'ALL' {
  return user.role === 'admin' ? 'ALL' : (user.area ?? 'IMPRESION');
}

async function requireAdminSession(): Promise<void> {
  const current = await getCurrentUser();
  if (!current || current.role !== 'admin') {
    throw new Error('No autorizado: solo el administrador puede realizar esta accion.');
  }
}

export async function signIn(username: string, password: string): Promise<AuthUser> {
  const email = toInternalEmail(username);
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: toSupabaseSecret(password),
  });
  if (error) throw new Error('Usuario o contrasena incorrectos');
  if (!data.user) throw new Error('No se recibio usuario');
  const meta = data.user.user_metadata as { username?: string; full_name?: string; role?: string; area?: string };
  return {
    id: data.user.id,
    username: meta.username ?? username,
    fullName: meta.full_name ?? meta.username ?? username,
    role: meta.role === 'admin' ? 'admin' : 'area',
    area: parseArea(meta.area),
  };
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const meta = user.user_metadata as { username?: string; full_name?: string; role?: string; area?: string };
  if (!meta.username) return null;
  return {
    id: user.id,
    username: meta.username,
    fullName: meta.full_name ?? meta.username,
    role: meta.role === 'admin' ? 'admin' : 'area',
    area: parseArea(meta.area),
  };
}

export interface ManagedUser {
  id: string;
  username: string;
  fullName: string;
  role: 'admin' | 'area';
  area?: UserArea;
  activo: boolean;
  platform: string;
  lastSignInAt?: string;
  lastSeen?: string;
}

async function invokeUserAdmin<T>(body: Record<string, unknown>): Promise<T> {
  await requireAdminSession();
  const { data, error } = await supabase.functions.invoke('manage_users', { body });
  if (error) throw new Error(error.message);

  const response = data as ({ error?: string } & T) | null;
  if (response?.error) throw new Error(response.error);
  if (!response) throw new Error('No se recibio respuesta del servidor.');
  return response;
}

export async function updateLastSeen(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { error } = await supabase.rpc('touch_profile_last_seen');
  if (error) throw error;
}

export interface UpdateUserPayload {
  username: string;
  fullName: string;
  role: 'admin' | 'area';
  area?: UserArea;
  activo: boolean;
  password?: string;
}

export async function listUsers(): Promise<ManagedUser[]> {
  const { users } = await invokeUserAdmin<{ users: Array<Omit<ManagedUser, 'area'> & { area?: string }> }>({ action: 'list' });
  return users.map((user) => ({ ...user, area: parseArea(user.area) }));
}

export async function createUser(
  username: string,
  fullName: string,
  password: string,
  role: 'admin' | 'area',
  area?: UserArea,
): Promise<void> {
  const displayUsername = username.trim().toLowerCase();
  if (!displayUsername) throw new Error('El nombre de usuario es obligatorio.');
  if (!fullName.trim()) throw new Error('El nombre del encargado es obligatorio.');
  if (!normalizeUsernameForEmail(displayUsername)) throw new Error('Nombre de usuario invalido. Usa letras o numeros.');
  if (!isValidCredential(password)) throw new Error('La credencial debe ser una contrasena de 6+ caracteres o un PIN de 4 digitos.');
  if (role === 'area' && !area) throw new Error('Debes seleccionar un area para usuarios de rol Area.');
  if (role === 'area' && area && !isValidArea(area)) throw new Error('Area invalida.');

  await invokeUserAdmin<{ success: boolean }>({
    action: 'create',
    payload: {
      username: displayUsername,
      fullName: fullName.trim(),
      password,
      role,
      area,
    },
  });
}

export async function updateUser(userId: string, payload: UpdateUserPayload): Promise<void> {
  const displayUsername = payload.username.trim().toLowerCase();
  if (!displayUsername) throw new Error('El nombre de usuario es obligatorio.');
  if (!payload.fullName.trim()) throw new Error('El nombre del encargado es obligatorio.');
  if (!normalizeUsernameForEmail(displayUsername)) throw new Error('Nombre de usuario invalido. Usa letras o numeros.');
  if (payload.role === 'area' && !payload.area) throw new Error('Debes seleccionar un area para usuarios de rol Area.');
  if (payload.role === 'area' && payload.area && !isValidArea(payload.area)) throw new Error('Area invalida.');
  if (payload.password && !isValidCredential(payload.password)) {
    throw new Error('La nueva credencial debe ser una contrasena de 6+ caracteres o un PIN de 4 digitos.');
  }

  await invokeUserAdmin<{ success: boolean }>({
    action: 'update',
    userId,
    payload: {
      ...payload,
      username: displayUsername,
      fullName: payload.fullName.trim(),
    },
  });
}

export async function setUserActivo(userId: string, activo: boolean): Promise<void> {
  await invokeUserAdmin<{ success: boolean }>({
    action: 'set_active',
    userId,
    payload: { activo },
  });
}

export async function deleteUser(userId: string): Promise<void> {
  await invokeUserAdmin<{ success: boolean }>({ action: 'delete', userId });
}
