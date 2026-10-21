"use client";
import { useEffect, useState } from "react";

type Row = { id: string; email: string; name: string; role: string };

export default function AdminUsers() {
  const [users, setUsers] = useState<Row[]>([]);
  useEffect(() => { fetch("/api/admin/users").then((r) => r.json()).then(setUsers); }, []);
  return (
    <table>
      <tbody>
        {users.map((u) => (
          <tr key={u.id}><td>{u.name}</td><td>{u.email}</td><td>{u.role}</td></tr>
        ))}
      </tbody>
    </table>
  );
}
