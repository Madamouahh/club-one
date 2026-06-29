import {
  canAccessTable,
  canEditTable,
  canUseCriticalAction,
  type PermissionTable,
  type PermissionUser,
} from "./permissions.ts";

export type AuthorizedTable = PermissionTable & {
  id: string;
};

export type AuthorizationResult = {
  ok: boolean;
  message?: string;
};

const unauthorizedMessage = "Action non autorisee pour ce role.";

function assignmentChanged(current: PermissionTable, next: PermissionTable) {
  return (current.assignedTo || "") !== (next.assignedTo || "");
}

export function authorizeTableMutation(input: {
  user: PermissionUser | null;
  currentTable: AuthorizedTable | null | undefined;
  nextTable?: PermissionTable | null;
}): AuthorizationResult {
  const { user, currentTable, nextTable } = input;

  if (!user || !currentTable) {
    return { ok: false, message: unauthorizedMessage };
  }

  if (!canAccessTable(currentTable, user) || !canEditTable(currentTable, user)) {
    return { ok: false, message: unauthorizedMessage };
  }

  if (
    nextTable &&
    assignmentChanged(currentTable, nextTable) &&
    !canUseCriticalAction(user.role, "canAssignTables")
  ) {
    return { ok: false, message: unauthorizedMessage };
  }

  return { ok: true };
}

export function authorizeTableGroupMutation(input: {
  user: PermissionUser | null;
  currentTables: AuthorizedTable[];
  nextTables: AuthorizedTable[];
}): AuthorizationResult {
  const { user, currentTables, nextTables } = input;

  if (!user || currentTables.length === 0 || currentTables.length !== nextTables.length) {
    return { ok: false, message: unauthorizedMessage };
  }

  for (const currentTable of currentTables) {
    const nextTable = nextTables.find((table) => table.id === currentTable.id);
    const result = authorizeTableMutation({
      user,
      currentTable,
      nextTable,
    });

    if (!result.ok) return result;
  }

  return { ok: true };
}

export async function runAuthorizedMutation<T>(input: {
  authorization: AuthorizationResult;
  mutate: () => Promise<T> | T;
}): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  if (!input.authorization.ok) {
    return {
      ok: false,
      message: input.authorization.message || unauthorizedMessage,
    };
  }

  return {
    ok: true,
    data: await input.mutate(),
  };
}
