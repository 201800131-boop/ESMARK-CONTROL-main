import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

type UserRole = 'admin' | 'area';

interface UpdateUserPayload {
  username: string;
  fullName: string;
  role: UserRole;
  area?: string;
  activo: boolean;
  password?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}

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

function resolveUserPlatform(user: { app_metadata?: Record<string, unknown> }): string {
  const providersRaw = user.app_metadata?.providers;
  const providers = Array.isArray(providersRaw)
    ? providersRaw.filter((p): p is string => typeof p === 'string')
    : [];

  if (providers.includes('google')) return 'Google';
  if (providers.includes('apple')) return 'Apple';
  if (providers.includes('github')) return 'GitHub';
  if (providers.includes('email')) return 'ESMARK (Usuario/PIN)';
  if (providers.length > 0) return providers.join(', ');
  return 'ESMARK (Interno)';
}

async function requireAdmin(req: Request) {
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) throw new Error('No autorizado: falta sesion.');

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: sessionData, error: sessionError } = await userClient.auth.getUser();
  if (sessionError || !sessionData.user) {
    throw new Error('No autorizado: sesion invalida.');
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: currentUser, error: userError } = await admin.auth.admin.getUserById(sessionData.user.id);
  if (userError || !currentUser.user) {
    throw new Error('No autorizado: usuario no encontrado.');
  }

  const meta = currentUser.user.app_metadata as { role?: string; activo?: boolean };
  if (meta.role !== 'admin' || meta.activo === false) {
    throw new Error('No autorizado: solo el administrador puede realizar esta accion.');
  }

  return admin;
}

function validateUserPayload(payload: UpdateUserPayload): void {
  const username = String(payload.username ?? '').trim().toLowerCase();
  if (!username) throw new Error('El nombre de usuario es obligatorio.');
  if (!String(payload.fullName ?? '').trim()) throw new Error('El nombre del encargado es obligatorio.');
  if (!normalizeUsernameForEmail(username)) throw new Error('Nombre de usuario invalido. Usa letras o numeros.');
  if (payload.role !== 'admin' && payload.role !== 'area') throw new Error('Rol invalido.');
  if (payload.role === 'area' && !payload.area) throw new Error('Debes seleccionar un area para usuarios de rol Area.');
  if (payload.password && !isValidCredential(payload.password)) {
    throw new Error('La credencial debe ser una contrasena de 6+ caracteres o un PIN de 4 digitos.');
  }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      return json({ error: 'Missing Supabase env vars' }, 500);
    }

    const admin = await requireAdmin(req);
    const body = await req.json() as { action?: string; userId?: string; payload?: UpdateUserPayload };

    if (body.action === 'list') {
      const { data, error } = await admin.auth.admin.listUsers();
      if (error) throw error;

      const { data: profilesData } = await admin.from('profiles').select('id, last_seen');
      const lastSeenMap: Record<string, string> = {};
      for (const p of profilesData ?? []) {
        if (p.id && p.last_seen) lastSeenMap[String(p.id)] = String(p.last_seen);
      }

      const users = data.users
        .filter((user) => {
          const meta = user.user_metadata as { username?: string };
          return Boolean(meta.username);
        })
        .map((user) => {
          const meta = user.user_metadata as {
            username?: string;
            full_name?: string;
            role?: string;
            area?: string;
            activo?: boolean;
          };
          const appMeta = user.app_metadata as {
            role?: string;
            area?: string;
            activo?: boolean;
          };
          return {
            id: user.id,
            username: meta.username ?? '',
            fullName: meta.full_name ?? meta.username ?? '',
            role: appMeta.role === 'admin' ? 'admin' : 'area',
            area: appMeta.area ?? meta.area,
            activo: appMeta.activo !== false && meta.activo !== false,
            platform: resolveUserPlatform(user as unknown as { app_metadata?: Record<string, unknown> }),
            lastSignInAt: typeof user.last_sign_in_at === 'string' ? user.last_sign_in_at : undefined,
            lastSeen: lastSeenMap[user.id],
          };
        });

      return json({ users });
    }

    if (body.action === 'create') {
      const payload = body.payload;
      if (!payload) throw new Error('Payload requerido.');
      validateUserPayload(payload);

      const username = payload.username.trim().toLowerCase();
      const { error } = await admin.auth.admin.createUser({
        email: toInternalEmail(username),
        password: toSupabaseSecret(String(payload.password ?? '')),
        email_confirm: true,
        user_metadata: {
          username,
          full_name: payload.fullName.trim(),
          role: payload.role,
          area: payload.role === 'area' ? payload.area : undefined,
          activo: true,
        },
        app_metadata: {
          role: payload.role,
          area: payload.role === 'area' ? payload.area : undefined,
          activo: true,
        },
      });
      if (error) throw error;
      return json({ success: true });
    }

    if (body.action === 'update') {
      const payload = body.payload;
      if (!body.userId) throw new Error('userId requerido.');
      if (!payload) throw new Error('Payload requerido.');
      validateUserPayload(payload);

      const username = payload.username.trim().toLowerCase();
      const { data: currentUser, error: getErr } = await admin.auth.admin.getUserById(body.userId);
      if (getErr || !currentUser.user) throw getErr ?? new Error('Usuario no encontrado.');
      const existingAppMeta = (currentUser.user.app_metadata ?? {}) as Record<string, unknown>;
      const updateData: {
        email: string;
        email_confirm: boolean;
        user_metadata: Record<string, unknown>;
        app_metadata: Record<string, unknown>;
        ban_duration: string;
        password?: string;
      } = {
        email: toInternalEmail(username),
        email_confirm: true,
        user_metadata: {
          username,
          full_name: payload.fullName.trim(),
          role: payload.role,
          area: payload.role === 'area' ? payload.area : undefined,
          activo: payload.activo,
        },
        app_metadata: {
          ...existingAppMeta,
          role: payload.role,
          area: payload.role === 'area' ? payload.area : undefined,
          activo: payload.activo,
        },
        ban_duration: payload.activo ? 'none' : '876600h',
      };

      if (payload.password) {
        updateData.password = toSupabaseSecret(payload.password);
      }

      const { error } = await admin.auth.admin.updateUserById(body.userId, updateData);
      if (error) throw error;
      return json({ success: true });
    }

    if (body.action === 'set_active') {
      if (!body.userId) throw new Error('userId requerido.');
      const activo = Boolean(body.payload?.activo);
      const { data: currentUser, error: getErr } = await admin.auth.admin.getUserById(body.userId);
      if (getErr) throw getErr;
      const existingMeta = (currentUser.user.user_metadata ?? {}) as Record<string, unknown>;
      const existingAppMeta = (currentUser.user.app_metadata ?? {}) as Record<string, unknown>;
      const { error } = await admin.auth.admin.updateUserById(body.userId, {
        user_metadata: { ...existingMeta, activo },
        app_metadata: { ...existingAppMeta, activo },
        ban_duration: activo ? 'none' : '876600h',
      });
      if (error) throw error;
      return json({ success: true });
    }

    if (body.action === 'delete') {
      if (!body.userId) throw new Error('userId requerido.');
      const { error } = await admin.auth.admin.deleteUser(body.userId);
      if (error) throw error;
      return json({ success: true });
    }

    return json({ error: 'Accion no soportada' }, 400);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const status = message.toLowerCase().startsWith('no autorizado') ? 403 : 400;
    return json({ error: message }, status);
  }
});
