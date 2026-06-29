import { initialTabForRole, type StaffRole } from "./permissions.ts";

export type StaffProfile = {
  id: string;
  username: string;
  role: StaffRole;
  full_name: string;
};

export type AuthSessionClient<TProfile extends StaffProfile> = {
  auth: {
    getSession: () => Promise<{ data?: { session?: unknown | null } | null; error?: unknown }>;
    signInWithPassword: (credentials: {
      email: string;
      password: string;
    }) => Promise<{ error?: unknown }>;
    signOut: () => Promise<unknown>;
    onAuthStateChange: (
      callback: (event: string, session: unknown | null) => void | Promise<void>
    ) => {
      data: {
        subscription: {
          unsubscribe: () => void;
        };
      };
    };
  };
  rpc: (
    name: "get_my_profile",
    args?: Record<string, never>
  ) => PromiseLike<{ data?: TProfile | TProfile[] | null; error?: unknown }>;
};

export type AuthState<TProfile extends StaffProfile> = {
  user: TProfile | null;
  activeTab: ReturnType<typeof initialTabForRole>;
  clearUserData: boolean;
};

function firstProfile<TProfile extends StaffProfile>(
  data: TProfile | TProfile[] | null | undefined
): TProfile | null {
  if (Array.isArray(data)) return data[0] || null;
  return data || null;
}

export async function fetchLinkedStaffProfile<TProfile extends StaffProfile>(
  client: AuthSessionClient<TProfile>
): Promise<TProfile | null> {
  const { data, error } = await client.rpc("get_my_profile");
  if (error) return null;
  return firstProfile(data);
}

export async function restoreStaffSession<TProfile extends StaffProfile>(
  client: AuthSessionClient<TProfile>
): Promise<TProfile | null> {
  const sessionResponse = await client.auth.getSession();
  const session = sessionResponse.data?.session ?? null;

  if (!session) return null;

  const profile = await fetchLinkedStaffProfile(client);
  if (!profile) {
    await client.auth.signOut();
    return null;
  }

  return profile;
}

export async function signInStaffUser<TProfile extends StaffProfile>(
  client: AuthSessionClient<TProfile>,
  username: string,
  password: string
): Promise<TProfile | null> {
  const cleanUsername = username.trim().toLowerCase();
  const cleanPassword = password.trim();

  if (!cleanUsername || !cleanPassword) return null;

  const { error } = await client.auth.signInWithPassword({
    email: `${cleanUsername}@clubone.local`,
    password: cleanPassword,
  });

  if (error) return null;

  const profile = await fetchLinkedStaffProfile(client);
  if (!profile) {
    await client.auth.signOut();
    return null;
  }

  return profile;
}

export async function signOutStaffUser<TProfile extends StaffProfile>(
  client: AuthSessionClient<TProfile>
): Promise<AuthState<TProfile>> {
  await client.auth.signOut();
  return {
    user: null,
    activeTab: "plan",
    clearUserData: true,
  };
}

export function subscribeStaffAuthState<TProfile extends StaffProfile>(
  client: AuthSessionClient<TProfile>,
  onProfile: (profile: TProfile | null) => void
) {
  const { data } = client.auth.onAuthStateChange(async (_event, session) => {
    if (!session) {
      onProfile(null);
      return;
    }

    const profile = await fetchLinkedStaffProfile(client);
    if (!profile) {
      await client.auth.signOut();
      onProfile(null);
      return;
    }

    onProfile(profile);
  });

  return () => {
    data.subscription.unsubscribe();
  };
}
