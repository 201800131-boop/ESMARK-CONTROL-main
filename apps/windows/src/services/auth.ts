import { supabase } from "../core/supabase";

export type UserArea = string;

export interface AreaCatalogItem {
  id: string;
  code: string;
  nombre: string;
}

function normalizeUsernameForEmail(username: string): string {
  return username
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9._-]/g, "");
}

function toInternalEmail(username: string): string {
  const normalized = normalizeUsernameForEmail(username);
  if (!normalized) {
    throw new Error("Nombre de usuario invalido. Usa letras o numeros.");
  }
  return `${normalized}@esmark.internal`;
}

function isValidArea(value: string): value is UserArea {
  return value.trim().length > 0;
}

function parseArea(value: string | undefined): UserArea | undefined {
  if (!value) return undefined;
  const normalized = value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (!normalized) return undefined;
  if (normalized.startsWith("disen") || normalized.startsWith("dise"))
    return "diseno";
  if (normalized.startsWith("impre")) return "impresion";
  if (normalized.startsWith("subli")) return "sublimacion";
  if (normalized.startsWith("admin")) return "administracion";
  if (normalized.startsWith("alma")) return "almacen";
  return normalized;
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

function toSignInErrorMessage(error: { message?: string }): string {
  const message = String(error.message ?? "");
  const normalized = message.toLowerCase();

  if (
    normalized.includes("quota") ||
    normalized.includes("restricted") ||
    normalized.includes("spend cap") ||
    normalized.includes("egress") ||
    normalized.includes("edge_functions")
  ) {
    return (
      "Supabase restringio el proyecto por limite de uso. " +
      "Revisa la facturacion, el plan o el spend cap antes de volver a iniciar sesion."
    );
  }

  if (
    normalized.includes("network") ||
    normalized.includes("fetch") ||
    normalized.includes("failed to fetch")
  ) {
    return "No se pudo conectar con Supabase. Revisa internet e intenta de nuevo.";
  }

  return "Usuario o contrasena incorrectos";
}

function getStringMetadata(
  metadata: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function usernameFromEmail(email?: string | null): string | undefined {
  if (!email) return undefined;
  const [localPart] = email.split("@");
  return localPart?.trim() || undefined;
}

function resolveAuthUser(
  user: SupabaseAuthUserLike,
  fallbackUsername?: string,
): AuthUser | null {
  const userMeta = user.user_metadata ?? {};
  const appMeta = user.app_metadata ?? {};
  const username =
    getStringMetadata(userMeta, "username") ??
    fallbackUsername?.trim() ??
    usernameFromEmail(user.email);

  if (!username) return null;

  const role =
    getStringMetadata(appMeta, "role") ?? getStringMetadata(userMeta, "role");
  const area =
    getStringMetadata(appMeta, "area") ?? getStringMetadata(userMeta, "area");
  const fullName =
    getStringMetadata(userMeta, "full_name") ??
    getStringMetadata(userMeta, "name") ??
    username;

  return {
    id: user.id,
    username,
    fullName,
    role: role === "admin" ? "admin" : "area",
    area: parseArea(area),
  };
}

export interface AuthUser {
  id: string;
  username: string;
  fullName: string;
  role: "admin" | "area";
  area?: UserArea;
}

type SupabaseAuthUserLike = {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
};

export function canViewArea(user: AuthUser, targetArea: string): boolean {
  if (user.role === "admin") return true;
  return !!user.area && parseArea(user.area) === parseArea(targetArea);
}

export function getAreaScope(user: AuthUser): UserArea | "ALL" {
  return user.role === "admin" ? "ALL" : (user.area ?? "impresion");
}

async function requireAdminSession(): Promise<void> {
  const current = await getCurrentUser();
  if (!current || current.role !== "admin") {
    throw new Error(
      "No autorizado: solo el administrador puede realizar esta accion.",
    );
  }
}

export async function signIn(
  username: string,
  password: string,
): Promise<AuthUser> {
  const email = toInternalEmail(username);
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: toSupabaseSecret(password),
  });
  if (error) throw new Error(toSignInErrorMessage(error));
  if (!data.user) throw new Error("No se recibio usuario");
  const userMeta = data.user.user_metadata as {
    username?: string;
    full_name?: string;
    role?: string;
    area?: string;
    activo?: boolean;
  };
  const appMeta = data.user.app_metadata as { activo?: boolean };
  if (appMeta.activo === false || userMeta.activo === false) {
    await supabase.auth.signOut();
    throw new Error("Este usuario esta inactivo. Pide a administracion que lo active.");
  }
  const authUser = resolveAuthUser(data.user, username);
  if (!authUser) throw new Error("No se pudo leer el perfil del usuario.");
  return authUser;
}

export async function signOut(): Promise<void> {
  try {
    await supabase.rpc("clear_profile_last_seen");
  } catch {
    // La presencia no debe impedir cerrar sesion.
  }
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return resolveAuthUser(user);
}

export interface ManagedUser {
  id: string;
  username: string;
  fullName: string;
  role: "admin" | "area";
  area?: UserArea;
  activo: boolean;
  platform: string;
  lastSignInAt?: string;
  lastSeen?: string;
}

async function invokeUserAdmin<T>(body: Record<string, unknown>): Promise<T> {
  await requireAdminSession();
  const { data, error } = await supabase.functions.invoke("manage_users", {
    body,
  });
  if (error) throw new Error(error.message);

  const response = data as ({ error?: string } & T) | null;
  if (response?.error) throw new Error(response.error);
  if (!response) throw new Error("No se recibio respuesta del servidor.");
  return response;
}

export async function updateLastSeen(): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  const { error } = await supabase.rpc("touch_profile_last_seen");
  if (error) throw error;
}

function toAreaCode(input: string): string {
  return input
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export async function listAreas(): Promise<AreaCatalogItem[]> {
  const { data, error } = await supabase
    .from("areas")
    .select("id,code,nombre")
    .order("nombre", { ascending: true });

  if (error) throw new Error(error.message);

  return (data ?? [])
    .map((item) => ({
      id: String(item.id ?? ""),
      code: toAreaCode(String(item.code ?? "")),
      nombre: String(item.nombre ?? "").trim() || String(item.code ?? ""),
    }))
    .filter((item) => item.id && item.code);
}

export async function createArea(nombre: string): Promise<AreaCatalogItem> {
  await requireAdminSession();

  const cleanName = nombre.trim();
  if (cleanName.length < 2)
    throw new Error("Ingresa un nombre de area valido.");

  const code = toAreaCode(cleanName);
  if (!code) throw new Error("No se pudo generar el codigo del area.");

  const { data, error } = await supabase
    .from("areas")
    .insert({ code, nombre: cleanName })
    .select("id,code,nombre")
    .single();

  if (error) {
    if (error.code === "23505")
      throw new Error("Ya existe un area con ese nombre.");
    throw new Error(error.message);
  }

  return {
    id: String(data.id ?? ""),
    code: toAreaCode(String(data.code ?? code)),
    nombre: String(data.nombre ?? cleanName),
  };
}

export async function renameArea(
  areaId: string,
  nombre: string,
): Promise<AreaCatalogItem> {
  await requireAdminSession();

  const cleanAreaId = areaId.trim();
  const cleanName = nombre.trim();
  if (!cleanAreaId) throw new Error("Area invalida.");
  if (cleanName.length < 2)
    throw new Error("Ingresa un nombre de area valido.");

  const { data, error } = await supabase
    .from("areas")
    .update({ nombre: cleanName })
    .eq("id", cleanAreaId)
    .select("id,code,nombre")
    .single();

  if (error) throw new Error(error.message);

  return {
    id: String(data.id ?? cleanAreaId),
    code: toAreaCode(String(data.code ?? "")),
    nombre: String(data.nombre ?? cleanName),
  };
}

export interface UpdateUserPayload {
  username: string;
  fullName: string;
  role: "admin" | "area";
  area?: UserArea;
  activo: boolean;
  password?: string;
}

export async function listUsers(): Promise<ManagedUser[]> {
  const { users } = await invokeUserAdmin<{
    users: Array<Omit<ManagedUser, "area"> & { area?: string }>;
  }>({ action: "list" });
  return users.map((user) => ({ ...user, area: parseArea(user.area) }));
}

export async function createUser(
  username: string,
  fullName: string,
  password: string,
  role: "admin" | "area",
  area?: UserArea,
): Promise<void> {
  const displayUsername = username.trim().toLowerCase();
  if (!displayUsername) throw new Error("El nombre de usuario es obligatorio.");
  if (!fullName.trim())
    throw new Error("El nombre del encargado es obligatorio.");
  if (!normalizeUsernameForEmail(displayUsername))
    throw new Error("Nombre de usuario invalido. Usa letras o numeros.");
  if (!isValidCredential(password))
    throw new Error(
      "La credencial debe ser una contrasena de 6+ caracteres o un PIN de 4 digitos.",
    );
  if (role === "area" && !area)
    throw new Error("Debes seleccionar un area para usuarios de rol Area.");
  if (role === "area" && area && !isValidArea(area))
    throw new Error("Area invalida.");

  await invokeUserAdmin<{ success: boolean }>({
    action: "create",
    payload: {
      username: displayUsername,
      fullName: fullName.trim(),
      password,
      role,
      area,
    },
  });
}

export async function updateUser(
  userId: string,
  payload: UpdateUserPayload,
): Promise<void> {
  const displayUsername = payload.username.trim().toLowerCase();
  if (!displayUsername) throw new Error("El nombre de usuario es obligatorio.");
  if (!payload.fullName.trim())
    throw new Error("El nombre del encargado es obligatorio.");
  if (!normalizeUsernameForEmail(displayUsername))
    throw new Error("Nombre de usuario invalido. Usa letras o numeros.");
  if (payload.role === "area" && !payload.area)
    throw new Error("Debes seleccionar un area para usuarios de rol Area.");
  if (payload.role === "area" && payload.area && !isValidArea(payload.area))
    throw new Error("Area invalida.");
  if (payload.password && !isValidCredential(payload.password)) {
    throw new Error(
      "La nueva credencial debe ser una contrasena de 6+ caracteres o un PIN de 4 digitos.",
    );
  }

  await invokeUserAdmin<{ success: boolean }>({
    action: "update",
    userId,
    payload: {
      ...payload,
      username: displayUsername,
      fullName: payload.fullName.trim(),
    },
  });
}

export async function setUserActivo(
  userId: string,
  activo: boolean,
): Promise<void> {
  await invokeUserAdmin<{ success: boolean }>({
    action: "set_active",
    userId,
    payload: { activo },
  });
}

export async function deleteUser(userId: string): Promise<void> {
  await invokeUserAdmin<{ success: boolean }>({ action: "delete", userId });
}
