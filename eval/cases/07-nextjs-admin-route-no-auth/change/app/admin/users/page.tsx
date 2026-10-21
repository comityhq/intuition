"use client";
import { useEffect, useState } from "react";

type Row = { id: string; email: string; name: string; role: string };

export default function AdminUsers() {
  const [users, setUsers] = useState<Row[]>([]);
  const load = () => fetch("/api/admin/users").then((r) => r.json()).then(setUsers);
  useEffect(() => { load(); }, []);

  async function setRole(id: string, role: string) {
    await fetch(`/api/admin/users/${id}`, { method: "PATCH", body: JSON.stringify({ role }) });
    load();
  }

  async function remove(id: string) {
    if (!confirm("Delete this user and all their shifts?")) return;
    await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <table>
      <tbody>
        {users.map((u) => (
          <tr key={u.id}>
            <td>{u.name}</td><td>{u.email}</td>
            <td>
              <select value={u.role} onChange={(e) => setRole(u.id, e.target.value)}>
                <option>member</option><option>manager</option><option>admin</option>
              </select>
            </td>
            <td><button onClick={() => remove(u.id)}>Delete</button></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
