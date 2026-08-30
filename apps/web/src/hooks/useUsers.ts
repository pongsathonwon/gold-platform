import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RegisterInput, UserRoleValue } from "@gold-platform/types";
import { assertOk, client } from "../api/client";

export interface AdminUser {
  id: number;
  name: string;
  username: string;
  role: UserRoleValue;
  /** false once deactivated — the row survives, the login does not */
  active: boolean;
}

/**
 * Every account, deactivated ones included.
 *
 * The list is not filtered server-side and should not be. A deactivated account is exactly what an
 * administrator comes to this page to find — to check somebody really is switched off, or to turn
 * them back on — and hiding it would leave the only route to that a database query.
 */
export function useUsers() {
  return useQuery({
    queryKey: ["users"],
    queryFn: async (): Promise<AdminUser[]> => {
      const res = await client.users.$get();
      await assertOk(res, "โหลดรายชื่อผู้ใช้ไม่สำเร็จ");
      const body = (await res.json()) as { data: AdminUser[] };
      return body.data;
    },
  });
}

function useInvalidateUsers() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["users"] });
}

/**
 * Creates a login. Posts to `/auth/users`, not `/users` — issuing an account is an auth concern and
 * that is where the password is hashed. It returns the created user and no token: the admin keeps
 * their own session.
 */
export function useCreateUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: async (req: RegisterInput) => {
      const res = await client.auth.users.$post({ json: req });
      await assertOk(res, "สร้างผู้ใช้ไม่สำเร็จ");
      return res.json();
    },
    onSuccess: invalidate,
  });
}

/**
 * Deactivates an account.
 *
 * `assertOk` surfaces the server's own message, which matters here more than usual: the two refusals
 * this can hit — deactivating yourself, and removing the last active admin — are business rules with
 * wording the API already owns, and restating them in the client would let the two drift.
 */
export function useDeactivateUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await client.users[":id"].$delete({ param: { id: String(id) } });
      await assertOk(res, "ปิดใช้งานผู้ใช้ไม่สำเร็จ");
      return res.json();
    },
    onSuccess: invalidate,
  });
}

export function useRestoreUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await client.users[":id"].restore.$post({ param: { id: String(id) } });
      await assertOk(res, "เปิดใช้งานผู้ใช้ไม่สำเร็จ");
      return res.json();
    },
    onSuccess: invalidate,
  });
}
