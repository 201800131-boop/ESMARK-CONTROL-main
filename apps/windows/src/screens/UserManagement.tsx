import React from 'react';
import {
  AREAS,
  listUsers,
  createUser,
  updateUser,
  setUserActivo,
  deleteUser,
  type ManagedUser,
  type UserArea,
} from '../services/auth';
import { supabase } from '../core/supabase';

function formatAreaLabel(area?: string): string {
  const normalized = String(area ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  if (normalized.startsWith('impre')) return 'IMPRESIÓN';
  if (normalized.startsWith('disen')) return 'DISEÑO';
  if (normalized.startsWith('subli')) return 'SUBLIMACIÓN';
  if (normalized.startsWith('admin')) return 'ADMINISTRACIÓN';
  return area ?? 'Sin área';
}

function formatCargo(role: 'admin' | 'area'): string {
  return role === 'admin' ? 'Administrador' : 'Jefe de Área';
}

function formatLastSignIn(value?: string): string {
  if (!value) return 'Nunca';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Nunca';
  return date.toLocaleString('es-HN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function isConnectedNow(value?: string): boolean {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const diffMs = Date.now() - date.getTime();
  return diffMs >= 0 && diffMs <= 15 * 60 * 1000;
}

function isConnectedNowRealtime(lastSeen?: string): boolean {
  if (!lastSeen) return false;
  const date = new Date(lastSeen);
  if (Number.isNaN(date.getTime())) return false;
  const diffMs = Date.now() - date.getTime();
  return diffMs >= 0 && diffMs <= 90_000; // 90 segundos
}

function isRecentlyActive(lastSeen?: string, lastSignInAt?: string): boolean {
  return isConnectedNowRealtime(lastSeen) || isConnectedNow(lastSignInAt);
}

export function UserManagement({ currentUserId, currentUsername }: { currentUserId: string; currentUsername: string }): React.JSX.Element {
  const [users, setUsers] = React.useState<ManagedUser[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [showForm, setShowForm] = React.useState(false);

  // Formulario nuevo usuario
  const [newUsername, setNewUsername] = React.useState('');
  const [newFullName, setNewFullName] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [newCredentialType, setNewCredentialType] = React.useState<'password' | 'pin'>('password');
  const [newRole, setNewRole] = React.useState<'admin' | 'area'>('area');
  const [newArea, setNewArea] = React.useState<UserArea>('IMPRESION');
  const [creating, setCreating] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState('');

  // Edicion
  const [editing, setEditing] = React.useState<ManagedUser | null>(null);
  const [editUsername, setEditUsername] = React.useState('');
  const [editFullName, setEditFullName] = React.useState('');
  const [editRole, setEditRole] = React.useState<'admin' | 'area'>('area');
  const [editArea, setEditArea] = React.useState<UserArea>('IMPRESION');
  const [editActivo, setEditActivo] = React.useState(true);
  const [editPassword, setEditPassword] = React.useState('');
  const [editCredentialType, setEditCredentialType] = React.useState<'password' | 'pin'>('password');
  const [savingEdit, setSavingEdit] = React.useState(false);
  const [editError, setEditError] = React.useState<string | null>(null);

  function isValidCredential(value: string, kind: 'password' | 'pin'): boolean {
    if (kind === 'pin') return /^\d{4}$/.test(value);
    return value.length >= 6;
  }

  async function loadUsers(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      setUsers(await listUsers());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar usuarios');
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    void loadUsers();
  }, []);

  // Tick cada 10s para re-evaluar quién está conectado sin refrescar toda la lista
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 10_000);
    return () => clearInterval(interval);
  }, []);

  // Realtime: actualizar last_seen al vuelo cuando llega un heartbeat
  React.useEffect(() => {
    const channel = supabase
      .channel('profiles-presence')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles' },
        (payload) => {
          const updated = payload.new as { id?: string; last_seen?: string };
          if (!updated.id) return;
          setUsers((prev) =>
            prev.map((u) =>
              u.id === updated.id ? { ...u, lastSeen: updated.last_seen } : u,
            ),
          );
        },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, []);

  async function handleCreate(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setFormError(null);
    if (!newUsername.trim() || !newFullName.trim() || !newPassword) {
      setFormError('Completa todos los campos.');
      return;
    }
    if (!isValidCredential(newPassword, newCredentialType)) {
      setFormError(newCredentialType === 'pin'
        ? 'El PIN debe tener exactamente 4 dígitos numéricos.'
        : 'La contraseña debe tener al menos 6 caracteres.');
      return;
    }
    if (newRole === 'area' && !newArea) {
      setFormError('Selecciona un área para el usuario.');
      return;
    }
    setCreating(true);
    try {
      await createUser(
        newUsername.trim(),
        newFullName.trim(),
        newPassword,
        newRole,
        newRole === 'area' ? newArea : undefined,
      );
      setNewUsername('');
      setNewFullName('');
      setNewPassword('');
      setNewCredentialType('password');
      setNewRole('area');
      setNewArea('IMPRESION');
      setShowForm(false);
      await loadUsers();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Error al crear usuario');
    } finally {
      setCreating(false);
    }
  }

  async function handleToggle(user: ManagedUser): Promise<void> {
    try {
      await setUserActivo(user.id, !user.activo);
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al actualizar usuario');
    }
  }

  async function handleDelete(user: ManagedUser): Promise<void> {
    if (!window.confirm(`¿Eliminar el usuario "${user.username}"? Esta acción no se puede deshacer.`)) return;
    try {
      await deleteUser(user.id);
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al eliminar usuario');
    }
  }

  function openEdit(user: ManagedUser): void {
    setEditing(user);
    setEditUsername(user.username);
    setEditFullName(user.fullName);
    setEditRole(user.role);
    setEditArea(user.area ?? 'IMPRESION');
    setEditActivo(user.activo);
    setEditPassword('');
    setEditCredentialType('password');
    setEditError(null);
  }

  function closeEdit(): void {
    setEditing(null);
    setEditError(null);
    setEditPassword('');
  }

  async function handleSaveEdit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!editing) return;
    setEditError(null);

    const nextSecret = editPassword.trim();
    if (nextSecret && !isValidCredential(nextSecret, editCredentialType)) {
      setEditError(editCredentialType === 'pin'
        ? 'El PIN debe tener exactamente 4 dígitos numéricos.'
        : 'La nueva contraseña debe tener al menos 6 caracteres.');
      return;
    }

    setSavingEdit(true);
    try {
      await updateUser(editing.id, {
        username: editUsername,
        fullName: editFullName,
        role: editRole,
        area: editRole === 'area' ? editArea : undefined,
        activo: editActivo,
        password: nextSecret || undefined,
      });
      closeEdit();
      await loadUsers();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Error al guardar cambios');
    } finally {
      setSavingEdit(false);
    }
  }

  const filteredUsers = users.filter((u) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      u.username.toLowerCase().includes(q)
      || u.fullName.toLowerCase().includes(q)
      || u.role.toLowerCase().includes(q)
      || (u.area ?? '').toLowerCase().includes(q)
    );
  });

  const total = users.length;
  const active = users.filter((u) => u.activo).length;
  const admins = users.filter((u) => u.role === 'admin').length;
  const areaUsers = users.filter((u) => u.role === 'area').length;
  const normalizeUserKey = (value: string): string => String(value ?? '').trim().toLowerCase();
  const isCurrentSessionUser = (user: ManagedUser): boolean => {
    const sessionId = normalizeUserKey(currentUserId);
    const sessionUsername = normalizeUserKey(currentUsername);
    const rowId = normalizeUserKey(user.id);
    const rowUsername = normalizeUserKey(user.username);
    return Boolean(sessionId && rowId === sessionId) || Boolean(sessionUsername && rowUsername === sessionUsername);
  };
  const isUserVisibleActive = (user: ManagedUser): boolean => user.activo && (isRecentlyActive(user.lastSeen, user.lastSignInAt) || isCurrentSessionUser(user));
  const connectedNow = users.filter((u) => isUserVisibleActive(u));
  const activeUsersOnPlatform = users
    .filter((u) => u.activo && !isCurrentSessionUser(u))
    .sort((a, b) => {
      // Conectados primero, luego por last_seen desc
      const aC = isUserVisibleActive(a) ? 1 : 0;
      const bC = isUserVisibleActive(b) ? 1 : 0;
      if (bC !== aC) return bC - aC;
      return String(b.lastSeen ?? b.lastSignInAt ?? '').localeCompare(String(a.lastSeen ?? a.lastSignInAt ?? ''));
    });

  return (
    <div style={styles.container}>
      <div style={{ ...styles.header, justifyContent: 'flex-end' }}>
        <button style={styles.addBtn} onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancelar' : '+ Nuevo usuario'}
        </button>
      </div>

      {/* Formulario de nuevo usuario */}
      {showForm && (
        <div style={styles.formCard}>
          <h3 style={styles.formTitle}>Crear usuario</h3>
          <form onSubmit={(e) => void handleCreate(e)} style={styles.form}>
            <div style={styles.formRow}>
              <input
                style={styles.input}
                type="text"
                placeholder="Nombre de usuario"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                autoCapitalize="none"
                autoComplete="off"
                autoFocus
              />
              <input
                style={styles.input}
                type="text"
                placeholder="Nombre del encargado (ej. Olga Sarmiento)"
                value={newFullName}
                onChange={(e) => setNewFullName(e.target.value)}
              />
              <input
                style={styles.input}
                type="password"
                placeholder={newCredentialType === 'pin' ? 'PIN de 4 dígitos' : 'Contraseña (mín. 6 caracteres)'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                inputMode={newCredentialType === 'pin' ? 'numeric' : undefined}
                maxLength={newCredentialType === 'pin' ? 4 : undefined}
              />
              <select
                style={styles.select}
                value={newCredentialType}
                onChange={(e) => {
                  setNewCredentialType(e.target.value as 'password' | 'pin');
                  setNewPassword('');
                }}
                title="Tipo de credencial"
              >
                <option value="password">Contraseña</option>
                <option value="pin">PIN (4 dígitos)</option>
              </select>
              <select
                style={styles.select}
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as 'admin' | 'area')}
              >
                <option value="area">Área</option>
                <option value="admin">Administrador</option>
              </select>
              {newRole === 'area' && (
                <select
                  style={styles.select}
                  value={newArea}
                  onChange={(e) => setNewArea(e.target.value as UserArea)}
                >
                  {AREAS.map((area) => (
                    <option key={area} value={area}>{formatAreaLabel(area)}</option>
                  ))}
                </select>
              )}
              <button type="submit" style={styles.createBtn}>
                {creating ? 'Creando…' : 'Crear'}
              </button>
            </div>
            {formError && <p style={styles.errorText}>{formError}</p>}
          </form>
        </div>
      )}

      {/* Tabla de usuarios */}
      {error && <p style={styles.errorText}>{error}</p>}

      <div style={styles.kpisRow}>
        <KpiCard label="Total" value={String(total)} />
        <KpiCard label="Activos" value={String(active)} />
        <KpiCard label="Administradores" value={String(admins)} />
        <KpiCard label="Usuarios de Área" value={String(areaUsers)} />
      </div>

      <div style={styles.kpisRow}>
        <KpiCard label="En línea ahora" value={String(connectedNow.length)} highlight />
      </div>

      <div style={styles.searchWrap}>
        <input
          style={styles.searchInput}
          placeholder="Buscar por usuario, rol o área..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div style={styles.activePanel}>
        <h3 style={styles.activePanelTitle}>Usuarios activos en plataforma {connectedNow.length > 0 && <span style={styles.connectedBadge}>{connectedNow.length} en línea</span>}</h3>
        <div style={styles.activeInlineRow}>
          <div
            style={{
              ...styles.activeChip,
              ...styles.activeChipOnline,
            }}
          >
            <span style={{ ...styles.activeDot, ...styles.activeDotOnline }} title="Conectado" />
            <div style={styles.activeChipTextWrap}>
              <div style={{ ...styles.activeChipName, ...styles.activeChipOnlineText }}>Tú</div>
              <div style={{ ...styles.activeChipMeta, ...styles.activeChipOnlineText }}>
                Conectado ahora · {currentUsername}
              </div>
            </div>
          </div>

          {activeUsersOnPlatform.map((u) => {
            const connected = isUserVisibleActive(u);
            return (
              <div
                key={`active-${u.id}`}
                style={{
                  ...styles.activeChip,
                  ...(connected ? styles.activeChipOnline : styles.activeChipOffline),
                }}
              >
                <span
                  style={{
                    ...styles.activeDot,
                    ...(connected ? styles.activeDotOnline : styles.activeDotOffline),
                  }}
                  title={connected ? 'Conectado' : 'Sin conexión'}
                />
                <div style={styles.activeChipTextWrap}>
                  <div style={{ ...styles.activeChipName, ...(connected ? styles.activeChipOnlineText : {}) }}>{u.fullName || u.username}</div>
                  <div style={{ ...styles.activeChipMeta, ...(connected ? styles.activeChipOnlineText : {}) }}>
                    {connected ? 'En línea' : 'Sin conexión'} · {u.platform} · {u.lastSeen ? formatLastSignIn(u.lastSeen) : formatLastSignIn(u.lastSignInAt)}
                  </div>
                </div>
              </div>
            );
          })}
          {activeUsersOnPlatform.length === 0 && (
            <div style={styles.activeEmpty}>No hay usuarios activos.</div>
          )}
        </div>
      </div>

      {loading ? (
        <p style={styles.loadingText}>Cargando usuarios…</p>
      ) : (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Usuario</th>
              <th style={styles.th}>Encargado</th>
              <th style={styles.th}>Rol</th>
              <th style={styles.th}>Área</th>
              <th style={styles.th}>Estado</th>
              <th style={styles.th}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.map((u) => (
              <tr key={u.id} style={styles.tr}>
                <td style={styles.td}>{u.username}</td>
                <td style={styles.td}>
                  <div style={styles.encargadoCell}>
                    <span style={styles.encargadoName}>{u.fullName || 'Sin nombre'}</span>
                    <span style={styles.encargadoCargo}>{formatCargo(u.role)}</span>
                  </div>
                </td>
                <td style={styles.td}>
                  <span style={{ ...styles.badge, ...(u.role === 'admin' ? styles.badgeAdmin : styles.badgeArea) }}>
                    {u.role === 'admin' ? 'Administrador' : 'Área'}
                  </span>
                </td>
                <td style={styles.td}>{u.role === 'admin' ? 'TODAS' : formatAreaLabel(u.area)}</td>
                <td style={styles.td}>
                  <span style={{ ...styles.badge, ...(u.activo ? styles.badgeActivo : styles.badgeInactivo) }}>
                    {u.activo ? 'Activo' : 'Inactivo'}
                  </span>
                </td>
                <td style={styles.td}>
                  <div style={styles.actionGroup}>
                    <button
                      style={{ ...styles.actionBtn, ...styles.actionBtnPrimary }}
                      onClick={() => openEdit(u)}
                    >
                      Editar
                    </button>
                    <button
                      style={{ ...styles.actionBtn, ...(u.activo ? styles.actionBtnWarn : styles.actionBtnOk) }}
                      onClick={() => void handleToggle(u)}
                    >
                      {u.activo ? 'Desactivar' : 'Activar'}
                    </button>
                    <button
                      style={{ ...styles.actionBtn, ...styles.actionBtnDanger }}
                      onClick={() => void handleDelete(u)}
                    >
                      Eliminar
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filteredUsers.length === 0 && (
              <tr>
                <td colSpan={6} style={{ ...styles.td, textAlign: 'center', color: '#999' }}>
                  No hay usuarios
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {editing && (
        <div style={styles.modalBackdrop}>
          <div style={styles.modalCard}>
            <h3 style={styles.modalTitle}>Editar usuario</h3>
            <form onSubmit={(e) => void handleSaveEdit(e)} style={styles.modalForm}>
              <label style={styles.modalLabel}>Nombre de usuario</label>
              <input
                style={styles.input}
                value={editUsername}
                onChange={(e) => setEditUsername(e.target.value)}
                autoFocus
              />

              <label style={styles.modalLabel}>Nombre del encargado</label>
              <input
                style={styles.input}
                value={editFullName}
                onChange={(e) => setEditFullName(e.target.value)}
              />

              <label style={styles.modalLabel}>Rol</label>
              <select
                style={styles.select}
                value={editRole}
                onChange={(e) => setEditRole(e.target.value as 'admin' | 'area')}
              >
                <option value="admin">Administrador</option>
                <option value="area">Área</option>
              </select>

              {editRole === 'area' && (
                <>
                  <label style={styles.modalLabel}>Área</label>
                  <select
                    style={styles.select}
                    value={editArea}
                    onChange={(e) => setEditArea(e.target.value as UserArea)}
                  >
                    {AREAS.map((area) => (
                      <option key={area} value={area}>{formatAreaLabel(area)}</option>
                    ))}
                  </select>
                </>
              )}

              <label style={styles.modalLabel}>Tipo de credencial</label>
              <select
                style={styles.select}
                value={editCredentialType}
                onChange={(e) => {
                  setEditCredentialType(e.target.value as 'password' | 'pin');
                  setEditPassword('');
                }}
              >
                <option value="password">Contraseña</option>
                <option value="pin">PIN (4 dígitos)</option>
              </select>

              <label style={styles.modalLabel}>{editCredentialType === 'pin' ? 'Nuevo PIN (opcional)' : 'Nueva contraseña (opcional)'}</label>
              <input
                style={styles.input}
                type="password"
                value={editPassword}
                onChange={(e) => setEditPassword(e.target.value)}
                placeholder={editCredentialType === 'pin' ? '4 dígitos (dejar vacío para no cambiar)' : 'Dejar vacío para no cambiar'}
                autoComplete="new-password"
                inputMode={editCredentialType === 'pin' ? 'numeric' : undefined}
                maxLength={editCredentialType === 'pin' ? 4 : undefined}
              />

              <label style={styles.checkboxRow}>
                <input
                  type="checkbox"
                  checked={editActivo}
                  onChange={(e) => setEditActivo(e.target.checked)}
                />
                Usuario activo
              </label>

              {editError && <p style={styles.errorText}>{editError}</p>}

              <div style={styles.modalActions}>
                <button type="button" style={styles.cancelBtn} onClick={closeEdit}>
                  Cancelar
                </button>
                <button type="submit" style={styles.saveBtn}>
                  {savingEdit ? 'Guardando…' : 'Guardar cambios'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function KpiCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }): React.JSX.Element {
  return (
    <div style={{ ...styles.kpiCard, ...(highlight ? styles.kpiCardHighlight : {}) }}>
      <div style={styles.kpiLabel}>{label}</div>
      <div style={{ ...styles.kpiValue, ...(highlight ? styles.kpiValueHighlight : {}) }}>{value}</div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: '0' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  title: { fontSize: 20, fontWeight: 700, color: '#1a1a2e' },
  addBtn: {
    padding: '9px 20px', backgroundColor: '#1a73e8', color: '#fff',
    border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer',
  },
  formCard: {
    backgroundColor: '#f8faff', border: '1px solid #d0e2ff',
    borderRadius: 10, padding: 20, marginBottom: 24,
  },
  formTitle: { fontSize: 15, fontWeight: 600, color: '#1a1a2e', marginBottom: 14 },
  form: {},
  formRow: { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' },
  input: {
    flex: 1, minWidth: 160, padding: '10px 14px',
    borderRadius: 8, border: '1px solid #dde1e7', fontSize: 14,
  },
  select: {
    padding: '10px 14px', borderRadius: 8, border: '1px solid #dde1e7', fontSize: 14, background: '#fff',
  },
  createBtn: {
    padding: '10px 22px', backgroundColor: '#43a047', color: '#fff',
    border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer',
  },
  errorText: {
    color: '#d32f2f', fontSize: 13, backgroundColor: '#fdecea',
    padding: '8px 12px', borderRadius: 6, marginTop: 10,
  },
  loadingText: { color: '#999', fontSize: 14, padding: '20px 0' },
  kpisRow: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(120px, 1fr))', gap: 12, marginBottom: 14 },
  kpiCard: { backgroundColor: '#fff', border: '1px solid #e8ecf3', borderRadius: 10, padding: '10px 12px' },
  kpiLabel: { fontSize: 12, color: '#6b7280', marginBottom: 6 },
  kpiValue: { fontSize: 24, fontWeight: 700, color: '#111827' },
  kpiCardHighlight: { backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0' },
  kpiValueHighlight: { color: '#15803d' },
  connectedBadge: {
    display: 'inline-block', marginLeft: 8, padding: '2px 8px',
    backgroundColor: '#22c55e', color: '#fff',
    borderRadius: 999, fontSize: 12, fontWeight: 700, verticalAlign: 'middle',
  },
  searchWrap: { marginBottom: 12 },
  searchInput: {
    width: '100%', padding: '11px 12px', borderRadius: 8,
    border: '1px solid #dbe1ea', fontSize: 14, backgroundColor: '#fff',
  },
  activePanel: {
    backgroundColor: '#f8fbff',
    border: '1px solid #dbeafe',
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
  },
  activePanelTitle: { fontSize: 14, fontWeight: 700, color: '#0f172a', marginBottom: 8 },
  activeInlineRow: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  activeChip: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 999,
    padding: '8px 12px',
    minWidth: 260,
    maxWidth: '100%',
  },
  activeChipOnline: {
    backgroundColor: '#16a34a',
    borderColor: '#16a34a',
    boxShadow: '0 0 0 1px rgba(22,163,74,.35) inset',
  },
  activeChipOffline: {
    backgroundColor: '#fff',
    borderColor: '#e2e8f0',
  },
  activeDot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    marginTop: 4,
    flexShrink: 0,
  },
  activeDotOnline: { backgroundColor: '#22c55e', boxShadow: '0 0 0 3px rgba(34,197,94,.18)' },
  activeDotOffline: { backgroundColor: '#94a3b8', boxShadow: '0 0 0 3px rgba(148,163,184,.2)' },
  activeChipTextWrap: { display: 'flex', flexDirection: 'column', minWidth: 0 },
  activeChipName: { fontSize: 13, fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  activeChipMeta: { fontSize: 12, color: '#475569', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  activeChipOnlineText: { color: '#ffffff' },
  activeEmpty: { fontSize: 13, color: '#64748b', padding: '6px 2px' },
  table: { width: '100%', borderCollapse: 'collapse', backgroundColor: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.07)' },
  th: { padding: '12px 16px', textAlign: 'left', fontSize: 12, fontWeight: 700, color: '#666', backgroundColor: '#f8f9fa', borderBottom: '1px solid #eee', textTransform: 'uppercase' as const },
  tr: { borderBottom: '1px solid #f0f0f0' },
  td: { padding: '12px 16px', fontSize: 14, color: '#1a1a2e' },
  encargadoCell: { display: 'flex', flexDirection: 'column', gap: 2 },
  encargadoName: { fontWeight: 600, color: '#0f172a' },
  encargadoCargo: { fontSize: 12, color: '#475569' },
  badge: { padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600 },
  badgeAdmin: { backgroundColor: '#e8f0fe', color: '#1a73e8' },
  badgeArea: { backgroundColor: '#e8f5e9', color: '#2e7d32' },
  badgeActivo: { backgroundColor: '#16a34a', color: '#ffffff', border: '1px solid #16a34a' },
  badgeInactivo: { backgroundColor: '#fce4e4', color: '#c62828' },
  actionGroup: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  actionBtn: {
    minWidth: 92,
    padding: '7px 12px',
    borderRadius: 10,
    border: '1px solid transparent',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
    textAlign: 'center',
  },
  actionBtnPrimary: { backgroundColor: '#dbeafe', color: '#1d4ed8', borderColor: '#bfdbfe' },
  actionBtnWarn: { backgroundColor: '#ffedd5', color: '#c2410c', borderColor: '#fed7aa' },
  actionBtnOk: { backgroundColor: '#dcfce7', color: '#166534', borderColor: '#bbf7d0' },
  actionBtnDanger: { backgroundColor: '#fee2e2', color: '#b91c1c', borderColor: '#fecaca' },
  modalBackdrop: {
    position: 'fixed', inset: 0, backgroundColor: 'rgba(15, 23, 42, 0.45)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 30,
  },
  modalCard: {
    width: 'min(520px, 100%)', backgroundColor: '#fff', borderRadius: 12,
    padding: 20, boxShadow: '0 18px 45px rgba(17,24,39,0.28)',
  },
  modalTitle: { fontSize: 20, fontWeight: 700, marginBottom: 14, color: '#111827' },
  modalForm: { display: 'flex', flexDirection: 'column', gap: 9 },
  modalLabel: { fontSize: 13, fontWeight: 600, color: '#374151' },
  checkboxRow: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#1f2937', marginTop: 6 },
  modalActions: { display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 },
  cancelBtn: {
    padding: '10px 16px', borderRadius: 8, border: '1px solid #d1d5db',
    backgroundColor: '#fff', color: '#374151', fontWeight: 600, cursor: 'pointer',
  },
  saveBtn: {
    padding: '10px 16px', borderRadius: 8, border: 'none',
    backgroundColor: '#2563eb', color: '#fff', fontWeight: 600, cursor: 'pointer',
  },
};
