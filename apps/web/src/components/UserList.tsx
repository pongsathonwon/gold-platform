import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { client } from "../api/client";

async function fetchUsers() {
  const res = await client.users.$get();
  if (!res.ok) throw new Error("Failed to fetch users");
  return res.json();
}

async function createUser(data: { name: string; email: string }) {
  const res = await client.users.$post({ json: data });
  if (!res.ok) throw new Error("Failed to create user");
  return res.json();
}

export function UserList() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  const { data: users, isPending } = useQuery({
    queryKey: ["users"],
    queryFn: fetchUsers,
  });

  const mutation = useMutation({
    mutationFn: createUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setName("");
      setEmail("");
    },
  });

  return (
    <div>
      <h2>Users</h2>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate({ name, email });
        }}
      >
        <input
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? "Adding…" : "Add User"}
        </button>
      </form>

      {isPending && <p>Loading…</p>}
      {users && (
        <ul>
          {users.map((user) => (
            <li key={user.id}>
              {user.name} — {user.email}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
