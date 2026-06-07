import type { Metadata } from "next";
import AdminLayoutClient from "./_components/AdminLayoutClient";

export const metadata: Metadata = {
  title: "BW5 Admin",
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminLayoutClient>{children}</AdminLayoutClient>;
}
