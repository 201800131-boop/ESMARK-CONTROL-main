import { supabase } from '../core/supabase';

export interface AuthUser {
  id: string;
  email: string | undefined;
}

export async function signIn(
  email: string,
  password: string,
): Promise<AuthUser> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw error;
  if (!data.user) throw new Error('No user returned');
  return { id: data.user.id, email: data.user.email };
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return { id: user.id, email: user.email };
}
